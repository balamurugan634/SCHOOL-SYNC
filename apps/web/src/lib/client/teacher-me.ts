'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import type { MyProfileOut, StaffAttendanceRecord, StaffLeaveItem, staffAttendanceMineResponse, staffLeaveBalanceResponse, staffLeaveCreateBody, myProfileUpdateBody } from '@school-sync/shared';
import { ApiError } from '../problem';
import { bff } from './fetcher';
import type { Paged } from './hooks';
import { readOnlyStore } from './readonly-store';

export type StaffAttendanceMine = z.infer<typeof staffAttendanceMineResponse>;
export type StaffLeaveBalance = z.infer<typeof staffLeaveBalanceResponse>;
export type StaffLeaveCreate = z.input<typeof staffLeaveCreateBody>;
export type ProfileUpdate = z.input<typeof myProfileUpdateBody>;

/* ───────────────────────── staff attendance (self-service) ───────────────────────── */

export const useMyStaffAttendance = (f: { from: string; to: string }) =>
  useQuery({ queryKey: ['me', 'staff-attendance', f], queryFn: ({ signal }) => bff<StaffAttendanceMine>('/staff-attendance/me', { query: f, signal }), placeholderData: keepPreviousData, staleTime: 15_000 });

export function useCheckInOut() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (kind: 'check-in' | 'check-out') => bff<StaffAttendanceRecord>(`/staff-attendance/${kind}`, { method: 'POST' }),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['me', 'staff-attendance'] }),
  });
}

/* ───────────────────────── staff leave ───────────────────────── */

export const useStaffLeaveList = (f: { status?: string; page: number; pageSize: number }) =>
  useQuery({
    queryKey: ['me', 'staff-leave', f],
    queryFn: ({ signal }) => bff<Paged<StaffLeaveItem>>('/staff-leave', { query: { status: f.status || undefined, page: f.page, pageSize: f.pageSize }, signal }),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });

export const useStaffLeaveBalance = () => useQuery({ queryKey: ['me', 'staff-leave-balance'], queryFn: ({ signal }) => bff<StaffLeaveBalance>('/staff-leave/balance', { signal }), staleTime: 30_000 });

export function useApplyStaffLeave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: StaffLeaveCreate) => bff<StaffLeaveItem>('/staff-leave', { method: 'POST', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['me'] }),
  });
}

export function useCancelStaffLeave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => bff<StaffLeaveItem>(`/staff-leave/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['me'] }),
  });
}

/* ───────────────────────── profile ───────────────────────── */

export const useMyProfile = () => useQuery({ queryKey: ['me', 'profile'], queryFn: ({ signal }) => bff<MyProfileOut>('/me/profile', { signal }), staleTime: 60_000 });

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ProfileUpdate) => bff<MyProfileOut>('/me/profile', { method: 'PATCH', body }),
    onSuccess: (data) => qc.setQueryData(['me', 'profile'], data),
  });
}

export const AVATAR_MAX_MB = 5;
export const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** `PUT /me/avatar` is multipart, which `bff()` (JSON only) does not send: build the FormData here. */
export async function putAvatar(file: File): Promise<{ avatarUrl: string | null }> {
  const body = new FormData();
  body.append('file', file, file.name);
  let res: Response;
  try {
    res = await fetch('/api/bff/me/avatar', { method: 'PUT', body, credentials: 'same-origin', headers: { accept: 'application/json' } });
  } catch {
    throw new ApiError({ status: 0, code: 'API_UNREACHABLE', title: 'Network error' });
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { detail: text.slice(0, 200) };
  }
  if (!res.ok) {
    const err = ApiError.fromProblem(res.status, data);
    if (err.isReadOnly) readOnlyStore.set(true);
    throw err;
  }
  return data as { avatarUrl: string | null };
}

export function useAvatar() {
  const qc = useQueryClient();
  const done = () => void qc.invalidateQueries({ queryKey: ['me', 'profile'] });
  return {
    upload: useMutation({ mutationFn: putAvatar, onSuccess: done }),
    remove: useMutation({ mutationFn: () => bff<{ avatarUrl: string | null }>('/me/avatar', { method: 'DELETE' }), onSuccess: done }),
  };
}
