'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import type { PeriodOut, SectionDetailOut, SectionOut, TeacherDashboard, TeachingAssignmentOut } from '@school-sync/shared';
import { useMe } from '@/components/me-context';
import { bff } from './fetcher';
import type { Paged } from './hooks';

/** "Grade 6" + "A" → "Grade 6 A" (the API prints the same section several ways; this is the one label the teacher screens use). */
export const secLabel = (grade: string | null | undefined, section: string | null | undefined): string => [grade, section].filter(Boolean).join(' ');
export const sectionOutLabel = (s: Pick<SectionOut, 'gradeName' | 'name'>): string => secLabel(s.gradeName, s.name);

export const tk = {
  dash: ['dashboard', 'teacher'] as const,
  sectionsMine: ['academics', 'sections', 'mine'] as const,
  section: (id: string) => ['academics', 'section', id] as const,
  assignments: ['academics', 'assignments', 'scope'] as const,
  periods: ['academics', 'periods'] as const,
};

export const useTeacherDashboard = () => useQuery({ queryKey: tk.dash, queryFn: ({ signal }) => bff<TeacherDashboard>('/dashboard/teacher', { signal }), staleTime: 30_000 });

/** Who I am as a teacher, from `Me` (the API still enforces every rule). */
export function useTeacherScope() {
  const me = useMe();
  return React.useMemo(() => {
    const lead = new Set(me.profile.classTeacherSectionIds);
    const assigned = new Set(me.profile.assignedSectionIds);
    return {
      staffId: me.profile.staffId,
      leadIds: me.profile.classTeacherSectionIds,
      assignedIds: me.profile.assignedSectionIds,
      isClassTeacher: lead.size > 0,
      isLead: (sectionId: string | null | undefined) => !!sectionId && lead.has(sectionId),
      isAssigned: (sectionId: string | null | undefined) => !!sectionId && assigned.has(sectionId),
    };
  }, [me]);
}

/** Sections I teach in or lead (current year), in grade order. */
export function useMySections() {
  return useQuery({
    queryKey: tk.sectionsMine,
    queryFn: ({ signal }) => bff<Paged<SectionOut>>('/academics/sections', { query: { mine: 'true', pageSize: 100 }, signal }).then((r) => [...r.data].sort((a, b) => a.gradeOrdinal - b.gradeOrdinal || a.name.localeCompare(b.name))),
    staleTime: 5 * 60_000,
  });
}

export function useSectionDetail(id: string | null | undefined) {
  return useQuery({ queryKey: tk.section(id ?? ''), queryFn: ({ signal }) => bff<SectionDetailOut>(`/academics/sections/${id}`, { signal }), enabled: !!id, staleTime: 60_000 });
}

/** Every section→subject→teacher assignment inside my scope (my own and my class's colleagues'). */
export function useTeachingAssignments() {
  return useQuery({
    queryKey: tk.assignments,
    queryFn: async ({ signal }) => {
      const all: TeachingAssignmentOut[] = [];
      for (let page = 1; page <= 10; page++) {
        const r = await bff<Paged<TeachingAssignmentOut>>('/academics/teaching-assignments', { query: { page, pageSize: 100 }, signal });
        all.push(...r.data);
        if (page >= (r.meta?.totalPages ?? 1)) break;
      }
      return all;
    },
    staleTime: 5 * 60_000,
  });
}

export const usePeriods = () => useQuery({ queryKey: tk.periods, queryFn: ({ signal }) => bff<{ data: PeriodOut[] }>('/academics/periods', { signal }).then((r) => r.data), staleTime: 10 * 60_000 });

export interface TeachPair {
  sectionId: string;
  sectionName: string;
  gradeId: string;
  gradeName: string;
  subjectId: string;
  subjectName: string;
  /** `teach` = I am the subject teacher; `lead` = I lead the class, so I may also post for its other subjects */
  via: 'teach' | 'lead';
  /** label: "Grade 6 A · English" */
  label: string;
}

/**
 * What I may create content for (homework, materials, progress): my own (section, subject) pairs, plus every subject of
 * the sections I lead. Derived from the assignments the API returns for my scope; the API re-checks (`NOT_TEACHING_SUBJECT`).
 */
export function useMyTeaching() {
  const scope = useTeacherScope();
  const assignments = useTeachingAssignments();
  const sections = useMySections();
  const data = React.useMemo(() => {
    const rows = assignments.data ?? [];
    const pairs: TeachPair[] = [];
    const seen = new Set<string>();
    for (const a of rows) {
      const mine = a.staffId === scope.staffId;
      const led = scope.isLead(a.sectionId);
      if (!mine && !led) continue;
      const k = `${a.sectionId}:${a.subjectId}`;
      if (seen.has(k)) continue;
      seen.add(k);
      pairs.push({ sectionId: a.sectionId, sectionName: secLabel(a.gradeName, a.sectionName), gradeId: a.gradeId, gradeName: a.gradeName, subjectId: a.subjectId, subjectName: a.subjectName, via: mine ? 'teach' : 'lead', label: `${secLabel(a.gradeName, a.sectionName)} · ${a.subjectName}` });
    }
    const order = new Map((sections.data ?? []).map((s, i) => [s.id, i]));
    pairs.sort((a, b) => (order.get(a.sectionId) ?? 99) - (order.get(b.sectionId) ?? 99) || a.subjectName.localeCompare(b.subjectName));
    const mineSet = new Set(pairs.filter((p) => p.via === 'teach').map((p) => `${p.sectionId}:${p.subjectId}`));
    const subjectsBySection = new Map<string, TeachPair[]>();
    for (const p of pairs) subjectsBySection.set(p.sectionId, [...(subjectsBySection.get(p.sectionId) ?? []), p]);
    return {
      pairs,
      /** I am the subject teacher of this section + subject */
      teaches: (sectionId: string, subjectId: string) => mineSet.has(`${sectionId}:${subjectId}`),
      subjectsOf: (sectionId: string) => subjectsBySection.get(sectionId) ?? [],
      mySubjectIds: [...new Set(pairs.filter((p) => p.via === 'teach').map((p) => p.subjectId))],
    };
  }, [assignments.data, sections.data, scope]);
  return {
    ...data,
    sections: sections.data,
    isPending: assignments.isPending || sections.isPending,
    error: assignments.error ?? sections.error,
    refetch: () => {
      void assignments.refetch();
      void sections.refetch();
    },
  };
}
