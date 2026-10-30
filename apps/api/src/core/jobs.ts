import { eq, sql } from 'drizzle-orm';
import { tenants } from '../db/control/schema';
import { jobs as email } from './email/jobs';
import { jobs as onlineMeetings } from './online-meetings/jobs';
import { jobs as attendance } from '../modules/attendance/jobs';
import { jobs as communication } from '../modules/communication/jobs';
import { jobs as exams } from '../modules/exams/jobs';
import { jobs as fees } from '../modules/fees/jobs';
import { jobs as learning } from '../modules/learning/jobs';
import { jobs as operations } from '../modules/operations/jobs';
import { controlDb } from './tenancy/control-db';
import { tenantDb, type Executor } from './tenancy/pools';
import { tenantByCode, type TenantInfo } from './tenancy/registry';

export interface Job {
  /** unique, e.g. "fees.reminders" */
  name: string;
  /** how often to run per school */
  everyMinutes: number;
  /** sub-minute jobs (the email sender): run on the 10-second tick instead of the minute tick, at most this often */
  everySeconds?: number;
  /** the job takes its own short locks and must NOT be wrapped in a long transaction (it does network I/O); `db` is then the plain school handle */
  selfLocking?: boolean;
  /**
   * Must be IDEMPOTENT (safe to run twice / from two instances). Receives a transaction that holds a per-school,
   * per-job advisory lock, so two API instances never run the same job for the same school at once.
   */
  run(tenant: TenantInfo, db: Executor): Promise<void>;
}

export const ALL_JOBS: Job[] = [...attendance, ...learning, ...exams, ...fees, ...communication, ...operations, ...email, ...onlineMeetings];

const lastRun = new Map<string, number>();
const FAST_TICK_MS = 10_000;
const FAST_CONCURRENCY = 4;

export async function runJobOnce(tenant: TenantInfo, job: Job): Promise<boolean> {
  if (job.selfLocking) {
    await job.run(tenant, tenantDb(tenant));
    return true;
  }
  return tenantDb(tenant).transaction(async (tx) => {
    const [r] = await tx.execute<{ ok: boolean }>(sql`select pg_try_advisory_xact_lock(hashtext(${`job:${job.name}`})) as ok`).then((x) => x.rows);
    if (!r?.ok) return false;
    await job.run(tenant, tx as unknown as Executor);
    return true;
  });
}

/** Ticks once a minute; runs each due job for every active school. Started by main.ts when RUN_WORKERS=true. */
export function startJobScheduler(log: { error: (o: unknown, m?: string) => void } = console as never): () => void {
  const tick = async () => {
    try {
      const active = await controlDb().select({ code: tenants.code }).from(tenants).where(eq(tenants.status, 'active'));
      for (const { code } of active) {
        const tenant = await tenantByCode(code);
        if (!tenant) continue;
        for (const job of ALL_JOBS) {
          if (job.everySeconds) continue; // sub-minute jobs run on the fast tick below
          const key = `${code}:${job.name}`;
          if (Date.now() - (lastRun.get(key) ?? 0) < job.everyMinutes * 60_000) continue;
          lastRun.set(key, Date.now());
          await runJobOnce(tenant, job).catch((e) => log.error({ err: e, job: job.name, site: code }, 'job failed'));
        }
      }
    } catch (e) {
      log.error(e, 'job scheduler tick failed');
    }
  };
  const timer = setInterval(() => void tick(), 60_000);
  timer.unref();

  // Fast tick (every 10 s) for sub-minute jobs (outgoing email). Schools are visited round-robin starting one further each tick and
  // a few at a time, so one slow mail server cannot hold up the others; a tick that is still running is not started twice.
  let fastBusy = false;
  let rotate = 0;
  const fastTick = async () => {
    if (fastBusy) return;
    fastBusy = true;
    try {
      const fast = ALL_JOBS.filter((j) => j.everySeconds);
      if (!fast.length) return;
      const active = await controlDb().select({ code: tenants.code }).from(tenants).where(eq(tenants.status, 'active'));
      const codes = active.map((a) => a.code);
      const start = codes.length ? rotate++ % codes.length : 0;
      const pending = [...codes.slice(start), ...codes.slice(0, start)];
      await Promise.all(
        Array.from({ length: Math.min(FAST_CONCURRENCY, pending.length) }, async () => {
          for (let code = pending.shift(); code; code = pending.shift()) {
            const tenant = await tenantByCode(code);
            if (!tenant) continue;
            for (const job of fast) {
              const key = `${code}:${job.name}`;
              if (Date.now() - (lastRun.get(key) ?? 0) < job.everySeconds! * 1000 - 500) continue;
              lastRun.set(key, Date.now());
              await runJobOnce(tenant, job).catch((e) => log.error({ err: e, job: job.name, site: code }, 'job failed'));
            }
          }
        }),
      );
    } catch (e) {
      log.error(e, 'fast job tick failed');
    } finally {
      fastBusy = false;
    }
  };
  const fastTimer = setInterval(() => void fastTick(), FAST_TICK_MS);
  fastTimer.unref();
  return () => {
    clearInterval(timer);
    clearInterval(fastTimer);
  };
}
