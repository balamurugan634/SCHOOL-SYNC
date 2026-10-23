import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { AlertTriangle, CheckCircle2, Circle, Clock, Info, Minus, XCircle } from 'lucide-react';
import { cn } from '@/lib/cn';

/** 20 px high, 12/500, soft background + status text + 12 px icon (status is never colour alone). */
export const badgeVariants = cva('inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-1.5 text-xs font-medium leading-none [&_svg]:size-3 [&_svg]:shrink-0', {
  variants: {
    variant: {
      neutral: 'bg-surface-sunken text-ink-2',
      primary: 'bg-brand-soft text-brand-ink',
      success: 'bg-success-soft text-success',
      warning: 'bg-warning-soft text-warning',
      danger: 'bg-danger-soft text-danger',
      info: 'bg-brand-soft text-brand-ink',
      accent: 'bg-accent-soft text-accent-ink',
      outline: 'border border-border-strong text-ink-2',
      'warning-outline': 'border border-warning text-warning',
    },
    size: { sm: '', md: '' },
  },
  defaultVariants: { variant: 'neutral', size: 'md' },
});

export interface BadgeProps extends React.ComponentProps<'span'>, VariantProps<typeof badgeVariants> {
  icon?: React.ReactNode;
  /** kept for call-site compatibility */
  dot?: boolean;
}

export function Badge({ className, variant, size, icon, dot: _dot, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant, size }), className)} {...props}>
      {icon}
      {children}
    </span>
  );
}

type Variant = NonNullable<VariantProps<typeof badgeVariants>['variant']>;
const I = { ok: <CheckCircle2 aria-hidden />, warn: <AlertTriangle aria-hidden />, bad: <XCircle aria-hidden />, info: <Info aria-hidden />, clock: <Clock aria-hidden />, dash: <Minus aria-hidden />, dot: <Circle aria-hidden /> };
const STATUS: Record<string, { label: string; variant: Variant; icon: React.ReactNode }> = {
  // attendance: present success · late warning · absent danger · leave info · half-day warning (outlined)
  present: { label: 'Present', variant: 'success', icon: I.ok },
  late: { label: 'Late', variant: 'warning', icon: I.clock },
  absent: { label: 'Absent', variant: 'danger', icon: I.bad },
  leave: { label: 'On leave', variant: 'info', icon: I.info },
  half_day: { label: 'Half day', variant: 'warning-outline', icon: I.dash },
  pending: { label: 'Pending', variant: 'warning', icon: I.clock },
  confirmed: { label: 'Confirmed', variant: 'success', icon: I.ok },
  approved: { label: 'Approved', variant: 'success', icon: I.ok },
  rejected: { label: 'Rejected', variant: 'danger', icon: I.bad },
  cancelled: { label: 'Cancelled', variant: 'neutral', icon: I.dash },
  draft: { label: 'Draft', variant: 'neutral', icon: I.dot },
  published: { label: 'Published', variant: 'success', icon: I.ok },
  submitted: { label: 'Submitted', variant: 'info', icon: I.ok },
  reviewed: { label: 'Reviewed', variant: 'success', icon: I.ok },
  returned: { label: 'Returned', variant: 'warning', icon: I.warn },
  not_required: { label: 'No submission', variant: 'neutral', icon: I.dash },
  requested: { label: 'Requested', variant: 'warning', icon: I.clock },
  declined: { label: 'Declined', variant: 'neutral', icon: I.dash },
  completed: { label: 'Completed', variant: 'success', icon: I.ok },
  scheduled: { label: 'Scheduled', variant: 'neutral', icon: I.clock },
  // money
  paid: { label: 'Paid', variant: 'success', icon: I.ok },
  unpaid: { label: 'Unpaid', variant: 'neutral', icon: I.dot },
  partial: { label: 'Part paid', variant: 'warning', icon: I.clock },
  overdue: { label: 'Overdue', variant: 'danger', icon: I.warn },
  void: { label: 'Void', variant: 'neutral', icon: I.dash },
  succeeded: { label: 'Succeeded', variant: 'success', icon: I.ok },
  failed: { label: 'Failed', variant: 'danger', icon: I.bad },
  refunded: { label: 'Refunded', variant: 'neutral', icon: I.dash },
  partially_refunded: { label: 'Part refunded', variant: 'neutral', icon: I.dash },
  // account / licence
  active: { label: 'Active', variant: 'success', icon: I.ok },
  trial: { label: 'Trial', variant: 'info', icon: I.info },
  grace: { label: 'Grace period', variant: 'warning', icon: I.clock },
  expired: { label: 'Expired', variant: 'danger', icon: I.bad },
  unlicensed: { label: 'Not licensed', variant: 'neutral', icon: I.dash },
  suspended: { label: 'Suspended', variant: 'danger', icon: I.bad },
  done: { label: 'Done', variant: 'success', icon: I.ok },
  todo: { label: 'To do', variant: 'neutral', icon: I.dot },
  soon: { label: 'Coming online', variant: 'neutral', icon: I.clock },
};

/** A status chip for a known status string; unknown values render neutral with a humanised label. */
export function StatusChip({ status, label, className, size, hideIcon }: { status: string; label?: string; className?: string; size?: 'sm' | 'md'; hideIcon?: boolean }) {
  const s = STATUS[status] ?? { label: status.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()), variant: 'neutral' as Variant, icon: I.dot };
  return (
    <Badge variant={s.variant} size={size} className={className} icon={hideIcon ? undefined : s.icon}>
      {label ?? s.label}
    </Badge>
  );
}
