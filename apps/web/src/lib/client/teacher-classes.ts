'use client';

import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import type {
  AttendanceCorrectionItem,
  AttendanceStudentSummaryResponse,
  HomeworkItem,
  LeaveItem,
  StudentDetailOut,
  StudentListItem,
  StudentResultOut,
  SubmissionItem,
  attendanceRecordItem,
  attendanceRecordsResponse,
  attendanceSectionSummaryResponse,
  attendanceCorrectionCreateBody,
} from '@school-sync/shared';
import { ApiError } from '../problem';
import { bff } from './fetcher';
import type { Paged } from './hooks';

export type SectionAttendanceSummary = z.infer<typeof attendanceSectionSummaryResponse>;
export type AttendanceRecord = z.infer<typeof attendanceRecordItem>;
export type AttendanceRecordsPage = z.infer<typeof attendanceRecordsResponse>;
export type CorrectionCreate = z.infer<typeof attendanceCorrectionCreateBody>;

export const clsKeys = {
  students: (sectionId: string) => ['students', 'section', sectionId] as const,
  student: (id: string) => ['students', 'one', id] as const,
  secSummary: (sectionId: string, from: string, to: string) => ['attendance', 'section-summary', sectionId, from, to] as const,
  stuSummary: (id: string) => ['attendance', 'student-summary', id] as const,
  stuRecords: (id: string) => ['attendance', 'student-records', id] as const,
  stuResults: (id: string) => ['results', 'student', id] as const,
  stuLeave: (id: string) => ['leave', 'student', id] as const,
  secHomework: (sectionId: string) => ['homework', 'section-completion', sectionId] as const,
};

/** Never retry a 403/404 (out of scope): the screen shows a calm state instead. */
const noRetryScope = (count: number, err: unknown) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2;

export function useSectionStudents(sectionId: string | null | undefined) {
  return useQuery({
    queryKey: clsKeys.students(sectionId ?? ''),
    queryFn: async ({ signal }) => {
      const all: StudentListItem[] = [];
      for (let page = 1; page <= 5; page++) {
        const r = await bff<Paged<StudentListItem>>('/students', { query: { sectionId: sectionId!, page, pageSize: 100 }, signal });
        all.push(...r.data);
        if (page >= (r.meta?.totalPages ?? 1)) break;
      }
      return all.sort((a, b) => (a.rollNo ?? 9999) - (b.rollNo ?? 9999) || a.name.localeCompare(b.name));
    },
    enabled: !!sectionId,
    staleTime: 60_000,
    retry: noRetryScope,
  });
}

export const useStudent = (id: string | null | undefined) =>
  useQuery({ queryKey: clsKeys.student(id ?? ''), queryFn: ({ signal }) => bff<StudentDetailOut>(`/students/${id}`, { signal }), enabled: !!id, staleTime: 60_000, retry: noRetryScope });

export const useSectionAttendanceSummary = (sectionId: string | null | undefined, from: string, to: string) =>
  useQuery({
    queryKey: clsKeys.secSummary(sectionId ?? '', from, to),
    queryFn: ({ signal }) => bff<SectionAttendanceSummary>(`/attendance/sections/${sectionId}/summary`, { query: { from, to }, signal }),
    enabled: !!sectionId,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    retry: noRetryScope,
  });

export const useStudentAttendanceSummary = (id: string | null | undefined) =>
  useQuery({ queryKey: clsKeys.stuSummary(id ?? ''), queryFn: ({ signal }) => bff<AttendanceStudentSummaryResponse>(`/attendance/students/${id}/summary`, { signal }), enabled: !!id, staleTime: 60_000, retry: noRetryScope });

/** Attendance history, newest first, keyset-paged ("Load more"). */
export const useStudentAttendanceRecords = (id: string | null | undefined) =>
  useInfiniteQuery({
    queryKey: clsKeys.stuRecords(id ?? ''),
    queryFn: ({ pageParam, signal }) => bff<AttendanceRecordsPage>(`/attendance/students/${id}/records`, { query: { limit: 15, cursor: pageParam || undefined }, signal }),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: !!id,
    staleTime: 60_000,
    retry: noRetryScope,
  });

/** Published results for one student. Only some roles (the class teacher) may read them: callers treat 403/404 as "not available". */
export const useStudentResults = (id: string | null | undefined, enabled = true) =>
  useQuery({ queryKey: clsKeys.stuResults(id ?? ''), queryFn: ({ signal }) => bff<{ data: StudentResultOut[] }>('/results', { query: { studentId: id! }, signal }).then((r) => r.data), enabled: !!id && enabled, staleTime: 5 * 60_000, retry: noRetryScope });

export const useStudentLeave = (id: string | null | undefined) =>
  useQuery({ queryKey: clsKeys.stuLeave(id ?? ''), queryFn: ({ signal }) => bff<Paged<LeaveItem>>('/leave', { query: { studentId: id!, pageSize: 20 }, signal }).then((r) => r.data), enabled: !!id, staleTime: 60_000, retry: noRetryScope });

export interface HomeworkCompletion {
  submitted: number;
  late: number;
  reviewed: number;
  returned: number;
}

/**
 * Homework completion per student for one class: the homework that takes online hand-ins (published or closed) is the
 * denominator; every submission of those is counted once per student and homework.
 */
export function useSectionHomeworkCompletion(sectionId: string | null | undefined) {
  return useQuery({
    queryKey: clsKeys.secHomework(sectionId ?? ''),
    queryFn: async ({ signal }) => {
      const hw: HomeworkItem[] = [];
      for (let page = 1; page <= 4; page++) {
        const r = await bff<Paged<HomeworkItem>>('/homework', { query: { sectionId: sectionId!, page, pageSize: 100 }, signal });
        hw.push(...r.data);
        if (page >= (r.meta?.totalPages ?? 1)) break;
      }
      const counted = hw.filter((h) => h.status !== 'draft' && h.allowSubmission);
      const ids = new Set(counted.map((h) => h.id));
      const subs: SubmissionItem[] = [];
      if (ids.size > 0) {
        for (let page = 1; page <= 10; page++) {
          const r = await bff<Paged<SubmissionItem>>('/submissions', { query: { sectionId: sectionId!, page, pageSize: 100 }, signal });
          subs.push(...r.data.filter((s) => ids.has(s.homeworkId)));
          if (page >= (r.meta?.totalPages ?? 1)) break;
        }
      }
      const byStudent = new Map<string, HomeworkCompletion>();
      for (const s of subs) {
        const c = byStudent.get(s.studentId) ?? { submitted: 0, late: 0, reviewed: 0, returned: 0 };
        c.submitted += 1;
        if (s.isLate) c.late += 1;
        if (s.status === 'reviewed') c.reviewed += 1;
        if (s.status === 'returned') c.returned += 1;
        byStudent.set(s.studentId, c);
      }
      return { homework: hw, total: counted.length, byStudent };
    },
    enabled: !!sectionId,
    staleTime: 60_000,
    retry: noRetryScope,
  });
}

/* ───────────── attendance corrections and student leave ───────────── */

export interface CorrectionFilters {
  status: '' | 'pending' | 'approved' | 'rejected';
  sectionId: string;
  mine: boolean;
  page: number;
  pageSize: number;
}
export const corrKeys = { all: ['attendance', 'corrections'] as const, list: (f: CorrectionFilters) => ['attendance', 'corrections', f] as const };

export const useCorrections = (f: CorrectionFilters, enabled = true) =>
  useQuery({
    queryKey: corrKeys.list(f),
    queryFn: ({ signal }) => bff<Paged<AttendanceCorrectionItem>>('/attendance/corrections', { query: { status: f.status || undefined, sectionId: f.sectionId || undefined, mine: f.mine ? 'true' : undefined, page: f.page, pageSize: f.pageSize }, signal }),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    enabled,
  });

export function useRequestCorrection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ recordId, body }: { recordId: string; body: CorrectionCreate }) => bff(`/attendance/records/${recordId}/corrections`, { method: 'POST', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['attendance'] });
    },
  });
}

export function useDecideCorrection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decision, note }: { id: string; decision: 'approve' | 'reject'; note?: string }) => bff(`/attendance/corrections/${id}/${decision}`, { method: 'POST', body: note ? { note } : {} }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['attendance'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export interface LeaveFilters {
  status: '' | 'pending' | 'approved' | 'rejected' | 'cancelled';
  sectionId: string;
  page: number;
  pageSize: number;
}
export const leaveKeys = { all: ['leave'] as const, list: (f: LeaveFilters) => ['leave', 'list', f] as const };

export const useLeaveList = (f: LeaveFilters) =>
  useQuery({
    queryKey: leaveKeys.list(f),
    queryFn: ({ signal }) => bff<Paged<LeaveItem>>('/leave', { query: { status: f.status || undefined, sectionId: f.sectionId || undefined, page: f.page, pageSize: f.pageSize }, signal }),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });

export function useDecideLeave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decision, note }: { id: string; decision: 'approve' | 'reject'; note?: string }) => bff(`/leave/${id}/${decision}`, { method: 'POST', body: note ? { note } : {} }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['leave'] });
      void qc.invalidateQueries({ queryKey: ['attendance'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}
