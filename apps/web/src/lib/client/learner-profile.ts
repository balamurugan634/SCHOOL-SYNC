'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AvatarResponse, CorrectionOut, LibraryIssue, MyProfileOut, StudentDetailOut, TransportMyBusItem } from '@school-sync/shared';
import type { z } from 'zod';
import type { correctionCreateBody, myProfileUpdateBody } from '@school-sync/shared';
import { bff } from './fetcher';
import type { Paged } from './hooks';
import { uploadMultipart, type UploadProgress } from './learner-files';

export type ProfileUpdate = z.infer<typeof myProfileUpdateBody>;
export type CorrectionCreate = z.infer<typeof correctionCreateBody>;

export const pk = {
  profile: ['profile', 'me'] as const,
  student: (id: string) => ['profile', 'student', id] as const,
  corrections: (studentId: string | null, f: object) => ['profile', 'corrections', studentId ?? 'all', f] as const,
  bus: ['more', 'my-bus'] as const,
  books: (studentId: string | null, returned: boolean) => ['more', 'my-books', studentId ?? 'me', returned] as const,
};

export const useMyProfile = () => useQuery({ queryKey: pk.profile, queryFn: ({ signal }) => bff<MyProfileOut>('/me/profile', { signal }), staleTime: 30_000 });

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ProfileUpdate) => bff<MyProfileOut>('/me/profile', { method: 'PATCH', body }),
    onSuccess: (data) => {
      qc.setQueryData(pk.profile, data);
      void qc.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}

export function useUploadAvatar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ file, onProgress }: { file: File; onProgress?: UploadProgress }) => uploadMultipart<AvatarResponse>('/me/avatar', file, { method: 'PUT', onProgress }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['profile'] }),
  });
}

export function useRemoveAvatar() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => bff<unknown>('/me/avatar', { method: 'DELETE' }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['profile'] }) });
}

/** The student's official record (what a correction would change). Students / verified parents may read it. */
export const useStudentRecord = (studentId: string | null) =>
  useQuery({ queryKey: pk.student(studentId ?? ''), queryFn: ({ signal }) => bff<StudentDetailOut>(`/students/${studentId}`, { signal }), enabled: !!studentId, staleTime: 60_000 });

export interface CorrectionFilters {
  page: number;
  pageSize: number;
}

export const useCorrections = (studentId: string | null, f: CorrectionFilters) =>
  useQuery({
    queryKey: pk.corrections(studentId, f),
    queryFn: ({ signal }) => bff<Paged<CorrectionOut>>('/correction-requests', { query: { page: f.page, pageSize: f.pageSize, studentId: studentId ?? undefined }, signal }),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });

export function useCreateCorrection(studentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CorrectionCreate) => bff<CorrectionOut>(`/students/${studentId}/correction-requests`, { method: 'POST', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['profile', 'corrections'] }),
  });
}

export function useCancelCorrection() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => bff<CorrectionOut>(`/correction-requests/${id}/cancel`, { method: 'POST', body: {} }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['profile', 'corrections'] }) });
}

export const useMyBus = (enabled = true) => useQuery({ queryKey: pk.bus, queryFn: ({ signal }) => bff<{ data: TransportMyBusItem[] }>('/transport/my-bus', { signal }).then((r) => r.data), enabled, staleTime: 60_000 });

export const useMyBooks = (studentId: string | null, parent: boolean, includeReturned: boolean, enabled = true) =>
  useQuery({
    queryKey: pk.books(parent ? studentId : null, includeReturned),
    queryFn: ({ signal }) => bff<{ data: LibraryIssue[] }>('/library/my-books', { query: { studentId: parent ? (studentId ?? undefined) : undefined, includeReturned: includeReturned ? 'true' : undefined }, signal }).then((r) => r.data),
    enabled,
    staleTime: 30_000,
  });
