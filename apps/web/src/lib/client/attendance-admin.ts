'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import type {
  AttendanceCorrectionItem,
  AttendanceSchoolSummaryResponse,
  AttendanceStatus,
  LeaveItem,
  StaffAttendanceRecord,
  StaffLeaveItem,
  attendanceSectionSummaryResponse,
  attendanceShortageScanResponse,
  staffAttendanceListResponse,
  staffAttendanceMarkResponse,
  staffAttendanceSummaryResponse,
  staffLeaveBalanceResponse,
} from '@school-sync/shared';
import { toast } from '@/components/ui/toaster';
import { ApiError, errorMessage } from '../problem';
import { bff } from './fetcher';
import { useApiMutation, type ApiMutationOptions } from './mutations';

/** Attendance admin (management): school summary, corrections, student + staff leave queues, staff attendance. Keys: `['attendance', 'admin', …]`. */

export type Paged<T> = { data: T[]; meta: { page: number; pageSize: number; total: number; totalPages: number } };
export type ShortageScanResult = z.infer<typeof attendanceShortageScanResponse>;
export type SectionRangeSummary = z.infer<typeof attendanceSectionSummaryResponse>;
export type StaffRegister = z.infer<typeof staffAttendanceListResponse>;
export type StaffMarkResult = z.infer<typeof staffAttendanceMarkResponse>;
export type StaffSummary = z.infer<typeof staffAttendanceSummaryResponse>;
export type StaffLeaveBalance = z.infer<typeof staffLeaveBalanceResponse>;

const K = ['attendance', 'admin'] as const;
const AFTER_DECISION = [['attendance'], ['dashboard']] as const;

// ── error wording ───────────────────────────────────────────────────────────────────────────────
const MESSAGES: Record<string, string> = {
  SELF_APPROVAL: 'You cannot decide your own request. Ask another approver (the principal, HR or an administrator) to do it.',
  ALREADY_DECIDED: 'Someone else already decided this request. The list has been refreshed.',
  NOT_PENDING: 'Only pending requests can be changed, and this one is no longer pending.',
  NOTE_REQUIRED: 'Please say why. A reason is required when a request is rejected.',
  NOT_CLASS_TEACHER: 'Only the class teacher of this student, or the school office, can decide this leave.',
  RANGE_TOO_LARGE: 'That date range is too long. Exports cover at most 93 days at a time.',
  INVALID_RANGE: 'The start date must not be after the end date.',
  FUTURE_DATE: 'Attendance cannot be recorded for a future date.',
  NOT_A_WORKING_DAY: 'That date is not a school working day, so there is no attendance to record.',
  HOLIDAY: 'That date is a holiday, so there is no attendance to record.',
  INVALID_TIMES: 'Check-out is before check-in. Fix the times and save again.',
  DUPLICATE_STAFF: 'A staff member appears twice in the register.',
  STAFF_NOT_FOUND: 'One of the staff members is no longer active, so the register could not be saved. Reload and try again.',
  RECORD_GONE: 'The attendance record no longer exists, so the correction could not be applied.',
  EDIT_WINDOW_CLOSED: 'The edit window for this roll call has closed.',
  CORRECTION_PENDING: 'A correction for this record is already waiting for a decision.',
  SUBSCRIPTION_EXPIRED: 'The school is in read-only mode, so changes are switched off until the subscription is renewed.',
};

/** Plain-language message for an attendance problem+json; falls back to the API's own sentence. */
export function attMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 403 && !MESSAGES[e.code]) return 'Your role does not allow this action.';
    if (MESSAGES[e.code]) return MESSAGES[e.code]!;
    if (e.status === 404) return 'That record could not be found. It may have been removed or be outside your scope.';
  }
  return errorMessage(e);
}

/** useApiMutation + `go()` that toasts attendance-specific wording and never throws. */
export function useAttMutation<V = void, R = unknown>(fn: (v: V) => Promise<R>, opts: Omit<ApiMutationOptions<V, R>, 'toastError'> = {}) {
  const m = useApiMutation(fn, { ...opts, toastError: false });
  const go = async (v: V) => {
    const r = await m.run(v);
    if (!r.ok) toast.error(attMessage(r.error), { duration: 8000 });
    return r;
  };
  return Object.assign(m, { go });
}

// ── school summary ──────────────────────────────────────────────────────────────────────────────
export const useSchoolSummary = (p: { date?: string; trendDays: 7 | 31 }) =>
  useQuery({
    queryKey: [...K, 'summary', p.date ?? 'today', p.trendDays],
    queryFn: ({ signal }) => bff<AttendanceSchoolSummaryResponse>('/attendance/summary', { query: { date: p.date, trendDays: p.trendDays, absenteeLimit: 200 }, signal }),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });

export const useShortageScan = () => useAttMutation(() => bff<ShortageScanResult>('/attendance/shortage-scan', { method: 'POST', body: {} }), { invalidate: [['attendance'], ['dashboard']] });

export const useSectionRangeSummary = (sectionId: string | null, from: string, to: string) =>
  useQuery({
    queryKey: [...K, 'section-range', sectionId, from, to],
    queryFn: ({ signal }) => bff<SectionRangeSummary>(`/attendance/sections/${sectionId}/summary`, { query: { from, to }, signal }),
    enabled: !!sectionId,
    staleTime: 30_000,
  });

// ── corrections ─────────────────────────────────────────────────────────────────────────────────
export interface CorrectionFilters {
  status: string;
  sectionId: string;
  page: number;
  pageSize: number;
}
export const useCorrections = (f: CorrectionFilters) =>
  useQuery({
    queryKey: [...K, 'corrections', f],
    queryFn: ({ signal }) => bff<Paged<AttendanceCorrectionItem>>('/attendance/corrections', { query: { status: f.status || undefined, sectionId: f.sectionId || undefined, page: f.page, pageSize: f.pageSize }, signal }),
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  });

export const useDecideCorrection = () =>
  useAttMutation(
    ({ id, decision, note }: { id: string; decision: 'approve' | 'reject'; note?: string }) => bff<AttendanceCorrectionItem>(`/attendance/corrections/${id}/${decision}`, { method: 'POST', body: note ? { note } : {} }),
    { invalidate: AFTER_DECISION, success: (_r, v) => (v.decision === 'approve' ? 'Correction approved. The record was updated.' : 'Correction rejected. The requester was told why.') },
  );

// ── leave queues (student + staff share one screen) ─────────────────────────────────────────────
export interface LeaveFilters {
  status: string;
  sectionId: string;
  q: string;
  from: string;
  to: string;
  page: number;
  pageSize: number;
}
const leaveQuery = (f: LeaveFilters, kind: 'student' | 'staff') => ({
  status: f.status && f.status !== 'all' ? f.status : undefined,
  sectionId: kind === 'student' ? f.sectionId || undefined : undefined,
  q: f.q || undefined,
  from: f.from || undefined,
  to: f.to || undefined,
  page: f.page,
  pageSize: f.pageSize,
});
export const useStudentLeave = (f: LeaveFilters, enabled = true) =>
  useQuery({ queryKey: [...K, 'leave', 'student', f], queryFn: ({ signal }) => bff<Paged<LeaveItem>>('/leave', { query: leaveQuery(f, 'student'), signal }), placeholderData: keepPreviousData, staleTime: 10_000, enabled });
export const useStaffLeave = (f: LeaveFilters, enabled = true) =>
  useQuery({ queryKey: [...K, 'leave', 'staff', f], queryFn: ({ signal }) => bff<Paged<StaffLeaveItem>>('/staff-leave', { query: leaveQuery(f, 'staff'), signal }), placeholderData: keepPreviousData, staleTime: 10_000, enabled });

export const useDecideLeave = (kind: 'student' | 'staff') =>
  useAttMutation(
    ({ id, decision, note }: { id: string; decision: 'approve' | 'reject'; note?: string }) => bff<LeaveItem | StaffLeaveItem>(`${kind === 'student' ? '/leave' : '/staff-leave'}/${id}/${decision}`, { method: 'POST', body: note ? { note } : {} }),
    {
      invalidate: AFTER_DECISION,
      success: (_r, v) =>
        v.decision === 'approve'
          ? kind === 'student'
            ? 'Leave approved. Attendance for those days will show as leave.'
            : 'Leave approved. The staff member was notified.'
          : 'Leave rejected. The applicant was told why.',
    },
  );

export const useStaffLeaveBalance = (staffId: string | null) =>
  useQuery({ queryKey: [...K, 'leave-balance', staffId], queryFn: ({ signal }) => bff<StaffLeaveBalance>('/staff-leave/balance', { query: { staffId }, signal }), enabled: !!staffId, staleTime: 30_000 });

// ── staff attendance ────────────────────────────────────────────────────────────────────────────
/** Whole register for a day (staff lists are small; the bulk-mark screen needs every row, so every page is read). */
async function fetchRegister(date: string | undefined, department: string | undefined, signal?: AbortSignal): Promise<StaffRegister> {
  const first = await bff<StaffRegister>('/staff-attendance', { query: { date, department, page: 1, pageSize: 100 }, signal });
  let data = first.data;
  for (let page = 2; page <= Math.min(first.meta.totalPages, 20); page++) {
    const r = await bff<StaffRegister>('/staff-attendance', { query: { date, department, page, pageSize: 100 }, signal });
    data = data.concat(r.data);
  }
  return { ...first, data, meta: { ...first.meta, page: 1, pageSize: data.length || first.meta.pageSize, totalPages: 1 } };
}
export const useStaffRegister = (date: string | undefined, department: string) =>
  useQuery({ queryKey: [...K, 'staff-register', date ?? 'today', department], queryFn: ({ signal }) => fetchRegister(date, department || undefined, signal), staleTime: 0, refetchOnMount: 'always', placeholderData: keepPreviousData });

export interface StaffMarkRow {
  staffId: string;
  status: AttendanceStatus;
  checkIn?: string | null;
  checkOut?: string | null;
  note?: string | null;
}
export const useSaveStaffRegister = () =>
  useAttMutation(({ date, records }: { date?: string; records: StaffMarkRow[] }) => bff<StaffMarkResult>('/staff-attendance', { method: 'PUT', body: { date, records } }), {
    invalidate: [['attendance', 'admin', 'staff-register'], ['attendance', 'admin', 'staff-summary'], ['dashboard']],
  });
export const useUpdateStaffRecord = () =>
  useAttMutation(({ id, body }: { id: string; body: { status?: AttendanceStatus; checkIn?: string | null; checkOut?: string | null; note?: string | null } }) => bff<StaffAttendanceRecord>(`/staff-attendance/${id}`, { method: 'PATCH', body }), {
    invalidate: [['attendance', 'admin', 'staff-register'], ['attendance', 'admin', 'staff-summary']],
    success: 'Record corrected.',
  });

export const useStaffSummary = (from: string, to: string, department: string, enabled = true) =>
  useQuery({
    queryKey: [...K, 'staff-summary', from, to, department],
    queryFn: ({ signal }) => bff<StaffSummary>('/staff-attendance/summary', { query: { from, to, department: department || undefined }, signal }),
    enabled,
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });

// ── bulk approve (sequential: each decision is audited and notified on its own) ─────────────────
export type BulkKind = 'correction' | 'leave' | 'staff-leave';
const BULK_BASE: Record<BulkKind, string> = { correction: '/attendance/corrections', leave: '/leave', 'staff-leave': '/staff-leave' };
export interface BulkResult {
  done: number;
  failed: { id: string; message: string }[];
  /** stopped early because the school went read-only */
  stopped: boolean;
}

export function useBulkApprove(kind: BulkKind) {
  const qc = useQueryClient();
  return useMutation<BulkResult, unknown, string[]>({
    mutationFn: async (ids) => {
      const out: BulkResult = { done: 0, failed: [], stopped: false };
      for (const id of ids) {
        try {
          await bff(`${BULK_BASE[kind]}/${id}/approve`, { method: 'POST', body: {} });
          out.done++;
        } catch (e) {
          out.failed.push({ id, message: attMessage(e) });
          if (e instanceof ApiError && (e.isReadOnly || e.status === 401 || e.status === 403)) {
            out.stopped = true;
            break;
          }
        }
      }
      return out;
    },
    onSettled: () => {
      for (const key of AFTER_DECISION) void qc.invalidateQueries({ queryKey: key });
    },
  });
}
