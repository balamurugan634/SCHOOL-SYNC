'use client';

import * as React from 'react';
import Link from 'next/link';
import { AlertTriangle, ChevronRight } from 'lucide-react';
import { useParentDashboard } from '@/lib/client/hooks';
import { errorMessage } from '@/lib/problem';
import { fmtDate, money, moneyCompact, percent, plural } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Banner } from '../ui/banner';
import { Button } from '../ui/button';
import { Card, CardBody, CardHeader } from '../ui/card';
import { EmptyState } from '../ui/empty-state';
import { Reveal, useFirstLoad } from '../ui/reveal';
import { Skeleton } from '../ui/skeleton';
import { StatTile } from '../ui/stat-tile';
import { StatusChip } from '../ui/badge';
import { PageHeader } from '../shell/page-header';
import { AnnouncementsCard, CalendarCard, HomeworkCard, MeetingsCard, TimetableCard } from './learner-blocks';
import { useMe, useMeContext } from '../me-context';

const firstName = (n: string) => n.trim().replace(/^((dr|mr|mrs|ms|miss|prof|sri|shri|smt)\.?\s+)+/i, '').split(/\s+/)[0] || n;

/** Parent home: the selected child's day, attendance, homework, fees due, meetings and announcements (GET /dashboard/parent). */
export function ParentHome() {
  const me = useMe();
  const { childId, base } = useMeContext();
  const q = useParentDashboard(childId);
  const first = useFirstLoad('dash:parent');
  const d = q.data;
  const child = d?.child ?? null;
  const noChildren = !q.isPending && !!d && d.children.length === 0;

  return (
    <>
      <PageHeader
        title="Home"
        description={child ? `Showing ${child.student.name}${child.student.grade ? ` · ${[child.student.grade, child.student.section].filter(Boolean).join(' ')}` : ''}. Use the switcher in the top bar to change child.` : `Welcome back, ${firstName(me.displayName)}.`}
      />

      {q.isError && !d ? (
        <Card>
          <EmptyState illustration="error-offline" title="We couldn’t load your home screen" description={errorMessage(q.error)} action={<Button variant="secondary" onClick={() => void q.refetch()}>Try again</Button>} />
        </Card>
      ) : noChildren ? (
        <div className="space-y-6">
          <Card>
            <EmptyState illustration="first-use" title="No children are linked to your account yet" description="The school links each parent to their children after verifying the relationship. If you expected to see a child here, please contact the school office." />
          </Card>
          {d && (d.announcements.latest.length > 0 || d.meetings.length > 0) && (
            <div className="grid gap-6 lg:grid-cols-2">
              <AnnouncementsCard a={d.announcements} href={`${base}/communication`} />
              <MeetingsCard meetings={d.meetings} href={`${base}/communication`} />
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {d && d.pendingLeaveCount > 0 && (
            <Banner tone="info">
              {plural(d.pendingLeaveCount, 'leave request')} waiting for the school to respond.
            </Banner>
          )}

          {/* stat row */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {q.isPending || !d || !child ? (
              [0, 1, 2, 3].map((i) => <StatTile key={i} label="Loading" state="loading" />)
            ) : (
              <>
                <Reveal first={first} index={0}>
                  <div className="h-full rounded-lg border border-border bg-surface p-4 shadow-card sm:p-5">
                    <p className="t-caption text-ink-2">Today’s attendance</p>
                    <div className="mt-2 flex min-h-10 items-center">{child.attendanceToday ? <StatusChip status={child.attendanceToday} /> : <span className="text-sm text-ink-2">Not marked yet</span>}</div>
                  </div>
                </Reveal>
                <Reveal first={first} index={1}>
                  <StatTile label="Attendance this year" value={percent(child.attendance?.totals.percentage)} hint={child.attendance?.shortage.isShort ? `Below the ${child.attendance.shortage.thresholdPercent}% requirement` : child.attendance ? `${plural(child.attendance.totals.absent, 'absence')}` : undefined} delta={child.attendance?.shortage.isShort ? { value: 'Shortage', direction: 'down', good: false } : null} />
                </Reveal>
                <Reveal first={first} index={2}>
                  <StatTile label="Homework to do" value={child.homework.pendingCount} hint={child.homework.overdueCount > 0 ? `${child.homework.overdueCount} overdue` : 'None overdue'} />
                </Reveal>
                <Reveal first={first} index={3}>
                  <FeesTile fees={d.fees} href={`${base}/fees`} />
                </Reveal>
              </>
            )}
          </div>

          <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="min-w-0 space-y-6">
              {q.isPending || !child ? (
                <>
                  <Skeleton className="h-72 w-full" />
                  <Skeleton className="h-60 w-full" />
                </>
              ) : (
                <>
                  <Reveal first={first} index={4}><TimetableCard tt={child.timetable} href={`${base}/academics`} title={`${firstName(child.student.name)}’s day`} /></Reveal>
                  <Reveal first={first} index={5}><HomeworkCard hw={child.homework} href={`${base}/academics`} /></Reveal>
                  {child.upcomingExams.length > 0 && (
                    <Card>
                      <CardHeader title="Upcoming exams" />
                      <CardBody className="pt-3">
                        <ul className="divide-y divide-border">
                          {child.upcomingExams.slice(0, 5).map((e, i) => (
                            <li key={`${e.examId}-${i}`} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium">{e.subject}</p>
                                <p className="t-caption text-ink-2">{e.examName}</p>
                              </div>
                              <span className="t-caption shrink-0 text-ink-2">{fmtDate(e.date, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                            </li>
                          ))}
                        </ul>
                      </CardBody>
                    </Card>
                  )}
                </>
              )}
            </div>

            <div className="min-w-0 space-y-6">
              {d?.fees && <FeesCard fees={d.fees} href={`${base}/fees`} />}
              {d && d.children.length > 1 && <AllChildren d={d} />}
              {d && <MeetingsCard meetings={d.meetings} href={`${base}/communication`} />}
              {d && <AnnouncementsCard a={d.announcements} href={`${base}/communication`} />}
              {d && <CalendarCard items={d.calendar} href={`${base}/academics`} />}
              {q.isPending && <Skeleton className="h-56 w-full" />}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function FeesTile({ fees, href }: { fees: NonNullable<ReturnType<typeof useParentDashboard>['data']>['fees']; href: string }) {
  if (!fees) return <StatTile label="Fees due" value="—" hint="No fees to show" />;
  const cur = fees.currency;
  return (
    <Link href={href} className="block h-full rounded-lg focus-visible:outline-offset-2">
      <div className="tr-colors h-full rounded-lg border border-border bg-surface p-4 shadow-card hover:border-border-strong hover:shadow-card-hover sm:p-5">
        <p className="t-caption text-ink-2">Fees due</p>
        <p className={cn('figure mt-1.5 text-[32px] leading-10', fees.overdueMinor > 0 && 'text-danger')} title={money(fees.outstandingMinor, cur)}>
          {moneyCompact(fees.outstandingMinor, cur)}
        </p>
        <p className="t-caption mt-1 flex items-center gap-1 text-ink-2">
          {fees.overdueCount > 0 ? <><AlertTriangle className="size-3.5 text-danger" aria-hidden /> {plural(fees.overdueCount, 'invoice')} overdue</> : 'View fees'}
          <ChevronRight className="ml-auto size-3.5 text-ink-3" aria-hidden />
        </p>
      </div>
    </Link>
  );
}

function FeesCard({ fees, href }: { fees: NonNullable<NonNullable<ReturnType<typeof useParentDashboard>['data']>['fees']>; href: string }) {
  const cur = fees.currency;
  return (
    <Card>
      <CardHeader title="Fees" />
      <CardBody className="space-y-4 pt-3">
        <dl className="grid grid-cols-2 gap-4">
          <div>
            <dt className="t-caption text-ink-2">Outstanding</dt>
            <dd className="figure text-[26px] leading-8">{money(fees.outstandingMinor, cur)}</dd>
          </div>
          <div>
            <dt className="t-caption text-ink-2">Overdue</dt>
            <dd className={cn('figure text-[26px] leading-8', fees.overdueMinor > 0 && 'text-danger')}>{money(fees.overdueMinor, cur)}</dd>
          </div>
        </dl>
        {fees.nextDue ? (
          <div className="rounded-md bg-surface-subtle p-3">
            <p className="t-caption text-ink-2">Next due · {fmtDate(fees.nextDue.dueDate, { day: 'numeric', month: 'short', year: 'numeric' })}</p>
            <p className="mt-0.5 text-sm font-medium">{fees.nextDue.title}</p>
            <p className="t-caption text-ink-2">{fees.nextDue.studentName} · {money(fees.nextDue.balanceMinor, cur)}</p>
          </div>
        ) : (
          <p className="text-sm text-ink-2">No fees are due right now.</p>
        )}
        <Button asChild className="w-full">
          <Link href={href}>View fees</Link>
        </Button>
      </CardBody>
    </Card>
  );
}

function AllChildren({ d }: { d: NonNullable<ReturnType<typeof useParentDashboard>['data']> }) {
  const { setChildId, childId } = useMeContext();
  return (
    <Card>
      <CardHeader title="All children" />
      <CardBody className="pt-3">
        <ul className="divide-y divide-border">
          {d.children.map((c) => (
            <li key={c.student.id} className="py-2 first:pt-0 last:pb-0">
              <button type="button" onClick={() => setChildId(c.student.id)} aria-pressed={c.student.id === (childId ?? d.selectedStudentId)} className={cn('tr-colors -mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-surface-subtle', c.student.id === d.selectedStudentId && 'bg-brand-soft')}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{c.student.name}</span>
                  <span className="t-caption block text-ink-2">{[c.student.grade, c.student.section].filter(Boolean).join(' ')} · {percent(c.attendancePercentage)} attendance</span>
                </span>
                {c.attendanceToday && <StatusChip status={c.attendanceToday} />}
              </button>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
