import { and, eq, sql, type SQL } from 'drizzle-orm';
import type { AuditDetailOut, AuditEntryOut } from '@school-sync/shared';
import { AppError, badRequest, notFound } from '../../core/errors';
import { decodeCursor, encodeCursor } from '../../core/http';
import type { Executor } from '../../core/tenancy/pools';
import { auditLogs } from '../../db/tenant/schema';

export interface AuditFilter {
  actorUserId?: string;
  entity?: string;
  entityId?: string;
  action?: string;
  from?: string;
  to?: string;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const escapeLike = (s: string) => s.replace(/[\\%_]/g, '\\$&');

/** Filters → SQL. Date-only bounds are school-local days (`from` inclusive, `to` inclusive of the whole day). */
export function auditWhere(f: AuditFilter, timeZone: string): SQL[] {
  const conds: (SQL | undefined)[] = [
    f.actorUserId ? eq(auditLogs.actorUserId, f.actorUserId) : undefined,
    f.entity ? eq(auditLogs.entity, f.entity) : undefined,
    f.entityId ? eq(auditLogs.entityId, f.entityId) : undefined,
    f.action ? sql`${auditLogs.action} like ${`${escapeLike(f.action)}%`}` : undefined,
  ];
  if (f.from) conds.push(DATE_ONLY.test(f.from) ? sql`${auditLogs.at} >= (${f.from}::date)::timestamp at time zone ${timeZone}` : sql`${auditLogs.at} >= ${f.from}::timestamptz`);
  if (f.to) conds.push(DATE_ONLY.test(f.to) ? sql`${auditLogs.at} < (${f.to}::date + 1)::timestamp at time zone ${timeZone}` : sql`${auditLogs.at} <= ${f.to}::timestamptz`);
  return conds.filter((c): c is SQL => !!c);
}

const entryColumns = {
  id: auditLogs.id,
  at: auditLogs.at,
  /** exact value (microseconds) for the keyset cursor — JS dates only keep milliseconds */
  atRaw: sql<string>`${auditLogs.at}::text`,
  actorUserId: auditLogs.actorUserId,
  actorName: auditLogs.actorName,
  action: auditLogs.action,
  entity: auditLogs.entity,
  entityId: auditLogs.entityId,
  summary: auditLogs.summary,
  ip: auditLogs.ip,
  requestId: auditLogs.requestId,
};

const TS_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2})?$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cursorCondition(cursor: string | undefined): SQL | undefined {
  if (!cursor) return undefined;
  const c = decodeCursor<{ a: string; i: string }>(cursor);
  if (!c || typeof c.a !== 'string' || typeof c.i !== 'string' || !TS_RE.test(c.a) || !UUID_RE.test(c.i)) throw badRequest('Invalid cursor', 'INVALID_CURSOR');
  return sql`(${auditLogs.at}, ${auditLogs.id}) < (${c.a}::timestamptz, ${c.i}::uuid)`;
}

const toEntry = (r: { id: string; at: Date; actorUserId: string | null; actorName: string | null; action: string; entity: string; entityId: string | null; summary: string | null; ip: string | null; requestId: string | null }): AuditEntryOut => ({
  id: r.id,
  at: r.at.toISOString(),
  actorUserId: r.actorUserId,
  actorName: r.actorName,
  action: r.action,
  entity: r.entity,
  entityId: r.entityId,
  summary: r.summary,
  ip: r.ip,
  requestId: r.requestId,
});

/** Newest first, keyset-paginated on (at, id). */
export async function listAudit(db: Executor, f: AuditFilter & { cursor?: string; limit: number }, timeZone: string): Promise<{ data: AuditEntryOut[]; nextCursor: string | null }> {
  const where = and(...auditWhere(f, timeZone), cursorCondition(f.cursor));
  const rows = await db
    .select(entryColumns)
    .from(auditLogs)
    .where(where)
    .orderBy(sql`${auditLogs.at} desc, ${auditLogs.id} desc`)
    .limit(f.limit + 1);
  const page = rows.slice(0, f.limit);
  const last = page.at(-1);
  return { data: page.map(toEntry), nextCursor: rows.length > f.limit && last ? encodeCursor({ a: last.atRaw, i: last.id }) : null };
}

export async function getAuditEntry(db: Executor, id: string): Promise<AuditDetailOut> {
  const [r] = await db.select().from(auditLogs).where(eq(auditLogs.id, id)).limit(1);
  if (!r) throw notFound('Audit entry');
  return { ...toEntry(r), userAgent: r.userAgent, before: r.before ?? null, after: r.after ?? null };
}

// ── CSV export ──────────────────────────────────────────────────────────────────────────────────
export const EXPORT_ROW_CAP = 50_000;
const EXPORT_PAGE = 2_000;
const HEADER = ['at', 'actor_user_id', 'actor_name', 'action', 'entity', 'entity_id', 'summary', 'ip', 'request_id', 'before', 'after'];

/** CSV cell: quote when needed, and defuse spreadsheet formulas (=, +, -, @, tab, CR) with a leading quote. */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'string' ? v : typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Streams the CSV in keyset pages so a 50k-row export never sits in memory at once. */
export async function* auditCsv(db: Executor, f: AuditFilter, timeZone: string): AsyncGenerator<string> {
  yield `${HEADER.join(',')}\r\n`;
  let sent = 0;
  let cursor: SQL | undefined;
  while (sent < EXPORT_ROW_CAP) {
    const rows = await db
      .select({ ...entryColumns, before: auditLogs.before, after: auditLogs.after })
      .from(auditLogs)
      .where(and(...auditWhere(f, timeZone), cursor))
      .orderBy(sql`${auditLogs.at} desc, ${auditLogs.id} desc`)
      .limit(Math.min(EXPORT_PAGE, EXPORT_ROW_CAP - sent));
    if (!rows.length) return;
    yield rows.map((r) => [r.at.toISOString(), r.actorUserId, r.actorName, r.action, r.entity, r.entityId, r.summary, r.ip, r.requestId, r.before, r.after].map(csvCell).join(',')).join('\r\n') + '\r\n';
    sent += rows.length;
    const last = rows.at(-1)!;
    if (rows.length < EXPORT_PAGE) return;
    cursor = sql`(${auditLogs.at}, ${auditLogs.id}) < (${last.atRaw}::timestamptz, ${last.id}::uuid)`;
  }
}

export { AppError };
