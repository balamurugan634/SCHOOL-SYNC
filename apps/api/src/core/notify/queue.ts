import { eq } from 'drizzle-orm';
import { tenants } from '../../db/control/schema';
import { controlDb } from '../tenancy/control-db';
import { tenantDb } from '../tenancy/pools';
import { tenantByCode, type TenantInfo } from '../tenancy/registry';

/**
 * In-process push queue: batches ids per school for a moment, then dispatches.
 * Durable by design — rows are written as `pending` first, and `startPushSweeper` re-sends anything left
 * over after a crash or provider outage. Swap `enqueuePush` for BullMQ when you run several worker processes.
 */
const buffer = new Map<string, { tenant: TenantInfo; ids: Set<string> }>();
let timer: NodeJS.Timeout | undefined;

export function enqueuePush(tenant: TenantInfo, ids: string[]): void {
  if (!ids.length) return;
  const slot = buffer.get(tenant.id) ?? { tenant, ids: new Set<string>() };
  ids.forEach((i) => slot.ids.add(i));
  buffer.set(tenant.id, slot);
  timer ??= setTimeout(() => void flush(), 250);
}

async function flush(): Promise<void> {
  timer = undefined;
  const batches = [...buffer.values()];
  buffer.clear();
  const { dispatchPush } = await import('./index');
  await Promise.allSettled(
    batches.map(async ({ tenant, ids }) => {
      try {
        await dispatchPush(tenantDb(tenant), tenant, [...ids]);
      } catch (e) {
        console.error(`[push:${tenant.code}] dispatch failed`, e instanceof Error ? e.message : e);
      }
    }),
  );
}

/** Awaitable flush for tests and graceful shutdown. */
export async function flushPushQueue(): Promise<void> {
  if (timer) clearTimeout(timer);
  await flush();
}

let sweeper: NodeJS.Timeout | undefined;
/** Every `everyMs`, re-send notifications that are still `pending` after a minute, for every active school. */
export function startPushSweeper(everyMs = 30_000): () => void {
  const run = async () => {
    try {
      const { dispatchPush } = await import('./index');
      const active = await controlDb().select({ code: tenants.code }).from(tenants).where(eq(tenants.status, 'active'));
      for (const { code } of active) {
        const t = await tenantByCode(code);
        if (t) await dispatchPush(tenantDb(t), t).catch((e) => console.error(`[push-sweeper:${code}]`, e instanceof Error ? e.message : e));
      }
    } catch (e) {
      console.error('[push-sweeper]', e instanceof Error ? e.message : e);
    }
  };
  sweeper = setInterval(() => void run(), everyMs);
  sweeper.unref();
  return () => {
    if (sweeper) clearInterval(sweeper);
  };
}
