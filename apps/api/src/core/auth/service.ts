import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { LRUCache } from 'lru-cache';
import { v7 as uuidv7 } from 'uuid';
import { experienceFor, type DeviceInfo, type Me, type TokenResponse } from '@school-sync/shared';
import { config } from '../../config';
import { academicYears, devices, grades, passwordResets, sections, sessions, students, users } from '../../db/tenant/schema';
import { audit, type AuditActor } from '../audit';
import { randomToken, safeEqual, sha256 } from '../crypto';
import { AppError, forbidden, unauthorized } from '../errors';
import { enqueueMail } from '../email';
import { invalidatePrincipal, getPrincipal, loadPrincipal, type Principal } from '../rbac/principal';
import type { Executor } from '../tenancy/pools';
import type { TenantInfo } from '../tenancy/registry';
import { burnPasswordCheck, hashPassword, verifyPassword } from './password';
import { signAccessToken } from './tokens';

export interface ClientMeta {
  ip?: string;
  userAgent?: string;
}

const MAX_ACTIVE_SESSIONS_PER_USER = 10;
const LOCK_AFTER_FAILURES = 5;
export const fileUrl = (id: string | null | undefined): string | null => (id ? `/api/v1/files/${id}` : null);

// ── session state cache (revocation visible within 10 s on every instance) ─────────────────────────
interface SessionState {
  ok: boolean;
}
const sessionStateCache = new LRUCache<string, SessionState>({ max: 50_000, ttl: 10_000 });

export async function isSessionActive(db: Executor, tenantId: string, sessionId: string): Promise<boolean> {
  const key = `${tenantId}:${sessionId}`;
  const hit = sessionStateCache.get(key);
  if (hit) return hit.ok;
  const [s] = await db.select({ revokedAt: sessions.revokedAt, expiresAt: sessions.expiresAt, createdAt: sessions.createdAt }).from(sessions).where(eq(sessions.id, sessionId)).limit(1);
  const maxAge = Date.now() - config.SESSION_MAX_DAYS * 86_400_000;
  const ok = !!s && !s.revokedAt && s.expiresAt.getTime() > Date.now() && s.createdAt.getTime() > maxAge;
  sessionStateCache.set(key, { ok });
  return ok;
}

// ── helpers ─────────────────────────────────────────────────────────────────────────────────────
async function findUser(db: Executor, identifier: string) {
  const id = identifier.trim().toLowerCase();
  const phone = id.replace(/[\s\-()]/g, '');
  const rows = await db
    .select()
    .from(users)
    .where(or(eq(users.username, id), eq(users.email, id), eq(users.phone, phone)))
    .limit(3);
  return rows.find((u) => u.username === id) ?? rows[0] ?? null;
}

async function upsertDevice(db: Executor, userId: string, sessionId: string, device: DeviceInfo) {
  if (!device.pushToken) return;
  await db
    .insert(devices)
    .values({ userId, sessionId, pushToken: device.pushToken, platform: device.platform, deviceName: device.name ?? null, appVersion: device.appVersion ?? null })
    .onConflictDoUpdate({ target: devices.pushToken, set: { userId, sessionId, platform: device.platform, deviceName: device.name ?? null, appVersion: device.appVersion ?? null, enabled: true, lastSeenAt: new Date() } });
}

async function issueTokens(db: Executor, tenant: TenantInfo, user: { id: string; authVersion: number }, sessionId: string, refreshSecret: string, me: Me): Promise<TokenResponse> {
  const accessToken = await signAccessToken({ userId: user.id, sessionId, tenantId: tenant.id, authVersion: user.authVersion });
  return { accessToken, refreshToken: `${sessionId}.${refreshSecret}`, tokenType: 'Bearer', expiresIn: config.ACCESS_TOKEN_TTL_SECONDS, sessionId, user: me };
}

// ── me ──────────────────────────────────────────────────────────────────────────────────────────
export async function buildMe(db: Executor, p: Principal): Promise<Me> {
  const [u] = await db.select().from(users).where(eq(users.id, p.userId)).limit(1);
  if (!u) throw unauthorized();

  const childIds = p.linkedStudentIds;
  const lookupIds = p.studentId ? [p.studentId] : childIds;
  const rows = lookupIds.length
    ? await db
        .select({ id: students.id, first: students.firstName, last: students.lastName, admissionNo: students.admissionNo, photo: students.photoFileId, sectionId: students.currentSectionId, sectionName: sections.name, gradeName: grades.name })
        .from(students)
        .leftJoin(sections, eq(sections.id, students.currentSectionId))
        .leftJoin(grades, eq(grades.id, sections.gradeId))
        .where(inArray(students.id, lookupIds))
        .orderBy(asc(students.firstName))
    : [];
  const full = (r: (typeof rows)[number]) => [r.first, r.last].filter(Boolean).join(' ');

  return {
    id: u.id,
    userType: u.userType,
    displayName: u.displayName,
    username: u.username,
    email: u.email,
    phone: u.phone,
    avatarUrl: fileUrl(u.avatarFileId),
    locale: u.locale,
    mustChangePassword: u.mustChangePassword,
    roles: p.roles,
    experience: experienceFor(p.roles),
    permissions: p.grants as Me['permissions'],
    profile: {
      studentId: p.studentId,
      guardianId: p.guardianId,
      staffId: p.staffId,
      children: p.guardianId ? rows.map((r) => ({ studentId: r.id, name: full(r), admissionNo: r.admissionNo, grade: r.gradeName ?? null, section: r.sectionName ?? null, sectionId: r.sectionId ?? null, photoUrl: fileUrl(r.photo) })) : [],
      sectionId: p.currentSectionId,
      gradeName: p.studentId ? (rows[0]?.gradeName ?? null) : null,
      sectionName: p.studentId ? (rows[0]?.sectionName ?? null) : null,
      classTeacherSectionIds: p.classTeacherSectionIds,
      assignedSectionIds: p.assignedSectionIds,
    },
  };
}

// ── login / refresh / logout ────────────────────────────────────────────────────────────────────
export async function login(db: Executor, tenant: TenantInfo, input: { identifier: string; password: string; device?: DeviceInfo }, meta: ClientMeta, actor: AuditActor): Promise<TokenResponse> {
  const user = await findUser(db, input.identifier);
  if (!user || !user.passwordHash) {
    await burnPasswordCheck(input.password);
    throw unauthorized('Incorrect username or password', 'INVALID_CREDENTIALS');
  }
  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    const retryAfter = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000);
    throw new AppError(423, 'ACCOUNT_LOCKED', 'Too many failed attempts. Try again later.', { retryAfterSeconds: retryAfter });
  }
  const ok = await verifyPassword(user.passwordHash, input.password);
  if (!ok) {
    const failures = user.failedLoginCount + 1;
    // 5th failure locks for 1 min, then doubles (2, 4, 8 … capped at 30 min)
    const lockMinutes = failures >= LOCK_AFTER_FAILURES ? Math.min(30, 2 ** (failures - LOCK_AFTER_FAILURES)) : 0;
    await db.update(users).set({ failedLoginCount: failures, lockedUntil: lockMinutes ? new Date(Date.now() + lockMinutes * 60_000) : null }).where(eq(users.id, user.id));
    await audit(db, { ...actor, userId: user.id, name: user.displayName }, { action: 'auth.login_failed', entity: 'user', entityId: user.id, summary: `Failed login (${failures})` });
    throw unauthorized('Incorrect username or password', 'INVALID_CREDENTIALS');
  }
  if (user.status !== 'active') throw forbidden('This account is disabled. Contact the school office.', 'ACCOUNT_DISABLED');
  if (user.userType === 'student' && !tenant.features.studentLogin) throw forbidden('Student login is not enabled for this school.', 'STUDENT_LOGIN_DISABLED');

  const sessionId = uuidv7();
  const secret = randomToken(32);
  await db.insert(sessions).values({
    id: sessionId,
    userId: user.id,
    refreshHash: sha256(secret),
    platform: input.device?.platform ?? 'web',
    deviceName: input.device?.name ?? null,
    appVersion: input.device?.appVersion ?? null,
    ip: meta.ip ?? null,
    userAgent: meta.userAgent?.slice(0, 300) ?? null,
    expiresAt: new Date(Date.now() + config.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
  });
  await db.update(users).set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(users.id, user.id));
  if (input.device) await upsertDevice(db, user.id, sessionId, input.device);
  await pruneSessions(db, user.id);
  await audit(db, { ...actor, userId: user.id, name: user.displayName }, { action: 'auth.login', entity: 'session', entityId: sessionId, summary: `Login from ${input.device?.platform ?? 'web'}` });

  const principal = (await loadPrincipal(db, user.id))!;
  return issueTokens(db, tenant, user, sessionId, secret, await buildMe(db, principal));
}

async function pruneSessions(db: Executor, userId: string) {
  const active = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
    .orderBy(desc(sessions.lastUsedAt));
  const surplus = active.slice(MAX_ACTIVE_SESSIONS_PER_USER).map((s) => s.id);
  if (surplus.length) await db.update(sessions).set({ revokedAt: new Date(), revokedReason: 'session_limit' }).where(inArray(sessions.id, surplus));
}

/** Rotating refresh tokens with reuse detection. */
export async function refresh(db: Executor, tenant: TenantInfo, input: { refreshToken: string; device?: DeviceInfo }, meta: ClientMeta, actor: AuditActor): Promise<TokenResponse> {
  const [sessionId, secret] = input.refreshToken.split('.');
  if (!sessionId || !secret || !/^[0-9a-f-]{36}$/.test(sessionId)) throw unauthorized('Invalid refresh token', 'INVALID_REFRESH');
  const [s] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
  const now = Date.now();
  if (!s || s.revokedAt || s.expiresAt.getTime() <= now || s.createdAt.getTime() < now - config.SESSION_MAX_DAYS * 86_400_000) throw unauthorized('Session expired, please sign in again', 'SESSION_EXPIRED');

  const presented = sha256(secret);
  if (!safeEqual(presented, s.refreshHash)) {
    if (s.prevRefreshHash && safeEqual(presented, s.prevRefreshHash)) {
      // A rotated-out token showed up again. Within a few seconds it's a client race; later it's theft/replay.
      if (now - s.lastUsedAt.getTime() < 10_000) throw new AppError(409, 'REFRESH_RACE', 'Refresh already in progress; retry with the latest token');
      await db.update(sessions).set({ revokedAt: new Date(), revokedReason: 'refresh_reuse' }).where(eq(sessions.id, s.id));
      sessionStateCache.delete(`${tenant.id}:${s.id}`);
      await audit(db, { ...actor, userId: s.userId }, { action: 'auth.refresh_reuse', entity: 'session', entityId: s.id, summary: 'Refresh token reuse detected — session revoked' });
    }
    throw unauthorized('Session expired, please sign in again', 'SESSION_EXPIRED');
  }

  const [user] = await db.select().from(users).where(eq(users.id, s.userId)).limit(1);
  if (!user || user.status !== 'active') throw unauthorized('Account disabled', 'ACCOUNT_DISABLED');

  const next = randomToken(32);
  await db
    .update(sessions)
    .set({ prevRefreshHash: s.refreshHash, refreshHash: sha256(next), lastUsedAt: new Date(), expiresAt: new Date(now + config.REFRESH_TOKEN_TTL_DAYS * 86_400_000), ip: meta.ip ?? s.ip, appVersion: input.device?.appVersion ?? s.appVersion })
    .where(eq(sessions.id, s.id));
  if (input.device) await upsertDevice(db, user.id, s.id, input.device);
  invalidatePrincipal(tenant.id, user.id);
  const principal = (await getPrincipal(db, tenant.id, user.id))!;
  return issueTokens(db, tenant, user, s.id, next, await buildMe(db, principal));
}

export async function logout(db: Executor, tenant: TenantInfo, sessionId: string, actor: AuditActor, pushToken?: string): Promise<void> {
  await db.update(sessions).set({ revokedAt: new Date(), revokedReason: 'logout' }).where(eq(sessions.id, sessionId));
  await db.update(devices).set({ enabled: false }).where(or(eq(devices.sessionId, sessionId), pushToken ? eq(devices.pushToken, pushToken) : sql`false`));
  sessionStateCache.delete(`${tenant.id}:${sessionId}`);
  await audit(db, actor, { action: 'auth.logout', entity: 'session', entityId: sessionId });
}

export async function revokeAllSessions(db: Executor, tenantId: string, userId: string, reason: string, exceptSessionId?: string): Promise<void> {
  const rows = await db
    .update(sessions)
    .set({ revokedAt: new Date(), revokedReason: reason })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), exceptSessionId ? sql`${sessions.id} <> ${exceptSessionId}` : sql`true`))
    .returning({ id: sessions.id });
  for (const r of rows) sessionStateCache.delete(`${tenantId}:${r.id}`);
  await db.update(devices).set({ enabled: false }).where(eq(devices.userId, userId));
}

export async function revokeSession(db: Executor, tenantId: string, userId: string, sessionId: string): Promise<boolean> {
  const rows = await db
    .update(sessions)
    .set({ revokedAt: new Date(), revokedReason: 'revoked_by_user' })
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });
  sessionStateCache.delete(`${tenantId}:${sessionId}`);
  return rows.length > 0;
}

// ── passwords ───────────────────────────────────────────────────────────────────────────────────
export async function changePassword(db: Executor, tenant: TenantInfo, p: Principal, input: { currentPassword: string; newPassword: string }, currentSessionId: string, actor: AuditActor): Promise<void> {
  const [u] = await db.select().from(users).where(eq(users.id, p.userId)).limit(1);
  if (!u?.passwordHash || !(await verifyPassword(u.passwordHash, input.currentPassword))) throw unauthorized('Current password is incorrect', 'INVALID_CREDENTIALS');
  if (input.currentPassword === input.newPassword) throw new AppError(422, 'PASSWORD_REUSED', 'Choose a different password');
  await db.update(users).set({ passwordHash: await hashPassword(input.newPassword), mustChangePassword: false, passwordChangedAt: new Date(), authVersion: sql`${users.authVersion} + 1` }).where(eq(users.id, u.id));
  // every other device must sign in again
  await revokeAllSessions(db, tenant.id, u.id, 'password_changed', currentSessionId);
  invalidatePrincipal(tenant.id, u.id);
  await audit(db, actor, { action: 'auth.password_changed', entity: 'user', entityId: u.id });
}

export async function requestPasswordReset(db: Executor, tenant: TenantInfo, identifier: string, log: { warn: (o: object, m?: string) => void }): Promise<void> {
  const user = await findUser(db, identifier);
  if (!user || user.status !== 'active' || !user.email) return; // never reveal whether the account exists
  const token = randomToken(32);
  await db.insert(passwordResets).values({ userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 30 * 60_000) });
  const link = `${config.PUBLIC_WEB_URL.replace('{code}', tenant.code).replace(/\/$/, '')}/reset-password?site=${tenant.code}&token=${token}`;
  // Queued (never sent inside the request): the HTTP call returns as soon as the row is stored and a non-blocking flush sends it at once.
  // `sensitive` keeps the link sealed in the queue, hidden from the admin screen and erased after delivery.
  await enqueueMail(
    tenant,
    {
      to: user.email,
      subject: `${tenant.name}: reset your password`,
      text: `Hello ${user.displayName},\n\nUse this link within 30 minutes to reset your password:\n${link}\n\nIf you didn't ask for this, ignore this email.`,
      referenceType: 'password_reset',
      referenceId: user.id,
      sensitive: true,
      sendNow: true,
    },
    { db },
  ).catch((e) => log.warn({ err: e instanceof Error ? e.message : String(e), site: tenant.code }, 'password reset email could not be queued'));
}

export async function resetPassword(db: Executor, tenant: TenantInfo, input: { token: string; newPassword: string }, actor: AuditActor): Promise<void> {
  const [r] = await db
    .select()
    .from(passwordResets)
    .where(and(eq(passwordResets.tokenHash, sha256(input.token)), isNull(passwordResets.usedAt)))
    .limit(1);
  if (!r || r.expiresAt.getTime() < Date.now()) throw new AppError(400, 'INVALID_RESET_TOKEN', 'This reset link is invalid or has expired');
  await db.update(passwordResets).set({ usedAt: new Date() }).where(eq(passwordResets.id, r.id));
  await db.update(users).set({ passwordHash: await hashPassword(input.newPassword), mustChangePassword: false, failedLoginCount: 0, lockedUntil: null, passwordChangedAt: new Date(), authVersion: sql`${users.authVersion} + 1` }).where(eq(users.id, r.userId));
  await revokeAllSessions(db, tenant.id, r.userId, 'password_reset');
  invalidatePrincipal(tenant.id, r.userId);
  await audit(db, { ...actor, userId: r.userId }, { action: 'auth.password_reset', entity: 'user', entityId: r.userId });
}

export async function listSessions(db: Executor, userId: string, currentSessionId: string) {
  const rows = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), sql`${sessions.expiresAt} > now()`))
    .orderBy(desc(sessions.lastUsedAt));
  return rows.map((s) => ({ id: s.id, platform: s.platform, deviceName: s.deviceName, appVersion: s.appVersion, ip: s.ip, createdAt: s.createdAt.toISOString(), lastUsedAt: s.lastUsedAt.toISOString(), current: s.id === currentSessionId }));
}
