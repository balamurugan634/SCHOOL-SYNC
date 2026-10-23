'use client';

import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { z } from 'zod';
import type {
  AuditDetailOut,
  AuditEntryOut,
  BrandingOut,
  BrandingUpdateBody,
  FeaturesOut,
  PermissionCatalogOut,
  RoleCreateBody,
  RoleDetailOut,
  RoleOut,
  RoleUpdateBody,
  SetupStatusOut,
  UserCreateBody,
  UserDetailOut,
  UserListQuery,
  UserOut,
  forceLogoutOut,
  passwordResetOut,
  userCreateOut,
  userRolesOut,
  userSessionOut,
} from '@school-sync/shared';
import { bff } from './fetcher';
import { fetchAllPages } from './options';
import { useApiMutation } from './mutations';

/** Settings & access: roles, users, school settings, branding, features, audit log, setup checklist. */

type Paged<T> = { data: T[]; meta: { page: number; pageSize: number; total: number; totalPages: number } };
export type UserCreated = z.infer<typeof userCreateOut>;
export type PasswordReset = z.infer<typeof passwordResetOut>;
export type UserSession = z.infer<typeof userSessionOut>;
export type UserRolesResult = z.infer<typeof userRolesOut>;
export type ForceLogoutResult = z.infer<typeof forceLogoutOut>;

// ── roles ────────────────────────────────────────────────────────────────────────────────────────
export const useRoles = (enabled = true) => useQuery({ queryKey: ['roles', 'list'], queryFn: ({ signal }) => bff<{ data: RoleOut[] }>('/roles', { signal }).then((r) => r.data), enabled, staleTime: 30_000 });
export const useRoleDetail = (id: string) => useQuery({ queryKey: ['roles', 'detail', id], queryFn: ({ signal }) => bff<RoleDetailOut>(`/roles/${id}`, { signal }), staleTime: 15_000 });
export const usePermissionCatalog = (enabled = true) => useQuery({ queryKey: ['roles', 'catalog'], queryFn: ({ signal }) => bff<PermissionCatalogOut>('/permissions/catalog', { signal }), enabled, staleTime: 10 * 60_000 });

const ROLE_INVALIDATE = [['roles'], ['users'], ['people', 'roles'], ['audit']] as const;
export const useCreateRole = () => useApiMutation((body: RoleCreateBody) => bff<RoleDetailOut>('/roles', { method: 'POST', body }), { invalidate: ROLE_INVALIDATE, success: (r) => `Created the role “${r.name}”.` });
export const useUpdateRole = (id: string) => useApiMutation((body: RoleUpdateBody) => bff<RoleDetailOut>(`/roles/${id}`, { method: 'PATCH', body }), { invalidate: ROLE_INVALIDATE, success: 'Role details saved.' });
export const useDeleteRole = (id: string) => useApiMutation(() => bff<{ ok: true }>(`/roles/${id}`, { method: 'DELETE' }), { invalidate: ROLE_INVALIDATE, success: 'Role deleted.' });
/** `grants`: permission → scope, or null to remove. Only changed entries are sent. */
export const useSaveRoleGrants = (id: string) =>
  useApiMutation((grants: Record<string, string | null>) => bff<RoleDetailOut>(`/roles/${id}/permissions`, { method: 'PUT', body: { grants } }), { invalidate: ROLE_INVALIDATE });

// ── users ────────────────────────────────────────────────────────────────────────────────────────
export interface UserFilters {
  q?: string;
  userType?: string;
  status?: string;
  roleId?: string;
  page: number;
  pageSize: number;
}
export const useUsers = (f: UserFilters) =>
  useQuery({
    queryKey: ['users', 'list', f],
    queryFn: ({ signal }) => bff<Paged<UserOut>>('/users', { query: { q: f.q, userType: f.userType as UserListQuery['userType'], status: f.status, roleId: f.roleId, page: f.page, pageSize: f.pageSize }, signal }),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
/** Staff accounts for pickers (e.g. the audit-log actor filter). Needs `users:view`. */
export const useStaffUsers = (enabled = true) => useQuery({ queryKey: ['users', 'staff-picker'], queryFn: ({ signal }) => fetchAllPages<UserOut>('/users', { userType: 'staff' }, signal), enabled, staleTime: 60_000 });
export const useUserDetail = (id: string | null) => useQuery({ queryKey: ['users', 'detail', id], queryFn: ({ signal }) => bff<UserDetailOut>(`/users/${id}`, { signal }), enabled: !!id, staleTime: 5_000 });
export const useUserSessions = (id: string | null) => useQuery({ queryKey: ['users', 'sessions', id], queryFn: ({ signal }) => bff<{ data: UserSession[] }>(`/users/${id}/sessions`, { signal }).then((r) => r.data), enabled: !!id, staleTime: 5_000 });

const USER_INVALIDATE = [['users'], ['roles', 'list'], ['audit']] as const;
export const useCreateUser = () => useApiMutation((body: UserCreateBody) => bff<UserCreated>('/users', { method: 'POST', body }), { invalidate: USER_INVALIDATE });
export function useUserActions(id: string) {
  return {
    setRoles: useApiMutation((roleIds: string[]) => bff<UserRolesResult>(`/users/${id}/roles`, { method: 'PUT', body: { roleIds } }), { invalidate: USER_INVALIDATE, success: 'Roles updated. The person’s access refreshes the next time their app syncs.' }),
    deactivate: useApiMutation(() => bff<UserDetailOut>(`/users/${id}/deactivate`, { method: 'POST' }), { invalidate: USER_INVALIDATE, success: 'Account deactivated and signed out everywhere.' }),
    reactivate: useApiMutation(() => bff<UserDetailOut>(`/users/${id}/reactivate`, { method: 'POST' }), { invalidate: USER_INVALIDATE, success: 'Account reactivated.' }),
    resetPassword: useApiMutation(() => bff<PasswordReset>(`/users/${id}/reset-password`, { method: 'POST' }), { invalidate: USER_INVALIDATE }),
    unlock: useApiMutation(() => bff<UserDetailOut>(`/users/${id}/unlock`, { method: 'POST' }), { invalidate: USER_INVALIDATE, success: 'Sign-in lock cleared.' }),
    forceLogout: useApiMutation(() => bff<ForceLogoutResult>(`/users/${id}/force-logout`, { method: 'POST' }), { invalidate: USER_INVALIDATE, success: (r) => (r.revoked === 1 ? 'Signed out of 1 device.' : `Signed out of ${r.revoked} devices.`) }),
    revokeSession: useApiMutation((sessionId: string) => bff<{ ok: true }>(`/users/${id}/sessions/${sessionId}`, { method: 'DELETE' }), { invalidate: [['users', 'sessions', id], ['users', 'detail', id]], success: 'Device signed out.' }),
  };
}

// ── school settings ──────────────────────────────────────────────────────────────────────────────
export type SettingsAll = Record<string, Record<string, unknown>>;
export const useSettings = (enabled = true) => useQuery({ queryKey: ['settings', 'all'], queryFn: ({ signal }) => bff<SettingsAll>('/settings', { signal }), enabled, staleTime: 30_000 });
export const useSaveSettingsGroup = (group: string) =>
  useApiMutation((values: Record<string, unknown>) => bff<Record<string, unknown>>(`/settings/${group}`, { method: 'PUT', body: values }), { invalidate: [['settings'], ['setup'], ['audit']], success: 'Settings saved.' });

export const useBranding = (enabled = true) => useQuery({ queryKey: ['settings', 'branding'], queryFn: ({ signal }) => bff<BrandingOut>('/settings/branding', { signal }), enabled, staleTime: 30_000 });
export const useSaveBranding = () => useApiMutation((body: BrandingUpdateBody) => bff<BrandingOut>('/settings/branding', { method: 'PUT', body }), { invalidate: [['settings'], ['setup'], ['audit']], success: 'School profile saved.' });

export const useFeatures = (enabled = true) => useQuery({ queryKey: ['settings', 'features'], queryFn: ({ signal }) => bff<FeaturesOut>('/settings/features', { signal }), enabled, staleTime: 30_000 });
export const useSaveFeatures = () => useApiMutation((body: Partial<FeaturesOut>) => bff<FeaturesOut>('/settings/features', { method: 'PUT', body }), { invalidate: [['settings'], ['audit']], success: 'Feature switches saved.' });

// ── audit log (keyset pagination) ────────────────────────────────────────────────────────────────
export interface AuditFilters {
  actorUserId?: string;
  entity?: string;
  action?: string;
  from?: string;
  to?: string;
}
type AuditPage = { data: AuditEntryOut[]; nextCursor: string | null };
export const useAudit = (f: AuditFilters) =>
  useInfiniteQuery({
    queryKey: ['audit', 'list', f],
    queryFn: ({ pageParam, signal }) => bff<AuditPage>('/audit', { query: { ...f, cursor: pageParam, limit: 50 }, signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 15_000,
  });
export const useAuditEntry = (id: string | null) => useQuery({ queryKey: ['audit', 'entry', id], queryFn: ({ signal }) => bff<AuditDetailOut>(`/audit/${id}`, { signal }), enabled: !!id, staleTime: 5 * 60_000 });

// ── setup checklist ──────────────────────────────────────────────────────────────────────────────
export const useSetupStatus = (enabled = true) => useQuery({ queryKey: ['setup', 'status'], queryFn: ({ signal }) => bff<SetupStatusOut>('/setup/status', { signal }), enabled, staleTime: 15_000 });
