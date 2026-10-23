import { CheckCircle2, Clock, Info, Minus, XCircle } from 'lucide-react';
import type { AttendanceStatus } from '@school-sync/shared';

/** One place for how an attendance status looks: icon + label always, colour from the status tokens (design.md §2.4). */
export const STATUS_VIEW: Record<AttendanceStatus, { label: string; icon: typeof Clock; cell: string }> = {
  present: { label: 'Present', icon: CheckCircle2, cell: 'bg-success-soft text-success' },
  late: { label: 'Late', icon: Clock, cell: 'bg-warning-soft text-warning' },
  absent: { label: 'Absent', icon: XCircle, cell: 'bg-danger-soft text-danger' },
  leave: { label: 'On leave', icon: Info, cell: 'bg-brand-soft text-brand-ink' },
  half_day: { label: 'Half day', icon: Minus, cell: 'border border-warning bg-surface text-warning' },
};

export const STATUS_ORDER: AttendanceStatus[] = ['present', 'late', 'half_day', 'leave', 'absent'];
/** When a day has several records (period mode) the day shows the most notable one. */
export const SEVERITY: Record<AttendanceStatus, number> = { absent: 4, half_day: 3, late: 2, leave: 1, present: 0 };
