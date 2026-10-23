'use client';

import { useQuery } from '@tanstack/react-query';
import type { z } from 'zod';
import type { TimetableGridResponse, TimetableSlotItem, TimetableSubstitutionItem, timetableSetSlotBody, timetableSubstitutionCreateBody } from '@school-sync/shared';
import { ApiError } from '../problem';
import { acad, friendly, type Paged } from './academics';
import { readOnlyStore } from './readonly-store';
import { useApiMutation } from './mutations';

/** Timetable grid, slots, replace-whole-grid and substitutions. */

export const useTimetable = (sectionId: string | null, date?: string) =>
  useQuery({
    queryKey: ['timetable', 'section', sectionId, date ?? ''],
    queryFn: ({ signal }) => acad<TimetableGridResponse>(`/timetable/sections/${sectionId}`, { query: { date }, signal }),
    enabled: !!sectionId,
    staleTime: 10_000,
  });

export interface SubstitutionFilters {
  from?: string;
  to?: string;
  sectionId?: string;
  staffId?: string;
  page: number;
  pageSize: number;
}
export const useSubstitutions = (f: SubstitutionFilters) =>
  useQuery({ queryKey: ['timetable', 'substitutions', f], queryFn: ({ signal }) => acad<Paged<TimetableSubstitutionItem>>('/timetable/substitutions', { query: { ...f }, signal }), staleTime: 10_000 });

type SetSlotBody = z.input<typeof timetableSetSlotBody>;
export interface SlotInputDraft {
  dayOfWeek: number;
  periodId: string;
  subjectId: string;
  staffId?: string | null;
  room?: string | null;
}

const INV = [['timetable'], ['dashboard'], ['setup']] as const;

export const useSetSlot = () => useApiMutation((b: SetSlotBody) => acad<TimetableSlotItem>('/timetable/slots', { method: 'PUT', body: b }), { invalidate: INV, success: 'Lesson saved', toastError: false });
export const useClearSlot = () => useApiMutation((slotId: string) => acad(`/timetable/slots/${slotId}`, { method: 'DELETE' }), { invalidate: INV, success: 'Lesson cleared' });

export const useCreateSubstitution = () =>
  useApiMutation((b: z.input<typeof timetableSubstitutionCreateBody>) => acad<TimetableSubstitutionItem>('/timetable/substitutions', { method: 'POST', body: b }), {
    invalidate: INV,
    success: (s) => `Cover arranged. ${s.substituteTeacherName}${s.originalTeacherName ? ` and ${s.originalTeacherName}` : ''} have been notified.`,
    toastError: false,
  });
export const useDeleteSubstitution = () => useApiMutation((id: string) => acad(`/timetable/substitutions/${id}`, { method: 'DELETE' }), { invalidate: INV, success: 'Cover cancelled' });

/** Problem+json extras of a TEACHER_CLASH (which day / period / section the clash is with). */
export interface ClashInfo {
  sectionName?: string;
  dayOfWeek?: number;
  periodId?: string;
}
export class TimetableError extends ApiError {
  clash?: ClashInfo;
}

/**
 * Replace a section's whole timetable. Written against fetch directly (not `bff()`) so a 409 TEACHER_CLASH keeps its extra
 * fields (day, period, other section) and the editor can mark the offending cell.
 */
export async function replaceTimetable(sectionId: string, body: { slots: SlotInputDraft[]; allowUnassigned: boolean }): Promise<TimetableSlotItem[]> {
  let res: Response;
  try {
    res = await fetch(`/api/bff/timetable/sections/${sectionId}`, { method: 'PUT', credentials: 'same-origin', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new ApiError({ status: 0, code: 'API_UNREACHABLE', title: 'Network error' });
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {}
  if (!res.ok) {
    const base = ApiError.fromProblem(res.status, data);
    if (base.isReadOnly) readOnlyStore.set(true);
    const f = friendly(base) as ApiError;
    const err = new TimetableError({ status: f.status, code: f.code, detail: f.detail, errors: f.errors, requestId: f.requestId });
    const x = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    if (f.code === 'TEACHER_CLASH') err.clash = { sectionName: typeof x.sectionName === 'string' ? x.sectionName : undefined, dayOfWeek: typeof x.dayOfWeek === 'number' ? x.dayOfWeek : undefined, periodId: typeof x.periodId === 'string' ? x.periodId : undefined };
    throw err;
  }
  return (data as { data: TimetableSlotItem[] }).data;
}

export const useReplaceTimetable = () => useApiMutation(({ sectionId, ...body }: { sectionId: string; slots: SlotInputDraft[]; allowUnassigned: boolean }) => replaceTimetable(sectionId, body), { invalidate: INV, success: 'Timetable saved', toastError: false });
