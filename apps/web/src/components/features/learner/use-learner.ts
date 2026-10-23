'use client';

import * as React from 'react';
import type { LinkedChild } from '@school-sync/shared';
import { useMeContext, usePermissions } from '@/components/me-context';
import { useSite } from '@/components/site-context';
import { useReadOnly } from '@/lib/client/readonly-store';

export interface Learner {
  role: 'student' | 'parent';
  isParent: boolean;
  /** href prefix of the experience: `/student` or `/parent` */
  base: string;
  /** the student whose data the screen shows: the student themself, or the parent's selected child (null = none yet) */
  studentId: string | null;
  sectionId: string | null;
  /** display name of that student */
  name: string;
  /** "Grade 6 · A" */
  classLabel: string;
  /** "Grade 6" */
  gradeName: string | null;
  /** every verified-linked child (parents) */
  kids: LinkedChild[];
  /** `?studentId=` for endpoints that need it for parents only (students send nothing; the API uses the session) */
  q: { studentId?: string };
  /** false only for a parent without any verified child */
  ready: boolean;
}

/**
 * Who the learner screens are about. Students → themselves; parents → the child chosen in the header switcher
 * (falls back to the first linked child). One hook so every screen scopes its queries the same way.
 */
export function useLearner(): Learner {
  const { me, base, childId } = useMeContext();
  return React.useMemo<Learner>(() => {
    if (me.experience === 'parent') {
      const kids = me.profile.children;
      const child = kids.find((k) => k.studentId === childId) ?? kids[0] ?? null;
      return {
        role: 'parent',
        isParent: true,
        base,
        studentId: child?.studentId ?? null,
        sectionId: child?.sectionId ?? null,
        name: child?.name ?? '',
        classLabel: child ? [child.grade, child.section].filter(Boolean).join(' · ') : '',
        gradeName: child?.grade ?? null,
        kids,
        q: child ? { studentId: child.studentId } : {},
        ready: !!child,
      };
    }
    return {
      role: 'student',
      isParent: false,
      base,
      studentId: me.profile.studentId,
      sectionId: me.profile.sectionId,
      name: me.displayName,
      classLabel: [me.profile.gradeName, me.profile.sectionName].filter(Boolean).join(' · '),
      gradeName: me.profile.gradeName,
      kids: [],
      q: {},
      ready: !!me.profile.studentId,
    };
  }, [me, base, childId]);
}

/** School feature switches + read-only mode + permission helper, in one place for buttons. */
export function useGates() {
  const site = useSite();
  const { can, canAny } = usePermissions();
  const readOnly = useReadOnly(site?.readOnly ?? false);
  return { features: site?.features ?? { fees: false, transport: false, library: false, onlinePayments: false, studentLogin: false }, readOnly, can, canAny, currency: site?.currency ?? 'INR', schoolName: site?.name ?? 'School' };
}
