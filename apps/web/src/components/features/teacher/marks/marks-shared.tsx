'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';
import type { ExamOut } from '@school-sync/shared';
import { cn } from '@/lib/cn';
import { StatusChip } from '@/components/ui/badge';
import { Select } from '@/components/ui/select';
import { SubNav } from '../common';
import { useMeContext, usePermissions } from '@/components/me-context';
import { useTeacherScope } from '@/lib/client/teacher';

/** Tabs of the marks area. Hidden on the entry grid (it has its own breadcrumb) so the grid gets the whole screen. */
export function MarksNav() {
  const pathname = usePathname();
  const { base } = useMeContext();
  const scope = useTeacherScope();
  const { can } = usePermissions();
  if (pathname.startsWith(`${base}/marks/sheets/`)) return null;
  return (
    <SubNav
      label="Marks"
      items={[
        { href: '/marks', label: 'Mark sheets', exact: true },
        { href: '/marks/exams', label: 'Exams' },
        { href: '/marks/results', label: 'Results' },
        { href: '/marks/remarks', label: 'Remarks', hidden: !(scope.isClassTeacher && can('report_cards:create')) },
      ]}
    />
  );
}

const EXAM_LABEL: Record<string, string> = { draft: 'Draft', scheduled: 'Scheduled', marks_entry: 'Marks entry open', under_review: 'Under review', published: 'Published' };
const EXAM_CHIP: Record<string, string> = { draft: 'draft', scheduled: 'scheduled', marks_entry: 'pending', under_review: 'submitted', published: 'published' };

export function ExamStatusChip({ status }: { status: ExamOut['status'] }) {
  return <StatusChip status={EXAM_CHIP[status] ?? status} label={EXAM_LABEL[status] ?? status} />;
}
export const examStatusLabel = (s: string): string => EXAM_LABEL[s] ?? s;

/** Toggle chips (a filter, not navigation). */
export function FilterChips<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; count?: number }[]; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={cn('tr-colors inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium sm:h-8', on ? 'border-brand/40 bg-brand-soft text-brand-ink' : 'border-border-strong bg-surface text-ink-2 hover:bg-surface-subtle hover:text-ink')}
          >
            {o.label}
            {o.count !== undefined && <span className={cn('tnum text-xs', on ? 'text-brand-ink' : 'text-ink-3')}>{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Exam picker as a labelled `Select` (value `''` is not allowed by Radix, so callers pass a real id). */
export function ExamSelect({ exams, value, onChange, className, label = 'Exam' }: { exams: ExamOut[]; value: string; onChange: (v: string) => void; className?: string; label?: string }) {
  return <Select aria-label={label} className={cn('w-full sm:w-64', className)} value={value} onValueChange={onChange} options={exams.map((e) => ({ value: e.id, label: e.name }))} placeholder="Choose an exam" />;
}
