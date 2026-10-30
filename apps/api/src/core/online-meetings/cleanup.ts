import { and, asc, eq, inArray, lt, sql } from 'drizzle-orm';
import type { OnlineProvider } from '@school-sync/shared';
import { onlineMeetingCleanup } from '../../db/tenant/schema';
import type { Executor } from '../tenancy/pools';
import type { TenantInfo } from '../tenancy/registry';
import { errorText, toProviderError } from './errors';
import { providerFor } from './integrations';

/**
 * Meetings that must still be cancelled at the provider although the event / meeting that owned them is gone (a deleted event).
 * The owner row is deleted in the same transaction that writes the tombstone, so the cancellation can be retried by the
 * background job for a day even though no event row is left to carry the state.
 */

/** Call inside the deleting transaction. */
export async function addCleanup(db: Executor, provider: OnlineProvider, remoteMeetingId: string, source: 'event' | 'meeting'): Promise<void> {
  await db.insert(onlineMeetingCleanup).values({ provider, remoteMeetingId, source }).onConflictDoNothing();
}

const RETRY_WINDOW = sql`now() - interval '1 day'`;

/** Try the waiting cancellations once (all of them, or just `ids`). Never throws. Returns how many are done. */
export async function runCleanup(tenant: TenantInfo, db: Executor, opts: { limit?: number; ids?: string[] } = {}): Promise<number> {
  try {
    const rows = await db
      .select()
      .from(onlineMeetingCleanup)
      .where(and(sql`${onlineMeetingCleanup.createdAt} > ${RETRY_WINDOW}`, opts.ids?.length ? inArray(onlineMeetingCleanup.id, opts.ids) : undefined))
      .orderBy(asc(onlineMeetingCleanup.updatedAt))
      .limit(opts.limit ?? 10);
    let done = 0;
    for (const r of rows) {
      try {
        await (await providerFor(db, tenant, r.provider, 'manage')).cancel(r.remoteMeetingId);
        await db.delete(onlineMeetingCleanup).where(eq(onlineMeetingCleanup.id, r.id));
        done++;
      } catch (e) {
        const pe = toProviderError(e, r.provider);
        await db
          .update(onlineMeetingCleanup)
          .set({ attempts: sql`${onlineMeetingCleanup.attempts} + 1`, lastError: errorText(pe, r.provider) })
          .where(eq(onlineMeetingCleanup.id, r.id));
      }
    }
    return done;
  } catch {
    return 0;
  }
}

/** Waiting cancellations older than a week are dropped (the provider copy is then left for the school to delete by hand). */
export async function purgeCleanup(db: Executor): Promise<void> {
  await db.delete(onlineMeetingCleanup).where(lt(onlineMeetingCleanup.createdAt, sql`now() - interval '7 days'`));
}

export async function hasCleanupWork(db: Executor): Promise<boolean> {
  const [r] = await db.select({ id: onlineMeetingCleanup.id }).from(onlineMeetingCleanup).limit(1);
  return !!r;
}
