'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import type {
  ExamAnalyticsOut,
  ExamOut,
  MarkSheetStatus,
  PaperOut,
  SheetDetailOut,
  SheetOut,
  classResultsOut,
  markEntriesBody,
  reportRemarkIn,
  reportRemarkRow,
  reportRemarkOut,
} from '@school-sync/shared';
import { bff } from './fetcher';
import type { Paged } from './hooks';

export type ClassResults = z.infer<typeof classResultsOut>;
export type MarkEntryBody = z.input<typeof markEntriesBody>['entries'][number];
export type RemarkRow = z.infer<typeof reportRemarkRow>;
export type RemarkOut = z.infer<typeof reportRemarkOut>;
export type RemarkBody = z.input<typeof reportRemarkIn>;

export const mk = {
  sheets: (f: SheetFilters) => ['marks', 'sheets', f] as const,
  sheet: (id: string) => ['marks', 'sheet', id] as const,
  exams: (f: ExamFilters) => ['marks', 'exams', f] as const,
  papers: (examId: string) => ['marks', 'papers', examId] as const,
  analytics: (examId: string) => ['marks', 'analytics', examId] as const,
  classResults: (examId: string, sectionId: string) => ['marks', 'class-results', examId, sectionId] as const,
  remarks: (examId: string, sectionId: string) => ['marks', 'remarks', examId, sectionId] as const,
};

/* ───────────────────────── mark sheets ───────────────────────── */

export interface SheetFilters {
  examId?: string;
  sectionId?: string;
  /** `true` = only sheets I am the subject teacher of; omitted = my subjects and my class */
  mine?: boolean;
}

/** Every sheet in scope (the API pages at 100; a teacher has a few dozen), so status counts and "needs action first" are global. */
export function useMarkSheets(f: SheetFilters) {
  return useQuery({
    queryKey: mk.sheets(f),
    queryFn: async ({ signal }) => {
      const all: SheetOut[] = [];
      for (let page = 1; page <= 5; page++) {
        const r = await bff<Paged<SheetOut>>('/marks/sheets', { query: { page, pageSize: 100, examId: f.examId, sectionId: f.sectionId, mine: f.mine ? 'true' : undefined }, signal });
        all.push(...r.data);
        if (page >= (r.meta?.totalPages ?? 1)) break;
      }
      return all;
    },
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });
}

/** Always refetched when the grid opens: another reviewer may have returned or approved the sheet since the list was loaded. */
export const useMarkSheet = (id: string) =>
  useQuery({
    queryKey: mk.sheet(id),
    queryFn: ({ signal }) => bff<SheetDetailOut>(`/marks/sheets/${id}`, { signal }),
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  });

export function useSaveEntries(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (entries: MarkEntryBody[]) => bff<SheetDetailOut>(`/marks/sheets/${id}/entries`, { method: 'PUT', body: { entries } }),
    onSuccess: (data) => {
      qc.setQueryData(mk.sheet(id), data);
      void qc.invalidateQueries({ queryKey: ['marks', 'sheets'] });
    },
  });
}

export function useSubmitSheet(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => bff<SheetDetailOut>(`/marks/sheets/${id}/submit`, { method: 'POST', body: {} }),
    onSuccess: (data) => {
      qc.setQueryData(mk.sheet(id), data);
      void qc.invalidateQueries({ queryKey: ['marks'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

/** What needs the teacher first: returned (fix and resubmit), then drafts, then everything else. */
export const SHEET_PRIORITY: Record<MarkSheetStatus, number> = { returned: 0, draft: 1, submitted: 2, approved: 3, published: 4 };
export const SHEET_STATUS_LABEL: Record<MarkSheetStatus, string> = { returned: 'Returned', draft: 'Draft', submitted: 'Submitted', approved: 'Approved', published: 'Published' };
export const sheetNeedsAction = (s: Pick<SheetOut, 'status'>): boolean => s.status === 'draft' || s.status === 'returned';

/* ───────────────────────── marks parsing / validation ───────────────────────── */

/** Typing filter: digits with at most two decimals ("", "7", "7.", "7.25"). */
export const MARK_TYPING = /^\d{0,4}(\.\d{0,2})?$/;
export const ABSENT_TOKEN = /^(a|ab|abs|absent)$/i;

export interface ParsedMark {
  /** `null` = nothing entered */
  value: number | null;
  error: string | null;
}
export function parseMark(raw: string, max: number): ParsedMark {
  const s = raw.trim();
  if (s === '' || s === '.') return { value: null, error: null };
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return { value: null, error: 'Enter a number' };
  if (n > max) return { value: n, error: `Above the maximum of ${max}` };
  return { value: n, error: null };
}

/** Normalise a pasted cell ("72", " 72.5 ", "72,5") to the typing format, or `null` when it isn't a mark. */
export function cleanPasted(raw: string): string | null {
  const s = raw.trim().replace(',', '.');
  if (s === '') return '';
  return MARK_TYPING.test(s) ? s : null;
}

/* ───────────────────────── exams ───────────────────────── */

export interface ExamFilters {
  status?: string;
  upcoming?: boolean;
}

export const useExams = (f: ExamFilters = {}) =>
  useQuery({
    queryKey: mk.exams(f),
    queryFn: ({ signal }) => bff<Paged<ExamOut>>('/exams', { query: { pageSize: 100, status: f.status, upcoming: f.upcoming ? 'true' : undefined }, signal }).then((r) => r.data),
    staleTime: 60_000,
  });

export const useExamPapers = (examId: string | null | undefined) =>
  useQuery({ queryKey: mk.papers(examId ?? ''), queryFn: ({ signal }) => bff<{ data: PaperOut[] }>(`/exams/${examId}/papers`, { signal }).then((r) => r.data), enabled: !!examId, staleTime: 60_000 });

export const useExamAnalytics = (examId: string | null | undefined) =>
  useQuery({ queryKey: mk.analytics(examId ?? ''), queryFn: ({ signal }) => bff<ExamAnalyticsOut>(`/exams/${examId}/analytics`, { signal }), enabled: !!examId, staleTime: 30_000 });

export const useClassResults = (examId: string | null | undefined, sectionId: string | null | undefined) =>
  useQuery({
    queryKey: mk.classResults(examId ?? '', sectionId ?? ''),
    queryFn: ({ signal }) => bff<ClassResults>('/results/class', { query: { examId, sectionId }, signal }),
    enabled: !!examId && !!sectionId,
    staleTime: 30_000,
    retry: false,
  });

/* ───────────────────────── report-card remarks ───────────────────────── */

export const useRemarks = (examId: string | null | undefined, sectionId: string | null | undefined) =>
  useQuery({
    queryKey: mk.remarks(examId ?? '', sectionId ?? ''),
    queryFn: ({ signal }) => bff<{ data: RemarkRow[] }>(`/report-cards/${examId}/remarks`, { query: { sectionId }, signal }).then((r) => r.data),
    enabled: !!examId && !!sectionId,
    staleTime: 0,
    retry: false,
  });

export function useSaveRemark(examId: string, sectionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ studentId, body }: { studentId: string; body: RemarkBody }) => bff<RemarkOut>(`/report-cards/${examId}/students/${studentId}/remarks`, { method: 'PUT', body }),
    onSuccess: (data, { studentId }) => {
      qc.setQueryData<RemarkRow[]>(mk.remarks(examId, sectionId), (rows) => rows?.map((r) => (r.studentId === studentId ? { ...r, ...data } : r)));
    },
  });
}

export function usePublishRemarks(examId: string, sectionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { sectionId?: string; studentIds?: string[] }) => bff<{ published: number }>(`/report-cards/${examId}/publish`, { method: 'POST', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: mk.remarks(examId, sectionId) }),
  });
}

/** Not written · Draft (written, not visible to families) · Published. */
export type RemarkState = 'none' | 'draft' | 'published';
export const remarkState = (r: Pick<RemarkRow, 'remark' | 'areasToImprove' | 'conduct' | 'publishedAt'>): RemarkState => {
  if (r.publishedAt) return 'published';
  return r.remark || r.areasToImprove || r.conduct ? 'draft' : 'none';
};
