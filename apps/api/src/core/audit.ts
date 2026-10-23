import type { FastifyRequest } from 'fastify';
import { auditLogs } from '../db/tenant/schema';
import type { Executor } from './tenancy/pools';

export interface AuditEntry {
  action: string; // attendance.submit, marks.publish, role.update, auth.login …
  entity: string;
  entityId?: string | null;
  summary?: string;
  before?: unknown;
  after?: unknown;
}

export interface AuditActor {
  userId?: string | null;
  name?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export function actorOf(req: FastifyRequest): AuditActor {
  return { userId: req.auth?.userId ?? null, name: req.auth?.displayName ?? null, ip: req.ip, userAgent: req.headers['user-agent']?.slice(0, 300) ?? null, requestId: req.id };
}

/** Append an audit record. Pass the transaction handle so the record commits (or rolls back) with the change. */
export async function audit(db: Executor, actor: AuditActor, e: AuditEntry): Promise<void> {
  await db.insert(auditLogs).values({
    actorUserId: actor.userId ?? null,
    actorName: actor.name ?? null,
    action: e.action,
    entity: e.entity,
    entityId: e.entityId ?? null,
    summary: e.summary ?? null,
    before: e.before === undefined ? null : redact(e.before),
    after: e.after === undefined ? null : redact(e.after),
    ip: actor.ip ?? null,
    userAgent: actor.userAgent ?? null,
    requestId: actor.requestId ?? null,
  });
}

const SECRET_KEYS = /password|token|secret|hash/i;
function redact(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(redact);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, SECRET_KEYS.test(k) ? '[redacted]' : redact(x)]));
  return v;
}
