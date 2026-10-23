import { eq, sql } from 'drizzle-orm';
import { tenants } from '../db/control/schema';
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
  /**
   * Must be IDEMPOTENT (safe to run twice / from two instances). Receives a transaction that holds a per-school,
   * per-job advisory lock, so two API instances never run the same job for the same school at once.
   */
  run(tenant: TenantInfo, db: Executor): Promise<void>;
}

export const ALL_JOBS: Job[] = [...attendance, ...learning, ...exams, ...fees, ...communication, ...operations];

const lastRun = new Map<string, number>();

export async function runJobOnce(tenant: TenantInfo, job: Job): Promise<boolean> {
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
  return () => clearInterval(timer);
}
