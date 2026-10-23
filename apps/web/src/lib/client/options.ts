'use client';

import { useQuery } from '@tanstack/react-query';
import type { AcademicYearOut, GradeOut, PeriodOut, SectionOut, StaffListItem, SubjectOut } from '@school-sync/shared';
import type { SelectOption } from '@/components/ui/select';
import { bff } from './fetcher';

/** Lookups shared by every management screen (pickers, filters, labels). Keys start with `['academics', …]` / `['people', 'staff-options']`. */

type Paged<T> = { data: T[]; meta: { page: number; pageSize: number; total: number; totalPages: number } };

/** Walks every page of a paged list (the API caps pageSize at 100). */
export async function fetchAllPages<T>(path: string, query: Record<string, string | number | boolean | undefined> = {}, signal?: AbortSignal): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; page <= 50; page++) {
    const r = await bff<Paged<T>>(path, { query: { ...query, page, pageSize: 100 }, signal });
    out.push(...r.data);
    if (page >= r.meta.totalPages) break;
  }
  return out;
}

const LONG = 5 * 60_000;

export const useYearList = () => useQuery({ queryKey: ['academics', 'years'], queryFn: ({ signal }) => bff<{ data: AcademicYearOut[] }>('/academics/years', { signal }).then((r) => r.data), staleTime: 60_000 });
export const useCurrentYear = () => {
  const q = useYearList();
  return { ...q, current: q.data?.find((y) => y.isCurrent) ?? null };
};
export const useGradeList = () => useQuery({ queryKey: ['academics', 'grades', 'full'], queryFn: ({ signal }) => bff<{ data: GradeOut[] }>('/academics/grades', { signal }).then((r) => [...r.data].sort((a, b) => a.ordinal - b.ordinal)), staleTime: LONG });
export const useSubjectList = () => useQuery({ queryKey: ['academics', 'subjects', 'list'], queryFn: ({ signal }) => bff<{ data: SubjectOut[] }>('/academics/subjects', { signal }).then((r) => r.data), staleTime: LONG });
export const usePeriodList = () => useQuery({ queryKey: ['academics', 'periods', 'list'], queryFn: ({ signal }) => bff<{ data: PeriodOut[] }>('/academics/periods', { signal }).then((r) => [...r.data].sort((a, b) => a.ordinal - b.ordinal)), staleTime: LONG });

/** Sections of one academic year (default: the current year), every page. Needs `academics:view`. */
export const useSectionList = (opts: { yearId?: string; gradeId?: string; enabled?: boolean } = {}) =>
  useQuery({
    queryKey: ['academics', 'sections', 'all', opts.yearId ?? 'current', opts.gradeId ?? ''],
    queryFn: ({ signal }) => fetchAllPages<SectionOut>('/academics/sections', { yearId: opts.yearId, gradeId: opts.gradeId }, signal).then((l) => l.sort((a, b) => a.gradeOrdinal - b.gradeOrdinal || a.name.localeCompare(b.name, undefined, { numeric: true }))),
    enabled: opts.enabled ?? true,
    staleTime: 60_000,
  });

/** Active staff for teacher / class-teacher pickers (every page). Needs `staff:view` (school scope). */
export const useStaffPicker = (opts: { teachingOnly?: boolean; enabled?: boolean } = {}) =>
  useQuery({
    queryKey: ['people', 'staff-options', opts.teachingOnly ? 'teaching' : 'all'],
    queryFn: ({ signal }) => fetchAllPages<StaffListItem>('/staff', { status: 'active', staffType: opts.teachingOnly ? 'teaching' : undefined }, signal),
    enabled: opts.enabled ?? true,
    staleTime: 60_000,
  });

export const sectionLabel = (s: Pick<SectionOut, 'gradeName' | 'name'>) => `${s.gradeName} ${s.name}`;
export const gradeOptions = (l?: GradeOut[]): SelectOption[] => (l ?? []).map((g) => ({ value: g.id, label: g.name }));
export const sectionOptions = (l?: SectionOut[]): SelectOption[] => (l ?? []).map((s) => ({ value: s.id, label: sectionLabel(s) }));
export const subjectOptions = (l?: SubjectOut[]): SelectOption[] => (l ?? []).filter((s) => s.isActive).map((s) => ({ value: s.id, label: s.name }));
export const yearOptions = (l?: AcademicYearOut[]): SelectOption[] => (l ?? []).map((y) => ({ value: y.id, label: y.isCurrent ? `${y.name} (current)` : y.name }));
export const staffOptions = (l?: StaffListItem[]): SelectOption[] => (l ?? []).map((s) => ({ value: s.id, label: s.name }));

/** Weekday names for ISO weekdays 1–7. */
export const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
export const weekdayName = (n: number, short = false) => (short ? WEEKDAY_NAMES[n - 1]?.slice(0, 3) : WEEKDAY_NAMES[n - 1]) ?? String(n);
