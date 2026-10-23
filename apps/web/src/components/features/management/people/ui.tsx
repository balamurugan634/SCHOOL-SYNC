'use client';

import * as React from 'react';
import { Badge, StatusChip } from '@/components/ui/badge';
import { RELATIONSHIPS, STUDENT_STATUSES, type Relationship, type StudentStatus } from '@school-sync/shared';
import { fmtDateTime } from '@/lib/format';

export const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

export const STUDENT_STATUS_LABEL: Record<StudentStatus, string> = { active: 'Active', suspended: 'Suspended', transferred: 'Transferred', withdrawn: 'Withdrawn', alumni: 'Alumni' };
export const STUDENT_STATUS_OPTIONS = STUDENT_STATUSES.map((s) => ({ value: s, label: STUDENT_STATUS_LABEL[s] }));
export const RELATIONSHIP_OPTIONS = RELATIONSHIPS.map((r) => ({ value: r, label: titleCase(r) }));
export const GENDER_OPTIONS = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'other', label: 'Other' },
];
export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

export function StudentStatusChip({ status }: { status: StudentStatus }) {
  if (status === 'active' || status === 'suspended') return <StatusChip status={status} />;
  return <Badge variant="neutral">{STUDENT_STATUS_LABEL[status]}</Badge>;
}

export const fmtWhen = (iso: string | null | undefined) => (iso ? fmtDateTime(iso) : '—');
export const relationshipLabel = (r: Relationship | string | null | undefined) => (r ? titleCase(r) : '—');

/** Drop empty strings so optional API fields are sent as absent rather than ''. */
export function clean<T extends Record<string, unknown>>(o: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === '' || v === undefined) continue;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const inner = clean(v as Record<string, unknown>);
      if (Object.keys(inner).length) out[k] = inner;
    } else out[k] = v;
  }
  return out as T;
}

/**
 * `useSectionList` (options.ts) types its data as `SectionOut[] | <placeholder fn>` because of `placeholderData: keepPreviousData`;
 * this narrows it back to the array without touching the shared file.
 */
export function asArray<T>(d: unknown): T[] | undefined {
  return Array.isArray(d) ? (d as T[]) : undefined;
}

export const STAFF_STATUS_LABEL: Record<string, string> = { active: 'Active', on_leave: 'On leave', resigned: 'Resigned', terminated: 'Terminated' };
export const STAFF_STATUS_OPTIONS = Object.entries(STAFF_STATUS_LABEL).map(([value, label]) => ({ value, label }));
export const STAFF_TYPE_OPTIONS = [
  { value: 'teaching', label: 'Teaching staff' },
  { value: 'non_teaching', label: 'Non-teaching staff' },
];

export function StaffStatusChip({ status }: { status: string }) {
  if (status === 'active') return <StatusChip status="active" />;
  if (status === 'on_leave') return <Badge variant="info">On leave</Badge>;
  if (status === 'terminated') return <Badge variant="danger">Terminated</Badge>;
  return <Badge variant="neutral">{STAFF_STATUS_LABEL[status] ?? titleCase(status)}</Badge>;
}

export const ADMISSION_LABEL: Record<string, string> = { submitted: 'Submitted', under_review: 'In review', waitlisted: 'Waitlisted', accepted: 'Accepted', rejected: 'Rejected', enrolled: 'Enrolled' };
export const ADMISSION_OPTIONS = Object.entries(ADMISSION_LABEL).map(([value, label]) => ({ value, label }));

export function AdmissionStatusChip({ status }: { status: string }) {
  const label = ADMISSION_LABEL[status] ?? titleCase(status);
  const variant = ({ submitted: 'info', under_review: 'warning', waitlisted: 'outline', accepted: 'success', rejected: 'danger', enrolled: 'primary' } as const)[status as 'submitted'] ?? 'neutral';
  return <Badge variant={variant}>{label}</Badge>;
}
