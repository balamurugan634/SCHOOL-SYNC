'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { z } from 'zod';
import type {
  AcademicYearOut,
  GradeOut,
  GradeSubjectOut,
  PeriodOut,
  SectionDetailOut,
  SectionOut,
  SubjectOut,
  TeachingAssignmentOut,
  TermOut,
  academicYearCreateBody,
  academicYearUpdateBody,
  academicsOverviewOut,
  classTeacherBody,
  copySectionsBody,
  copySectionsOut,
  gradeCreateBody,
  gradeUpdateBody,
  periodCreateBody,
  periodUpdateBody,
  sectionCreateBody,
  sectionUpdateBody,
  subjectCreateBody,
  subjectUpdateBody,
  termCreateBody,
  termUpdateBody,
} from '@school-sync/shared';
import { ApiError } from '../problem';
import { bff, type BffOptions } from './fetcher';
import { useApiMutation } from './mutations';
import { fetchAllPages } from './options';


/** Hooks and mutations for the academic structure (years, terms, grades, subjects, periods, sections, teaching assignments). */

export type Paged<T> = { data: T[]; meta: { page: number; pageSize: number; total: number; totalPages: number } };
export type Overview = z.infer<typeof academicsOverviewOut>;
export type CopySectionsResult = z.infer<typeof copySectionsOut>;

/** Clearer wording (and what to do next) for the API codes of this area; everything else keeps the API's own sentence. */
const say = (e: ApiError, fallback: string) => {
  const t = e.detail ?? (e.message && e.message !== e.code ? e.message : fallback);
  return /[.!?]$/.test(t) ? t : `${t}.`;
};

const GUIDANCE: Record<string, string | ((e: ApiError) => string)> = {
  YEAR_IS_CURRENT: 'The current academic year cannot be deleted. Make another year current first.',
  YEAR_IN_USE: 'This year already has sections or enrolments, so it cannot be deleted. Remove them first, or keep the year.',
  TERMS_OUT_OF_RANGE: 'Some terms fall outside the new dates. Adjust those terms first, then change the year.',
  TERM_OUT_OF_RANGE: (e) => `${say(e, 'The term must fall inside its academic year.')}`,
  SECTION_HAS_STUDENTS: 'This section has student enrolments, so it cannot be deleted. Move the students to another section first.',
  CAPACITY_BELOW_ENROLMENT: (e) => `${say(e, 'The section already has more students than this capacity.')} Raise the capacity or move students out first.`,
  GRADE_IN_USE: 'This grade has sections or students, so it cannot be deleted. Mark it inactive instead.',
  SUBJECT_IN_USE: 'This subject is offered by a grade or assigned to a teacher, so it cannot be deleted. Mark it inactive instead.',
  PERIOD_IN_USE: 'This period is used by a timetable or by attendance records, so it cannot be deleted. Edit its name or times instead.',
  OFFERING_IN_USE: (e) => `${say(e, 'Some removed subjects still have teachers assigned.')} Remove those teaching assignments first (Teaching assignments screen).`,
  SUBJECT_NOT_OFFERED: 'This grade does not offer that subject yet. Add it under Subjects → Grade offerings first.',
  ASSIGNMENT_EXISTS: 'That subject already has a teacher in this section. Change the existing assignment instead.',
  STAFF_NOT_ELIGIBLE: (e) => `${say(e, 'That staff member cannot be assigned.')} Only active staff with a login can be chosen.`,
  TEACHER_CLASH: (e) => `${say(e, 'This teacher is already teaching another class in that period.')} Choose another teacher or change the other class first.`,
  SUBSTITUTION_EXISTS: 'This lesson already has a cover on that date. Remove the existing cover first.',
  SUBSTITUTE_IS_TEACHER: 'The substitute is already the teacher of this lesson. Pick someone else.',
  DATE_IN_PAST: 'A cover cannot be arranged for a past date.',
  DATE_WEEKDAY_MISMATCH: 'That date falls on a different weekday than this lesson.',
  PERIOD_IS_BREAK: 'Breaks take no lessons. Pick a teaching period.',
  NOT_A_WORKING_DAY: 'That weekday is not a school day. Working days are set in School settings.',
  PROMOTION_HAS_PROBLEMS: 'Fix the problems listed in the preview before applying the promotion.',
  NOTHING_TO_PROMOTE: 'There are no students left to move from the source year. They may already have been promoted.',
  INVALID_YEAR_ORDER: 'The year you promote into must start after the year you promote from.',
  SAME_YEAR: 'Pick two different academic years.',
  LICENSE_LIMIT_REACHED: (e) => `${say(e, 'The student limit of the subscription has been reached.')} Contact support to add seats, or reduce the number of students to enrol.`,
  FORBIDDEN: 'Your role does not allow this change.',
};

export function friendly(e: unknown): unknown {
  if (!(e instanceof ApiError)) return e;
  const g = GUIDANCE[e.code];
  if (!g) return e;
  return new ApiError({ status: e.status, code: e.code, detail: typeof g === 'function' ? g(e) : g, errors: e.errors, retryAfterSeconds: e.retryAfterSeconds, requestId: e.requestId });
}

/** `bff()` with the clearer messages above. */
export async function acad<T = unknown>(path: string, opts?: BffOptions): Promise<T> {
  try {
    return await bff<T>(path, opts);
  } catch (e) {
    throw friendly(e);
  }
}

/** Everything under `['academics']` plus the screens that show counts derived from it. */
export const INVALIDATE_STRUCTURE = [['academics'], ['dashboard'], ['setup'], ['people']] as const;

// ── reads ────────────────────────────────────────────────────────────────────────────────────────
export const useOverview = () => useQuery({ queryKey: ['academics', 'overview'], queryFn: ({ signal }) => acad<Overview>('/academics/overview', { signal }), staleTime: 30_000 });

export const useTerms = (yearId: string | null) =>
  useQuery({ queryKey: ['academics', 'terms', yearId], queryFn: ({ signal }) => acad<{ data: TermOut[] }>(`/academics/years/${yearId}/terms`, { signal }).then((r) => [...r.data].sort((a, b) => a.ordinal - b.ordinal)), enabled: !!yearId, staleTime: 30_000 });

export interface SectionFilters {
  yearId?: string;
  gradeId?: string;
  q?: string;
  page: number;
  pageSize: number;
}
export const useSections = (f: SectionFilters, enabled = true) =>
  useQuery({
    queryKey: ['academics', 'sections', 'page', f],
    queryFn: ({ signal }) => acad<Paged<SectionOut>>('/academics/sections', { query: { yearId: f.yearId, gradeId: f.gradeId, q: f.q, page: f.page, pageSize: f.pageSize }, signal }),
    placeholderData: keepPreviousData,
    enabled,
    staleTime: 15_000,
  });

/**
 * Every section of one year (default: current), all pages, sorted by grade then name.
 * (Same data as `useSectionList` in options.ts; this one is typed without the keepPreviousData union that makes `data` a function type.)
 */
export const useAllSections = (opts: { yearId?: string; gradeId?: string; enabled?: boolean } = {}) =>
  useQuery<SectionOut[]>({
    queryKey: ['academics', 'sections', 'every', opts.yearId ?? 'current', opts.gradeId ?? ''],
    queryFn: ({ signal }) => fetchAllPages<SectionOut>('/academics/sections', { yearId: opts.yearId, gradeId: opts.gradeId }, signal).then((l) => [...l].sort((a, b) => a.gradeOrdinal - b.gradeOrdinal || a.name.localeCompare(b.name, undefined, { numeric: true }))),
    enabled: opts.enabled ?? true,
    staleTime: 60_000,
  });

export const useSectionDetail = (id: string | null) => useQuery({ queryKey: ['academics', 'section', id], queryFn: ({ signal }) => acad<SectionDetailOut>(`/academics/sections/${id}`, { signal }), enabled: !!id, staleTime: 15_000 });

export const useGradeSubjects = (gradeId: string | null) =>
  useQuery({ queryKey: ['academics', 'grade-subjects', gradeId], queryFn: ({ signal }) => acad<{ data: GradeSubjectOut[] }>(`/academics/grades/${gradeId}/subjects`, { signal }).then((r) => r.data), enabled: !!gradeId, staleTime: 30_000 });

/** Every teaching assignment of one year (default: current), all pages. */
export const useAssignments = (yearId?: string, enabled = true) =>
  useQuery({ queryKey: ['academics', 'assignments', yearId ?? 'current'], queryFn: ({ signal }) => fetchAllPages<TeachingAssignmentOut>('/academics/teaching-assignments', { yearId }, signal), enabled, staleTime: 15_000 });

/** The school's working weekdays (ISO 1–7). Needs `settings:view`; falls back to null when the caller may not read settings. */
export const useWorkingDays = () =>
  useQuery({
    queryKey: ['academics', 'working-days'],
    queryFn: ({ signal }) => bff<{ workingDays?: number[] }>('/settings/academic', { signal }).then((r) => r.workingDays ?? null),
    retry: false,
    staleTime: 5 * 60_000,
  });

// ── mutations ────────────────────────────────────────────────────────────────────────────────────
type Body<S extends z.ZodType> = z.input<S>;

export function useYearMutations() {
  const inv = INVALIDATE_STRUCTURE;
  return {
    create: useApiMutation((b: Body<typeof academicYearCreateBody>) => acad<AcademicYearOut>('/academics/years', { method: 'POST', body: b }), { invalidate: inv, success: (y) => `Academic year ${y.name} created` }),
    update: useApiMutation(({ id, body }: { id: string; body: Body<typeof academicYearUpdateBody> }) => acad<AcademicYearOut>(`/academics/years/${id}`, { method: 'PATCH', body }), { invalidate: inv, success: 'Academic year updated' }),
    remove: useApiMutation((id: string) => acad(`/academics/years/${id}`, { method: 'DELETE' }), { invalidate: inv, success: 'Academic year deleted' }),
    setCurrent: useApiMutation((id: string) => acad<AcademicYearOut>(`/academics/years/${id}/set-current`, { method: 'POST' }), { invalidate: [['academics'], ['dashboard'], ['people'], ['attendance'], ['timetable'], ['setup'], ['license']], success: (y) => `${y.name} is now the current academic year` }),
    copySections: useApiMutation(({ id, body }: { id: string; body: Body<typeof copySectionsBody> }) => acad<CopySectionsResult>(`/academics/years/${id}/copy-sections`, { method: 'POST', body }), { invalidate: inv }),
  };
}

export function useTermMutations() {
  const inv = INVALIDATE_STRUCTURE;
  return {
    create: useApiMutation(({ yearId, body }: { yearId: string; body: Body<typeof termCreateBody> }) => acad<TermOut>(`/academics/years/${yearId}/terms`, { method: 'POST', body }), { invalidate: inv, success: 'Term added' }),
    update: useApiMutation(({ id, body }: { id: string; body: Body<typeof termUpdateBody> }) => acad<TermOut>(`/academics/terms/${id}`, { method: 'PATCH', body }), { invalidate: inv, success: 'Term updated' }),
    remove: useApiMutation((id: string) => acad(`/academics/terms/${id}`, { method: 'DELETE' }), { invalidate: inv, success: 'Term deleted' }),
  };
}

export function useGradeMutations() {
  const inv = INVALIDATE_STRUCTURE;
  return {
    create: useApiMutation((b: Body<typeof gradeCreateBody>) => acad<GradeOut>('/academics/grades', { method: 'POST', body: b }), { invalidate: inv, success: (g) => `${g.name} added` }),
    update: useApiMutation(({ id, body }: { id: string; body: Body<typeof gradeUpdateBody> }) => acad<GradeOut>(`/academics/grades/${id}`, { method: 'PATCH', body }), { invalidate: inv, success: 'Grade updated' }),
    remove: useApiMutation((id: string) => acad(`/academics/grades/${id}`, { method: 'DELETE' }), { invalidate: inv, success: 'Grade deleted' }),
  };
}

export function useSubjectMutations() {
  const inv = INVALIDATE_STRUCTURE;
  return {
    create: useApiMutation((b: Body<typeof subjectCreateBody>) => acad<SubjectOut>('/academics/subjects', { method: 'POST', body: b }), { invalidate: inv, success: (s) => `${s.name} added` }),
    update: useApiMutation(({ id, body }: { id: string; body: Body<typeof subjectUpdateBody> }) => acad<SubjectOut>(`/academics/subjects/${id}`, { method: 'PATCH', body }), { invalidate: inv, success: 'Subject updated' }),
    remove: useApiMutation((id: string) => acad(`/academics/subjects/${id}`, { method: 'DELETE' }), { invalidate: inv, success: 'Subject deleted' }),
  };
}

export const useSaveOfferings = () =>
  useApiMutation(({ gradeId, subjects }: { gradeId: string; subjects: { subjectId: string; periodsPerWeek: number }[] }) => acad<{ data: GradeSubjectOut[] }>(`/academics/grades/${gradeId}/subjects`, { method: 'PUT', body: { subjects } }), {
    invalidate: INVALIDATE_STRUCTURE,
    success: 'Grade offerings saved',
  });

export function usePeriodMutations() {
  const inv = [['academics'], ['timetable'], ['setup']] as const;
  return {
    create: useApiMutation((b: Body<typeof periodCreateBody>) => acad<PeriodOut>('/academics/periods', { method: 'POST', body: b }), { invalidate: inv, success: (p) => `${p.name} added` }),
    update: useApiMutation(({ id, body }: { id: string; body: Body<typeof periodUpdateBody> }) => acad<PeriodOut>(`/academics/periods/${id}`, { method: 'PATCH', body }), { invalidate: inv, success: 'Period updated' }),
    remove: useApiMutation((id: string) => acad(`/academics/periods/${id}`, { method: 'DELETE' }), { invalidate: inv, success: 'Period deleted' }),
  };
}

export function useSectionMutations() {
  const inv = INVALIDATE_STRUCTURE;
  return {
    create: useApiMutation((b: Body<typeof sectionCreateBody>) => acad<SectionOut>('/academics/sections', { method: 'POST', body: b }), { invalidate: inv, success: (s) => `${s.gradeName} ${s.name} created` }),
    update: useApiMutation(({ id, body }: { id: string; body: Body<typeof sectionUpdateBody> }) => acad<SectionOut>(`/academics/sections/${id}`, { method: 'PATCH', body }), { invalidate: inv, success: 'Section updated' }),
    remove: useApiMutation((id: string) => acad(`/academics/sections/${id}`, { method: 'DELETE' }), { invalidate: inv, success: 'Section deleted' }),
    classTeacher: useApiMutation(({ id, body }: { id: string; body: Body<typeof classTeacherBody> }) => acad<SectionOut>(`/academics/sections/${id}/class-teacher`, { method: 'PUT', body }), {
      invalidate: [...inv, ['attendance'], ['timetable']],
      success: (_s, v) => (v.body.staffId ? 'Class teacher assigned' : 'Class teacher removed'),
    }),
  };
}

export function useAssignmentMutations() {
  const inv = [['academics', 'assignments'], ['academics', 'section'], ['academics', 'sections'], ['academics', 'overview'], ['timetable'], ['setup']] as const;
  return {
    create: useApiMutation((b: { sectionId: string; subjectId: string; staffId: string }) => acad<TeachingAssignmentOut>('/academics/teaching-assignments', { method: 'POST', body: b }), { invalidate: inv, success: (a) => `${a.staffName} now teaches ${a.subjectName}` }),
    update: useApiMutation(({ id, staffId }: { id: string; staffId: string }) => acad<TeachingAssignmentOut>(`/academics/teaching-assignments/${id}`, { method: 'PATCH', body: { staffId } }), { invalidate: inv, success: (a) => `${a.staffName} now teaches ${a.subjectName}` }),
    remove: useApiMutation((id: string) => acad(`/academics/teaching-assignments/${id}`, { method: 'DELETE' }), { invalidate: inv, success: 'Teacher removed from the subject' }),
  };
}

export const gradeSort = (a: Pick<GradeOut, 'ordinal'>, b: Pick<GradeOut, 'ordinal'>) => a.ordinal - b.ordinal;
export type { AcademicYearOut, GradeOut, GradeSubjectOut, PeriodOut, SectionDetailOut, SectionOut, SubjectOut, TeachingAssignmentOut, TermOut };
