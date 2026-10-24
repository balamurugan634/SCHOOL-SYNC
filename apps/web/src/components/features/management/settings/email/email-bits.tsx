'use client';

import * as React from 'react';
import { Ban, CheckCircle2, Clock, Send, XCircle } from 'lucide-react';
import { EMAIL_PROVIDER_PRESETS, EMAIL_QUEUE_STATUS_LABELS, type EmailProvider, type EmailQueueStatus } from '@school-sync/shared';
import { Badge } from '@/components/ui/badge';

const STATUS: Record<EmailQueueStatus, { variant: 'neutral' | 'info' | 'success' | 'danger'; icon: React.ReactNode }> = {
  not_sent: { variant: 'neutral', icon: <Clock aria-hidden /> },
  sending: { variant: 'info', icon: <Send aria-hidden /> },
  sent: { variant: 'success', icon: <CheckCircle2 aria-hidden /> },
  error: { variant: 'danger', icon: <XCircle aria-hidden /> },
  cancelled: { variant: 'neutral', icon: <Ban aria-hidden /> },
};

/** Status chip with the Frappe-style labels (Not Sent · Sending · Sent · Error · Cancelled): icon + text, never colour alone. */
export function QueueStatusBadge({ status }: { status: EmailQueueStatus }) {
  const s = STATUS[status];
  return (
    <Badge variant={s.variant} icon={s.icon}>
      {EMAIL_QUEUE_STATUS_LABELS[status]}
    </Badge>
  );
}

export const priorityLabel = (p: number): string => (p <= 1 ? 'High' : p >= 9 ? 'Bulk' : 'Normal');
export const providerLabel = (p: EmailProvider): string => EMAIL_PROVIDER_PRESETS[p].label;

/** `a@x.org`, or `a@x.org +2` for longer lists. */
export function recipientsText(to: string[], cc: string[] = []): string {
  const all = [...to, ...cc];
  return all.length > 1 ? `${all[0]} +${all.length - 1}` : (all[0] ?? '');
}

export const SECURITY_LABEL = { starttls: 'STARTTLS', ssl: 'SSL/TLS', none: 'None (not encrypted)' } as const;

/** "just now", "5 min ago", "in 3 min", falling back to the date for anything further away. */
export function relativeTime(iso: string, now = Date.now()): string {
  const diff = new Date(iso).getTime() - now;
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60_000);
  if (abs < 45_000) return diff > 0 ? 'in a few seconds' : 'just now';
  if (mins < 60) return diff > 0 ? `in ${mins} min` : `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return diff > 0 ? `in ${hours} h` : `${hours} h ago`;
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

/** True when the instant has already passed (or is within a second of now). */
export const isDue = (iso: string, now = Date.now()): boolean => new Date(iso).getTime() <= now + 1000;
