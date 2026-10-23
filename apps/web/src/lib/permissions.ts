import { scopeAtLeast, type Me, type PermissionKey, type Scope } from '@school-sync/shared';

export type Grants = Me['permissions'];

/** UI gating only — the API enforces for real. */
export function can(grants: Grants, perm: PermissionKey, min: Scope = 'own'): boolean {
  return scopeAtLeast(grants[perm], min);
}
export function canAny(grants: Grants, ...perms: PermissionKey[]): boolean {
  return perms.some((p) => can(grants, p));
}
export function canAll(grants: Grants, ...perms: PermissionKey[]): boolean {
  return perms.every((p) => can(grants, p));
}

/** Who sees the "Get your school ready" wizard. */
export function isSetupAdmin(me: Pick<Me, 'permissions' | 'roles'>): boolean {
  return me.roles.includes('super_admin') || can(me.permissions, 'settings:edit', 'school');
}
