'use client';

import * as React from 'react';
import { MinusCircle } from 'lucide-react';
import type { HomeworkItem, HomeworkStats } from '@school-sync/shared';
import { Badge, StatusChip } from '@/components/ui/badge';
import { secLabel } from '@/lib/client/teacher';

export const hwClass = (h: Pick<HomeworkItem, 'gradeName' | 'sectionName'>): string => secLabel(h.gradeName, h.sectionName);

/** Students who have handed something in (any status other than "missing"). */
export const handedIn = (s: HomeworkStats): number => Math.max(0, s.totalStudents - s.missing);
/** Submissions waiting for the teacher (submitted on time or late, not yet reviewed). */
export const toReviewCount = (s: HomeworkStats): number => s.submitted + s.late;

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function HomeworkStatusChip({ status }: { status: HomeworkItem['status'] }) {
  return <StatusChip status={status} label={status === 'closed' ? 'Closed' : undefined} />;
}

/** Status of one student's work on a homework (roster and review). */
export function WorkStatusChip({ status }: { status: 'missing' | 'submitted' | 'late' | 'reviewed' | 'returned' }) {
  if (status === 'missing')
    return (
      <Badge variant="warning-outline" icon={<MinusCircle aria-hidden />}>
        Missing
      </Badge>
    );
  return <StatusChip status={status} label={status === 'returned' ? 'Returned for rework' : undefined} />;
}

export const marksText = (marks: number | null | undefined, max: number | null | undefined): string => (marks === null || marks === undefined ? '—' : max ? `${marks} / ${max}` : String(marks));

/** A removable filter chip (shown in "no results" states and above lists). */
export function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button type="button" onClick={onRemove} aria-label={`Remove filter: ${label}`} className="tr-colors inline-flex h-7 items-center gap-1.5 rounded-full border border-border-strong bg-surface px-2.5 text-[13px] text-ink-2 hover:bg-surface-subtle hover:text-ink">
      {label}
      <span aria-hidden className="text-ink-3">
        ×
      </span>
    </button>
  );
}
