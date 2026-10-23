'use client';

import * as React from 'react';
import { AlertTriangle, CheckCircle2, Circle, Clock, Minus } from 'lucide-react';
import type { ExamStatus, MarkSheetStatus } from '@school-sync/shared';
import { EXAM_TYPES } from '@school-sync/shared';
import { Badge } from '@/components/ui/badge';
import type { SelectOption } from '@/components/ui/select';
import { usePermissions } from '@/components/me-context';
import { AreaTabs } from '../shared/detail';

export const EXAM_TYPE_LABEL: Record<(typeof EXAM_TYPES)[number], string> = {
  unit_test: 'Unit test',
  quiz: 'Quiz',
  midterm: 'Mid-term',
  final: 'Final',
  practical: 'Practical',
  other: 'Other',
};
export const EXAM_TYPE_OPTIONS: SelectOption[] = EXAM_TYPES.map((t) => ({ value: t, label: EXAM_TYPE_LABEL[t] }));

export const EXAM_STATUS_LABEL: Record<ExamStatus, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  marks_entry: 'Marks entry',
  under_review: 'Under review',
  published: 'Published',
};
export const EXAM_STATUS_OPTIONS: SelectOption[] = (Object.keys(EXAM_STATUS_LABEL) as ExamStatus[]).map((s) => ({ value: s, label: EXAM_STATUS_LABEL[s] }));
export const EXAM_STEPS = (Object.keys(EXAM_STATUS_LABEL) as ExamStatus[]).map((id) => ({ id, label: EXAM_STATUS_LABEL[id] }));

const EXAM_CHIP: Record<ExamStatus, { variant: React.ComponentProps<typeof Badge>['variant']; icon: React.ReactNode }> = {
  draft: { variant: 'neutral', icon: <Circle aria-hidden /> },
  scheduled: { variant: 'info', icon: <Clock aria-hidden /> },
  marks_entry: { variant: 'warning', icon: <Clock aria-hidden /> },
  under_review: { variant: 'warning', icon: <AlertTriangle aria-hidden /> },
  published: { variant: 'success', icon: <CheckCircle2 aria-hidden /> },
};

export function ExamStatusChip({ status }: { status: ExamStatus }) {
  const c = EXAM_CHIP[status];
  return (
    <Badge variant={c.variant} icon={c.icon}>
      {EXAM_STATUS_LABEL[status]}
    </Badge>
  );
}

export const SHEET_STATUS_LABEL: Record<MarkSheetStatus, string> = { draft: 'Draft', submitted: 'Submitted', approved: 'Approved', published: 'Published', returned: 'Returned' };
export const SHEET_STATUS_OPTIONS: SelectOption[] = (Object.keys(SHEET_STATUS_LABEL) as MarkSheetStatus[]).map((s) => ({ value: s, label: SHEET_STATUS_LABEL[s] }));
const SHEET_CHIP: Record<MarkSheetStatus, { variant: React.ComponentProps<typeof Badge>['variant']; icon: React.ReactNode }> = {
  draft: { variant: 'neutral', icon: <Minus aria-hidden /> },
  submitted: { variant: 'info', icon: <Clock aria-hidden /> },
  approved: { variant: 'primary', icon: <CheckCircle2 aria-hidden /> },
  published: { variant: 'success', icon: <CheckCircle2 aria-hidden /> },
  returned: { variant: 'warning', icon: <AlertTriangle aria-hidden /> },
};
export function SheetStatusChip({ status }: { status: MarkSheetStatus }) {
  const c = SHEET_CHIP[status];
  return (
    <Badge variant={c.variant} icon={c.icon}>
      {SHEET_STATUS_LABEL[status]}
    </Badge>
  );
}

/** "12 Oct – 18 Oct 2026" style range for an exam's dates. */
export function dateRange(a: string | null | undefined, b: string | null | undefined, fmt: (s: string | null | undefined) => string): string {
  if (a && b) return `${fmt(a)} – ${fmt(b)}`;
  if (a || b) return fmt(a ?? b);
  return 'Dates not set';
}

/** Tabs at the top of every list-level exams page; hides the ones the signed-in role cannot use. */
export function ExamsAreaTabs() {
  const { can } = usePermissions();
  const items = [
    { href: '/admin/exams', label: 'Exams', exact: true, show: can('exams:view') },
    { href: '/admin/exams/review', label: 'Review queue', show: can('marks:view', 'assigned') },
    { href: '/admin/exams/grade-scales', label: 'Grade scales', show: can('exams:view') },
    { href: '/admin/exams/report-cards', label: 'Report cards', show: can('report_cards:view', 'assigned') },
  ].filter((i) => i.show);
  return <AreaTabs items={items} />;
}
