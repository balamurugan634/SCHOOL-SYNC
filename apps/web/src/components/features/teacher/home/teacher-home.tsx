'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowRight, CalendarDays, CheckCircle2, ClipboardCheck, Megaphone, Users } from 'lucide-react';
import type { TeacherDashboard, TimetableEntry } from '@school-sync/shared';
import { cn } from '@/lib/cn';
import { dueLabel, fmtClock, fmtDate, fmtDateTime, plural } from '@/lib/format';
import { useTeacherDashboard, useTeacherScope } from '@/lib/client/teacher';
import { teacherError } from '@/lib/client/teacher-errors';
import { Badge, StatusChip } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ProgressBar } from '@/components/ui/progress';
import { Reveal, useFirstLoad } from '@/components/ui/reveal';
import { Skeleton } from '@/components/ui/skeleton';
import { StatTile } from '@/components/ui/stat-tile';
import { JoinFor } from '../../online-meeting/online-meeting';
import { PageHeader } from '@/components/shell/page-header';
import { useMe, useMeContext } from '@/components/me-context';

/** "Dr. Meenakshi Raman" → "Meenakshi" (honorifics are skipped). */
const firstName = (n: string) => n.trim().replace(/^((dr|mr|mrs|ms|miss|prof|sri|shri|smt)\.?\s+)+/i, '').split(/\s+/)[0] || n;
const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};

type D = TeacherDashboard;

function Block({ title, description, href, label = 'View all', children, className }: { title: string; description?: React.ReactNode; href?: string; label?: string; children: React.ReactNode; className?: string }) {
  return (
    <Card className={className}>
      <CardHeader
        title={title}
        description={description}
        action={
          href && (
            <Button asChild variant="ghost" size="sm">
              <Link href={href}>
                {label} <ArrowRight />
              </Link>
            </Button>
          )
        }
      />
      <CardBody className="pt-3">{children}</CardBody>
    </Card>
  );
}

function BlockSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <Card>
      <div className="space-y-3 p-5" aria-busy>
        <Skeleton className="h-5 w-40" />
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    </Card>
  );
}

/** The teacher's home: what to do next, in the order a school day goes. Every block is the exact payload the API returns. */
export function TeacherHomeScreen() {
  const q = useTeacherDashboard();
  const me = useMe();
  const { base } = useMeContext();
  const scope = useTeacherScope();
  const first = useFirstLoad('dash:teacher');
  const d = q.data;

  return (
    <>
      <PageHeader title={`${greeting()}, ${firstName(me.displayName)}`} description={d ? `${fmtDate(d.date, { weekday: 'long', day: 'numeric', month: 'long' })}${d.staff.designation ? ` · ${d.staff.designation}` : ''}` : 'Here is what needs you today.'} />

      {q.isError && !d ? (
        <Card>
          <EmptyState illustration="error-offline" title="We couldn’t load your day" description={teacherError(q.error)} action={<Button variant="secondary" onClick={() => void q.refetch()}>Try again</Button>} />
        </Card>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {q.isPending || !d ? (
              [0, 1, 2, 3].map((i) => <StatTile key={i} label="Loading" state="loading" />)
            ) : (
              <>
                <Reveal first={first} index={0}>
                  <TileLink href={`${base}/attendance`} label="Attendance to mark">
                    <StatTile label="Attendance to mark" value={d.attendance.isWorkingDay ? d.attendance.pendingCount : '—'} hint={d.attendance.isWorkingDay ? (d.attendance.items.length === 0 ? 'No classes today' : d.attendance.pendingCount === 0 ? 'All marked' : `of ${plural(d.attendance.items.length, d.attendance.mode === 'period' ? 'period' : 'class', d.attendance.mode === 'period' ? 'periods' : 'classes')}`) : 'Not a school day'} />
                  </TileLink>
                </Reveal>
                <Reveal first={first} index={1}>
                  <TileLink href={`${base}/homework`} label="Homework to review">
                    <StatTile label="Homework to review" value={d.homework.toReviewCount} hint={d.homework.toReviewCount === 1 ? 'submission waiting' : 'submissions waiting'} />
                  </TileLink>
                </Reveal>
                <Reveal first={first} index={2}>
                  <TileLink href={`${base}/marks`} label="Marks to enter">
                    <StatTile label="Marks to enter" value={d.marks.pendingCount} hint={d.marks.returnedCount > 0 ? `${d.marks.returnedCount} sent back to you` : 'mark sheets'} />
                  </TileLink>
                </Reveal>
                <Reveal first={first} index={3}>
                  {scope.isClassTeacher ? (
                    <TileLink href={`${base}/attendance/leave`} label="Leave to decide">
                      <StatTile label="Leave to decide" value={d.pendingLeaveCount} hint={d.pendingLeaveCount === 1 ? 'request in your class' : 'requests in your class'} />
                    </TileLink>
                  ) : (
                    <TileLink href={`${base}/messages/meetings`} label="Meetings">
                      <StatTile label="Meetings ahead" value={d.meetings.length} hint="requests and bookings" />
                    </TileLink>
                  )}
                </Reveal>
              </>
            )}
          </div>

          {/* phones: one column ordered by what matters first; desktop: 8 + 4 columns */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="contents lg:flex lg:flex-col lg:gap-6">
              <div className="order-1 lg:order-none">{d ? <AttendanceBlock d={d} base={base} /> : <BlockSkeleton />}</div>
              <div className="order-2 lg:order-none">{d ? <TimetableBlock d={d} base={base} /> : <BlockSkeleton rows={5} />}</div>
              <div className="order-3 lg:order-none">{d ? <HomeworkBlock d={d} base={base} /> : <BlockSkeleton />}</div>
              {d && d.calendar.length > 0 && (
                <div className="order-7 lg:order-none">
                  <CalendarBlock d={d} />
                </div>
              )}
            </div>
            <div className="contents lg:flex lg:flex-col lg:gap-6">
              <div className="order-4 lg:order-none">{d ? <MarksBlock d={d} base={base} /> : <BlockSkeleton />}</div>
              {scope.isClassTeacher && d && (
                <div className="order-5 lg:order-none">
                  <LeaveBlock d={d} base={base} />
                </div>
              )}
              <div className="order-6 lg:order-none">{d ? <MeetingsBlock d={d} base={base} /> : <BlockSkeleton />}</div>
              <div className="order-8 lg:order-none">{d ? <AnnouncementsBlock d={d} base={base} /> : <BlockSkeleton />}</div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function TileLink({ href, label, children }: { href: string; label: string; children: React.ReactNode }) {
  return (
    <Link href={href} aria-label={`${label}: open`} className="block rounded-lg transition-transform duration-150 hover:-translate-y-px">
      {children}
    </Link>
  );
}

/* ───────────────────────── attendance ───────────────────────── */

function AttendanceBlock({ d, base }: { d: D; base: string }) {
  const a = d.attendance;
  const period = a.mode === 'period';
  return (
    <Block title="Attendance" description={a.isWorkingDay ? (a.items.length > 0 ? (a.pendingCount > 0 ? `${a.pendingCount} of ${a.items.length} not yet marked` : 'Everything is marked for today') : undefined) : undefined} href={`${base}/attendance`} label="Roll call">
      {!a.isWorkingDay ? (
        <p className="py-1 text-sm text-ink-2">{a.holiday ? `Holiday: ${a.holiday}.` : 'Today is not a school day.'} No attendance is expected.</p>
      ) : a.items.length === 0 ? (
        <EmptyState compact illustration="empty-generic" title="No attendance to take today" description="You aren’t down to take a roll call. If that looks wrong, ask the school office." />
      ) : (
        <ul className="divide-y divide-border">
          {a.items.map((i) => (
            <li key={`${i.sectionId}:${i.periodId ?? ''}`} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {i.sectionName}
                  {period && i.periodName ? ` · ${i.periodName}` : ''}
                  {period && i.subjectName ? ` · ${i.subjectName}` : ''}
                </p>
                <p className="t-caption text-ink-2">
                  {i.marked && i.counts ? `${i.counts.present} present · ${i.counts.absent} absent${i.counts.late ? ` · ${i.counts.late} late` : ''}` : i.sessionStatus === 'draft' ? `Draft saved · ${plural(i.strength, 'student')}` : plural(i.strength, 'student')}
                </p>
              </div>
              {i.marked ? (
                <>
                  <span className="inline-flex items-center gap-1 text-[13px] text-success">
                    <CheckCircle2 className="size-4" aria-hidden /> Marked
                  </span>
                  <Button asChild variant="ghost" size="sm">
                    <Link href={`${base}/attendance?class=${i.sectionId}:${i.periodId ?? ''}`}>Edit</Link>
                  </Button>
                </>
              ) : (
                <Button asChild size="sm">
                  <Link href={`${base}/attendance?class=${i.sectionId}:${i.periodId ?? ''}`}>
                    <ClipboardCheck /> Take attendance
                  </Link>
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Block>
  );
}

/* ───────────────────────── timetable ───────────────────────── */

function TimetableBlock({ d, base }: { d: D; base: string }) {
  const tt = d.timetable;
  const entries = tt.entries.filter((e) => !e.isBreak || e.state === 'current');
  return (
    <Block title="Today’s lessons" description={tt.isWorkingDay ? (entries.length > 0 ? `${plural(entries.filter((e) => e.relation !== 'covered').length, 'lesson')}${tt.now ? ` · school time ${fmtClock(tt.now)}` : ''}` : undefined) : undefined} href={`${base}/timetable`} label="My week">
      {!tt.isWorkingDay ? (
        <p className="py-1 text-sm text-ink-2">No lessons today. It isn’t a school day.</p>
      ) : entries.length === 0 ? (
        <EmptyState compact illustration="empty-events" title="No lessons on your timetable today" />
      ) : (
        <ol className="-mx-2" aria-label="Lessons today">
          {entries.map((e) => (
            <LessonRow key={e.periodId} e={e} isNext={tt.next?.periodId === e.periodId && e.state !== 'current'} />
          ))}
        </ol>
      )}
    </Block>
  );
}

function LessonRow({ e, isNext }: { e: TimetableEntry; isNext: boolean }) {
  const now = e.state === 'current';
  const covered = e.relation === 'covered';
  return (
    <li className={cn('flex items-center gap-3 rounded-md px-2 py-2', now && 'bg-brand-soft', e.state === 'past' && !now && 'text-ink-3')} aria-current={now ? 'time' : undefined}>
      <span className="tnum w-[84px] shrink-0 text-[13px] text-ink-2">{fmtClock(e.startTime)}</span>
      <div className="min-w-0 flex-1">
        <p className={cn('truncate text-sm', now ? 'font-semibold text-brand-ink' : 'font-medium', covered && 'text-ink-3 line-through decoration-ink-3/60')}>
          {e.isBreak ? e.periodName : (e.subjectName ?? e.periodName)}
          {e.sectionName && !e.isBreak ? ` · ${e.sectionName}` : ''}
        </p>
        <p className="t-caption truncate text-ink-3">
          {covered ? `Covered by ${e.substitution?.substituteTeacherName ?? e.teacherName ?? 'a colleague'}${e.substitution?.reason ? ` · ${e.substitution.reason}` : ''}` : [e.periodName, e.room].filter(Boolean).join(' · ')}
        </p>
      </div>
      {now && <Badge variant="accent">Now</Badge>}
      {isNext && <Badge variant="outline">Next</Badge>}
      {e.relation === 'covering' && <Badge variant="accent">Covering</Badge>}
      {covered && <Badge variant="neutral">Free</Badge>}
    </li>
  );
}

/* ───────────────────────── homework ───────────────────────── */

function HomeworkBlock({ d, base }: { d: D; base: string }) {
  const hw = d.homework;
  return (
    <Block title="Homework" description={hw.toReviewCount > 0 ? `${plural(hw.toReviewCount, 'submission')} to review` : 'Nothing waiting for review'} href={`${base}/homework`}>
      {hw.dueSoon.length === 0 ? (
        <EmptyState
          compact
          illustration="empty-homework"
          title="Nothing of yours is due in the next 3 days"
          action={
            <Button asChild variant="secondary" size="sm">
              <Link href={`${base}/homework/new`}>Set homework</Link>
            </Button>
          }
        />
      ) : (
        <ul className="divide-y divide-border">
          {hw.dueSoon.slice(0, 5).map((h) => {
            const due = dueLabel(h.dueAt);
            const handed = h.stats ? Math.max(0, h.stats.totalStudents - h.stats.missing) : 0;
            const waiting = h.stats ? h.stats.submitted + h.stats.late : 0;
            return (
              <li key={h.id} className="py-2.5 first:pt-0 last:pb-0">
                <Link href={`${base}/homework/${h.id}${waiting > 0 ? '?tab=review' : ''}`} className="-mx-2 block rounded-md px-2 py-1 hover:bg-surface-subtle">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{h.title}</p>
                      <p className="t-caption truncate text-ink-2">
                        {h.gradeName} {h.sectionName} · {h.subjectName} · due {due.text}
                      </p>
                    </div>
                    {waiting > 0 && <Badge variant="accent">{waiting} to review</Badge>}
                  </div>
                  {h.allowSubmission && h.stats && (
                    <div className="mt-1.5 flex items-center gap-3">
                      <ProgressBar className="flex-1" value={handed} max={h.stats.totalStudents} label={`${h.title}: students who handed in`} />
                      <span className="t-caption tnum shrink-0 text-ink-2">
                        {handed} of {h.stats.totalStudents}
                      </span>
                    </div>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Block>
  );
}

/* ───────────────────────── marks ───────────────────────── */

function MarksBlock({ d, base }: { d: D; base: string }) {
  const m = d.marks;
  return (
    <Block title="Marks to enter" description={m.pendingCount > 0 ? `${plural(m.pendingCount, 'sheet')}${m.returnedCount > 0 ? ` · ${m.returnedCount} returned to you` : ''}` : undefined} href={`${base}/marks`}>
      {m.items.length === 0 ? (
        <div className="flex items-start gap-3 py-1 text-sm text-ink-2">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
          No mark sheets are waiting for you.
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {m.items.slice(0, 5).map((s) => (
            <li key={s.sheetId} className="py-2.5 first:pt-0 last:pb-0">
              <Link href={`${base}/marks/sheets/${s.sheetId}`} className="-mx-2 flex items-center gap-3 rounded-md px-2 py-1 hover:bg-surface-subtle">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {s.sectionName} · {s.subject}
                  </p>
                  <p className="t-caption truncate text-ink-2">{s.examName}</p>
                </div>
                <StatusChip status={s.status} />
              </Link>
            </li>
          ))}
          {m.items.length > 5 && <li className="t-caption pt-2.5 text-ink-2">and {m.items.length - 5} more</li>}
        </ul>
      )}
    </Block>
  );
}

/* ───────────────────────── leave (class teachers) ───────────────────────── */

function LeaveBlock({ d, base }: { d: D; base: string }) {
  const n = d.pendingLeaveCount;
  return (
    <Card>
      <CardHeader title="Student leave" description="Requests from your class" />
      <CardBody className="flex items-center justify-between gap-3 pt-3">
        <div>
          <p className="figure text-[32px] leading-10">{n}</p>
          <p className="t-caption text-ink-2">{n === 0 ? 'Nothing waiting for a decision' : n === 1 ? 'request waiting for your decision' : 'requests waiting for your decision'}</p>
        </div>
        <Button asChild variant={n > 0 ? 'primary' : 'secondary'} size="sm">
          <Link href={`${base}/attendance/leave?status=pending`}>{n > 0 ? 'Review' : 'Open'}</Link>
        </Button>
      </CardBody>
    </Card>
  );
}

/* ───────────────────────── meetings ───────────────────────── */

function MeetingsBlock({ d, base }: { d: D; base: string }) {
  const list = d.meetings.slice(0, 3);
  return (
    <Block title="Parent meetings" href={`${base}/messages/meetings`} label="Manage">
      {list.length === 0 ? (
        <div className="flex items-start gap-3 py-1 text-sm text-ink-2">
          <Users className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
          No meetings are booked or waiting for an answer.
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {list.map((m) => (
            <li key={m.id} className="space-y-0.5 py-2.5 first:pt-0 last:pb-0">
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 truncate text-sm font-medium">{m.topic}</p>
                <StatusChip status={m.status} />
              </div>
              <p className="t-caption text-ink-2">
                {m.student.name}
                {m.guardian ? ` · ${m.guardian.name}` : ''}
                {m.scheduledAt ? ` · ${fmtDateTime(m.scheduledAt)}` : m.proposedAt ? ` · wants ${fmtDateTime(m.proposedAt)}` : ''}
              </p>
              {m.status === 'confirmed' && m.onlineMeeting?.status === 'scheduled' && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <JoinFor meeting={m.onlineMeeting} variant="primary" />
                  {m.onlineMeeting.startUrl && (
                    <Button asChild size="sm" variant="secondary">
                      <a href={m.onlineMeeting.startUrl} target="_blank" rel="noopener noreferrer">Start as host</a>
                    </Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Block>
  );
}

/* ───────────────────────── announcements and calendar ───────────────────────── */

function AnnouncementsBlock({ d, base }: { d: D; base: string }) {
  const a = d.announcements;
  return (
    <Block title="Announcements" description={a.unreadCount > 0 ? `${a.unreadCount} unread${a.pendingAckCount > 0 ? ` · ${a.pendingAckCount} need your acknowledgement` : ''}` : undefined} href={`${base}/messages?tab=received`}>
      {a.latest.length === 0 ? (
        <div className="flex items-start gap-3 py-1 text-sm text-ink-2">
          <Megaphone className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
          No announcements right now.
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {a.latest.slice(0, 3).map((n) => (
            <li key={n.id} className="py-2.5 first:pt-0 last:pb-0">
              <Link href={`${base}/messages?tab=received&view=${n.id}`} className="-mx-2 block rounded-md px-2 py-1 hover:bg-surface-subtle">
                <div className="flex items-start justify-between gap-3">
                  <p className={cn('min-w-0 truncate text-sm', n.read ? 'font-medium' : 'font-semibold')}>{n.title}</p>
                  {n.priority !== 'normal' && <Badge variant={n.priority === 'urgent' ? 'danger' : 'warning'}>{n.priority === 'urgent' ? 'Urgent' : 'Important'}</Badge>}
                </div>
                <p className="t-caption text-ink-2">
                  {n.author?.name ?? 'School'} · {fmtDateTime(n.publishAt ?? n.createdAt)}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Block>
  );
}

function CalendarBlock({ d }: { d: D }) {
  return (
    <Card>
      <CardHeader title="Coming up" />
      <CardBody className="pt-3">
        <ul className="divide-y divide-border">
          {d.calendar.slice(0, 5).map((c) => (
            <li key={c.id} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
              <CalendarDays className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{c.title}</p>
                <p className="t-caption text-ink-2">
                  {fmtDate(c.date, { weekday: 'short', day: 'numeric', month: 'short' })}
                  {c.startTime ? `, ${fmtClock(c.startTime)}` : ''}
                  {c.subtitle ? ` · ${c.subtitle}` : ''}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
