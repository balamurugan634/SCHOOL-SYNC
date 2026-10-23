'use client';

import * as React from 'react';
import Link from 'next/link';
import { AlertTriangle, CalendarPlus, ChevronRight } from 'lucide-react';
import type { ParentDashboard, StudentDashboard } from '@school-sync/shared';
import { useParentDashboard } from '@/lib/client/hooks';
import { useLearnerInvoice } from '@/lib/client/learner-fees';
import { useStudentDashboard } from '@/lib/client/learner-learning';
import { fmtDate, money, moneyCompact, percent, plural } from '@/lib/format';
import { cn } from '@/lib/cn';
import { PageHeader } from '@/components/shell/page-header';
import { AnnouncementsCard, CalendarCard, HomeworkCard, MeetingsCard, TimetableCard } from '@/components/dashboard/learner-blocks';
import { StatusChip } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Reveal, useFirstLoad } from '@/components/ui/reveal';
import { Skeleton } from '@/components/ui/skeleton';
import { StatTile } from '@/components/ui/stat-tile';
import { useMeContext } from '@/components/me-context';
import { Avatar } from '@/components/ui/avatar';
import { assetUrl } from '@/lib/assets';
import { ErrorState, NoChildState } from '../states';
import { useGates, useLearner } from '../use-learner';
import { PayButton } from '../fees/pay-dialog';
import { ExamsPeekCard, MoreCard, NowNextCard, ResultsPeekCard, TasksPeekCard } from './home-blocks';

/** "Dr. Meenakshi Raman" → "Meenakshi" (honorifics are skipped). */
const firstName = (n: string) => n.trim().replace(/^((dr|mr|mrs|ms|miss|prof|sri|shri|smt)\.?\s+)+/i, '').split(/\s+/)[0] || n;

function HomeSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <span className="sr-only">Loading your home screen…</span>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <StatTile key={i} label="Loading" state="loading" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <Skeleton className="h-36 w-full" />
          <Skeleton className="h-72 w-full" />
          <Skeleton className="h-56 w-full" />
        </div>
        <div className="space-y-6">
          <Skeleton className="h-56 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────── student ─────────────────────────────

export function StudentHomeScreen() {
  const l = useLearner();
  const { me } = useMeContext();
  const q = useStudentDashboard();
  const first = useFirstLoad('dash:student');
  const d = q.data;
  const base = l.base;

  return (
    <>
      <PageHeader title="Home" description={`Welcome back, ${firstName(me.displayName)}.${l.classLabel ? ` ${l.classLabel}.` : ''}`} />
      {q.isPending ? (
        <HomeSkeleton />
      ) : q.isError && !d ? (
        <Card>
          <ErrorState error={q.error} onRetry={() => void q.refetch()} title="We couldn’t load your home screen" />
        </Card>
      ) : d ? (
        <StudentBlocks d={d} base={base} first={first} />
      ) : null}
    </>
  );
}

function StudentBlocks({ d, base, first }: { d: StudentDashboard; base: string; first: boolean }) {
  const att = d.attendance;
  const openTasks = d.tasks.length;
  const overdueTasks = d.tasks.filter((t) => t.overdue).length;
  return (
    <div className="space-y-6">
      {att?.shortage.isShort && (
        <Banner tone="warning" title="Your attendance is below the requirement">
          It is {percent(att.totals.percentage)} and the school expects at least {att.shortage.thresholdPercent}%. <Link href={`${base}/attendance`} className="font-medium text-brand-ink underline-offset-4 hover:underline">See your attendance</Link>
        </Banner>
      )}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Reveal first={first} index={0}>
          <Link href={`${base}/attendance`} className="block h-full rounded-lg focus-visible:outline-offset-2">
            <StatTile className="tr-colors h-full hover:border-border-strong hover:shadow-card-hover" label="Attendance this year" value={percent(att?.totals.percentage)} hint={att ? (d.attendanceToday ? `Today: ${d.attendanceToday.replace('_', ' ')}` : `${plural(att.totals.absent, 'absence')}`) : 'No record yet'} />
          </Link>
        </Reveal>
        <Reveal first={first} index={1}>
          <Link href={`${base}/learning?tab=homework`} className="block h-full rounded-lg focus-visible:outline-offset-2">
            <StatTile className="tr-colors h-full hover:border-border-strong hover:shadow-card-hover" label="Homework to do" value={d.homework.pendingCount} hint={d.homework.overdueCount > 0 ? `${d.homework.overdueCount} overdue` : 'None overdue'} />
          </Link>
        </Reveal>
        <Reveal first={first} index={2}>
          <Link href={`${base}/tasks`} className="block h-full rounded-lg focus-visible:outline-offset-2">
            <StatTile className="tr-colors h-full hover:border-border-strong hover:shadow-card-hover" label="Open tasks" value={openTasks} hint={overdueTasks > 0 ? `${overdueTasks} overdue` : 'Tasks and homework'} />
          </Link>
        </Reveal>
        <Reveal first={first} index={3}>
          <Link href={`${base}/learning?tab=results`} className="block h-full rounded-lg focus-visible:outline-offset-2">
            <StatTile className="tr-colors h-full hover:border-border-strong hover:shadow-card-hover" label="Results available" value={d.publishedResults.length} hint={d.publishedResults[0]?.examName ?? 'None published yet'} />
          </Link>
        </Reveal>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-6">
          <Reveal first={first} index={4}><NowNextCard tt={d.timetable} href={`${base}/learning?tab=timetable`} /></Reveal>
          <Reveal first={first} index={5}><TimetableCard tt={d.timetable} href={`${base}/learning?tab=timetable`} /></Reveal>
          <HomeworkCard hw={d.homework} href={`${base}/learning?tab=homework`} />
          <TasksPeekCard tasks={d.tasks} href={`${base}/tasks`} />
          <ExamsPeekCard exams={d.upcomingExams} href={`${base}/learning?tab=exams`} />
        </div>
        <div className="min-w-0 space-y-6">
          <AnnouncementsCard a={d.announcements} href={`${base}/announcements`} />
          <CalendarCard items={d.calendar} href={`${base}/calendar`} />
          <ResultsPeekCard results={d.publishedResults} href={`${base}/learning?tab=results`} />
          <MoreCard />
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────── parent ─────────────────────────────

export function ParentHomeScreen() {
  const l = useLearner();
  const { me } = useMeContext();
  const q = useParentDashboard(l.studentId, true);
  const first = useFirstLoad('dash:parent');
  const d = q.data;
  const noChildren = !q.isPending && !!d && d.children.length === 0;
  const child = d?.child ?? null;

  return (
    <>
      <PageHeader
        title="Home"
        description={child ? `Showing ${child.student.name}${child.student.grade ? ` · ${[child.student.grade, child.student.section].filter(Boolean).join(' ')}` : ''}.${l.kids.length > 1 ? ' Use the switcher in the top bar to change child.' : ''}` : `Welcome back, ${firstName(me.displayName)}.`}
      />
      {q.isPending && !d ? (
        <HomeSkeleton />
      ) : q.isError && !d ? (
        <Card>
          <ErrorState error={q.error} onRetry={() => void q.refetch()} title="We couldn’t load your home screen" />
        </Card>
      ) : noChildren && d ? (
        <div className="space-y-6">
          <NoChildState />
          {(d.announcements.latest.length > 0 || d.meetings.length > 0) && (
            <div className="grid gap-6 lg:grid-cols-2">
              <AnnouncementsCard a={d.announcements} href={`${l.base}/communication?tab=announcements`} />
              <MeetingsCard meetings={d.meetings} href={`${l.base}/communication?tab=meetings`} />
            </div>
          )}
          <MoreCard href={`${l.base}/more`} />
        </div>
      ) : d ? (
        <ParentBlocks d={d} first={first} fetching={q.isFetching} />
      ) : null}
    </>
  );
}

function ParentBlocks({ d, first, fetching }: { d: ParentDashboard; first: boolean; fetching: boolean }) {
  const l = useLearner();
  const base = l.base;
  const child = d.child;
  const fees = d.fees;
  return (
    <div className={cn('space-y-6', fetching && 'transition-opacity')} aria-busy={fetching || undefined}>
      {d.pendingLeaveCount > 0 && (
        <Banner tone="info" action={<Button asChild variant="secondary" size="sm"><Link href={`${base}/attendance?tab=leave`}>View</Link></Button>}>
          {plural(d.pendingLeaveCount, 'leave request')} waiting for the school to respond.
        </Banner>
      )}
      {child?.attendance?.shortage.isShort && (
        <Banner tone="warning" title="Attendance is below the requirement">
          {child.student.name}’s attendance is {percent(child.attendance.totals.percentage)}; the school expects at least {child.attendance.shortage.thresholdPercent}%.
        </Banner>
      )}

      {d.children.length > 1 && <ChildrenStrip d={d} />}

      {child ? (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Reveal first={first} index={0}>
              <div className="h-full rounded-lg border border-border bg-surface p-4 shadow-card sm:p-5">
                <p className="t-caption text-ink-2">Today’s attendance</p>
                <div className="mt-2 flex min-h-10 items-center">{child.attendanceToday ? <StatusChip status={child.attendanceToday} /> : <span className="text-sm text-ink-2">Not marked yet</span>}</div>
                <Link href={`${base}/attendance?tab=leave`} className="t-caption mt-1 inline-flex items-center gap-1 font-medium text-brand-ink underline-offset-4 hover:underline">
                  <CalendarPlus className="size-3.5" aria-hidden /> Apply for leave
                </Link>
              </div>
            </Reveal>
            <Reveal first={first} index={1}>
              <Link href={`${base}/attendance`} className="block h-full rounded-lg focus-visible:outline-offset-2">
                <StatTile className="tr-colors h-full hover:border-border-strong hover:shadow-card-hover" label="Attendance this year" value={percent(child.attendance?.totals.percentage)} hint={child.attendance ? plural(child.attendance.totals.absent, 'absence') : undefined} delta={child.attendance?.shortage.isShort ? { value: 'Shortage', direction: 'down', good: false } : null} />
              </Link>
            </Reveal>
            <Reveal first={first} index={2}>
              <Link href={`${base}/academics?tab=homework`} className="block h-full rounded-lg focus-visible:outline-offset-2">
                <StatTile className="tr-colors h-full hover:border-border-strong hover:shadow-card-hover" label="Homework to do" value={child.homework.pendingCount} hint={child.homework.overdueCount > 0 ? `${child.homework.overdueCount} overdue` : 'None overdue'} />
              </Link>
            </Reveal>
            <Reveal first={first} index={3}>
              <FeesTile fees={fees} href={`${base}/fees`} />
            </Reveal>
          </div>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="min-w-0 space-y-6">
              <Reveal first={first} index={4}><NowNextCard tt={child.timetable} href={`${base}/academics?tab=timetable`} who={firstName(child.student.name)} /></Reveal>
              <TimetableCard tt={child.timetable} href={`${base}/academics?tab=timetable`} title={`${firstName(child.student.name)}’s day`} />
              <HomeworkCard hw={child.homework} href={`${base}/academics?tab=homework`} empty={`Nothing due for ${firstName(child.student.name)}.`} />
              <ExamsPeekCard exams={child.upcomingExams} href={`${base}/academics?tab=exams`} />
              {child.publishedResults.length > 0 && <ResultsPeekCard results={child.publishedResults} href={`${base}/academics?tab=results`} />}
            </div>
            <div className="min-w-0 space-y-6">
              {fees && <FeesCard fees={fees} href={`${base}/fees`} />}
              <MeetingsCard meetings={d.meetings} href={`${base}/communication?tab=meetings`} />
              <AnnouncementsCard a={d.announcements} href={`${base}/communication?tab=announcements`} />
              <CalendarCard items={d.calendar} href={`${base}/communication?tab=calendar`} />
              <MoreCard href={`${base}/more`} />
            </div>
          </div>
        </>
      ) : (
        <NoChildState />
      )}
    </div>
  );
}

function ChildrenStrip({ d }: { d: ParentDashboard }) {
  const { setChildId, me } = useMeContext();
  const l = useLearner();
  const cur = l.studentId ?? d.selectedStudentId;
  return (
    <section aria-label="Your children">
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {d.children.map((c) => {
          const kid = me.profile.children.find((k) => k.studentId === c.student.id);
          const on = c.student.id === cur;
          return (
            <li key={c.student.id}>
              <button type="button" onClick={() => setChildId(c.student.id)} aria-pressed={on} className={cn('tr-colors flex w-full items-center gap-3 rounded-lg border p-3 text-left shadow-card', on ? 'border-brand/40 bg-brand-soft' : 'border-border bg-surface hover:border-border-strong')}>
                <Avatar name={c.student.name} src={assetUrl(kid?.photoUrl)} size="md" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{c.student.name}</span>
                  <span className="t-caption block truncate text-ink-2">{[c.student.grade, c.student.section].filter(Boolean).join(' ')} · {percent(c.attendancePercentage)} attendance</span>
                  <span className={cn('t-caption block', c.overdueCount > 0 ? 'font-medium text-danger' : 'text-ink-2')}>
                    {c.outstandingMinor > 0 ? `${moneyCompact(c.outstandingMinor)} due${c.overdueCount > 0 ? ` · ${c.overdueCount} overdue` : ''}` : 'No fees due'}
                  </span>
                </span>
                {c.attendanceToday && <StatusChip status={c.attendanceToday} />}
                {on && <span className="sr-only">Selected</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function FeesTile({ fees, href }: { fees: ParentDashboard['fees']; href: string }) {
  const { features, can } = useGates();
  if (!fees || !features.fees || !can('fees:view')) return <StatTile label="Fees due" value="—" hint="No fees to show" />;
  const cur = fees.currency;
  return (
    <Link href={href} className="block h-full rounded-lg focus-visible:outline-offset-2">
      <div className="tr-colors h-full rounded-lg border border-border bg-surface p-4 shadow-card hover:border-border-strong hover:shadow-card-hover sm:p-5">
        <p className="t-caption text-ink-2">Fees due</p>
        <p className={cn('figure mt-1.5 text-[32px] leading-10', fees.overdueMinor > 0 && 'text-danger')} title={money(fees.outstandingMinor, cur)}>
          {moneyCompact(fees.outstandingMinor, cur)}
        </p>
        <p className="t-caption mt-1 flex items-center gap-1 text-ink-2">
          {fees.overdueCount > 0 ? (
            <>
              <AlertTriangle className="size-3.5 text-danger" aria-hidden /> {plural(fees.overdueCount, 'invoice')} overdue
            </>
          ) : (
            'View fees'
          )}
          <ChevronRight className="ml-auto size-3.5 text-ink-3" aria-hidden />
        </p>
      </div>
    </Link>
  );
}

/** Fees block with a "Pay" action: online when the school enabled it, otherwise the invoice (with how to pay at the office). */
function FeesCard({ fees, href }: { fees: NonNullable<ParentDashboard['fees']>; href: string }) {
  const { features, can } = useGates();
  const cur = fees.currency;
  const next = fees.nextDue;
  const online = features.onlinePayments && can('payments:create');
  const inv = useLearnerInvoice(online && next ? next.invoiceId : null);
  if (!features.fees || !can('fees:view')) return null;
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
        {next ? (
          <div className="rounded-md bg-surface-subtle p-3">
            <p className="t-caption text-ink-2">Next due · {fmtDate(next.dueDate, { day: 'numeric', month: 'short', year: 'numeric' })}</p>
            <p className="mt-0.5 text-sm font-medium">{next.title}</p>
            <p className="t-caption text-ink-2">
              {next.studentName} · {money(next.balanceMinor, cur)}
            </p>
          </div>
        ) : (
          <p className="text-sm text-ink-2">No fees are due right now.</p>
        )}
        <div className="flex flex-wrap gap-2">
          {next && online && inv.data && <PayButton invoice={inv.data} size="md" label="Pay" />}
          {next && online && inv.isPending && <Skeleton className="h-9 w-20" />}
          <Button asChild variant={next && online && inv.data ? 'secondary' : 'primary'} className="flex-1">
            <Link href={next ? `${href}/${next.invoiceId}` : href}>{next ? 'View invoice' : 'View fees'}</Link>
          </Button>
        </div>
        {next && !features.onlinePayments && <p className="t-caption text-ink-2">Online payment isn’t switched on at this school — pay at the school office; the receipt appears here.</p>}
      </CardBody>
    </Card>
  );
}
