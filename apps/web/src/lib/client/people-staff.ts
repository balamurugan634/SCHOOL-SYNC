'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { z } from 'zod';
import type { AdmissionEnrollOut, AdmissionOut, CorrectionOut, RoleOut, StaffDetailOut, StaffListItem, StaffWorkloadOut, admissionCreateBody, admissionEnrollBody, admissionStatusBody, admissionUpdateBody, staffCreateOut, staffCreateBody, staffDeactivateBody, staffUpdateBody } from '@school-sync/shared';
import { bff } from './fetcher';
import type { Paged } from './hooks';
import { useApiMutation } from './mutations';
import { fetchAllPages } from './options';
import { PEOPLE_INVALIDATE } from './people';

/** Staff, admissions and record-correction requests (management). Keys: ['people', 'staff' | 'staff-member' | 'admissions' | 'corrections', …]. */

// ── staff ────────────────────────────────────────────────────────────────────────────────────────
export interface StaffFilters {
  q?: string;
  staffType?: string;
  status?: string;
  department?: string;
  page: number;
  pageSize: number;
}
const staffQuery = (f: Partial<StaffFilters>) => ({ q: f.q || undefined, staffType: f.staffType || undefined, status: f.status || undefined, department: f.department || undefined, page: f.page, pageSize: f.pageSize });
export const useStaffDirectory = (f: StaffFilters) => useQuery({ queryKey: ['people', 'staff', f], queryFn: ({ signal }) => bff<Paged<StaffListItem>>('/staff', { query: staffQuery(f), signal }), placeholderData: keepPreviousData, staleTime: 15_000 });
export const fetchAllStaff = (f: Omit<StaffFilters, 'page' | 'pageSize'>, signal?: AbortSignal) => fetchAllPages<StaffListItem>('/staff', staffQuery(f), signal);
export const useStaffMember = (id: string) => useQuery({ queryKey: ['people', 'staff-member', id], queryFn: ({ signal }) => bff<StaffDetailOut>(`/staff/${id}`, { signal }), staleTime: 15_000 });
export const useStaffWorkload = (id: string, enabled = true) => useQuery({ queryKey: ['people', 'staff-workload', id], queryFn: ({ signal }) => bff<StaffWorkloadOut>(`/staff/${id}/workload`, { signal }), enabled, staleTime: 15_000 });
/** Roles for the staff role picker (needs `roles:view`; the caller shows a plain note when it is refused). */
export const useRoleChoices = (enabled = true) => useQuery({ queryKey: ['people', 'roles'], queryFn: ({ signal }) => bff<{ data: RoleOut[] }>('/roles', { signal }).then((r) => r.data), enabled, staleTime: 60_000, retry: false });

export type StaffCreateInput = z.input<typeof staffCreateBody>;
export type StaffUpdateInput = z.input<typeof staffUpdateBody>;
export type StaffCreated = z.infer<typeof staffCreateOut>;
export const useCreateStaff = () => useApiMutation((body: StaffCreateInput) => bff<StaffCreated>('/staff', { method: 'POST', body }), { invalidate: PEOPLE_INVALIDATE, toastError: false });
export function useStaffActions(id: string) {
  const inv = [...PEOPLE_INVALIDATE, ['academics']] as const;
  return {
    update: useApiMutation((body: StaffUpdateInput) => bff<StaffDetailOut>(`/staff/${id}`, { method: 'PATCH', body }), { invalidate: inv, success: 'Staff details saved', toastError: false }),
    deactivate: useApiMutation((body: z.input<typeof staffDeactivateBody>) => bff<StaffDetailOut>(`/staff/${id}/deactivate`, { method: 'POST', body }), { invalidate: inv, toastError: false }),
    reactivate: useApiMutation(() => bff<StaffDetailOut>(`/staff/${id}/reactivate`, { method: 'POST' }), { invalidate: inv, success: 'Staff member reactivated. Their login works again.' }),
    setRoles: useApiMutation((roleIds: string[]) => bff<{ userId: string; roles: { id: string; key: string; name: string }[]; changed: boolean }>(`/staff/${id}/roles`, { method: 'PUT', body: { roleIds } }), { invalidate: inv, toastError: false }),
  };
}

// ── admissions ───────────────────────────────────────────────────────────────────────────────────
export interface AdmissionFilters {
  q?: string;
  status?: string;
  gradeId?: string;
  page: number;
  pageSize: number;
}
const admissionQuery = (f: Partial<AdmissionFilters>) => ({ q: f.q || undefined, status: f.status || undefined, gradeId: f.gradeId || undefined, page: f.page, pageSize: f.pageSize });
export const useAdmissions = (f: AdmissionFilters) => useQuery({ queryKey: ['people', 'admissions', f], queryFn: ({ signal }) => bff<Paged<AdmissionOut>>('/admissions', { query: admissionQuery(f), signal }), placeholderData: keepPreviousData, staleTime: 15_000 });
export const fetchAllAdmissions = (f: Omit<AdmissionFilters, 'page' | 'pageSize'>, signal?: AbortSignal) => fetchAllPages<AdmissionOut>('/admissions', admissionQuery(f), signal);

/** How many applications sit in each pipeline stage (one cheap request per stage). */
export const ADMISSION_STAGES = ['submitted', 'under_review', 'waitlisted', 'accepted', 'rejected', 'enrolled'] as const;
export const useAdmissionCounts = (gradeId?: string) =>
  useQuery({
    queryKey: ['people', 'admission-counts', gradeId ?? ''],
    queryFn: async ({ signal }) => {
      const rows = await Promise.all(ADMISSION_STAGES.map((s) => bff<Paged<AdmissionOut>>('/admissions', { query: { status: s, gradeId: gradeId || undefined, pageSize: 1 }, signal }).then((r) => [s, r.meta.total] as const)));
      return Object.fromEntries(rows) as Record<(typeof ADMISSION_STAGES)[number], number>;
    },
    staleTime: 15_000,
  });

export type AdmissionCreateInput = z.input<typeof admissionCreateBody>;
export type AdmissionUpdateInput = z.input<typeof admissionUpdateBody>;
export const useCreateAdmission = () => useApiMutation((body: AdmissionCreateInput) => bff<AdmissionOut>('/admissions', { method: 'POST', body }), { invalidate: [['people'], ['dashboard'], ['setup']], success: 'Application recorded', toastError: false });
export function useAdmissionActions(id: string) {
  const inv = PEOPLE_INVALIDATE;
  return {
    update: useApiMutation((body: AdmissionUpdateInput) => bff<AdmissionOut>(`/admissions/${id}`, { method: 'PATCH', body }), { invalidate: inv, success: 'Application saved', toastError: false }),
    setStatus: useApiMutation((body: z.input<typeof admissionStatusBody>) => bff<AdmissionOut>(`/admissions/${id}/status`, { method: 'POST', body }), { invalidate: inv, toastError: false }),
    enroll: useApiMutation((body: z.input<typeof admissionEnrollBody>) => bff<AdmissionEnrollOut>(`/admissions/${id}/enroll`, { method: 'POST', body }), { invalidate: inv, toastError: false }),
  };
}

// ── record-correction requests ───────────────────────────────────────────────────────────────────
export interface CorrectionFilters {
  q?: string;
  status?: string;
  page: number;
  pageSize: number;
}
export const useCorrections = (f: CorrectionFilters) =>
  useQuery({ queryKey: ['people', 'corrections', f], queryFn: ({ signal }) => bff<Paged<CorrectionOut>>('/correction-requests', { query: { q: f.q || undefined, status: f.status || undefined, page: f.page, pageSize: f.pageSize }, signal }), placeholderData: keepPreviousData, staleTime: 15_000 });
export function useCorrectionActions() {
  const inv = PEOPLE_INVALIDATE;
  return {
    approve: useApiMutation(({ id, note }: { id: string; note?: string }) => bff<CorrectionOut>(`/correction-requests/${id}/approve`, { method: 'POST', body: { note: note || undefined } }), { invalidate: inv, success: 'Correction approved and applied to the record', toastError: false }),
    reject: useApiMutation(({ id, note }: { id: string; note: string }) => bff<CorrectionOut>(`/correction-requests/${id}/reject`, { method: 'POST', body: { note } }), { invalidate: inv, success: 'Correction rejected', toastError: false }),
  };
}
