'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { z } from 'zod';
import type {
  AttendanceStudentSummaryResponse,
  GuardianLinkOut,
  GuardianOut,
  IssuedCredential,
  InvoiceOut,
  StudentCreateOut,
  StudentDetailOut,
  StudentDocumentOut,
  StudentImportOut,
  StudentListItem,
  StudentResultOut,
  studentCreateBody,
  studentGuardianLinkBody,
  studentGuardianUpdateBody,
  studentImportBody,
  studentMoveSectionBody,
  studentStatusBody,
  studentUpdateBody,
  guardianCreateBody,
  guardianUpdateBody,
  studentDocumentCreateBody,
} from '@school-sync/shared';
import { bff } from './fetcher';
import type { Paged } from './hooks';
import { useApiMutation } from './mutations';
import { fetchAllPages } from './options';

/** Students, guardians and their links / documents (management). Keys: ['people', 'students' | 'student' | 'guardians' | 'guardian', …]. */

/** Everything a people mutation can change: lists, details, section counts, seats, dashboards, setup progress. */
export const PEOPLE_INVALIDATE = [['people'], ['academics', 'sections'], ['dashboard'], ['license'], ['setup']] as const;

// ── students ─────────────────────────────────────────────────────────────────────────────────────
export interface StudentFilters {
  q?: string;
  gradeId?: string;
  sectionId?: string;
  status?: string;
  page: number;
  pageSize: number;
}
const studentQuery = (f: Partial<StudentFilters>) => ({ q: f.q || undefined, gradeId: f.gradeId || undefined, sectionId: f.sectionId || undefined, status: f.status || undefined, page: f.page, pageSize: f.pageSize });

export const useStudents = (f: StudentFilters) =>
  useQuery({ queryKey: ['people', 'students', f], queryFn: ({ signal }) => bff<Paged<StudentListItem>>('/students', { query: studentQuery(f), signal }), placeholderData: keepPreviousData, staleTime: 15_000 });

/** Every student matching the filters (for the CSV export), max 5 000. */
export const fetchAllStudents = (f: Omit<StudentFilters, 'page' | 'pageSize'>, signal?: AbortSignal) => fetchAllPages<StudentListItem>('/students', studentQuery(f), signal);

export const useStudent = (id: string) => useQuery({ queryKey: ['people', 'student', id], queryFn: ({ signal }) => bff<StudentDetailOut>(`/students/${id}`, { signal }), staleTime: 15_000 });

export const useStudentAttendance = (id: string, enabled = true) =>
  useQuery({ queryKey: ['people', 'student-attendance', id], queryFn: ({ signal }) => bff<AttendanceStudentSummaryResponse>(`/attendance/students/${id}/summary`, { signal }), enabled, staleTime: 30_000, retry: false });

export const useStudentResults = (id: string, enabled = true) =>
  useQuery({ queryKey: ['people', 'student-results', id], queryFn: ({ signal }) => bff<{ data: StudentResultOut[] }>('/results', { query: { studentId: id }, signal }).then((r) => r.data), enabled, staleTime: 30_000, retry: false });

export const useStudentInvoices = (id: string, enabled = true) =>
  useQuery({ queryKey: ['people', 'student-invoices', id], queryFn: ({ signal }) => bff<Paged<InvoiceOut>>('/fees/invoices', { query: { studentId: id, pageSize: 50 }, signal }).then((r) => r.data), enabled, staleTime: 30_000, retry: false });

export type StudentCreateInput = z.input<typeof studentCreateBody>;
export type StudentUpdateInput = z.input<typeof studentUpdateBody>;

export const useCreateStudent = () => useApiMutation((body: StudentCreateInput) => bff<StudentCreateOut>('/students', { method: 'POST', body }), { invalidate: PEOPLE_INVALIDATE, toastError: false });

export function useStudentActions(id: string) {
  const inv = PEOPLE_INVALIDATE;
  return {
    update: useApiMutation((body: StudentUpdateInput) => bff<StudentDetailOut>(`/students/${id}`, { method: 'PATCH', body }), { invalidate: inv, success: 'Student details saved', toastError: false }),
    setStatus: useApiMutation((body: z.input<typeof studentStatusBody>) => bff<StudentDetailOut>(`/students/${id}/status`, { method: 'POST', body }), { invalidate: inv, toastError: false }),
    move: useApiMutation((body: z.input<typeof studentMoveSectionBody>) => bff<StudentDetailOut>(`/students/${id}/move-section`, { method: 'POST', body }), { invalidate: inv, success: 'Student moved to the new section', toastError: false }),
    link: useApiMutation((body: z.input<typeof studentGuardianLinkBody>) => bff<GuardianLinkOut>(`/students/${id}/guardians`, { method: 'POST', body }), { invalidate: inv, success: 'Parent linked' }),
    updateLink: useApiMutation(({ guardianId, body }: { guardianId: string; body: z.input<typeof studentGuardianUpdateBody> }) => bff<GuardianLinkOut>(`/students/${id}/guardians/${guardianId}`, { method: 'PATCH', body }), { invalidate: inv, success: 'Link updated' }),
    unlink: useApiMutation((guardianId: string) => bff<null>(`/students/${id}/guardians/${guardianId}`, { method: 'DELETE' }), { invalidate: inv, success: 'Parent unlinked' }),
    verify: useApiMutation((guardianId: string) => bff<GuardianLinkOut>(`/students/${id}/guardians/${guardianId}/verify`, { method: 'POST' }), { invalidate: inv, success: 'Link verified. The parent can now see this child.' }),
    unverify: useApiMutation((guardianId: string) => bff<GuardianLinkOut>(`/students/${id}/guardians/${guardianId}/unverify`, { method: 'POST' }), { invalidate: inv, success: 'Verification withdrawn. The parent no longer sees this child.' }),
    addDocument: useApiMutation((body: z.input<typeof studentDocumentCreateBody>) => bff<StudentDocumentOut>(`/students/${id}/documents`, { method: 'POST', body }), { invalidate: inv, success: 'Document added', toastError: false }),
    verifyDocument: useApiMutation((docId: string) => bff<StudentDocumentOut>(`/students/${id}/documents/${docId}/verify`, { method: 'POST' }), { invalidate: inv, success: 'Document marked as checked' }),
    deleteDocument: useApiMutation((docId: string) => bff<null>(`/students/${id}/documents/${docId}`, { method: 'DELETE' }), { invalidate: inv, success: 'Document removed' }),
  };
}

export type StudentImportInput = z.input<typeof studentImportBody>;
export const useImportStudents = () => useApiMutation((body: StudentImportInput) => bff<StudentImportOut>('/students/import', { method: 'POST', body }), { invalidate: PEOPLE_INVALIDATE, toastError: false });

// ── guardians ────────────────────────────────────────────────────────────────────────────────────
export interface GuardianFilters {
  q?: string;
  hasLogin?: string;
  page: number;
  pageSize: number;
}
export const useGuardians = (f: GuardianFilters) =>
  useQuery({ queryKey: ['people', 'guardians', f], queryFn: ({ signal }) => bff<Paged<GuardianOut>>('/guardians', { query: { q: f.q || undefined, hasLogin: f.hasLogin || undefined, page: f.page, pageSize: f.pageSize }, signal }), placeholderData: keepPreviousData, staleTime: 15_000 });

/** Small search-as-you-type lookup for the parent pickers. */
export const useGuardianLookup = (q: string, enabled = true) =>
  useQuery({ queryKey: ['people', 'guardian-lookup', q], queryFn: ({ signal }) => bff<Paged<GuardianOut>>('/guardians', { query: { q, pageSize: 8 }, signal }).then((r) => r.data), enabled: enabled && q.trim().length >= 2, staleTime: 15_000 });

export const useGuardian = (id: string) => useQuery({ queryKey: ['people', 'guardian', id], queryFn: ({ signal }) => bff<GuardianOut>(`/guardians/${id}`, { signal }), staleTime: 15_000 });

export type GuardianCreateInput = z.input<typeof guardianCreateBody>;
export type GuardianUpdateInput = z.input<typeof guardianUpdateBody>;
export const useCreateGuardian = () => useApiMutation((body: GuardianCreateInput) => bff<GuardianOut & { credentials: IssuedCredential | null }>('/guardians', { method: 'POST', body }), { invalidate: PEOPLE_INVALIDATE, toastError: false });
export function useGuardianActions(id: string) {
  return {
    update: useApiMutation((body: GuardianUpdateInput) => bff<GuardianOut>(`/guardians/${id}`, { method: 'PATCH', body }), { invalidate: PEOPLE_INVALIDATE, success: 'Parent details saved', toastError: false }),
    remove: useApiMutation(() => bff<null>(`/guardians/${id}`, { method: 'DELETE' }), { invalidate: PEOPLE_INVALIDATE, success: 'Parent removed' }),
    createLogin: useApiMutation(() => bff<IssuedCredential>(`/guardians/${id}/login`, { method: 'POST' }), { invalidate: PEOPLE_INVALIDATE }),
  };
}
