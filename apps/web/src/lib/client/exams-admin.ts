'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { z } from 'zod';
import type {
  classResultRow,
  classResultsOut,
  ExamAnalyticsOut,
  ExamOut,
  GradeScaleOut,
  GradeSubjectOut,
  PaperOut,
  reportRemarkRow,
  SectionOut,
  SheetDetailOut,
  SheetOut,
  sheetBulkPublishOut,
  sheetGenerateOut,
  TermOut,
} from '@school-sync/shared';
import { toast } from '@/components/ui/toaster';
import { ApiError, errorMessage } from '../problem';
import { bff } from './fetcher';
import type { Paged } from './hooks';
import { fetchAllPages } from './options';
import { useApiMutation, type ApiMutationOptions } from './mutations';

/** Exams admin: exams, grade scales, schedule, mark sheets, analytics, class results, report-card remarks. Query keys start with `['exams', …]`. */

export type ClassResultsOut = z.infer<typeof classResultsOut>;
export type ClassResultRow = z.infer<typeof classResultRow>;
export type ReportRemarkRow = z.infer<typeof reportRemarkRow>;
export type SheetGenerateOut = z.infer<typeof sheetGenerateOut>;
export type SheetBulkPublishOut = z.infer<typeof sheetBulkPublishOut>;

/** Prefixes to invalidate after any exams mutation (the management dashboard shows exam / review counts). */
export const EXAMS_INVALIDATE = [['exams'], ['dashboard']] as const;

export interface ExamFilters {
  q: string;
  status: string;
  examType: string;
  academicYearId: string;
  page: number;
  pageSize: number;
}

export const useExams = (f: ExamFilters) =>
  useQuery({
    queryKey: ['exams', 'list', f],
    queryFn: ({ signal }) => bff<Paged<ExamOut>>('/exams', { query: { q: f.q, status: f.status, examType: f.examType, academicYearId: f.academicYearId, page: f.page, pageSize: f.pageSize }, signal }),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });

/** Every exam (for pickers on the review queue and report-card screens). */
export const useExamPicker = (enabled = true) =>
  useQuery({ queryKey: ['exams', 'picker'], enabled, queryFn: ({ signal }) => bff<Paged<ExamOut>>('/exams', { query: { pageSize: 100 }, signal }).then((r) => r.data), staleTime: 30_000 });

export const useExam = (id: string) => useQuery({ queryKey: ['exams', 'one', id], queryFn: ({ signal }) => bff<ExamOut>(`/exams/${id}`, { signal }), staleTime: 10_000 });

export const useGradeScales = () =>
  useQuery({ queryKey: ['exams', 'grade-scales'], queryFn: ({ signal }) => bff<Paged<GradeScaleOut>>('/grade-scales', { query: { pageSize: 100 }, signal }).then((r) => r.data), staleTime: 30_000 });

export const usePapers = (examId: string, enabled = true) =>
  useQuery({ queryKey: ['exams', 'papers', examId], queryFn: ({ signal }) => bff<{ data: PaperOut[] }>(`/exams/${examId}/papers`, { signal }).then((r) => r.data), enabled, staleTime: 10_000 });

export const useExamTerms = (yearId: string | undefined) =>
  useQuery({ queryKey: ['exams', 'terms', yearId ?? ''], queryFn: ({ signal }) => bff<{ data: TermOut[] }>(`/academics/years/${yearId}/terms`, { signal }).then((r) => r.data), enabled: !!yearId, staleTime: 5 * 60_000 });

export const useGradeSubjects = (gradeId: string | undefined) =>
  useQuery({ queryKey: ['exams', 'grade-subjects', gradeId ?? ''], queryFn: ({ signal }) => bff<{ data: GradeSubjectOut[] }>(`/academics/grades/${gradeId}/subjects`, { signal }).then((r) => r.data), enabled: !!gradeId, staleTime: 5 * 60_000 });

export interface SheetFilters {
  examId: string;
  sectionId: string;
  subjectId: string;
  status: string;
  page: number;
  pageSize: number;
}

export const useSheets = (f: SheetFilters, enabled = true) =>
  useQuery({
    queryKey: ['exams', 'sheets', f],
    queryFn: ({ signal }) => bff<Paged<SheetOut>>('/marks/sheets', { query: { examId: f.examId, sectionId: f.sectionId, subjectId: f.subjectId, status: f.status, page: f.page, pageSize: f.pageSize }, signal }),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  });

export const useSheetDetail = (id: string | null) => useQuery({ queryKey: ['exams', 'sheet', id ?? ''], queryFn: ({ signal }) => bff<SheetDetailOut>(`/marks/sheets/${id}`, { signal }), enabled: !!id, staleTime: 0 });

export const useExamAnalytics = (examId: string, enabled = true) =>
  useQuery({ queryKey: ['exams', 'analytics', examId], queryFn: ({ signal }) => bff<ExamAnalyticsOut>(`/exams/${examId}/analytics`, { signal }), enabled, staleTime: 30_000 });

export const useClassResults = (examId: string, sectionId: string) =>
  useQuery({
    queryKey: ['exams', 'class-results', examId, sectionId],
    queryFn: ({ signal }) => bff<ClassResultsOut>('/results/class', { query: { examId, sectionId }, signal }),
    enabled: !!examId && !!sectionId,
    staleTime: 15_000,
  });

export const useRemarks = (examId: string, sectionId: string) =>
  useQuery({
    queryKey: ['exams', 'remarks', examId, sectionId],
    queryFn: ({ signal }) => bff<{ data: ReportRemarkRow[] }>(`/report-cards/${examId}/remarks`, { query: { sectionId }, signal }).then((r) => r.data),
    enabled: !!examId && !!sectionId,
    staleTime: 10_000,
  });

const CODE_MESSAGES: Record<string, string> = {
  INVALID_BANDS: 'The grade bands are not valid. They must start at 0%, end at 100%, not overlap and use different labels.',
  DEFAULT_REQUIRED: 'There must always be one default grade scale. Make another scale the default first.',
  GRADE_SCALE_IN_USE: 'An exam uses this grade scale, so it cannot be deleted. Create a new scale or edit the bands instead.',
  GRADE_SCALE_NOT_FOUND: 'That grade scale no longer exists. Pick another one.',
  INVALID_EXAM_STATE: 'That step is not available for this exam in its current state. Reload the page to see where it is now.',
  EXAM_PUBLISHED: 'A published exam can no longer be edited.',
  EXAM_IN_USE: 'Only an exam without mark sheets that is still a draft or scheduled can be deleted.',
  NO_PAPERS: 'Add at least one paper to the schedule first.',
  NO_SHEETS: 'Generate mark sheets and let teachers enter marks before publishing.',
  SHEETS_PENDING: 'Some mark sheets are not approved yet. Approve or return them, or tick the box to publish anyway and leave them hidden.',
  SCHEDULE_CONFLICT: 'That clashes with another paper for the same grade on the same day. Change the time or the date.',
  PAPER_EXISTS: 'That subject already has a paper for this grade. Edit the existing paper instead.',
  DUPLICATE_PAPER: 'The same grade and subject appears twice in this set.',
  PAPER_IN_USE: 'Mark sheets already exist for this paper, so it cannot be removed or moved to another grade or subject.',
  MARKS_EXCEED_MAX: 'Some marks are higher than the maximum for this paper. Fix them and try again.',
  SUBJECT_NOT_IN_GRADE: 'That subject is not taught in that grade. Add it to the grade’s subjects first.',
  DATE_OUTSIDE_EXAM: 'The paper date must fall within the exam’s start and end dates.',
  EXAM_LOCKED: 'The schedule cannot be changed once the exam is under review or published.',
  INVALID_PAPER: 'The paper details are not valid. A time needs a date, and the end time must be after the start time.',
  SHEET_LOCKED: 'This sheet can no longer be edited. Published marks go through the correction workflow.',
  SHEET_NOT_PUBLISHED: 'Only published marks go through the correction workflow.',
  INVALID_SHEET_STATE: 'That step is not available for this mark sheet in its current state. Reload to see where it is now.',
  ALREADY_PUBLISHED: 'This sheet is already published.',
  NOTE_REQUIRED: 'A note is required.',
  NO_CHANGES: 'Nothing was changed. Edit at least one mark before saving a correction.',
  STUDENT_NOT_IN_SECTION: 'Some students are not in this section any more. Reload the sheet.',
  EMPTY_REMARK: 'Write at least a remark, an area to improve or a conduct note.',
  TERM_MISMATCH: 'That term does not belong to the exam’s academic year.',
  INVALID_DATES: 'The end date must be on or after the start date.',
  NO_ACADEMIC_YEAR: 'No current academic year is set up yet.',
  FORBIDDEN: 'Your role does not allow this.',
};

/** problem+json → one clear sentence for this area (falls back to the API’s own detail). */
export function examErrorMessage(e: unknown): string {
  if (e instanceof ApiError && e.code !== 'FORBIDDEN' && CODE_MESSAGES[e.code]) {
    // the API's own sentence names the conflicting subject / band / count, so it beats the generic one for these codes
    if (SPECIFIC.has(e.code) && e.message && e.message !== e.code) return e.message;
    return CODE_MESSAGES[e.code]!;
  }
  return errorMessage(e);
}

const SPECIFIC = new Set(['SCHEDULE_CONFLICT', 'INVALID_BANDS', 'SHEETS_PENDING', 'MARKS_EXCEED_MAX', 'INVALID_EXAM_STATE', 'DATE_OUTSIDE_EXAM', 'INVALID_SHEET_STATE']);

/**
 * `useApiMutation` for exams: invalidates `['exams']` + `['dashboard']`, and `run()` toasts the area's clear sentence
 * (`examErrorMessage`) instead of the generic one. Use `mutateAsync` + `applyApiErrors` for forms.
 */
export function useExamMutation<V = void, R = unknown>(fn: (vars: V) => Promise<R>, opts: ApiMutationOptions<V, R> = {}) {
  const m = useApiMutation<V, R>(fn, { invalidate: EXAMS_INVALIDATE, ...opts, toastError: false });
  const run = async (vars: V) => {
    const r = await m.run(vars);
    if (!r.ok && opts.toastError !== false) toast.error(examErrorMessage(r.error), { duration: 8000 });
    return r;
  };
  return { ...m, run };
}

/**
 * Sections of one academic year for the class pickers on the exam screens (every page). Same data as `useSectionList`
 * in options.ts, typed explicitly (that hook's `placeholderData` widens `data` to a union with a function under tsc).
 */
export const useExamSections = (yearId?: string) =>
  useQuery<SectionOut[]>({
    queryKey: ['exams', 'sections', yearId ?? 'current'],
    queryFn: ({ signal }) => fetchAllPages<SectionOut>('/academics/sections', { yearId }, signal).then((l) => [...l].sort((a, b) => a.gradeOrdinal - b.gradeOrdinal || a.name.localeCompare(b.name, undefined, { numeric: true }))),
    staleTime: 60_000,
  });
