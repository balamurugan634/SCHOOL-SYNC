import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import type { UserDetailOut, UserOut } from '@school-sync/shared';
import { audit } from '../../core/audit';
import { revokeAllSessions } from '../../core/auth/service';
import { AppError, forbidden, notFound } from '../../core/errors';
import { ilikeAny } from '../../core/http';
import type { Principal } from '../../core/rbac/principal';
import type { Executor } from '../../core/tenancy/pools';
import { guardians, passwordResets, roles, sessions, staff, students, userRoles, users } from '../../db/tenant/schema';
import { createLogin, normalizeEmail, normalizePhone, prepareCredential } from '../people/accounts';
import { nextEmployeeId } from '../people/sequences';
import { assertOtherActiveSuperAdmin, assertRolesFitUserType, SUPER_ADMIN, userRoleKeys, type RoleCtx } from './roles';

type UserRow = typeof users.$inferSelect;
interface ProfileIds {
  studentId: string | null;
  guardianId: string | null;
  staffId: string | null;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

function toUserOut(u: UserRow, roleList: { id: string; key: string; name: string }[], ids: ProfileIds): UserOut {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    userType: u.userType,
    email: u.email,
    phone: u.phone,
    status: u.status,
    roles: roleList,
    lastLoginAt: iso(u.lastLoginAt),
    mustChangePassword: u.mustChangePassword,
    locked: !!u.lockedUntil && u.lockedUntil.getTime() > Date.now(),
    createdAt: u.createdAt.toISOString(),
    ...ids,
  };
}

// ── list ────────────────────────────────────────────────────────────────────────────────────────
export interface UserFilters {
  q?: string;
  userType?: 'student' | 'parent' | 'staff';
  status?: 'invited' | 'active' | 'suspended' | 'deactivated';
  roleId?: string;
  roleKey?: string;
}

export async function listUsers(db: Executor, f: UserFilters, page: { limit: number; offset: number }): Promise<{ data: UserOut[]; total: number }> {
  const conds: (SQL | undefined)[] = [
    f.q ? ilikeAny(f.q, users.username, users.displayName, users.email, users.phone) : undefined,
    f.userType ? eq(users.userType, f.userType) : undefined,
    f.status ? eq(users.status, f.status) : undefined,
    f.roleId ? sql`exists (select 1 from ${userRoles} where ${userRoles.userId} = ${users.id} and ${userRoles.roleId} = ${f.roleId})` : undefined,
    f.roleKey ? sql`exists (select 1 from ${userRoles} join ${roles} on ${roles.id} = ${userRoles.roleId} where ${userRoles.userId} = ${users.id} and ${roles.key} = ${f.roleKey})` : undefined,
  ];
  const where = and(...conds);
  const [rows, [{ n }]] = (await Promise.all([
    db
      .select({ u: users, studentId: students.id, guardianId: guardians.id, staffId: staff.id })
      .from(users)
      .leftJoin(students, eq(students.userId, users.id))
      .leftJoin(guardians, eq(guardians.userId, users.id))
      .leftJoin(staff, eq(staff.userId, users.id))
      .where(where)
      .orderBy(asc(users.displayName), asc(users.id))
      .limit(page.limit)
      .offset(page.offset),
    db.select({ n: sql<number>`count(*)::int` }).from(users).where(where),
  ])) as [{ u: UserRow; studentId: string | null; guardianId: string | null; staffId: string | null }[], [{ n: number }]];

  const ids = rows.map((r) => r.u.id);
  const roleRows = ids.length
    ? await db
        .select({ userId: userRoles.userId, id: roles.id, key: roles.key, name: roles.name })
        .from(userRoles)
        .innerJoin(roles, eq(roles.id, userRoles.roleId))
        .where(inArray(userRoles.userId, ids))
        .orderBy(asc(roles.key))
    : [];
  const byUser = Map.groupBy(roleRows, (r) => r.userId);
  return {
    data: rows.map((r) => toUserOut(r.u, (byUser.get(r.u.id) ?? []).map(({ id, key, name }) => ({ id, key, name })), { studentId: r.studentId, guardianId: r.guardianId, staffId: r.staffId })),
    total: n,
  };
}

// ── detail ──────────────────────────────────────────────────────────────────────────────────────
export async function getUserDetail(db: Executor, id: string): Promise<UserDetailOut> {
  const [row] = await db
    .select({ u: users, studentId: students.id, guardianId: guardians.id, staffId: staff.id })
    .from(users)
    .leftJoin(students, eq(students.userId, users.id))
    .leftJoin(guardians, eq(guardians.userId, users.id))
    .leftJoin(staff, eq(staff.userId, users.id))
    .where(eq(users.id, id))
    .limit(1);
  if (!row) throw notFound('User');
  const [roleList, [s]] = await Promise.all([
    userRoleKeys(db, id),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(sessions)
      .where(and(eq(sessions.userId, id), isNull(sessions.revokedAt), sql`${sessions.expiresAt} > now()`)),
  ]);
  const u = row.u;
  return {
    ...toUserOut(u, roleList, { studentId: row.studentId, guardianId: row.guardianId, staffId: row.staffId }),
    failedLoginCount: u.failedLoginCount,
    lockedUntil: iso(u.lockedUntil),
    passwordChangedAt: iso(u.passwordChangedAt),
    locale: u.locale,
    activeSessions: s?.n ?? 0,
  };
}

// ── management guards ───────────────────────────────────────────────────────────────────────────
/**
 * Load the target account and enforce the rules shared by every account-management action:
 * a super administrator's account can only be managed by another super administrator, and (optionally) never by themselves.
 */
async function loadManageable(db: Executor, p: Principal, userId: string, opts: { allowSelf?: boolean } = {}): Promise<UserRow> {
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u) throw notFound('User');
  if (!opts.allowSelf && u.id === p.userId) throw forbidden('You cannot do this to your own account', 'CANNOT_MODIFY_SELF');
  if (!p.hasRole(SUPER_ADMIN)) {
    const held = await userRoleKeys(db, userId);
    if (held.some((r) => r.key === SUPER_ADMIN)) throw forbidden('Only a super administrator can manage a super administrator account', 'ONLY_SUPER_ADMIN');
  }
  return u;
}

const snapshot = (u: UserRow) => ({ username: u.username, status: u.status, mustChangePassword: u.mustChangePassword, locked: !!u.lockedUntil });

// ── create (staff login) ────────────────────────────────────────────────────────────────────────
export async function createStaffUser(
  tx: Executor,
  ctx: RoleCtx & { tenantId: string },
  input: { displayName: string; username?: string; email?: string; phone?: string; roleIds?: string[]; staffId?: string },
): Promise<{ userId: string; temporaryPassword: string }> {
  const { principal } = ctx;
  let roleKeys: string[] = [];
  if (input.roleIds?.length) {
    if (!principal.scope('roles:edit')) throw forbidden('Assigning roles needs the permission to edit roles', 'ROLES_EDIT_REQUIRED');
    const wanted = [...new Set(input.roleIds)];
    const rows = await tx.select().from(roles).where(inArray(roles.id, wanted));
    if (rows.length !== wanted.length) throw new AppError(422, 'ROLE_NOT_FOUND', 'One or more roles do not exist');
    assertRolesFitUserType(rows, 'staff');
    if (rows.some((r) => r.key === SUPER_ADMIN) && !principal.hasRole(SUPER_ADMIN)) throw forbidden('Only a super administrator can create a super administrator', 'ONLY_SUPER_ADMIN');
    roleKeys = rows.map((r) => r.key);
  }

  let staffId = input.staffId ?? null;
  let employeeId: string;
  if (staffId) {
    const [st] = await tx.select().from(staff).where(eq(staff.id, staffId)).limit(1);
    if (!st) throw notFound('Staff profile');
    if (st.userId) throw new AppError(409, 'STAFF_HAS_LOGIN', 'This staff member already has a login');
    employeeId = st.employeeId;
  } else {
    employeeId = await nextEmployeeId(tx);
  }

  const username = (input.username ?? employeeId).toLowerCase();
  const email = input.email ? normalizeEmail(input.email) : null;
  const phone = input.phone ? normalizePhone(input.phone) : null;
  const login = await createLogin(tx, { username, displayName: input.displayName, userType: 'staff', email, phone, roleKeys }, principal.userId);

  if (staffId) {
    await tx.update(staff).set({ userId: login.userId }).where(eq(staff.id, staffId));
  } else {
    const [first, ...rest] = input.displayName.trim().split(/\s+/);
    const [created] = await tx
      .insert(staff)
      .values({ userId: login.userId, employeeId, firstName: first ?? input.displayName, lastName: rest.join(' ') || null, staffType: 'non_teaching', email, phone })
      .returning({ id: staff.id });
    staffId = created!.id;
  }
  await audit(tx, ctx.actor, { action: 'user.create', entity: 'user', entityId: login.userId, summary: `Created staff login ${login.username}`, after: { username: login.username, userType: 'staff', staffId, employeeId, roles: roleKeys } });
  return { userId: login.userId, temporaryPassword: login.temporaryPassword };
}

// ── lifecycle ───────────────────────────────────────────────────────────────────────────────────
export async function deactivateUser(tx: Executor, ctx: RoleCtx & { tenantId: string }, userId: string): Promise<boolean> {
  const u = await loadManageable(tx, ctx.principal, userId);
  if (u.status === 'deactivated') return false;
  if ((await userRoleKeys(tx, userId)).some((r) => r.key === SUPER_ADMIN) && u.status === 'active') await assertOtherActiveSuperAdmin(tx, userId);
  await tx.update(users).set({ status: 'deactivated', authVersion: sql`${users.authVersion} + 1` }).where(eq(users.id, userId));
  await revokeAllSessions(tx, ctx.tenantId, userId, 'account_deactivated');
  await audit(tx, ctx.actor, { action: 'user.deactivate', entity: 'user', entityId: userId, summary: `Deactivated ${u.username}`, before: snapshot(u), after: { ...snapshot(u), status: 'deactivated' } });
  return true;
}

export async function reactivateUser(tx: Executor, ctx: RoleCtx, userId: string): Promise<boolean> {
  const u = await loadManageable(tx, ctx.principal, userId, { allowSelf: true });
  if (u.status === 'active') return false;
  await tx.update(users).set({ status: 'active', failedLoginCount: 0, lockedUntil: null, authVersion: sql`${users.authVersion} + 1` }).where(eq(users.id, userId));
  await audit(tx, ctx.actor, { action: 'user.reactivate', entity: 'user', entityId: userId, summary: `Reactivated ${u.username}`, before: snapshot(u), after: { ...snapshot(u), status: 'active', locked: false } });
  return true;
}

/** `credential` is generated BEFORE the transaction (Argon2 is slow). The plaintext is returned to the admin once and never logged. */
export async function resetUserPassword(tx: Executor, ctx: RoleCtx & { tenantId: string }, userId: string, credential: Awaited<ReturnType<typeof prepareCredential>>): Promise<{ username: string; temporaryPassword: string }> {
  const u = await loadManageable(tx, ctx.principal, userId);
  await tx
    .update(users)
    .set({ passwordHash: credential.hash, mustChangePassword: true, failedLoginCount: 0, lockedUntil: null, passwordChangedAt: new Date(), authVersion: sql`${users.authVersion} + 1` })
    .where(eq(users.id, userId));
  // any reset link that was emailed earlier must stop working too
  await tx.update(passwordResets).set({ usedAt: new Date() }).where(and(eq(passwordResets.userId, userId), isNull(passwordResets.usedAt)));
  await revokeAllSessions(tx, ctx.tenantId, userId, 'password_reset_by_admin');
  await audit(tx, ctx.actor, { action: 'user.reset_password', entity: 'user', entityId: userId, summary: `Admin reset the password of ${u.username}`, before: snapshot(u), after: { ...snapshot(u), mustChangePassword: true, locked: false } });
  return { username: u.username, temporaryPassword: credential.password };
}

export async function unlockUser(tx: Executor, ctx: RoleCtx, userId: string): Promise<void> {
  const u = await loadManageable(tx, ctx.principal, userId, { allowSelf: true });
  await tx.update(users).set({ failedLoginCount: 0, lockedUntil: null }).where(eq(users.id, userId));
  await audit(tx, ctx.actor, { action: 'user.unlock', entity: 'user', entityId: userId, summary: `Unlocked ${u.username}`, before: { ...snapshot(u), failedLoginCount: u.failedLoginCount }, after: { ...snapshot(u), locked: false, failedLoginCount: 0 } });
}

export async function activeSessionCount(db: Executor, userId: string): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), sql`${sessions.expiresAt} > now()`));
  return r?.n ?? 0;
}

export async function forceLogout(tx: Executor, ctx: RoleCtx & { tenantId: string }, userId: string): Promise<number> {
  const u = await loadManageable(tx, ctx.principal, userId);
  const revoked = await activeSessionCount(tx, userId);
  await revokeAllSessions(tx, ctx.tenantId, userId, 'force_logout');
  await audit(tx, ctx.actor, { action: 'user.force_logout', entity: 'user', entityId: userId, summary: `Signed ${u.username} out of ${revoked} session(s)`, after: { revoked } });
  return revoked;
}

export async function listUserSessions(db: Executor, userId: string) {
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
  if (!u) throw notFound('User');
  const rows = await db
    .select({ id: sessions.id, platform: sessions.platform, deviceName: sessions.deviceName, appVersion: sessions.appVersion, ip: sessions.ip, createdAt: sessions.createdAt, lastUsedAt: sessions.lastUsedAt })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), sql`${sessions.expiresAt} > now()`))
    .orderBy(desc(sessions.lastUsedAt));
  return rows.map((s) => ({ ...s, createdAt: s.createdAt.toISOString(), lastUsedAt: s.lastUsedAt.toISOString() }));
}

export async function assertManageableForSession(db: Executor, p: Principal, userId: string): Promise<string> {
  const u = await loadManageable(db, p, userId, { allowSelf: true });
  return u.username;
}
