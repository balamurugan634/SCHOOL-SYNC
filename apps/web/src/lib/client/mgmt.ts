'use client';

/**
 * Plumbing shared by the management screens (finance, communication, operations, reports):
 * generic query / mutation hooks over the BFF, file upload + CSV download, money parsing, small lookups.
 */
import * as React from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { z } from 'zod';
import type { FilePurpose, FileUploadResponse } from '@school-sync/shared';
import { ApiError, errorMessage } from '../problem';
import { bff, type BffOptions } from './fetcher';
import type { Paged } from './hooks';
import { readOnlyStore } from './readonly-store';

export type Query = NonNullable<BffOptions['query']>;
export type { Paged };

// ── errors ──────────────────────────────────────────────────────────────────────────────────

/** 403 FEATURE_DISABLED: the school has switched this module off (fees / transport / library). */
export const isFeatureDisabled = (e: unknown): boolean => e instanceof ApiError && e.code === 'FEATURE_DISABLED';
/** 403 for a missing permission (the API is the authority; the UI only reflects `Me.permissions`). */
export const isForbidden = (e: unknown): boolean => e instanceof ApiError && e.status === 403 && e.code !== 'FEATURE_DISABLED';
export const isReadOnlyError = (e: unknown): boolean => e instanceof ApiError && e.isReadOnly;

/** A human sentence for any thrown value; never leaks codes. */
export function friendlyError(e: unknown, fallback?: string): string {
  if (e instanceof ApiError) {
    if (e.code === 'FEATURE_DISABLED') return 'This part of SchoolSync is not enabled for your school. Ask a school administrator to switch it on in Settings.';
    if (e.code === 'FORBIDDEN') return 'Your role does not allow this action.';
    if (e.code === 'NOT_FOUND') return e.detail ?? 'That record no longer exists. It may have been removed.';
    if (e.code === 'IDEMPOTENCY_KEY_REUSED') return 'That attempt clashed with an earlier one. Please try again.';
  }
  return errorMessage(e, fallback);
}

// ── query / mutation helpers ────────────────────────────────────────────────────────────────

export function usePagedQuery<T>(key: QueryKey, path: string, query: Query, opts: { enabled?: boolean; staleTime?: number } = {}) {
  return useQuery({
    queryKey: [...key, query],
    queryFn: ({ signal }) => bff<Paged<T>>(path, { query, signal }),
    placeholderData: keepPreviousData,
    staleTime: opts.staleTime ?? 15_000,
    enabled: opts.enabled ?? true,
    retry: (n, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && n < 2,
  });
}

/** A single GET. Pass `path = null` to keep it idle. */
export function useGetQuery<T>(key: QueryKey, path: string | null, query?: Query, opts: { enabled?: boolean; staleTime?: number; keepPrevious?: boolean } = {}) {
  return useQuery({
    queryKey: [...key, query ?? null],
    queryFn: ({ signal }) => bff<T>(path as string, { query, signal }),
    enabled: path !== null && (opts.enabled ?? true),
    staleTime: opts.staleTime ?? 30_000,
    placeholderData: opts.keepPrevious ? keepPreviousData : undefined,
    retry: (n, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && n < 2,
  });
}

/** A write. `invalidate` = query-key prefixes to refetch afterwards. */
export function useApiMutation<V, R = unknown>(opts: {
  method?: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: (v: V) => string;
  body?: (v: V) => unknown;
  headers?: (v: V) => Record<string, string> | undefined;
  invalidate?: QueryKey[];
}) {
  const qc = useQueryClient();
  return useMutation<R, unknown, V>({
    mutationFn: (v) => bff<R>(opts.path(v), { method: opts.method ?? 'POST', body: opts.body ? opts.body(v) : undefined, headers: opts.headers?.(v) }),
    onSuccess: () => {
      for (const k of opts.invalidate ?? []) void qc.invalidateQueries({ queryKey: k });
    },
  });
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

// ── files ───────────────────────────────────────────────────────────────────────────────────

function parseBody(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { detail: text.slice(0, 200) };
  }
}

/** POST /files (multipart). The purpose decides what is accepted: `receipt` = images + PDF, `announcement` = images + documents. */
export async function uploadFile(file: File, purpose: FilePurpose, signal?: AbortSignal): Promise<FileUploadResponse> {
  const fd = new FormData();
  fd.append('file', file);
  let res: Response;
  try {
    res = await fetch(`/api/bff/files?purpose=${purpose}`, { method: 'POST', body: fd, credentials: 'same-origin', signal, headers: { accept: 'application/json' } });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new ApiError({ status: 0, code: 'API_UNREACHABLE', title: 'Network error' });
  }
  const data = parseBody(await res.text());
  if (!res.ok) {
    const err = ApiError.fromProblem(res.status, data);
    if (err.isReadOnly) readOnlyStore.set(true);
    throw err;
  }
  return data as FileUploadResponse;
}

export const fileHref = (id: string, download = false): string => `/api/bff/files/${id}${download ? '?download=1' : ''}`;

function toSearch(q?: Query): string {
  if (!q) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** GET a file (CSV / PDF) through the BFF and save it. Throws an ApiError with the API's message when refused. */
export async function downloadBff(path: string, query: Query | undefined, fallbackName: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`/api/bff${path}${toSearch(query)}`, { credentials: 'same-origin' });
  } catch {
    throw new ApiError({ status: 0, code: 'API_UNREACHABLE', title: 'Network error' });
  }
  if (!res.ok) throw ApiError.fromProblem(res.status, parseBody(await res.text()));
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') ?? '';
  const name = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd)?.[1];
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name ? decodeURIComponent(name) : fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── money ───────────────────────────────────────────────────────────────────────────────────

/** "1560.50" → 156050. Returns null when it is not a valid amount. */
export function parseMinor(text: string | null | undefined): number | null {
  const t = (text ?? '').trim().replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}
export const minorToText = (minor: number): string => (minor / 100).toFixed(2).replace(/\.00$/, '');

/** An amount typed as text; > 0 unless `allowZero`. The form converts with `parseMinor` on submit. */
export const amountText = (what = 'the amount', opts: { allowZero?: boolean } = {}) =>
  z
    .string()
    .trim()
    .min(1, `Enter ${what}`)
    .regex(/^\d{1,10}(\.\d{1,2})?$/, 'Enter a valid amount, like 1560 or 1560.50')
    .refine((v) => opts.allowZero || Number(v) > 0, 'The amount must be more than zero');

// ── lookups (small, cached; each needs the permission the API asks for) ─────────────────────

export interface GradeLite {
  id: string;
  name: string;
}
export interface SectionLite {
  id: string;
  gradeId: string;
  gradeName: string;
  name: string;
  studentCount?: number;
}
export interface StudentLite {
  id: string;
  admissionNo: string;
  name: string;
  gradeName: string | null;
  sectionName: string | null;
  gradeId: string | null;
  sectionId: string | null;
  status: string;
}
export interface StaffLite {
  id: string;
  employeeId: string;
  name: string;
  designation: string | null;
  status: string;
}

export function useGradeList(enabled = true) {
  return useQuery({
    queryKey: ['mgmt', 'grades'],
    queryFn: ({ signal }) => bff<{ data: GradeLite[] }>('/academics/grades', { signal }).then((r) => r.data),
    staleTime: 5 * 60_000,
    enabled,
  });
}

export function useSectionList(gradeId?: string | null, enabled = true) {
  return useQuery({
    queryKey: ['mgmt', 'sections', gradeId ?? 'all'],
    queryFn: ({ signal }) => bff<Paged<SectionLite>>('/academics/sections', { query: { gradeId: gradeId || undefined, pageSize: 100 }, signal }).then((r) => r.data),
    staleTime: 5 * 60_000,
    enabled,
  });
}

export function useAcademicYears(enabled = true) {
  return useQuery({
    queryKey: ['mgmt', 'years'],
    queryFn: ({ signal }) => bff<{ data: { id: string; name: string; isCurrent: boolean }[] }>('/academics/years', { signal }).then((r) => r.data),
    staleTime: 5 * 60_000,
    enabled,
  });
}

export function useStudentSearch(q: string, extra: { gradeId?: string; sectionId?: string; pageSize?: number } = {}, enabled = true) {
  const dq = useDebounced(q.trim(), 250);
  return useQuery({
    queryKey: ['mgmt', 'student-search', dq, extra],
    queryFn: ({ signal }) => bff<Paged<StudentLite>>('/students', { query: { q: dq || undefined, gradeId: extra.gradeId, sectionId: extra.sectionId, pageSize: extra.pageSize ?? 20 }, signal }),
    enabled: enabled && (dq.length >= 2 || !!extra.sectionId || !!extra.gradeId),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}

export function useStaffSearch(q: string, enabled = true) {
  const dq = useDebounced(q.trim(), 250);
  return useQuery({
    queryKey: ['mgmt', 'staff-search', dq],
    queryFn: ({ signal }) => bff<Paged<StaffLite>>('/staff', { query: { q: dq || undefined, pageSize: 20 }, signal }),
    enabled: enabled && dq.length >= 2,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}
