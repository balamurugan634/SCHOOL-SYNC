'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowRight, CalendarDays, Users } from 'lucide-react';
import type { CalendarItem, HomeworkItem, MeetingItem, ParentDashboard, TimetableDayResponse } from '@school-sync/shared';
import { cn } from '@/lib/cn';
import { dueLabel, fmtClock, fmtDate, fmtDateTime } from '@/lib/format';
import { Badge, StatusChip } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardBody, CardHeader } from '../ui/card';
import { EmptyState } from '../ui/empty-state';

type Announcements = ParentDashboard['announcements'];

/** Cards shared by the parent and student homes. Each takes the exact payload block the API returns. */
export function ViewAll({ href, label = 'View all' }: { href: string; label?: string }) {
  return (
    <Button asChild variant="ghost" size="sm">
      <Link href={href}>
        {label} <ArrowRight />
      </Link>
    </Button>
  );
}

export function TimetableCard({ tt, href, title = 'Today’s classes' }: { tt: TimetableDayResponse; href: string; title?: string }) {
  const entries = tt.entries.filter((e) => !e.isBreak || e.state === 'current');
  return (
    <Card>
      <CardHeader title={title} description={tt.sectionName ? `${tt.sectionName} · ${fmtDate(tt.date, { weekday: 'long', day: 'numeric', month: 'long' })}` : undefined} action={<ViewAll href={href} label="Timetable" />} />
      <CardBody className="pt-3">
        {!tt.isWorkingDay ? (
          <p className="py-2 text-sm text-ink-2">No classes today — it isn’t a working day.</p>
        ) : entries.length === 0 ? (
          <EmptyState compact illustration="empty-events" title="No classes scheduled today" />
        ) : (
          <ol className="-mx-2">
            {entries.map((e) => {
              const now = e.state === 'current';
              return (
                <li key={e.periodId} className={cn('flex items-center gap-3 rounded-md px-2 py-2', now && 'bg-brand-soft', e.state === 'past' && 'text-ink-3')}>
                  <span className="tnum w-[88px] shrink-0 text-[13px] text-ink-2">
                    {fmtClock(e.startTime)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={cn('truncate text-sm', now ? 'font-semibold text-brand-ink' : 'font-medium')}>{e.isBreak ? e.periodName : (e.subjectName ?? e.periodName)}</p>
                    {!e.isBreak && (e.teacherName || e.room) && (
                      <p className="t-caption truncate text-ink-3">
                        {[e.teacherName, e.room].filter(Boolean).join(' · ')}
                        {e.substituted ? ' · substitute' : ''}
                      </p>
                    )}
                  </div>
                  {now && <Badge variant="accent">Now</Badge>}
                  {tt.next?.periodId === e.periodId && !now && <Badge variant="outline">Next</Badge>}
                </li>
              );
            })}
          </ol>
        )}
      </CardBody>
    </Card>
  );
}

export function HomeworkCard({ hw, href, empty = 'Nothing due — all caught up.' }: { hw: { pendingCount: number; overdueCount: number; items: HomeworkItem[] }; href: string; empty?: string }) {
  const items = hw.items.slice(0, 5);
  return (
    <Card>
      <CardHeader title="Homework" description={hw.pendingCount > 0 ? `${hw.pendingCount} to do${hw.overdueCount ? ` · ${hw.overdueCount} overdue` : ''}` : undefined} action={<ViewAll href={href} />} />
      <CardBody className="pt-3">
        {items.length === 0 ? (
          <EmptyState compact illustration="empty-homework" title={empty} />
        ) : (
          <ul className="divide-y divide-border">
            {items.map((h) => {
              const due = dueLabel(h.dueAt);
              const status = h.learner?.status ?? 'pending';
              return (
                <li key={h.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{h.title}</p>
                    <p className={cn('t-caption truncate', due.overdue && status !== 'submitted' ? 'text-danger' : 'text-ink-2')}>
                      {h.subjectName} · {due.text}
                    </p>
                  </div>
                  <StatusChip status={status === 'pending' && due.overdue ? 'overdue' : status} />
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

export function CalendarCard({ items, href, title = 'Coming up' }: { items: CalendarItem[]; href: string; title?: string }) {
  const list = items.slice(0, 5);
  return (
    <Card>
      <CardHeader title={title} action={<ViewAll href={href} />} />
      <CardBody className="pt-3">
        {list.length === 0 ? (
          <EmptyState compact illustration="empty-events" title="Nothing scheduled" />
        ) : (
          <ul className="divide-y divide-border">
            {list.map((c) => (
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
        )}
      </CardBody>
    </Card>
  );
}

export function MeetingsCard({ meetings, href }: { meetings: MeetingItem[]; href: string }) {
  const list = meetings.slice(0, 3);
  return (
    <Card>
      <CardHeader title="Meetings" action={<ViewAll href={href} label="Manage" />} />
      <CardBody className="pt-3">
        {list.length === 0 ? (
          <div className="flex items-start gap-3 py-1 text-sm text-ink-2">
            <Users className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
            No meetings with teachers are planned.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {list.map((m) => (
              <li key={m.id} className="space-y-1 py-2.5 first:pt-0 last:pb-0">
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 truncate text-sm font-medium">{m.topic}</p>
                  <StatusChip status={m.status} />
                </div>
                <p className="t-caption text-ink-2">
                  {m.teacher.name}
                  {m.scheduledAt ? ` · ${fmtDateTime(m.scheduledAt)}` : m.proposedAt ? ` · proposed ${fmtDateTime(m.proposedAt)}` : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

export function AnnouncementsCard({ a, href }: { a: Announcements; href: string }) {
  const list = a.latest.slice(0, 3);
  return (
    <Card>
      <CardHeader title="Announcements" description={a.unreadCount > 0 ? `${a.unreadCount} unread` : undefined} action={<ViewAll href={href} />} />
      <CardBody className="pt-3">
        {list.length === 0 ? (
          <EmptyState compact illustration="empty-notifications" title="No announcements yet" />
        ) : (
          <ul className="divide-y divide-border">
            {list.map((n) => (
              <li key={n.id} className="py-2.5 first:pt-0 last:pb-0">
                <div className="flex items-start gap-2">
                  {!n.read && <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-brand" aria-hidden />}
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {!n.read && <span className="sr-only">Unread: </span>}
                      <span className="min-w-0 truncate">{n.title}</span>
                      {n.priority === 'urgent' && <Badge variant="danger">Urgent</Badge>}
                      {n.priority === 'important' && <Badge variant="warning">Important</Badge>}
                    </p>
                    <p className="t-caption mt-0.5 line-clamp-2 text-ink-2">{n.body}</p>
                    <p className="t-caption mt-1 text-ink-3">{n.author?.name ? `${n.author.name} · ` : ''}{n.publishAt ? fmtDateTime(n.publishAt) : ''}</p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

