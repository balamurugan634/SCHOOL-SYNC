'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowRight, BookOpen, Bus, Phone, UserRound } from 'lucide-react';
import type { LibraryIssue, TransportMyBusItem } from '@school-sync/shared';
import { useMyBooks, useMyBus } from '@/lib/client/learner-profile';
import { fmtClock, fmtDate, money, plural } from '@/lib/format';
import { cn } from '@/lib/cn';
import { PageHeader } from '@/components/shell/page-header';
import { Badge, StatusChip } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { MoreNav, useMoreItems } from '../more-nav';
import { FeatureGate } from '../gate';
import { ChildContext, NeedsLearner, QueryView } from '../states';
import { useGates, useLearner } from '../use-learner';
import { useUrlParams } from '../url-state';

// ───────────────────────────── transport ─────────────────────────────

function BusCard({ item, current }: { item: TransportMyBusItem; current?: boolean }) {
  const l = useLearner();
  return (
    <Card>
      <CardHeader title={l.isParent ? item.studentName : 'Your bus'} description={item.allocated ? item.route?.name : undefined} action={item.allocated ? <Badge variant="primary"><Bus /> On the bus</Badge> : <Badge variant="neutral">Not using the bus</Badge>} />
      <CardBody className="pt-4">
        {!item.allocated || !item.route ? (
          <p className="text-sm text-ink-2">{l.isParent ? `${item.studentName} isn’t assigned to a school bus.` : 'You aren’t assigned to a school bus.'} If you need transport, ask the school office.</p>
        ) : (
          <div className="space-y-5">
            <dl className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-lg bg-surface-subtle p-4">
                <dt className="t-caption text-ink-2">Morning pick-up</dt>
                <dd className="figure text-[28px] leading-9">{item.stop?.pickupTime ? fmtClock(item.stop.pickupTime) : '—'}</dd>
                <dd className="t-caption text-ink-2">at {item.stop?.name ?? 'your stop'}</dd>
              </div>
              <div className="rounded-lg bg-surface-subtle p-4">
                <dt className="t-caption text-ink-2">Afternoon drop</dt>
                <dd className="figure text-[28px] leading-9">{item.stop?.dropTime ? fmtClock(item.stop.dropTime) : '—'}</dd>
                <dd className="t-caption text-ink-2">at {item.stop?.name ?? 'your stop'}</dd>
              </div>
            </dl>
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <div><dt className="t-caption text-ink-2">Route</dt><dd className="font-medium">{item.route.name}</dd><dd className="t-caption text-ink-2">Starts {item.route.pickupStartTime ? fmtClock(item.route.pickupStartTime) : '—'} · returns {item.route.dropStartTime ? fmtClock(item.route.dropStartTime) : '—'}</dd></div>
              {item.vehicle && <div><dt className="t-caption text-ink-2">Vehicle</dt><dd className="font-medium">{item.vehicle.registrationNo}</dd>{item.vehicle.model && <dd className="t-caption text-ink-2">{item.vehicle.model}</dd>}</div>}
              {item.driver?.name && (
                <div>
                  <dt className="t-caption text-ink-2">Driver</dt>
                  <dd className="font-medium">{item.driver.name}</dd>
                  {item.driver.phone && <dd><a href={`tel:${item.driver.phone}`} className="inline-flex min-h-8 items-center gap-1.5 text-brand-ink underline-offset-4 hover:underline"><Phone className="size-3.5" aria-hidden /> {item.driver.phone}</a></dd>}
                </div>
              )}
              {item.attendantName && <div><dt className="t-caption text-ink-2">Attendant</dt><dd className="font-medium">{item.attendantName}</dd></div>}
            </dl>
          </div>
        )}
      </CardBody>
      {current && l.kids.length > 1 && <span className="sr-only">Selected child</span>}
    </Card>
  );
}

function BusBody() {
  const l = useLearner();
  const q = useMyBus();
  return (
    <QueryView
      query={q}
      skeleton={<Card><CardBody className="space-y-4" aria-busy="true"><Skeleton className="h-6 w-1/3" /><Skeleton className="h-24 w-full" /><Skeleton className="h-16 w-full" /></CardBody></Card>}
      isEmpty={(d) => d.length === 0}
      empty={<Card><EmptyState illustration="empty-generic" title="No bus information" description="You’ll see the route, stop and timings here once the school assigns a seat." /></Card>}
    >
      {(items) => {
        const sorted = [...items].sort((a, b) => Number(b.studentId === l.studentId) - Number(a.studentId === l.studentId));
        return (
          <div className="space-y-6">
            {sorted.map((it) => (
              <BusCard key={it.studentId} item={it} current={it.studentId === l.studentId} />
            ))}
          </div>
        );
      }}
    </QueryView>
  );
}

export function StudentTransportScreen() {
  return (
    <>
      <PageHeader title="My bus" description="Your route, stop and timings." />
      <MoreNav />
      <FeatureGate feature="transport" perm="transport:view" what="School transport">
        <BusBody />
      </FeatureGate>
    </>
  );
}

export function ParentTransportScreen() {
  return (
    <>
      <PageHeader title="My bus" description="Route, stop, timings and driver contact." />
      <MoreNav />
      <FeatureGate feature="transport" perm="transport:view" what="School transport">
        <NeedsLearner>
          <BusBody />
        </NeedsLearner>
      </FeatureGate>
    </>
  );
}

// ───────────────────────────── library ─────────────────────────────

function BookRow({ b }: { b: LibraryIssue }) {
  const { currency } = useGates();
  const l = useLearner();
  const status = b.status === 'overdue' ? 'overdue' : b.status === 'returned' ? 'completed' : 'active';
  return (
    <li className="flex flex-wrap items-start gap-x-4 gap-y-2 px-5 py-4 max-sm:px-4">
      <BookOpen className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{b.book.title}</p>
        <p className="t-caption text-ink-2">{[b.book.author, b.book.accessionNo].filter(Boolean).join(' · ')}{l.isParent && l.kids.length > 1 ? ` · ${b.borrower.name}` : ''}</p>
        <p className="t-caption mt-1 text-ink-2">
          Borrowed {fmtDate(b.issuedOn)} ·{' '}
          {b.returnedOn ? `returned ${fmtDate(b.returnedOn)}` : <span className={cn(b.status === 'overdue' && 'font-medium text-danger')}>due {fmtDate(b.dueOn)}</span>}
        </p>
        {b.status === 'overdue' && (
          <p className="t-caption mt-1 text-danger">
            {plural(b.daysOverdue, 'day')} overdue · fine so far {money(b.fineMinor, currency)}
          </p>
        )}
        {b.status === 'returned' && b.fineMinor > 0 && <p className="t-caption mt-1 text-ink-2">Fine charged: {money(b.fineMinor, currency)}</p>}
      </div>
      <StatusChip status={status} label={b.status === 'overdue' ? 'Overdue' : b.status === 'returned' ? 'Returned' : 'Borrowed'} />
    </li>
  );
}

function LibraryBody() {
  const l = useLearner();
  const { currency } = useGates();
  const { get, set } = useUrlParams();
  const returned = get('returned') === '1';
  const q = useMyBooks(l.studentId, l.isParent, returned);
  const fines = (q.data ?? []).filter((b) => b.status === 'overdue').reduce((s, b) => s + b.fineMinor, 0);
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 max-sm:px-4">
        <div>
          <p className="t-section">{l.isParent ? `Books ${l.name} has` : 'Books you have'}</p>
          {q.data && <p className="t-caption text-ink-2">{plural(q.data.filter((b) => b.status !== 'returned').length, 'book')} out{fines > 0 ? ` · ${money(fines, currency)} in fines so far` : ''}</p>}
        </div>
        <label className="flex min-h-9 cursor-pointer items-center gap-2 text-sm">
          <Checkbox checked={returned} onCheckedChange={(c) => set({ returned: c === true ? '1' : null })} />
          Show returned books
        </label>
      </div>
      <div className="border-t border-border">
        <QueryView
          query={q}
          skeleton={<div className="space-y-3 p-5" aria-busy="true"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>}
          isEmpty={(d) => d.length === 0}
          empty={<EmptyState illustration="empty-generic" title={returned ? 'No books borrowed yet' : 'No books on loan'} description={returned ? 'Borrowed and returned books will be listed here.' : 'Books borrowed from the school library appear here with their due dates.'} compact />}
        >
          {(rows) => <ul className="divide-y divide-border">{rows.map((b) => <BookRow key={b.id} b={b} />)}</ul>}
        </QueryView>
      </div>
    </Card>
  );
}

export function StudentLibraryScreen() {
  return (
    <>
      <PageHeader title="My books" description="Books you have borrowed from the school library, with due dates." />
      <MoreNav />
      <FeatureGate feature="library" perm="library:view" what="The library">
        <LibraryBody />
      </FeatureGate>
    </>
  );
}

export function ParentLibraryScreen() {
  return (
    <>
      <PageHeader title="My books" description="Books your child has borrowed, due dates and fines." />
      <MoreNav />
      <FeatureGate feature="library" perm="library:view" what="The library">
        <NeedsLearner>
          <ChildContext />
          <LibraryBody />
        </NeedsLearner>
      </FeatureGate>
    </>
  );
}

// ───────────────────────────── parent hub ─────────────────────────────

/** /parent/more — a card for every extra area the school offers this parent. */
export function ParentMoreScreen() {
  const l = useLearner();
  const items = useMoreItems();
  return (
    <>
      <PageHeader title="More" description="Transport, library, record corrections and your own details." />
      <MoreNav />
      {items.length === 0 ? (
        <Card><EmptyState illustration="empty-generic" icon={<UserRound />} title="Nothing more to show" description="The school hasn’t switched on any extra services for your account yet." /></Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {items.map((i) => (
            <li key={i.id}>
              <Link href={`${l.base}${i.href}`} className="group block h-full rounded-lg focus-visible:outline-offset-2">
                <Card interactive className="h-full">
                  <CardBody className="flex items-start gap-3">
                    <i.icon className="mt-0.5 size-5 shrink-0 text-ink-2" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">{i.label}</p>
                      <p className="t-caption mt-0.5 text-ink-2">{i.blurb}</p>
                    </div>
                    <ArrowRight className="mt-0.5 size-4 shrink-0 text-ink-3 transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </CardBody>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
