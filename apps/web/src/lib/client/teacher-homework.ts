'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { HomeworkCreateBody, HomeworkItem, HomeworkRosterResponse, HomeworkUpdateBody, SubmissionItem, SubmissionReturnBody, SubmissionReviewBody } from '@school-sync/shared';
import { bff } from './fetcher';
import type { Paged } from './hooks';

export type HomeworkSort = 'dueAsc' | 'dueDesc';
export type HomeworkScope = 'mine' | 'class';

export interface HomeworkFilters {
  /** `mine` = homework I created (?mine=true); `class` = everything I can see in my classes */
  scope: HomeworkScope;
  sectionId: string;
  subjectId: string;
  status: '' | 'draft' | 'published' | 'closed';
  q: string;
  dueFrom: string;
  dueTo: string;
  sort: HomeworkSort;
  page: number;
  pageSize: number;
}

export interface SubmissionFilters {
  status: '' | 'submitted' | 'late' | 'reviewed' | 'returned';
  page: number;
  pageSize: number;
}

export const hwKeys = {
  all: ['homework'] as const,
  list: (f: HomeworkFilters) => ['homework', 'list', f] as const,
  one: (id: string) => ['homework', 'one', id] as const,
  roster: (id: string) => ['homework', 'roster', id] as const,
  subs: (homeworkId: string, f: SubmissionFilters) => ['submissions', 'list', homeworkId, f] as const,
  sub: (id: string) => ['submissions', 'one', id] as const,
};

export const homeworkQuery = (f: HomeworkFilters) => ({
  mine: f.scope === 'mine' ? 'true' : undefined,
  sectionId: f.sectionId || undefined,
  subjectId: f.subjectId || undefined,
  status: f.status || undefined,
  q: f.q || undefined,
  dueFrom: f.dueFrom || undefined,
  dueTo: f.dueTo || undefined,
  sort: f.sort,
  page: f.page,
  pageSize: f.pageSize,
});

export const useHomeworkList = (f: HomeworkFilters) =>
  useQuery({ queryKey: hwKeys.list(f), queryFn: ({ signal }) => bff<Paged<HomeworkItem>>('/homework', { query: homeworkQuery(f), signal }), placeholderData: keepPreviousData, staleTime: 15_000 });

export const useHomework = (id: string | null | undefined) => useQuery({ queryKey: hwKeys.one(id ?? ''), queryFn: ({ signal }) => bff<HomeworkItem>(`/homework/${id}`, { signal }), enabled: !!id, staleTime: 15_000 });

export const useHomeworkRoster = (id: string | null | undefined, enabled = true) =>
  useQuery({ queryKey: hwKeys.roster(id ?? ''), queryFn: ({ signal }) => bff<HomeworkRosterResponse>(`/homework/${id}/roster`, { signal }), enabled: !!id && enabled, staleTime: 15_000 });

export const useSubmissions = (homeworkId: string | null | undefined, f: SubmissionFilters, enabled = true) =>
  useQuery({
    queryKey: hwKeys.subs(homeworkId ?? '', f),
    queryFn: ({ signal }) => bff<Paged<SubmissionItem>>('/submissions', { query: { homeworkId: homeworkId ?? undefined, status: f.status || undefined, page: f.page, pageSize: f.pageSize }, signal }),
    enabled: !!homeworkId && enabled,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });

export const useSubmission = (id: string | null | undefined) => useQuery({ queryKey: hwKeys.sub(id ?? ''), queryFn: ({ signal }) => bff<SubmissionItem>(`/submissions/${id}`, { signal }), enabled: !!id, staleTime: 15_000 });

/** Everything that shows homework numbers: the lists, the detail, the roster, review queues and the teacher home. */
function useRefresh() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['homework'] });
    void qc.invalidateQueries({ queryKey: ['submissions'] });
    void qc.invalidateQueries({ queryKey: ['dashboard', 'teacher'] });
  };
}

export function useCreateHomework() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: (body: HomeworkCreateBody) => bff<HomeworkItem>('/homework', { method: 'POST', body }), onSuccess: refresh });
}

export function useUpdateHomework(id: string) {
  const refresh = useRefresh();
  return useMutation({ mutationFn: (body: HomeworkUpdateBody) => bff<HomeworkItem>(`/homework/${id}`, { method: 'PATCH', body }), onSuccess: refresh });
}

export function usePublishHomework() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: (id: string) => bff<HomeworkItem>(`/homework/${id}/publish`, { method: 'POST' }), onSuccess: refresh });
}

export function useCloseHomework() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: (id: string) => bff<HomeworkItem>(`/homework/${id}/close`, { method: 'POST' }), onSuccess: refresh });
}

export function useDeleteHomework() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: (id: string) => bff<unknown>(`/homework/${id}`, { method: 'DELETE' }), onSuccess: refresh });
}

export function useReviewSubmission() {
  const qc = useQueryClient();
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: SubmissionReviewBody }) => bff<SubmissionItem>(`/submissions/${id}/review`, { method: 'POST', body }),
    onSuccess: (res, v) => {
      qc.setQueryData(hwKeys.sub(v.id), res);
      refresh();
    },
  });
}

export function useReturnSubmission() {
  const qc = useQueryClient();
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: SubmissionReturnBody }) => bff<SubmissionItem>(`/submissions/${id}/return`, { method: 'POST', body }),
    onSuccess: (res, v) => {
      qc.setQueryData(hwKeys.sub(v.id), res);
      refresh();
    },
  });
}
