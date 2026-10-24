import { and, asc, eq, isNull, ne, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { passwordPolicy, type PlatformOperator, type PlatformTokenResponse } from '@school-sync/shared';
import { config } from '../../config';
import { platformOperators, platformSessions } from '../../db/control/schema';
import { burnPasswordCheck, generatePassword, hashPassword, verifyPassword } from '../auth/password';
import { randomToken, safeEqual, sha256 } from '../crypto';
import { AppError, conflict, forbidden, notFound, unauthorized } from '../errors';
import { controlDb } from '../tenancy/control-db';
import { platformAuditLog, SYSTEM_ACTOR, type PlatformActor } from './audit';
import { signPlatformToken, verifyPlatformToken } from './tokens';

type OperatorRow = typeof platformOperators.$inferSelect;

/** Operators are staff of ours: sessions are shorter than a school user's (7 days idle, 30 days absolute). */
const REFRESH_DAYS = 7;
const SESSION_MAX_DAYS = 30;
const MAX_ACTIVE_SESSIONS = 10;
/** the 5th failure locks the account for a minute, then 2, 4, 8 … capped at 30 minutes */
const LOCK_AFTER_FAILURES = 5;

export interface ClientMeta {
  ip?: string;
  userAgent?: string;
}

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

export function toOperator(r: OperatorRow): PlatformOperator {
  return {
    id: r.id,
    email: r.email,
    displayName: r.displayName,
    status: r.status,
    mustChangePassword: r.mustChangePassword,
    lastLoginAt: r.lastLoginAt?.toISOString() ?? null,
    lockedUntil: r.lockedUntil && r.lockedUntil.getTime() > Date.now() ? r.lockedUntil.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  };
}

const actorFor = (op: OperatorRow, meta: ClientMeta): PlatformActor => ({ kind: 'operator', id: op.id, email: op.email, displayName: op.displayName, ip: meta.ip ?? null, userAgent: meta.userAgent ?? null });

async function loadByEmail(email: string): Promise<OperatorRow | null> {
  const [row] = await controlDb().select().from(platformOperators).where(eq(platformOperators.email, normalizeEmail(email))).limit(1);
  return row ?? null;
}

// ── sessions ────────────────────────────────────────────────────────────────────────────────────
async function startSession(op: OperatorRow, meta: ClientMeta): Promise<PlatformTokenResponse> {
  const db = controlDb();
  const sessionId = uuidv7();
  const secret = randomToken(32);
  await db.insert(platformSessions).values({
    id: sessionId,
    operatorId: op.id,
    refreshHash: sha256(secret),
    ip: meta.ip ?? null,
    userAgent: meta.userAgent?.slice(0, 300) ?? null,
    expiresAt: new Date(Date.now() + REFRESH_DAYS * 86_400_000),
  });
  // keep the newest MAX_ACTIVE_SESSIONS sessions per operator
  const active = await db
    .select({ id: platformSessions.id })
    .from(platformSessions)
    .where(and(eq(platformSessions.operatorId, op.id), isNull(platformSessions.revokedAt)))
    .orderBy(sql`${platformSessions.lastUsedAt} desc`);
  for (const s of active.slice(MAX_ACTIVE_SESSIONS)) await db.update(platformSessions).set({ revokedAt: new Date(), revokedReason: 'session_limit' }).where(eq(platformSessions.id, s.id));
  return tokens(op, sessionId, secret);
}

async function tokens(op: OperatorRow, sessionId: string, secret: string): Promise<PlatformTokenResponse> {
  return { accessToken: await signPlatformToken({ operatorId: op.id, sessionId }), refreshToken: `${sessionId}.${secret}`, tokenType: 'Bearer', expiresIn: config.ACCESS_TOKEN_TTL_SECONDS, sessionId, operator: toOperator(op) };
}

export async function revokeOperatorSessions(operatorId: string, reason: string, exceptSessionId?: string): Promise<void> {
  await controlDb()
    .update(platformSessions)
    .set({ revokedAt: new Date(), revokedReason: reason })
    .where(and(eq(platformSessions.operatorId, operatorId), isNull(platformSessions.revokedAt), exceptSessionId ? ne(platformSessions.id, exceptSessionId) : undefined));
}

// ── sign in / refresh / out ─────────────────────────────────────────────────────────────────────
export async function login(input: { email: string; password: string }, meta: ClientMeta): Promise<PlatformTokenResponse> {
  const db = controlDb();
  const op = await loadByEmail(input.email);
  if (!op) {
    await burnPasswordCheck(input.password);
    await platformAuditLog({ ...SYSTEM_ACTOR, ip: meta.ip ?? null }, 'operator.login_failed', null, { reason: 'unknown_account' });
    throw unauthorized('Incorrect email or password', 'INVALID_CREDENTIALS');
  }
  if (op.lockedUntil && op.lockedUntil.getTime() > Date.now()) {
    throw new AppError(423, 'ACCOUNT_LOCKED', 'Too many failed attempts. Try again later.', { retryAfterSeconds: Math.ceil((op.lockedUntil.getTime() - Date.now()) / 1000) });
  }
  if (!(await verifyPassword(op.passwordHash, input.password))) {
    const failures = op.failedAttempts + 1;
    const lockMinutes = failures >= LOCK_AFTER_FAILURES ? Math.min(30, 2 ** (failures - LOCK_AFTER_FAILURES)) : 0;
    await db.update(platformOperators).set({ failedAttempts: failures, lockedUntil: lockMinutes ? new Date(Date.now() + lockMinutes * 60_000) : null }).where(eq(platformOperators.id, op.id));
    await platformAuditLog(actorFor(op, meta), 'operator.login_failed', null, { failures, locked: lockMinutes > 0 });
    throw unauthorized('Incorrect email or password', 'INVALID_CREDENTIALS');
  }
  if (op.status !== 'active') throw forbidden('This account is disabled. Ask another operator to enable it.', 'ACCOUNT_DISABLED');

  const [fresh] = await db.update(platformOperators).set({ failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(platformOperators.id, op.id)).returning();
  const result = await startSession(fresh!, meta);
  await platformAuditLog(actorFor(op, meta), 'operator.login', null, { sessionId: result.sessionId });
  return result;
}

/** Rotating refresh tokens with reuse detection (same model as the school sign-in). */
export async function refresh(refreshToken: string, meta: ClientMeta): Promise<PlatformTokenResponse> {
  const db = controlDb();
  const [sessionId, secret] = refreshToken.split('.');
  if (!sessionId || !secret || !/^[0-9a-f-]{36}$/.test(sessionId)) throw unauthorized('Invalid refresh token', 'INVALID_REFRESH');
  const [s] = await db.select().from(platformSessions).where(eq(platformSessions.id, sessionId)).limit(1);
  const now = Date.now();
  if (!s || s.revokedAt || s.expiresAt.getTime() <= now || s.createdAt.getTime() < now - SESSION_MAX_DAYS * 86_400_000) throw unauthorized('Session expired, please sign in again', 'SESSION_EXPIRED');

  const presented = sha256(secret);
  if (!safeEqual(presented, s.refreshHash)) {
    if (s.prevRefreshHash && safeEqual(presented, s.prevRefreshHash)) {
      if (now - s.lastUsedAt.getTime() < 10_000) throw new AppError(409, 'REFRESH_RACE', 'Refresh already in progress; retry with the latest token');
      await db.update(platformSessions).set({ revokedAt: new Date(), revokedReason: 'refresh_reuse' }).where(eq(platformSessions.id, s.id));
      await platformAuditLog({ kind: 'operator', id: s.operatorId, ip: meta.ip ?? null }, 'operator.refresh_reuse', null, { sessionId: s.id });
    }
    throw unauthorized('Session expired, please sign in again', 'SESSION_EXPIRED');
  }
  const [op] = await db.select().from(platformOperators).where(eq(platformOperators.id, s.operatorId)).limit(1);
  if (!op || op.status !== 'active') throw unauthorized('Account disabled', 'ACCOUNT_DISABLED');

  const next = randomToken(32);
  await db
    .update(platformSessions)
    .set({ prevRefreshHash: s.refreshHash, refreshHash: sha256(next), lastUsedAt: new Date(), expiresAt: new Date(now + REFRESH_DAYS * 86_400_000), ip: meta.ip ?? s.ip })
    .where(eq(platformSessions.id, s.id));
  return tokens(op, s.id, next);
}

export async function logout(operatorId: string, sessionId: string, meta: ClientMeta): Promise<void> {
  await controlDb().update(platformSessions).set({ revokedAt: new Date(), revokedReason: 'logout' }).where(and(eq(platformSessions.id, sessionId), eq(platformSessions.operatorId, operatorId)));
  await platformAuditLog({ kind: 'operator', id: operatorId, ip: meta.ip ?? null }, 'operator.logout', null, { sessionId });
}

/** Resolve a bearer access token to an active operator with a live session; throws 401 otherwise. */
export async function authenticateOperator(token: string): Promise<{ operator: OperatorRow; sessionId: string }> {
  const claims = await verifyPlatformToken(token);
  const [row] = await controlDb()
    .select({ op: platformOperators, s: platformSessions })
    .from(platformSessions)
    .innerJoin(platformOperators, eq(platformOperators.id, platformSessions.operatorId))
    .where(and(eq(platformSessions.id, claims.sessionId), eq(platformSessions.operatorId, claims.operatorId)))
    .limit(1);
  const maxAge = Date.now() - SESSION_MAX_DAYS * 86_400_000;
  if (!row || row.s.revokedAt || row.s.expiresAt.getTime() <= Date.now() || row.s.createdAt.getTime() < maxAge) throw unauthorized('Session ended, please sign in again', 'SESSION_EXPIRED');
  if (row.op.status !== 'active') throw unauthorized('Account disabled', 'ACCOUNT_DISABLED');
  return { operator: row.op, sessionId: row.s.id };
}

export async function changePassword(op: OperatorRow, sessionId: string, input: { currentPassword: string; newPassword: string }, meta: ClientMeta): Promise<void> {
  if (!(await verifyPassword(op.passwordHash, input.currentPassword))) throw unauthorized('Current password is incorrect', 'INVALID_CREDENTIALS');
  if (input.currentPassword === input.newPassword) throw new AppError(422, 'PASSWORD_REUSED', 'Choose a different password');
  await controlDb().update(platformOperators).set({ passwordHash: await hashPassword(input.newPassword), mustChangePassword: false, passwordChangedAt: new Date(), failedAttempts: 0, lockedUntil: null }).where(eq(platformOperators.id, op.id));
  await revokeOperatorSessions(op.id, 'password_changed', sessionId);
  await platformAuditLog(actorFor(op, meta), 'operator.password_changed', null, {});
}

// ── management (any active operator) ────────────────────────────────────────────────────────────
export async function listOperators(): Promise<PlatformOperator[]> {
  const rows = await controlDb().select().from(platformOperators).orderBy(asc(platformOperators.createdAt));
  return rows.map(toOperator);
}

export async function loadOperator(id: string): Promise<OperatorRow> {
  const [row] = await controlDb().select().from(platformOperators).where(eq(platformOperators.id, id)).limit(1);
  if (!row) throw notFound('Operator');
  return row;
}

export async function createOperator(input: { email: string; displayName: string; password?: string }, actor: PlatformActor): Promise<{ operator: PlatformOperator; temporaryPassword: string | null }> {
  const email = normalizeEmail(input.email);
  if (await loadByEmail(email)) throw new AppError(409, 'EMAIL_TAKEN', 'An operator with that email already exists', { errors: [{ path: 'email', message: 'An operator with that email already exists' }] });
  const password = input.password ?? generatePassword(16);
  const [row] = await controlDb()
    .insert(platformOperators)
    .values({ email, displayName: input.displayName.trim(), passwordHash: await hashPassword(password), mustChangePassword: true, passwordChangedAt: new Date() })
    .onConflictDoNothing()
    .returning();
  if (!row) throw new AppError(409, 'EMAIL_TAKEN', 'An operator with that email already exists');
  await platformAuditLog(actor, 'operator.create', null, { operatorId: row.id, email });
  return { operator: toOperator(row), temporaryPassword: input.password ? null : password };
}

async function activeCount(): Promise<number> {
  const [r] = await controlDb().select({ n: sql<number>`count(*)::int` }).from(platformOperators).where(eq(platformOperators.status, 'active'));
  return r?.n ?? 0;
}

export async function setOperatorStatus(id: string, status: 'active' | 'disabled', actor: PlatformActor): Promise<PlatformOperator> {
  const op = await loadOperator(id);
  if (status === 'disabled') {
    if (actor.kind === 'operator' && actor.id === id) throw conflict('You cannot disable your own account', 'CANNOT_DISABLE_SELF');
    if (op.status === 'active' && (await activeCount()) <= 1) throw conflict('At least one operator must stay active', 'LAST_OPERATOR');
  }
  const [row] = await controlDb()
    .update(platformOperators)
    .set({ status, ...(status === 'active' ? { failedAttempts: 0, lockedUntil: null } : {}) })
    .where(eq(platformOperators.id, id))
    .returning();
  if (status === 'disabled') await revokeOperatorSessions(id, 'disabled');
  await platformAuditLog(actor, status === 'disabled' ? 'operator.disable' : 'operator.enable', null, { operatorId: id, email: op.email });
  return toOperator(row!);
}

/** Sets a new generated temporary password, clears any lock, signs the operator out everywhere. Returned once. */
export async function resetOperatorPassword(id: string, actor: PlatformActor): Promise<{ operator: PlatformOperator; temporaryPassword: string }> {
  const op = await loadOperator(id);
  if (actor.kind === 'operator' && actor.id === id) throw conflict('Use “Change password” for your own account', 'CANNOT_RESET_SELF');
  const temporaryPassword = generatePassword(16);
  const [row] = await controlDb()
    .update(platformOperators)
    .set({ passwordHash: await hashPassword(temporaryPassword), mustChangePassword: true, passwordChangedAt: new Date(), failedAttempts: 0, lockedUntil: null })
    .where(eq(platformOperators.id, id))
    .returning();
  await revokeOperatorSessions(id, 'password_reset');
  await platformAuditLog(actor, 'operator.reset_password', null, { operatorId: id, email: op.email });
  return { operator: toOperator(row!), temporaryPassword };
}

/**
 * First-run bootstrap: when no operator exists and PLATFORM_ADMIN_EMAIL + PLATFORM_ADMIN_PASSWORD are set, create the
 * first one (must change the password at first sign-in). Safe to call on every start and from several instances.
 */
export async function bootstrapFirstOperator(log?: { info: (m: string) => void; warn: (m: string) => void }): Promise<boolean> {
  const email = config.PLATFORM_ADMIN_EMAIL?.trim();
  const password = config.PLATFORM_ADMIN_PASSWORD;
  if (!email || !password) return false;
  const [r] = await controlDb().select({ n: sql<number>`count(*)::int` }).from(platformOperators);
  if ((r?.n ?? 0) > 0) return false;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !passwordPolicy.safeParse(password).success) {
    log?.warn('PLATFORM_ADMIN_EMAIL / PLATFORM_ADMIN_PASSWORD ignored: needs a valid email and a password of 10+ characters with upper case, lower case and a digit');
    return false;
  }
  const [row] = await controlDb()
    .insert(platformOperators)
    .values({ email: normalizeEmail(email), displayName: 'Platform administrator', passwordHash: await hashPassword(password), mustChangePassword: true, passwordChangedAt: new Date() })
    .onConflictDoNothing()
    .returning();
  if (!row) return false;
  await platformAuditLog(SYSTEM_ACTOR, 'operator.bootstrap', null, { operatorId: row.id, email: row.email });
  log?.info(`Created the first platform operator ${row.email} (must change the password at first sign-in)`);
  return true;
}

/** Break-glass for the command line: create or reset an operator with a given password. */
export async function upsertOperatorFromCli(email: string, password: string, displayName?: string): Promise<{ created: boolean; id: string }> {
  const parsed = passwordPolicy.safeParse(password);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Weak password');
  const existing = await loadByEmail(email);
  const passwordHash = await hashPassword(password);
  if (existing) {
    await controlDb().update(platformOperators).set({ passwordHash, mustChangePassword: true, status: 'active', failedAttempts: 0, lockedUntil: null, passwordChangedAt: new Date() }).where(eq(platformOperators.id, existing.id));
    await revokeOperatorSessions(existing.id, 'password_reset');
    await platformAuditLog({ kind: 'cli', id: null }, 'operator.reset_password', null, { operatorId: existing.id, email: existing.email });
    return { created: false, id: existing.id };
  }
  const [row] = await controlDb()
    .insert(platformOperators)
    .values({ email: normalizeEmail(email), displayName: displayName?.trim() || 'Platform operator', passwordHash, mustChangePassword: true, passwordChangedAt: new Date() })
    .returning();
  await platformAuditLog({ kind: 'cli', id: null }, 'operator.create', null, { operatorId: row!.id, email: row!.email });
  return { created: true, id: row!.id };
}

