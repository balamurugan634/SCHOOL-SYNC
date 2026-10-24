import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { EMAIL_QUEUE_RETENTION, EMAIL_QUEUE_STATUS_LABELS, type EmailQueueAction, type EmailQueueDetail, type EmailQueueItem, type EmailQueueStatus, type EmailQueueSummaryOut } from '@school-sync/shared';
import { audit } from '../../core/audit';
import { config } from '../../config';
import { conflict, notFound } from '../../core/errors';
import { kickFlush } from '../../core/email';
import type { Executor } from '../../core/tenancy/pools';
import type { TenantInfo } from '../../core/tenancy/registry';
import { emailAccounts, emailQueue, users } from '../../db/tenant/schema';
import type { EmailCtx } from './email-accounts';

type Row = typeof emailQueue.$inferSelect;
const iso = (d: Date | null) => (d ? d.toISOString() : null);
const BODY_PREVIEW_CHARS = 20_000;

function toItem(r: Row, accountName: string | null): EmailQueueItem {
  return {
    id: r.id,
    status: r.status,
    priority: r.priority,
    to: r.toAddresses,
    cc: r.ccAddresses,
    subject: r.subject,
    sender: r.sender,
    accountId: r.accountId,
    accountName,
    attempts: r.attempts,
    maxAttempts: r.maxAttempts,
    nextAttemptAt: r.status === 'not_sent' ? iso(r.nextAttemptAt) : null,
    sentAt: iso(r.sentAt),
    sentVia: r.sentVia,
    lastError: r.lastError,
    referenceType: r.referenceType,
    referenceId: r.referenceId,
    createdAt: r.createdAt.toISOString(),
  };
}

const esc = (q: string) => `%${q.replace(/[\\%_]/g, '\\$&')}%`;

export interface QueueFilter {
  status?: EmailQueueStatus;
  accountId?: string;
  from?: string;
  to?: string;
  q?: string;
}

function whereOf(f: QueueFilter, tz: string): SQL | undefined {
  const c: (SQL | undefined)[] = [];
  if (f.status) c.push(eq(emailQueue.status, f.status));
  if (f.accountId === 'platform') c.push(sql`${emailQueue.accountId} is null`);
  else if (f.accountId) c.push(eq(emailQueue.accountId, f.accountId));
  if (f.from) c.push(sql`${emailQueue.createdAt} >= (${f.from}::date)::timestamp at time zone ${tz}`);
  if (f.to) c.push(sql`${emailQueue.createdAt} < ((${f.to}::date + 1)::timestamp at time zone ${tz})`);
  if (f.q) {
    const p = esc(f.q);
    c.push(sql`(${emailQueue.subject} ilike ${p} or array_to_string(${emailQueue.toAddresses}, ' ') ilike ${p} or array_to_string(${emailQueue.ccAddresses}, ' ') ilike ${p} or ${emailQueue.sender} ilike ${p})`);
  }
  return and(...c);
}

export async function listQueue(db: Executor, tenant: TenantInfo, f: QueueFilter, page: { limit: number; offset: number }): Promise<{ data: EmailQueueItem[]; total: number }> {
  const where = whereOf(f, tenant.timezone);
  const [rows, [count]] = await Promise.all([
    db
      .select({ r: emailQueue, accountName: emailAccounts.name })
      .from(emailQueue)
      .leftJoin(emailAccounts, eq(emailAccounts.id, emailQueue.accountId))
      .where(where)
      .orderBy(desc(emailQueue.createdAt), desc(emailQueue.id))
      .limit(page.limit)
      .offset(page.offset),
    db.select({ n: sql<number>`count(*)::int` }).from(emailQueue).where(where),
  ]);
  return { data: rows.map((x) => toItem(x.r, x.accountName)), total: count?.n ?? 0 };
}

export async function queueSummary(db: Executor): Promise<EmailQueueSummaryOut> {
  const [r] = await db
    .select({
      notSent: sql<number>`count(*) filter (where ${emailQueue.status} = 'not_sent')::int`,
      sending: sql<number>`count(*) filter (where ${emailQueue.status} = 'sending')::int`,
      sent: sql<number>`count(*) filter (where ${emailQueue.status} = 'sent')::int`,
      error: sql<number>`count(*) filter (where ${emailQueue.status} = 'error')::int`,
      cancelled: sql<number>`count(*) filter (where ${emailQueue.status} = 'cancelled')::int`,
      nextDueAt: sql<Date | null>`min(${emailQueue.nextAttemptAt}) filter (where ${emailQueue.status} = 'not_sent')`,
      lastSentAt: sql<Date | null>`max(${emailQueue.sentAt})`,
    })
    .from(emailQueue);
  return {
    counts: { not_sent: r?.notSent ?? 0, sending: r?.sending ?? 0, sent: r?.sent ?? 0, error: r?.error ?? 0, cancelled: r?.cancelled ?? 0 },
    nextDueAt: r?.nextDueAt ? new Date(r.nextDueAt).toISOString() : null,
    lastSentAt: r?.lastSentAt ? new Date(r.lastSentAt).toISOString() : null,
    retention: { ...EMAIL_QUEUE_RETENTION },
    workerEnabled: config.RUN_WORKERS,
  };
}

export async function getQueueItem(db: Executor, id: string): Promise<EmailQueueDetail> {
  const [x] = await db
    .select({ r: emailQueue, accountName: emailAccounts.name, createdByName: users.displayName })
    .from(emailQueue)
    .leftJoin(emailAccounts, eq(emailAccounts.id, emailQueue.accountId))
    .leftJoin(users, eq(users.id, emailQueue.createdBy))
    .where(eq(emailQueue.id, id))
    .limit(1);
  if (!x) throw notFound('Email');
  const r = x.r;
  return {
    ...toItem(r, x.accountName),
    replyTo: r.replyTo,
    messageId: r.messageId,
    // one-time messages (reset links) are sealed at rest and never shown, not even to administrators
    bodyHidden: r.sensitive,
    textBody: r.sensitive ? null : (r.textBody?.slice(0, BODY_PREVIEW_CHARS) ?? null),
    htmlBody: r.sensitive ? null : (r.htmlBody?.slice(0, BODY_PREVIEW_CHARS) ?? null),
    createdByName: x.createdByName,
    updatedAt: r.updatedAt.toISOString(),
  };
}

// ── actions ─────────────────────────────────────────────────────────────────────────────────────────
const VERB: Record<EmailQueueAction, string> = { send_now: 'sent now', retry: 'retried', cancel: 'cancelled', delete: 'deleted' };

/** Statuses an action may start from. */
const ALLOWED_FROM: Record<EmailQueueAction, EmailQueueStatus[]> = {
  send_now: ['not_sent', 'error'],
  retry: ['error', 'cancelled'],
  cancel: ['not_sent'],
  delete: ['not_sent', 'sent', 'error', 'cancelled'],
};

/**
 * Apply `action` to the rows that are in an allowed state; the others are skipped (and counted). Nothing here sends: send_now /
 * retry only make rows due, the caller then kicks the worker (kickAfter) so the one-at-a-time rule is never bypassed.
 */
export async function applyQueueAction(tx: Executor, ctx: EmailCtx, action: EmailQueueAction, ids: string[]): Promise<{ affected: string[]; skipped: number }> {
  const unique = [...new Set(ids)];
  const inState = and(inArray(emailQueue.id, unique), inArray(emailQueue.status, ALLOWED_FROM[action]));
  let affected: { id: string }[];
  const now = new Date();
  if (action === 'delete') {
    affected = await tx.delete(emailQueue).where(inState).returning({ id: emailQueue.id });
  } else if (action === 'cancel') {
    affected = await tx
      .update(emailQueue)
      .set({ status: 'cancelled', updatedAt: now, textBody: sql`case when ${emailQueue.sensitive} then null else ${emailQueue.textBody} end`, htmlBody: sql`case when ${emailQueue.sensitive} then null else ${emailQueue.htmlBody} end` })
      .where(inState)
      .returning({ id: emailQueue.id });
  } else {
    // send_now / retry: back to Not Sent and due right now. A one-time message whose body was erased cannot be resent.
    affected = await tx
      .update(emailQueue)
      .set({
        status: 'not_sent',
        nextAttemptAt: now,
        updatedAt: now,
        attempts: sql`case when ${emailQueue.status} in ('error', 'cancelled') then 0 else ${emailQueue.attempts} end`,
        lastError: sql`case when ${emailQueue.status} in ('error', 'cancelled') then null else ${emailQueue.lastError} end`,
      })
      .where(and(inState, sql`(${emailQueue.textBody} is not null or ${emailQueue.htmlBody} is not null)`))
      .returning({ id: emailQueue.id });
  }
  if (affected.length) {
    await audit(tx, ctx.actor, {
      action: `email_queue.${action}`,
      entity: 'email_queue',
      entityId: affected.length === 1 ? affected[0]!.id : null,
      summary: `${affected.length} email${affected.length === 1 ? '' : 's'} ${VERB[action]}`,
      after: { count: affected.length, ids: affected.slice(0, 50).map((a) => a.id) },
    });
  }
  return { affected: affected.map((a) => a.id), skipped: unique.length - affected.length };
}

/** One row: 404 when it does not exist, 409 (with the current status) when the action does not apply. */
export async function applySingleAction(tx: Executor, ctx: EmailCtx, action: EmailQueueAction, id: string): Promise<string[]> {
  const [row] = await tx.select({ status: emailQueue.status }).from(emailQueue).where(eq(emailQueue.id, id)).limit(1);
  if (!row) throw notFound('Email');
  const { affected } = await applyQueueAction(tx, ctx, action, [id]);
  if (!affected.length) {
    const why = !ALLOWED_FROM[action].includes(row.status) ? `it is ${EMAIL_QUEUE_STATUS_LABELS[row.status]}` : 'its content is no longer available';
    throw conflict(`This email cannot be ${VERB[action]}: ${why}.`, 'EMAIL_STATE_CONFLICT');
  }
  return affected;
}

export function kickAfter(tenant: TenantInfo, action: EmailQueueAction, affected: string[]): void {
  if (action === 'send_now') kickFlush(tenant, { ids: affected });
  else if (action === 'retry') kickFlush(tenant);
}

/** "Flush queue now": make every waiting message due (skips the retry wait) and start the worker. Returns how many are waiting. */
export async function flushQueue(tx: Executor, ctx: EmailCtx): Promise<number> {
  await tx.update(emailQueue).set({ nextAttemptAt: new Date(), updatedAt: new Date() }).where(and(eq(emailQueue.status, 'not_sent'), sql`${emailQueue.nextAttemptAt} > now()`));
  const [c] = await tx.select({ n: sql<number>`count(*)::int` }).from(emailQueue).where(eq(emailQueue.status, 'not_sent'));
  await audit(tx, ctx.actor, { action: 'email_queue.flush', entity: 'email_queue', summary: `Flushed the email queue (${c?.n ?? 0} waiting)` });
  return c?.n ?? 0;
}

export async function clearFinished(tx: Executor, ctx: EmailCtx, o: { olderThanDays: number; statuses: ('sent' | 'error' | 'cancelled')[] }): Promise<number> {
  const cutoff = new Date(Date.now() - o.olderThanDays * 86_400_000);
  const deleted = await tx
    .delete(emailQueue)
    .where(
      and(
        inArray(emailQueue.status, o.statuses),
        o.olderThanDays > 0 ? sql`(case when ${emailQueue.status} = 'sent' then coalesce(${emailQueue.sentAt}, ${emailQueue.updatedAt}) else ${emailQueue.updatedAt} end) < ${cutoff}` : undefined,
      ),
    )
    .returning({ id: emailQueue.id });
  await audit(tx, ctx.actor, {
    action: 'email_queue.clear',
    entity: 'email_queue',
    summary: `Cleared ${deleted.length} ${o.statuses.join('/')} email${deleted.length === 1 ? '' : 's'}${o.olderThanDays > 0 ? ` older than ${o.olderThanDays} days` : ''}`,
    after: { count: deleted.length, statuses: o.statuses, olderThanDays: o.olderThanDays },
  });
  return deleted.length;
}

