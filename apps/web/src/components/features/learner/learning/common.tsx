'use client';

import * as React from 'react';
import { FileText, Link2, Paperclip } from 'lucide-react';
import type { HomeworkLearnerStatus, LearningAttachmentRef } from '@school-sync/shared';
import { fileHref, formatBytes } from '@/lib/client/learner-files';
import { StatusChip } from '@/components/ui/badge';
import { cn } from '@/lib/cn';

/** Homework status as the learner understands it (the API's `pending` means "not handed in yet"). */
export function HomeworkStatusChip({ status, className }: { status: HomeworkLearnerStatus | string; className?: string }) {
  const label = status === 'pending' ? 'To do' : status === 'late' ? 'Handed in late' : status === 'returned' ? 'Needs rework' : status === 'not_required' ? 'No hand-in' : undefined;
  return <StatusChip status={status === 'pending' ? 'todo' : status} label={label} className={className} />;
}

export const HOMEWORK_STATUS_OPTIONS: { value: HomeworkLearnerStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'To do' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'submitted', label: 'Handed in' },
  { value: 'late', label: 'Handed in late' },
  { value: 'returned', label: 'Needs rework' },
  { value: 'reviewed', label: 'Reviewed' },
  { value: 'not_required', label: 'No hand-in' },
];

/** Files attached by a teacher or a student: each opens through the BFF in a new tab. */
export function AttachmentList({ attachments, className }: { attachments: LearningAttachmentRef[]; className?: string }) {
  if (attachments.length === 0) return null;
  return (
    <ul className={cn('flex flex-wrap gap-2', className)} aria-label="Attachments">
      {attachments.map((a) => (
        <li key={a.fileId}>
          <a href={fileHref(a.fileId)} target="_blank" rel="noopener noreferrer" className="tr-colors inline-flex min-h-9 max-w-full items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5 text-[13px] hover:border-border-strong hover:bg-surface-subtle">
            <FileText className="size-4 shrink-0 text-ink-3" aria-hidden />
            <span className="min-w-0 truncate">{a.name}</span>
            {a.sizeBytes ? <span className="t-caption shrink-0 text-ink-3">{formatBytes(a.sizeBytes)}</span> : null}
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

export const LinkIcon = Link2;
export const ClipIcon = Paperclip;

/** Marks like "7.5 / 10". */
export const marksText = (marks: number | null | undefined, max: number | null | undefined): string => (marks === null || marks === undefined ? '—' : max ? `${marks} / ${max}` : String(marks));

/** The grade → tone mapping is deliberately absent: grades are labels, not scores to colour. */
export function SectionTitle({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <h2 id={id} className="t-section">
      {children}
    </h2>
  );
}
