'use client';

import * as React from 'react';
import { Check, Copy, KeyRound } from 'lucide-react';
import type { PlatformSeats } from '@school-sync/shared';
import { Banner } from '@/components/ui/banner';
import { Badge, StatusChip } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { ProgressBar } from '@/components/ui/progress';
import { toast } from '@/components/ui/toaster';
import { cn } from '@/lib/cn';
import { fmtDate } from '@/lib/format';

/** Licence state of a school's subscription as a chip (icon + label, never colour alone). */
export const LicenseChip = ({ state }: { state: string }) => <StatusChip status={state} />;

const TENANT_STATUS: Record<string, { label: string; variant: 'success' | 'danger' | 'neutral' | 'warning' }> = {
  active: { label: 'Live', variant: 'success' },
  suspended: { label: 'Suspended', variant: 'danger' },
  archived: { label: 'Archived', variant: 'neutral' },
  provisioning: { label: 'Setting up', variant: 'warning' },
  failed: { label: 'Setup failed', variant: 'danger' },
};
export function TenantStatusChip({ status }: { status: string }) {
  const s = TENANT_STATUS[status] ?? { label: status, variant: 'neutral' as const };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

export function InvoiceChip({ status, overdue }: { status: string; overdue?: boolean }) {
  if (overdue) return <StatusChip status="overdue" />;
  return <StatusChip status={status === 'issued' ? 'unpaid' : status} label={status === 'issued' ? 'Awaiting payment' : undefined} />;
}

export const KIND_LABEL: Record<string, string> = { seats: 'Seats', true_up: 'True-up', adjustment: 'Adjustment' };

/** "312 of 500" with a bar; says so plainly when the school has not been metered yet or has no seat limit. */
export function SeatsMeter({ seats, className, compact }: { seats: Pick<PlatformSeats, 'used' | 'licensed' | 'overBy' | 'nearLimit'>; className?: string; compact?: boolean }) {
  const { used, licensed, overBy, nearLimit } = seats;
  if (used === null) return <span className={cn('t-caption text-ink-3', className)}>{licensed === null ? 'No seat limit' : `Not metered · ${licensed.toLocaleString()} seats`}</span>;
  if (licensed === null) return <span className={cn('tnum text-sm', className)}>{used.toLocaleString()} <span className="text-ink-3">· no limit</span></span>;
  const tone = overBy > 0 ? 'danger' : nearLimit ? 'warning' : 'brand';
  return (
    <div className={cn('min-w-[8.5rem] space-y-1', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="tnum text-sm font-medium">{used.toLocaleString()}<span className="font-normal text-ink-3"> of {licensed.toLocaleString()}</span></span>
        {overBy > 0 && <span className="t-caption tnum text-danger">+{overBy.toLocaleString()} over</span>}
      </div>
      {!compact && <ProgressBar value={used} max={Math.max(licensed, 1)} tone={tone} label={`${used} of ${licensed} seats used`} />}
    </div>
  );
}

export function PeriodText({ endsOn, daysLeft, state }: { endsOn: string | null; daysLeft: number | null; state: string }) {
  if (!endsOn) return <span className="text-ink-3">No subscription</span>;
  const note = daysLeft === null ? '' : daysLeft < 0 ? (state === 'grace' ? `ended ${-daysLeft} d ago` : `ended ${-daysLeft} d ago`) : daysLeft === 0 ? 'ends today' : `${daysLeft} d left`;
  return (
    <span className="block">
      <span className="tnum">{fmtDate(endsOn, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
      {note && <span className="t-caption block text-ink-2">{note}</span>}
    </span>
  );
}

export function CopyButton({ text, label, size = 'sm' }: { text: string; label: string; size?: 'sm' | 'md' }) {
  const [done, setDone] = React.useState(false);
  return (
    <Button
      variant="secondary"
      size={size}
      aria-label={`Copy ${label}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1800);
        } catch {
          toast.error('Could not copy. Select the text and copy it by hand.');
        }
      }}
    >
      {done ? <Check /> : <Copy />} {done ? 'Copied' : 'Copy'}
    </Button>
  );
}

export interface Secret {
  label: string;
  username: string;
  password: string;
}

/**
 * One-time temporary passwords (new school admin, new operator, operator reset). The API returns them once and stores only a
 * hash, so closing this dialog loses them; it says so, and offers copy buttons.
 */
export function SecretDialog({ open, onOpenChange, title, description, secrets, children }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: string; secrets: Secret[]; children?: React.ReactNode }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} description={description ?? 'Share these with the person now. They must choose a new password the first time they sign in.'} size="lg" onInteractOutside={(e) => e.preventDefault()}>
        <div className="mt-4 space-y-3">
          <Banner tone="warning" title="This password is shown only once">
            We keep only a one-way hash of it, so it cannot be shown again. Copy it before you close this window.
          </Banner>
          {children}
          <ul className="space-y-3">
            {secrets.map((s) => (
              <li key={`${s.label}-${s.username}`} className="rounded-lg border border-border bg-surface-subtle p-3">
                <p className="t-label flex items-center gap-1.5"><KeyRound className="size-3.5 text-ink-3" aria-hidden /> {s.label}</p>
                <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 text-sm">
                  <dt className="t-caption text-ink-2">Username</dt>
                  <dd className="select-all break-all font-mono text-[13px]">{s.username}</dd>
                  <dd><CopyButton text={s.username} label="username" /></dd>
                  <dt className="t-caption text-ink-2">Password</dt>
                  <dd className="select-all break-all font-mono text-[13px]" data-testid="one-time-password">{s.password}</dd>
                  <dd><CopyButton text={s.password} label="password" /></dd>
                </dl>
              </li>
            ))}
          </ul>
        </div>
        <div className="mt-5 flex justify-end">
          <Button onClick={() => onOpenChange(false)}>I have copied it</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Next academic year after "2026-27" → "2027-28". */
export function nextYearName(name: string): string {
  const start = Number(name.slice(0, 4)) + 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}
/** Add whole years to an ISO date (`2027-03-31` + 1 → `2028-03-31`). */
export function addYears(iso: string, n: number): string {
  return `${Number(iso.slice(0, 4)) + n}${iso.slice(4)}`;
}
/** Current April-March academic year, from the browser's clock. */
export function currentAcademicYear(now = new Date()): { name: string; startsOn: string; endsOn: string } {
  const y = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return { name: `${y}-${String((y + 1) % 100).padStart(2, '0')}`, startsOn: `${y}-04-01`, endsOn: `${y + 1}-03-31` };
}
