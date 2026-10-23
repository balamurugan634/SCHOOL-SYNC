'use client';

import * as React from 'react';
import { useLicense, type License } from '@/lib/client/queries';
import { ApiError } from '@/lib/problem';
import { cn } from '@/lib/cn';
import { Banner } from '../ui/banner';
import { Button } from '../ui/button';
import { Card, CardBody, CardHeader } from '../ui/card';
import { Skeleton } from '../ui/skeleton';
import { StatusChip } from '../ui/badge';

const fmtDate = (s: string | null) => (s ? new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${s}T00:00:00`)) : '—');
const money = (minor: number, currency: string) => {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: minor % 100 === 0 ? 0 : 2 }).format(minor / 100);
  } catch {
    return `${currency} ${(minor / 100).toFixed(2)}`;
  }
};

const STATE_COPY: Record<License['state'], string> = {
  unlicensed: 'No subscription is set up for this school yet.',
  trial: 'This school is on a trial. Add a subscription before it ends.',
  active: 'The subscription is active.',
  grace: 'The subscription period has ended. The school is in a grace period — renew to avoid read-only mode.',
  expired: 'The subscription has expired and the school is in read-only mode.',
  cancelled: 'The subscription was cancelled.',
};

export function LicenseCard({ className, data }: { className?: string; /** pass the licence block of a dashboard to avoid a second request */ data?: License | null }) {
  const own = useLicense(!data);
  const q = data ? { isPending: false, isError: false, data, error: null, refetch: () => Promise.resolve() } : own;

  if (q.isPending) {
    return (
      <Card className={className}>
        <CardHeader title="Subscription" />
        <CardBody className="space-y-3">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-2 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </CardBody>
      </Card>
    );
  }
  if (q.isError) {
    const forbidden = q.error instanceof ApiError && q.error.status === 403;
    return (
      <Card className={className}>
        <CardHeader title="Subscription" />
        <CardBody>
          <Banner tone={forbidden ? 'info' : 'danger'}>{forbidden ? 'Only school administrators can see subscription details.' : 'We could not load the subscription details.'}</Banner>
          {!forbidden && (
            <Button variant="secondary" size="sm" className="mt-3" onClick={() => q.refetch()}>
              Try again
            </Button>
          )}
        </CardBody>
      </Card>
    );
  }

  const l = q.data;
  const { used, licensed, remaining, nearLimit, overBy } = l.seats;
  const pct = licensed ? Math.min(1, used / licensed) : 0;
  const barColor = overBy > 0 ? 'bg-danger' : nearLimit ? 'bg-warning' : 'bg-primary';
  const rows: [string, string][] = [
    ['Academic year', l.academicYear ?? '—'],
    ['Period', `${fmtDate(l.startsOn)} – ${fmtDate(l.endsOn)}`],
    [l.state === 'grace' ? 'Grace period ends' : 'Days left', l.state === 'grace' ? fmtDate(l.graceEndsOn) : l.daysLeft === null ? '—' : l.daysLeft < 0 ? 'Ended' : `${l.daysLeft} day${l.daysLeft === 1 ? '' : 's'}`],
  ];
  if (l.pricePerStudentMinor !== null && l.currency) rows.push(['Price per student, per year', money(l.pricePerStudentMinor, l.currency)]);

  return (
    <Card className={className}>
      <CardHeader title="Subscription" description="Priced per student, per academic year" action={<StatusChip status={l.state} />} />
      <CardBody className="space-y-4">
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-xs text-muted-foreground">Student seats used</p>
            <p className="tnum text-xs text-muted-foreground">{licensed === null ? 'No limit' : `${remaining?.toLocaleString() ?? 0} left`}</p>
          </div>
          <p className="mt-1 text-2xl font-semibold leading-8">
            <span className="tnum">{used.toLocaleString()}</span>
            {licensed !== null && <span className="tnum text-base font-normal text-muted-foreground"> of {licensed.toLocaleString()}</span>}
          </p>
          {licensed !== null && (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-label="Seats used" aria-valuemin={0} aria-valuemax={licensed} aria-valuenow={Math.min(used, licensed)}>
              <div className={cn('h-full rounded-full', barColor)} style={{ width: `${pct * 100}%` }} />
            </div>
          )}
        </div>

        {overBy > 0 && (
          <Banner tone="danger" title={`${overBy.toLocaleString()} seat${overBy === 1 ? '' : 's'} over the licence`}>
            {l.overagePolicy === 'block' ? 'New students cannot be added until more seats are licensed.' : 'The extra seats are billed under the school’s overage policy.'}
          </Banner>
        )}
        {overBy === 0 && nearLimit && (
          <Banner tone="warning" title="Close to the seat limit">
            Only {remaining?.toLocaleString()} seat{remaining === 1 ? '' : 's'} left. Add more seats before admissions open.
          </Banner>
        )}

        <dl className="divide-y divide-border border-y border-border text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-4 py-2">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="text-right font-medium">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="text-[13px] text-muted-foreground">{STATE_COPY[l.state]}</p>
      </CardBody>
    </Card>
  );
}
