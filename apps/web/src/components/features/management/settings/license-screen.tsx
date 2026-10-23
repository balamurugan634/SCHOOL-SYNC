'use client';

import * as React from 'react';
import Link from 'next/link';
import type { License } from '@/lib/client/queries';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { StatusChip } from '@/components/ui/badge';
import { ProgressBar } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { StatTile } from '@/components/ui/stat-tile';
import { PageHeader } from '@/components/shell/page-header';
import { useLicense } from '@/lib/client/queries';
import { fmtDate, money, plural } from '@/lib/format';
import { DefList, ErrorPanel, Panel } from '../shared/detail';
import { paths } from '../shared/paths';

const STATE_COPY: Record<License['state'], { tone: 'info' | 'success' | 'warning' | 'danger' | 'locked'; title: string; body: string }> = {
  unlicensed: { tone: 'warning', title: 'No subscription yet', body: 'This school has no subscription for the current academic year. Contact the SchoolSync platform operator to set one up.' },
  trial: { tone: 'info', title: 'Trial', body: 'The school is on a trial. Add a subscription before it ends to keep everything working.' },
  active: { tone: 'success', title: 'Subscription active', body: 'Everything is working. Renewal is arranged with the SchoolSync platform operator before the period ends.' },
  grace: { tone: 'warning', title: 'Grace period', body: 'The subscription period has ended. The school keeps working during the grace period; renew before it ends to avoid read-only mode.' },
  expired: { tone: 'locked', title: 'Subscription expired: read-only mode', body: 'People can still view information, but every change is refused until the subscription is renewed. Contact the SchoolSync platform operator.' },
  cancelled: { tone: 'locked', title: 'Subscription cancelled', body: 'The subscription was cancelled, so the school is read-only. Contact the SchoolSync platform operator to reactivate it.' },
};

/** Licence and seat usage (GET /license): period, seats used vs licensed, price, and what happens at the limit. */
export function LicenseScreen() {
  const q = useLicense();
  const l = q.data;
  return (
    <>
      <PageHeader title="Subscription and seats" description="SchoolSync is priced per student, per academic year. Seats are counted from the students on your roll." crumbs={[{ label: 'Home', href: '/admin' }, { label: 'Settings and access' }, { label: 'Subscription' }]} />
      {q.isPending ? (
        <div className="space-y-4" aria-busy aria-label="Loading subscription">
          <div className="grid gap-4 sm:grid-cols-3">
            {[0, 1, 2].map((i) => <StatTile key={i} label="Loading" state="loading" />)}
          </div>
          <Skeleton className="h-64 w-full rounded-lg" />
        </div>
      ) : q.isError || !l ? (
        <ErrorPanel error={q.error} onRetry={() => void q.refetch()} title="We couldn’t load the subscription" />
      ) : (
        <Loaded l={l} />
      )}
    </>
  );
}

function Loaded({ l }: { l: License }) {
  const copy = STATE_COPY[l.state];
  const { used, licensed, remaining, nearLimit, overBy } = l.seats;
  const daysText = l.daysLeft === null ? '—' : l.daysLeft < 0 ? 'Ended' : plural(l.daysLeft, 'day');
  const tone = overBy > 0 ? 'danger' : nearLimit ? 'warning' : 'brand';
  const annual = l.pricePerStudentMinor !== null && l.currency && licensed ? money(l.pricePerStudentMinor * licensed, l.currency) : null;
  return (
    <div className="space-y-6">
      <Banner tone={copy.tone} title={copy.title}>{copy.body}</Banner>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Students on the roll" value={used} hint="Each uses one seat" />
        <StatTile label="Seats licensed" value={licensed ?? '—'} hint={licensed === null ? 'No limit set' : undefined} />
        <StatTile label={overBy > 0 ? 'Over the limit by' : 'Seats remaining'} value={overBy > 0 ? overBy : (remaining ?? '—')} />
        <StatTile label={l.state === 'grace' ? 'Grace period ends' : 'Time left'} value={l.state === 'grace' ? fmtDate(l.graceEndsOn, { day: 'numeric', month: 'short' }) : daysText} hint={l.endsOn ? `Period ends ${fmtDate(l.endsOn)}` : undefined} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Seat usage" description={l.academicYear ? `Academic year ${l.academicYear}` : undefined} actions={<StatusChip status={l.state === 'cancelled' ? 'suspended' : l.state} />} bodyClassName="space-y-4">
          {licensed ? (
            <>
              <div>
                <div className="mb-2 flex items-baseline justify-between gap-2 text-sm">
                  <span><span className="figure text-2xl">{used.toLocaleString()}</span> of {licensed.toLocaleString()} seats used</span>
                  <span className="t-caption text-ink-2">{Math.round((used / licensed) * 100)}%</span>
                </div>
                <ProgressBar value={used} max={licensed} tone={tone} label={`${used} of ${licensed} seats used`} />
              </div>
              {overBy > 0 && <Banner tone="danger">The roll is {plural(overBy, 'student')} over the licensed seats. {l.overagePolicy === 'allow_and_bill' ? 'Extra students are still admitted and billed at the end of the period.' : 'New students cannot be added until you add seats or archive students.'}</Banner>}
              {overBy === 0 && nearLimit && <Banner tone="warning">Only {plural(remaining ?? 0, 'seat')} left. Ask the platform operator to add seats before the next admissions or import.</Banner>}
            </>
          ) : (
            <p className="text-sm text-ink-2">No seat limit is set for this period.</p>
          )}
          <p className="t-caption text-ink-2">
            When the limit is reached: {l.overagePolicy === 'allow_and_bill' ? 'new students are still admitted and the extra seats are billed in a true-up at the end of the period.' : 'adding or importing students is refused until seats are added or students are archived.'}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="secondary"><Link href={paths.students()}>View students</Link></Button>
            <Button asChild size="sm" variant="ghost"><Link href={paths.studentImport}>Import students</Link></Button>
          </div>
        </Panel>

        <Panel title="Subscription period" bodyClassName="space-y-5">
          <DefList
            items={[
              { label: 'Academic year', value: l.academicYear },
              { label: 'Starts', value: fmtDate(l.startsOn) },
              { label: 'Ends', value: fmtDate(l.endsOn) },
              { label: 'Grace period ends', value: fmtDate(l.graceEndsOn) },
              { label: 'Price per student', value: l.pricePerStudentMinor !== null && l.currency ? `${money(l.pricePerStudentMinor, l.currency)} a year` : null },
              { label: 'Licensed total', value: annual ? `${annual} a year for ${plural(licensed ?? 0, 'seat')}` : null },
              { label: 'When seats run out', value: l.overagePolicy === 'allow_and_bill' ? 'Allow and bill' : 'Block new students' },
            ]}
          />
          <p className="t-caption text-ink-2">Renewals and seat changes are arranged with the SchoolSync platform operator; they cannot be changed from here.</p>
        </Panel>
      </div>
    </div>
  );
}
