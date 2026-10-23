import { CalendarDays, ClipboardList, Info, NotebookPen, PenLine, Sun, Trophy, Users, type LucideIcon } from 'lucide-react';
import type { CalendarKind } from '@school-sync/shared';

export interface KindMeta {
  label: string;
  icon: LucideIcon;
  /** soft chip classes — the label and icon always carry the meaning, the tint is only a hint */
  chip: string;
}

const neutral = 'bg-surface-sunken text-ink';

/** Calendar + event kinds → label, icon and chip tint. Kind is never shown by colour alone. */
export const KIND_META: Record<CalendarKind, KindMeta> = {
  holiday: { label: 'Holiday', icon: Sun, chip: 'bg-brand-soft text-brand-ink' },
  event: { label: 'Event', icon: CalendarDays, chip: neutral },
  ptm: { label: 'Parent–teacher meeting', icon: Users, chip: neutral },
  sports: { label: 'Sports', icon: Trophy, chip: neutral },
  exam: { label: 'Exam', icon: ClipboardList, chip: 'bg-warning-soft text-warning' },
  exam_paper: { label: 'Exam paper', icon: PenLine, chip: 'bg-warning-soft text-warning' },
  homework_due: { label: 'Homework due', icon: NotebookPen, chip: 'bg-surface-sunken text-ink-2' },
  other: { label: 'Other', icon: Info, chip: neutral },
};

export const kindMeta = (k: string): KindMeta => KIND_META[k as CalendarKind] ?? KIND_META.other;

/** Calendar kinds that are backed by an `events` row (and therefore open the event drawer). */
export const EVENT_BACKED: readonly string[] = ['event', 'holiday', 'ptm', 'sports', 'exam', 'other'];

export const EVENT_KIND_OPTIONS = [
  { value: 'all', label: 'All kinds' },
  { value: 'event', label: 'Events' },
  { value: 'holiday', label: 'Holidays' },
  { value: 'ptm', label: 'Parent–teacher meetings' },
  { value: 'sports', label: 'Sports' },
  { value: 'exam', label: 'Exams' },
  { value: 'other', label: 'Other' },
];
