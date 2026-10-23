import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import {
  ACTIONS,
  isPermissionKey,
  MODULES,
  PERMISSION_CATALOG,
  ROLE_PRESETS,
  SCOPES,
  SYSTEM_ROLE_KEYS,
  type PermissionCatalogOut,
  type PermissionKey,
  type RoleDetailOut,
  type RoleOut,
  type Scope,
  type SystemRoleKey,
} from '@school-sync/shared';
import { audit, type AuditActor } from '../../core/audit';
import { AppError, conflict, forbidden, notFound, unprocessable } from '../../core/errors';
import type { Principal } from '../../core/rbac/principal';
import type { Executor } from '../../core/tenancy/pools';
import { rolePermissions, roles, userRoles, users } from '../../db/tenant/schema';

export const SUPER_ADMIN = 'super_admin' satisfies SystemRoleKey;
const isSystemKey = (k: string): k is SystemRoleKey => (SYSTEM_ROLE_KEYS as readonly string[]).includes(k);

type RoleRow = typeof roles.$inferSelect;

// ── catalog ─────────────────────────────────────────────────────────────────────────────────────
export function buildPermissionCatalog(): PermissionCatalogOut {
  const resources = Object.entries(PERMISSION_CATALOG) as [keyof typeof PERMISSION_CATALOG, (typeof PERMISSION_CATALOG)[keyof typeof PERMISSION_CATALOG]][];
  return {
    actions: [...ACTIONS],
    scopes: [...SCOPES],
    modules: (Object.keys(MODULES) as (keyof typeof MODULES)[]).map((key) => ({
      key,
      label: MODULES[key],
      resources: resources
        .filter(([, def]) => def.module === key)
        .map(([rk, def]) => ({ key: rk, label: def.label, module: def.module, actions: def.actions.map((a) => ({ action: a, permission: `${rk}:${a}` })) })),
    })),
    systemRoles: SYSTEM_ROLE_KEYS.map((k) => {
      const p = ROLE_PRESETS[k];
      return { key: p.key, name: p.name, description: p.description, userTypes: [...p.userTypes], experience: p.experience, grants: { ...p.grants } as Record<string, Scope> };
    }),
  };
}

// ── reads ───────────────────────────────────────────────────────────────────────────────────────
const roleSelect = (db: Executor) =>
  db
    .select({
      id: roles.id,
      key: roles.key,
      name: roles.name,
      description: roles.description,
      isSystem: roles.isSystem,
      createdAt: roles.createdAt,
      updatedAt: roles.updatedAt,
      userCount: sql<number>`(select count(*)::int from ${userRoles} where ${userRoles.roleId} = ${roles.id})`,
      permissionCount: sql<number>`(select count(*)::int from ${rolePermissions} where ${rolePermissions.roleId} = ${roles.id})`,
    })
    .from(roles);

const toRoleOut = (r: Awaited<ReturnType<typeof roleSelect>>[number]): RoleOut => ({
  id: r.id,
  key: r.key,
  name: r.name,
  description: r.description,
  isSystem: r.isSystem,
  userCount: r.userCount,
  permissionCount: r.permissionCount,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

export async function listRoles(db: Executor): Promise<RoleOut[]> {
  const rows = await roleSelect(db).orderBy(desc(roles.isSystem), asc(roles.name));
  return rows.map(toRoleOut);
}

export async function roleGrants(db: Executor, roleId: string): Promise<Record<string, Scope>> {
  const rows = await db.select({ permission: rolePermissions.permission, scope: rolePermissions.scope }).from(rolePermissions).where(eq(rolePermissions.roleId, roleId)).orderBy(asc(rolePermissions.permission));
  return Object.fromEntries(rows.map((r) => [r.permission, r.scope]));
}

export async function getRoleDetail(db: Executor, id: string): Promise<RoleDetailOut> {
  const [row] = await roleSelect(db).where(eq(roles.id, id)).limit(1);
  if (!row) throw notFound('Role');
  return { ...toRoleOut(row), grants: await roleGrants(db, id) };
}

async function requireRole(db: Executor, id: string): Promise<RoleRow> {
  const [row] = await db.select().from(roles).where(eq(roles.id, id)).limit(1);
  if (!row) throw notFound('Role');
  return row;
}

// ── validation helpers ──────────────────────────────────────────────────────────────────────────
/** 422 naming every key that is not a real `resource:action` permission. */
export function assertKnownPermissions(keys: string[]): void {
  const bad = keys.filter((k) => !isPermissionKey(k));
  if (bad.length) throw new AppError(422, 'UNKNOWN_PERMISSION', `Unknown permission${bad.length > 1 ? 's' : ''}: ${bad.join(', ')}`, { invalid: bad });
}

/** Without the super_admin role you may only hand out access you hold yourself (same permission at an equal or wider scope). */
export function assertCanGrant(p: Principal, grants: Record<string, Scope>): void {
  if (p.hasRole(SUPER_ADMIN)) return;
  const beyond = Object.entries(grants).filter(([perm, scope]) => !p.can(perm as PermissionKey, scope));
  if (beyond.length) throw new AppError(403, 'CANNOT_GRANT_BEYOND_OWN_ACCESS', `You cannot grant access you do not hold yourself: ${beyond.map(([k, v]) => `${k}:${v}`).join(', ')}`, { permissions: beyond.map(([k]) => k) });
}

/** URL/identifier-safe key from a display name: "Lab Assistant" -> lab_assistant */
export const slugifyRoleKey = (name: string): string =>
  name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);

/** Bump `auth_version` for everyone holding the role: their access tokens go stale and they refresh to pick up new grants. */
async function bumpRoleHolders(db: Executor, roleId: string): Promise<void> {
  await db.update(users).set({ authVersion: sql`${users.authVersion} + 1` }).where(inArray(users.id, db.select({ id: userRoles.userId }).from(userRoles).where(eq(userRoles.roleId, roleId))));
}

// ── role CRUD ───────────────────────────────────────────────────────────────────────────────────
export interface RoleCtx {
  actor: AuditActor;
  principal: Principal;
}

export async function createRole(tx: Executor, ctx: RoleCtx, input: { name: string; description?: string; cloneFromRoleId?: string; grants?: Record<string, Scope> }): Promise<string> {
  const key = slugifyRoleKey(input.name);
  if (!key) throw unprocessable('Role name must contain letters or digits', 'INVALID_ROLE_NAME');
  if (isSystemKey(key)) throw conflict(`"${key}" is a built-in role key; choose a different name`, 'ROLE_KEY_RESERVED');
  const [dup] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.key, key)).limit(1);
  if (dup) throw conflict(`A role with the key "${key}" already exists`, 'ROLE_KEY_TAKEN');

  let grants: Record<string, Scope> = {};
  if (input.cloneFromRoleId) {
    await requireRole(tx, input.cloneFromRoleId);
    grants = await roleGrants(tx, input.cloneFromRoleId);
  }
  if (input.grants) {
    assertKnownPermissions(Object.keys(input.grants));
    grants = { ...grants, ...input.grants };
  }
  assertCanGrant(ctx.principal, grants);

  const [created] = await tx.insert(roles).values({ key, name: input.name, description: input.description ?? null, isSystem: false }).returning({ id: roles.id });
  const entries = Object.entries(grants);
  if (entries.length) await tx.insert(rolePermissions).values(entries.map(([permission, scope]) => ({ roleId: created!.id, permission, scope })));
  await audit(tx, ctx.actor, { action: 'role.create', entity: 'role', entityId: created!.id, summary: `Created role ${input.name}`, after: { key, name: input.name, description: input.description ?? null, grants } });
  return created!.id;
}

export async function updateRole(tx: Executor, ctx: RoleCtx, id: string, input: { name?: string; description?: string | null }): Promise<void> {
  const before = await requireRole(tx, id);
  const patch: Partial<typeof roles.$inferInsert> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.description !== undefined) patch.description = input.description;
  if (!Object.keys(patch).length) return;
  await tx.update(roles).set(patch).where(eq(roles.id, id));
  await audit(tx, ctx.actor, { action: 'role.update', entity: 'role', entityId: id, summary: `Updated role ${before.key}`, before: { name: before.name, description: before.description }, after: { name: input.name ?? before.name, description: input.description === undefined ? before.description : input.description } });
}

/**
 * Apply a partial grants map (`null` removes). Returns whether anything changed; when it did, every holder's `auth_version`
 * is bumped in the same transaction. The CALLER must call `invalidatePrincipal(tenantId)` after the commit.
 */
export async function setRoleGrants(tx: Executor, ctx: RoleCtx, id: string, patch: Record<string, Scope | null>): Promise<{ changed: boolean }> {
  const role = await requireRole(tx, id);
  if (role.key === SUPER_ADMIN) throw unprocessable('The super administrator role always keeps every permission and cannot be edited', 'SUPER_ADMIN_LOCKED');
  assertKnownPermissions(Object.keys(patch));

  const before = await roleGrants(tx, id);
  const after: Record<string, Scope> = { ...before };
  const toSet: [string, Scope][] = [];
  const toRemove: string[] = [];
  for (const [perm, scope] of Object.entries(patch)) {
    if (scope === null) {
      if (perm in after) {
        delete after[perm];
        toRemove.push(perm);
      }
    } else if (after[perm] !== scope) {
      after[perm] = scope;
      toSet.push([perm, scope]);
    }
  }
  if (!toSet.length && !toRemove.length) return { changed: false };
  assertCanGrant(ctx.principal, Object.fromEntries(toSet));

  if (toRemove.length) await tx.delete(rolePermissions).where(and(eq(rolePermissions.roleId, id), inArray(rolePermissions.permission, toRemove)));
  if (toSet.length) {
    await tx
      .insert(rolePermissions)
      .values(toSet.map(([permission, scope]) => ({ roleId: id, permission, scope })))
      .onConflictDoUpdate({ target: [rolePermissions.roleId, rolePermissions.permission], set: { scope: sql`excluded.scope` } });
  }
  await tx.update(roles).set({ updatedAt: new Date() }).where(eq(roles.id, id));
  await bumpRoleHolders(tx, id);
  await audit(tx, ctx.actor, { action: 'role.permissions', entity: 'role', entityId: id, summary: `Changed permissions of ${role.key}: +${toSet.length} / -${toRemove.length}`, before, after });
  return { changed: true };
}

export async function deleteRole(tx: Executor, ctx: RoleCtx, id: string): Promise<void> {
  const role = await requireRole(tx, id);
  if (role.isSystem) throw conflict('Built-in roles cannot be deleted (you can edit their permissions instead)', 'ROLE_SYSTEM');
  const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(userRoles).where(eq(userRoles.roleId, id))) as [{ n: number }];
  if (n > 0) throw conflict(`This role is assigned to ${n} user${n === 1 ? '' : 's'}; remove it from them first`, 'ROLE_IN_USE');
  const grants = await roleGrants(tx, id);
  await tx.delete(roles).where(eq(roles.id, id));
  await audit(tx, ctx.actor, { action: 'role.delete', entity: 'role', entityId: id, summary: `Deleted role ${role.key}`, before: { key: role.key, name: role.name, description: role.description, grants } });
}

// ── role assignment on users ────────────────────────────────────────────────────────────────────
export interface AssignCtx extends RoleCtx {
  tenantId: string;
}

/** Another ACTIVE user (not `exceptUserId`) holds super_admin? Serialised with an advisory lock so two concurrent removals can't both pass. */
export async function assertOtherActiveSuperAdmin(tx: Executor, exceptUserId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(727010)`);
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .innerJoin(users, eq(users.id, userRoles.userId))
    .where(and(eq(roles.key, SUPER_ADMIN), eq(users.status, 'active'), ne(users.id, exceptUserId)));
  if (!row || row.n < 1) throw new AppError(409, 'LAST_SUPER_ADMIN', 'This is the last active super administrator; make someone else a super administrator first');
}

export async function userRoleKeys(db: Executor, userId: string): Promise<{ id: string; key: string; name: string }[]> {
  return db
    .select({ id: roles.id, key: roles.key, name: roles.name })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.userId, userId))
    .orderBy(asc(roles.key));
}

/** Reject a system role that is meant for other kinds of accounts (a student must not become a teacher). */
export function assertRolesFitUserType(rows: { key: string; isSystem: boolean }[], userType: string): void {
  for (const r of rows) {
    if (!r.isSystem || !isSystemKey(r.key)) continue;
    if (!(ROLE_PRESETS[r.key].userTypes as readonly string[]).includes(userType)) {
      throw new AppError(422, 'ROLE_NOT_ALLOWED_FOR_USER_TYPE', `The "${r.key}" role cannot be given to a ${userType} account`);
    }
  }
}

/**
 * Replace the full set of roles of a user. Does ALL the checks (caller needs `roles:edit`; not on yourself; role/user-type fit;
 * only a super_admin may grant/remove `super_admin` or touch a super_admin's roles; never the last active super_admin),
 * writes the change, bumps `users.auth_version` and audits before/after role keys — all inside the passed transaction.
 *
 * The CALLER must, AFTER the transaction commits: `invalidatePrincipal(tenantId, userId)` and (when `changed`)
 * `notify(...)` the user (type `system.access_changed`). Returns the role keys before/after.
 */
export async function replaceUserRoles(tx: Executor, ctx: AssignCtx, userId: string, roleIds: string[]): Promise<{ before: string[]; after: string[]; changed: boolean }> {
  const { principal } = ctx;
  if (!principal.scope('roles:edit')) throw forbidden();
  if (userId === principal.userId) throw forbidden('You cannot change your own roles', 'CANNOT_MODIFY_SELF');
  const [target] = await tx.select({ id: users.id, userType: users.userType, status: users.status, username: users.username }).from(users).where(eq(users.id, userId)).limit(1);
  if (!target) throw notFound('User');

  const wanted = [...new Set(roleIds)];
  const roleRows = wanted.length ? await tx.select().from(roles).where(inArray(roles.id, wanted)) : [];
  if (roleRows.length !== wanted.length) throw new AppError(422, 'ROLE_NOT_FOUND', 'One or more roles do not exist');
  assertRolesFitUserType(roleRows, target.userType);

  const current = await userRoleKeys(tx, userId);
  const before = current.map((r) => r.key).sort();
  const after = roleRows.map((r) => r.key).sort();
  const currentIds = new Set(current.map((r) => r.id));
  const toAdd = roleRows.filter((r) => !currentIds.has(r.id));
  const toRemove = current.filter((r) => !wanted.includes(r.id));
  if (!toAdd.length && !toRemove.length) return { before, after, changed: false };

  const isSuper = principal.hasRole(SUPER_ADMIN);
  const touchesSuper = before.includes(SUPER_ADMIN) || toAdd.some((r) => r.key === SUPER_ADMIN);
  if (touchesSuper && !isSuper) throw forbidden('Only a super administrator can change super administrator access', 'ONLY_SUPER_ADMIN');
  if (toRemove.some((r) => r.key === SUPER_ADMIN) && target.status === 'active') await assertOtherActiveSuperAdmin(tx, userId);

  if (toRemove.length)
    await tx.delete(userRoles).where(
      and(
        eq(userRoles.userId, userId),
        inArray(
          userRoles.roleId,
          toRemove.map((r) => r.id),
        ),
      ),
    );
  if (toAdd.length) await tx.insert(userRoles).values(toAdd.map((r) => ({ userId, roleId: r.id, grantedBy: principal.userId })));
  await tx.update(users).set({ authVersion: sql`${users.authVersion} + 1` }).where(eq(users.id, userId));
  await audit(tx, ctx.actor, { action: 'user.roles', entity: 'user', entityId: userId, summary: `Changed roles of ${target.username}: +${toAdd.length} / -${toRemove.length}`, before: { roles: before }, after: { roles: after } });
  return { before, after, changed: true };
}
