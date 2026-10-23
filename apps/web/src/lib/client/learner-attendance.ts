'use client';

import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AttendanceStudentSummaryResponse, LeaveCreateBody, LeaveItem } from '@school-sync/shared';
import type { z } from 'zod';
import type { attendanceRecordItem } from '@school-sync/shared';
import { bff } from './fetcher';
import type { Paged } from './hooks';

/** Attendance & leave for one student (the student themself, or the parent's selected child). Keys: ['attendance', …, studentId, …]. */
export type AttendanceRecord = z.infer<typeof attendanceRecordItem>;
export interface RecordsPage {
  data: AttendanceRecord[];
  nextCursor: string | null;
}

export const ak = {
  summary: (studentId: string | null) => ['attendance', 'summary', studentId ?? 'none'] as const,
  month: (studentId: string | null, month: string) => ['attendance', 'month', studentId ?? 'none', month] as const,
  records: (studentId: string | null, status: string) => ['attendance', 'records', studentId ?? 'none', status] as const,
  leave: (studentId: string | null, f: object) => ['attendance', 'leave', studentId ?? 'me', f] as const,
};

export const useAttendanceSummary = (studentId: string | null) =>
  useQuery({
    queryKey: ak.summary(studentId),
    queryFn: ({ signal }) => bff<AttendanceStudentSummaryResponse>(`/attendance/students/${studentId}/summary`, { signal }),
    enabled: !!studentId,
    staleTime: 30_000,
  });

/** Every record of one calendar month (follows the cursor; a month is at most a few hundred rows even in period mode). */
export const useAttendanceMonth = (studentId: string | null, month: string) =>
  useQuery({
    queryKey: ak.month(studentId, month),
    queryFn: async ({ signal }) => {
      const [y, m] = month.split('-').map(Number) as [number, number];
      const last = new Date(y, m, 0).getDate();
      const from = `${month}-01`;
      const to = `${month}-${String(last).padStart(2, '0')}`;
      const out: AttendanceRecord[] = [];
      let cursor: string | null = null;
      for (let i = 0; i < 6; i++) {
        const page: RecordsPage = await bff<RecordsPage>(`/attendance/students/${studentId}/records`, { query: { from, to, limit: 100, cursor: cursor ?? undefined }, signal });
        out.push(...page.data);
        cursor = page.nextCursor;
        if (!cursor) break;
      }
      return out;
    },
    enabled: !!studentId,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

export const useAttendanceRecords = (studentId: string | null, status: string) =>
  useInfiniteQuery({
    queryKey: ak.records(studentId, status),
    queryFn: ({ pageParam, signal }) => bff<RecordsPage>(`/attendance/students/${studentId}/records`, { query: { limit: 30, cursor: pageParam || undefined, status: status || undefined }, signal }),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: !!studentId,
    staleTime: 30_000,
  });

export interface LeaveFilters {
  page: number;
  pageSize: number;
  status?: string;
}

export const useLeaves = (studentId: string | null, parent: boolean, f: LeaveFilters) =>
  useQuery({
    queryKey: ak.leave(parent ? studentId : null, f),
    queryFn: ({ signal }) => bff<Paged<LeaveItem>>('/leave', { query: { page: f.page, pageSize: f.pageSize, status: f.status || undefined, studentId: parent ? (studentId ?? undefined) : undefined }, signal }),
    enabled: !parent || !!studentId,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });

function useLeaveInvalidate() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['attendance'] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
}

export function useCreateLeave() {
  const done = useLeaveInvalidate();
  return useMutation({ mutationFn: (body: LeaveCreateBody) => bff<LeaveItem>('/leave', { method: 'POST', body }), onSuccess: done });
}

export function useCancelLeave() {
  const done = useLeaveInvalidate();
  return useMutation({ mutationFn: (id: string) => bff<LeaveItem>(`/leave/${id}/cancel`, { method: 'POST', body: {} }), onSuccess: done });
}
