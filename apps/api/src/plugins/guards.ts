import type { FastifyReply, FastifyRequest } from 'fastify';
import { scopeAtLeast, type PermissionKey, type Scope } from '@school-sync/shared';
import { isSessionActive } from '../core/auth/service';
import { verifyAccessToken } from '../core/auth/tokens';
import { forbidden, unauthorized } from '../core/errors';
import { getPrincipal } from '../core/rbac/principal';
import './context';

type Hook = (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

/** Verifies the bearer token (tenant-bound), the live session, and loads the caller's roles/scopes. */
export const requireAuth: Hook = async (req) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw unauthorized();
  const claims = await verifyAccessToken(req.tenant.id, header.slice(7));
  if (!(await isSessionActive(req.db, req.tenant.id, claims.sessionId))) throw unauthorized('Session ended, please sign in again', 'SESSION_EXPIRED');
  const principal = await getPrincipal(req.db, req.tenant.id, claims.userId);
  if (!principal || principal.status !== 'active') throw unauthorized('Account disabled', 'ACCOUNT_DISABLED');
  // roles/permissions changed since this token was issued → client must refresh
  if (principal.authVersion !== claims.authVersion) throw unauthorized('Permissions changed, refresh your session', 'TOKEN_STALE');
  req.auth = principal;
  req.sessionId = claims.sessionId;
};

/**
 * Route guard: authenticated AND holds `perm` at `min` scope or wider.
 * This only proves the caller may use the feature at all — handlers still restrict the *records*
 * with the scope helpers in core/rbac/scope.ts.
 */
export const requirePerm =
  (perm: PermissionKey, min: Scope = 'own'): Hook =>
  async (req, reply) => {
    await requireAuth(req, reply);
    if (!scopeAtLeast(req.auth.scope(perm), min)) throw forbidden();
  };

/** Any of several permissions (e.g. staff can view via `students:view` or a parent via `fees:view`). */
export const requireAnyPerm =
  (...perms: PermissionKey[]): Hook =>
  async (req, reply) => {
    await requireAuth(req, reply);
    if (!perms.some((p) => req.auth.scope(p))) throw forbidden();
  };
