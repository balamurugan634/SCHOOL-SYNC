'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ExamOut,
  HomeworkItem,
  HomeworkLearnerStatus,
  HomeworkSubmitBody,
  MaterialItem,
  PaperOut,
  ReportCardOut,
  StudentDashboard,
  StudentResultOut,
  SubmissionItem,
  SyllabusCoverageItem,
  SyllabusTopicItem,
  TaskCreateBody,
  TaskItem,
  TaskUpdateBody,
  TasksFeedItem,
  TimetableDayResponse,
  TimetableGridResponse,
} from '@school-sync/shared';
import { ApiError } from '../problem';
import { bff } from './fetcher';
import type { Paged } from './hooks';

/** Student / parent "learning" data. Keys are domain-first and carry the student so switching child never shows stale data. */
export const lk = {
  dash: ['learning', 'dashboard'] as const,
  tasks: ['learning', 'tasks'] as const,
  homework: (sid: string | null) => ['learning', 'homework', sid ?? 'me'] as const,
  homeworkOne: (id: string, sid: string | null) => ['learning', 'homework-one', id, sid ?? 'me'] as const,
  submission: (id: string, sid: string | null) => ['learning', 'submission', id, sid ?? 'me'] as const,
  materials: (sid: string | null) => ['learning', 'materials', sid ?? 'me'] as const,
  syllabus: (sid: string | null) => ['learning', 'syllabus', sid ?? 'me'] as const,
  results: (sid: string | null) => ['learning', 'results', sid ?? 'me'] as const,
  exams: ['learning', 'exams'] as const,
  timetable: (sectionId: string | null) => ['learning', 'timetable', sectionId ?? 'none'] as const,
};

type StudentQ = { studentId?: string };

// ───────────────────────────── home ─────────────────────────────

export const useStudentDashboard = (enabled = true) => useQuery({ queryKey: lk.dash, queryFn: ({ signal }) => bff<StudentDashboard>('/dashboard/student', { signal }), staleTime: 30_000, enabled });

// ───────────────────────────── tasks ─────────────────────────────

export type TaskView = 'open' | 'done' | 'all';

export const useTasksFeed = (includeDone: boolean) =>
  useQuery({ queryKey: [...lk.tasks, 'feed', includeDone], queryFn: ({ signal }) => bff<{ data: TasksFeedItem[] }>('/tasks/feed', { query: { limit: 100, includeDone: includeDone ? 'true' : 'false' }, signal }).then((r) => r.data), staleTime: 15_000 });

/** The full personal task (notes, reminder) for the edit form — the feed only has the headline fields. */
export const useTask = (id: string | null) => useQuery({ queryKey: [...lk.tasks, 'one', id], queryFn: ({ signal }) => bff<TaskItem>(`/tasks/${id}`, { signal }), enabled: !!id });

function useInvalidateTasks() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: lk.tasks });
    void qc.invalidateQueries({ queryKey: lk.dash });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
}

export function useCreateTask() {
  const done = useInvalidateTasks();
  return useMutation({ mutationFn: (body: TaskCreateBody) => bff<TaskItem>('/tasks', { method: 'POST', body }), onSuccess: done });
}
export function useUpdateTask() {
  const done = useInvalidateTasks();
  return useMutation({ mutationFn: ({ id, body }: { id: string; body: TaskUpdateBody }) => bff<TaskItem>(`/tasks/${id}`, { method: 'PATCH', body }), onSuccess: done });
}
export function useDeleteTask() {
  const done = useInvalidateTasks();
  return useMutation({ mutationFn: (id: string) => bff<{ ok: true }>(`/tasks/${id}`, { method: 'DELETE' }), onSuccess: done });
}

// ───────────────────────────── homework ─────────────────────────────

export interface HomeworkFilters {
  page: number;
  pageSize: number;
  q?: string;
  learnerStatus?: HomeworkLearnerStatus;
  sort: 'dueAsc' | 'dueDesc';
}

export const useHomeworkList = (studentId: string | null, parent: boolean, f: HomeworkFilters, enabled = true) =>
  useQuery({
    queryKey: [...lk.homework(studentId), f],
    queryFn: ({ signal }) => bff<Paged<HomeworkItem>>('/homework', { query: { page: f.page, pageSize: f.pageSize, q: f.q || undefined, learnerStatus: f.learnerStatus, sort: f.sort, ...(parent && studentId ? { studentId } : {}) }, signal }),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    enabled: enabled && (!parent || !!studentId),
  });

export const useHomework = (id: string, q: StudentQ, studentId: string | null) =>
  useQuery({ queryKey: lk.homeworkOne(id, studentId), queryFn: ({ signal }) => bff<HomeworkItem>(`/homework/${id}`, { query: q, signal }), enabled: !!id });

/** `null` = nothing handed in yet (the API answers 404 NOT_SUBMITTED). */
export const useSubmission = (id: string, q: StudentQ, studentId: string | null) =>
  useQuery({
    queryKey: lk.submission(id, studentId),
    queryFn: async ({ signal }) => {
      try {
        return await bff<SubmissionItem>(`/homework/${id}/submission`, { query: q, signal });
      } catch (e) {
        if (e instanceof ApiError && e.code === 'NOT_SUBMITTED') return null;
        throw e;
      }
    },
    enabled: !!id,
  });

export function useSubmitHomework(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: HomeworkSubmitBody) => bff<SubmissionItem>(`/homework/${id}/submit`, { method: 'POST', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['learning', 'homework'] });
      void qc.invalidateQueries({ queryKey: ['learning', 'homework-one'] });
      void qc.invalidateQueries({ queryKey: ['learning', 'submission'] });
      void qc.invalidateQueries({ queryKey: lk.tasks });
      void qc.invalidateQueries({ queryKey: lk.dash });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

// ───────────────────────────── materials & syllabus ─────────────────────────────

export interface MaterialFilters {
  page: number;
  pageSize: number;
  q?: string;
  subjectId?: string;
}
export const useMaterials = (studentId: string | null, parent: boolean, f: MaterialFilters, enabled = true) =>
  useQuery({
    queryKey: [...lk.materials(studentId), f],
    queryFn: ({ signal }) => bff<Paged<MaterialItem>>('/materials', { query: { page: f.page, pageSize: f.pageSize, q: f.q || undefined, subjectId: f.subjectId, ...(parent && studentId ? { studentId } : {}) }, signal }),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    enabled: enabled && (!parent || !!studentId),
  });

export const useSubjects = () => useQuery({ queryKey: ['learning', 'subjects'], queryFn: ({ signal }) => bff<{ data: { id: string; name: string; code: string; isActive: boolean }[] }>('/academics/subjects', { signal }).then((r) => r.data), staleTime: 5 * 60_000 });

export const useSyllabusCoverage = (studentId: string | null, q: StudentQ, enabled = true) =>
  useQuery({ queryKey: [...lk.syllabus(studentId), 'coverage'], queryFn: ({ signal }) => bff<{ data: SyllabusCoverageItem[] }>('/syllabus/coverage', { query: q, signal }).then((r) => r.data), staleTime: 60_000, enabled });

export const useSyllabusTopics = (studentId: string | null, q: StudentQ, enabled = true) =>
  useQuery({ queryKey: [...lk.syllabus(studentId), 'topics'], queryFn: ({ signal }) => bff<{ data: SyllabusTopicItem[] }>('/syllabus/topics', { query: q, signal }).then((r) => r.data), staleTime: 60_000, enabled });

// ───────────────────────────── results, exams ─────────────────────────────

export const useResults = (studentId: string | null, q: StudentQ, enabled = true) =>
  useQuery({ queryKey: lk.results(studentId), queryFn: ({ signal }) => bff<{ data: StudentResultOut[] }>('/results', { query: q, signal }).then((r) => r.data), staleTime: 60_000, enabled });

export interface ProgressOut {
  studentId: string;
  exams: { examId: string; name: string; examType: string; date: string | null; percent: number | null; grade: string | null }[];
  subjects: { subjectId: string; subjectName: string; points: { examId: string; percent: number | null; marks: number | null; maxMarks: number; isAbsent: boolean }[] }[];
}
export const useResultsProgress = (studentId: string | null, q: StudentQ, enabled = true) =>
  useQuery({ queryKey: [...lk.results(studentId), 'progress'], queryFn: ({ signal }) => bff<ProgressOut>('/results/progress', { query: q, signal }), staleTime: 60_000, enabled });

export const useReportCard = (examId: string, studentId: string | null, enabled = true) =>
  useQuery({ queryKey: [...lk.results(studentId), 'card', examId], queryFn: ({ signal }) => bff<ReportCardOut>(`/report-cards/${examId}/students/${studentId}`, { signal }), enabled: enabled && !!studentId && !!examId, retry: false });

export const reportCardPdfPath = (examId: string, studentId: string): string => `/api/bff/report-cards/${examId}/students/${studentId}/pdf`;

export const useExams = () => useQuery({ queryKey: lk.exams, queryFn: ({ signal }) => bff<Paged<ExamOut>>('/exams', { query: { pageSize: 50 }, signal }).then((r) => r.data), staleTime: 60_000 });

export const useExamPapers = (examId: string | null, enabled = true) => useQuery({ queryKey: [...lk.exams, 'papers', examId], queryFn: ({ signal }) => bff<{ data: PaperOut[] }>(`/exams/${examId}/papers`, { signal }).then((r) => r.data), enabled: enabled && !!examId, staleTime: 60_000 });

// ───────────────────────────── timetable ─────────────────────────────

export const useTimetableGrid = (sectionId: string | null, date: string) =>
  useQuery({ queryKey: [...lk.timetable(sectionId), date], queryFn: ({ signal }) => bff<TimetableGridResponse>(`/timetable/sections/${sectionId}`, { query: { date }, signal }), enabled: !!sectionId, staleTime: 60_000, placeholderData: keepPreviousData });

export const useTimetableToday = (studentId: string | null, q: StudentQ, enabled = true) =>
  useQuery({ queryKey: ['learning', 'timetable-today', studentId ?? 'me'], queryFn: ({ signal }) => bff<TimetableDayResponse>('/timetable/me', { query: q, signal }), staleTime: 30_000, enabled, refetchInterval: 5 * 60_000 });
