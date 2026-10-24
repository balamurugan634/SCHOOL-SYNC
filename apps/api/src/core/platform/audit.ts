import type { FastifyRequest } from 'fastify';
import { platformAudit } from '../../db/control/schema';
import { controlDb } from '../tenancy/control-db';

/**
 * Who is calling the platform API: a signed-in operator (bearer token), the automation key (`X-Platform-Key`),
 * the command line, or the system itself (startup bootstrap, background jobs).
 */
export interface PlatformActor {
  kind: 'operator' | 'key' | 'cli' | 'system';
  /** operator id for `operator`, otherwise null */
  id: string | null;
  email?: string;
  displayName?: string;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

/** The text stored in `platform_audit.actor`: the operator id, or `platform-api` / `cli` / `system`. */
export function actorLabel(a: PlatformActor): string {
  switch (a.kind) {
    case 'operator':
      return a.id ?? 'operator';
    case 'key':
      return 'platform-api';
    default:
      return a.kind;
  }
}

export const SYSTEM_ACTOR: PlatformActor = { kind: 'system', id: null };

export function actorOfRequest(req: FastifyRequest): PlatformActor {
  return req.platformActor ?? { kind: 'system', id: null, ip: req.ip };
}

/** Append one record to the platform audit log (control DB). `via` records whether an operator or the key did it. */
export async function platformAuditLog(actor: PlatformActor, action: string, tenantCode: string | null, detail?: Record<string, unknown>): Promise<void> {
  await controlDb()
    .insert(platformAudit)
    .values({ actor: actorLabel(actor), action, tenantCode, detail: { ...detail, via: actor.kind, ...(actor.ip ? { ip: actor.ip } : {}), ...(actor.requestId ? { requestId: actor.requestId } : {}) } });
}
