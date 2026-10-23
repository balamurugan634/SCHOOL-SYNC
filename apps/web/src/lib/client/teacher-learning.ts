'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useQueries } from '@tanstack/react-query';
import type {
  MaterialCreateBody,
  MaterialItem,
  MaterialUpdateBody,
  SyllabusCoverageItem,
  SyllabusProgressStatus,
  SyllabusTopicItem,
  TimetableDayResponse,
  TimetableSubstitutionItem,
} from '@school-sync/shared';
import { bff } from './fetcher';
import type { Paged } from './hooks';

/* ───────────────────────── syllabus ───────────────────────── */

export const syKeys = {
  coverage: (sectionId: string) => ['syllabus', 'coverage', sectionId] as const,
  topics: (gradeId: string, subjectId: string, sectionId: string) => ['syllabus', 'topics', gradeId, subjectId, sectionId] as const,
};

export const useCoverage = (sectionId: string | null | undefined) =>
  useQuery({ queryKey: syKeys.coverage(sectionId ?? ''), queryFn: ({ signal }) => bff<{ data: SyllabusCoverageItem[] }>('/syllabus/coverage', { query: { sectionId: sectionId! }, signal }).then((r) => r.data), enabled: !!sectionId, staleTime: 30_000 });

/** Coverage of every class I can see (for the class cards). */
export const useAllCoverage = () => useQuery({ queryKey: ['syllabus', 'coverage', 'all'], queryFn: ({ signal }) => bff<{ data: SyllabusCoverageItem[] }>('/syllabus/coverage', { signal }).then((r) => r.data), staleTime: 60_000 });

export const useTopics = (gradeId: string | null | undefined, subjectId: string | null | undefined, sectionId: string | null | undefined) =>
  useQuery({
    queryKey: syKeys.topics(gradeId ?? '', subjectId ?? '', sectionId ?? ''),
    queryFn: ({ signal }) => bff<{ data: SyllabusTopicItem[] }>('/syllabus/topics', { query: { gradeId: gradeId!, subjectId: subjectId!, sectionId: sectionId! }, signal }).then((r) => [...r.data].sort((a, b) => a.ordinal - b.ordinal)),
    enabled: !!gradeId && !!subjectId && !!sectionId,
    staleTime: 30_000,
  });

/** One topic's progress for one class. Optimistic: the row flips at once and rolls back if the API refuses (NOT_TEACHING_SUBJECT …). */
export function useSetTopicProgress(gradeId: string, subjectId: string, sectionId: string) {
  const qc = useQueryClient();
  const key = syKeys.topics(gradeId, subjectId, sectionId);
  return useMutation({
    mutationFn: ({ topicId, status }: { topicId: string; status: SyllabusProgressStatus }) => bff(`/syllabus/topics/${topicId}/progress`, { method: 'PUT', body: { sectionId, status } }),
    onMutate: async ({ topicId, status }) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<SyllabusTopicItem[]>(key);
      if (prev) qc.setQueryData<SyllabusTopicItem[]>(key, prev.map((t) => (t.id === topicId ? { ...t, progress: { sectionId, status, completedAt: status === 'completed' ? new Date().toISOString() : null, updatedAt: new Date().toISOString() } } : t)));
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['syllabus'] });
    },
  });
}

/** Several topics at once (`PUT /syllabus/progress`, atomic). */
export function useBulkTopicProgress(sectionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (items: { topicId: string; status: SyllabusProgressStatus }[]) => bff('/syllabus/progress', { method: 'PUT', body: { sectionId, items } }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['syllabus'] });
    },
  });
}

/* ───────────────────────── materials ───────────────────────── */

export interface MaterialFilters {
  sectionId: string;
  subjectId: string;
  q: string;
  archived: boolean;
  page: number;
  pageSize: number;
}
export const matKeys = { all: ['materials'] as const, list: (f: MaterialFilters) => ['materials', 'list', f] as const };

export const useMaterials = (f: MaterialFilters) =>
  useQuery({
    queryKey: matKeys.list(f),
    queryFn: ({ signal }) => bff<Paged<MaterialItem>>('/materials', { query: { sectionId: f.sectionId || undefined, subjectId: f.subjectId || undefined, q: f.q || undefined, archived: f.archived ? 'true' : undefined, page: f.page, pageSize: f.pageSize }, signal }),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });

export function useCreateMaterial() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (body: MaterialCreateBody) => bff<MaterialItem>('/materials', { method: 'POST', body }), onSuccess: () => void qc.invalidateQueries({ queryKey: matKeys.all }) });
}
export function useUpdateMaterial() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ id, body }: { id: string; body: MaterialUpdateBody }) => bff<MaterialItem>(`/materials/${id}`, { method: 'PATCH', body }), onSuccess: () => void qc.invalidateQueries({ queryKey: matKeys.all }) });
}
export function useArchiveMaterial() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => bff(`/materials/${id}`, { method: 'DELETE' }), onSuccess: () => void qc.invalidateQueries({ queryKey: matKeys.all }) });
}

/* ───────────────────────── timetable ───────────────────────── */

/** My school day for each date of a week (Monday-first list of ISO dates): lessons I teach, covers I give, and lessons covered for me. */
export function useMyWeek(dates: string[]) {
  const results = useQueries({
    queries: dates.map((date) => ({
      queryKey: ['timetable', 'me', date] as const,
      queryFn: ({ signal }: { signal: AbortSignal }) => bff<TimetableDayResponse>('/timetable/me', { query: { date }, signal }),
      staleTime: 60_000,
    })),
  });
  return {
    days: results.map((r) => r.data),
    isPending: results.some((r) => r.isPending),
    error: results.find((r) => r.error)?.error ?? null,
    refetch: () => results.forEach((r) => void r.refetch()),
  };
}

export const useSubstitutions = (from: string, to: string) =>
  useQuery({ queryKey: ['timetable', 'substitutions', from, to], queryFn: ({ signal }) => bff<Paged<TimetableSubstitutionItem>>('/timetable/substitutions', { query: { from, to, pageSize: 100 }, signal }).then((r) => r.data), staleTime: 60_000 });
