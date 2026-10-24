'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowRight, BookOpen, CalendarClock, ChevronRight, CircleCheck, DoorOpen, Trophy } from 'lucide-react';
import type { TasksFeedItem, TimetableDayResponse } from '@school-sync/shared';
import { dueLabel, fmtClock, fmtDate, fmtDateTime } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Badge, StatusChip } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ViewAll } from '@/components/dashboard/learner-blocks';
import { useMoreItems } from '../more-nav';
import { useLearner } from '../use-learner';

type Exam = { examId: string; examName: string; subject: string; date: string; startTime: string | null; endTime: string | null; room: string | null };

/** Highlights the lesson happening now, or the next one, so the first thing on the home screen answers "where should I be?" */
export function NowNextCard({ tt, href, who }: { tt: TimetableDayResponse; href: string; who?: string }) {
  const lesson = tt.current ?? tt.next;
  let body: React.ReactNode;
  let tag: React.ReactNode = null;
  if (!tt.isWorkingDay) {
    body = <p className="text-sm text-ink-2">No classes today — it isn’t a school day.</p>;
  } else if (lesson) {
    const now = !!tt.current;
    tag = <Badge variant={now ? 'accent' : 'outline'}>{now ? 'Now' : 'Next'}</Badge>;
    body = (
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <p className="figure text-[26px] leading-8">{lesson.isBreak ? lesson.periodName : (lesson.subjectName ?? lesson.periodName)}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-2">
            <span className="tnum">
              {fmtClock(lesson.startTime)} – {fmtClock(lesson.endTime)}
            </span>
            {!lesson.isBreak && lesson.teacherName && <span>{lesson.teacherName}{lesson.substituted ? ' (cover)' : ''}</span>}
            {!lesson.isBreak && lesson.room && (
              <span className="inline-flex items-center gap-1">
                <DoorOpen className="size-3.5" aria-hidden /> Room {lesson.room}
              </span>
            )}
          </p>
        </div>
      </div>
    );
  } else {
    const any = tt.entries.some((e) => !e.isBreak);
    body = <p className="text-sm text-ink-2">{any ? 'That’s all the classes for today.' : 'No classes are scheduled today.'}</p>;
  }
  return (
    <Card className={cn(tt.current && 'border-brand/30')}>
      <CardHeader title={who ? `${who}’s class right now` : 'Right now'} action={<div className="flex items-center gap-2">{tag}<ViewAll href={href} label="Timetable" /></div>} />
      <CardBody className="pt-3">{body}</CardBody>
    </Card>
  );
}

export function TasksPeekCard({ tasks, href }: { tasks: TasksFeedItem[]; href: string }) {
  const l = useLearner();
  const list = tasks.slice(0, 5);
  return (
    <Card>
      <CardHeader title="My tasks" description={tasks.length > 0 ? `${tasks.length} open${tasks.some((t) => t.overdue) ? ` · ${tasks.filter((t) => t.overdue).length} overdue` : ''}` : undefined} action={<ViewAll href={href} />} />
      <CardBody className="pt-3">
        {list.length === 0 ? (
          <EmptyState compact illustration="empty-homework" title="Nothing to do — enjoy it" />
        ) : (
          <ul className="divide-y divide-border">
            {list.map((t) => {
              const due = t.dueAt ? dueLabel(t.dueAt) : null;
              const to = t.kind === 'homework' ? `${l.base}/learning/homework/${t.id}` : href;
              return (
                <li key={`${t.kind}-${t.id}`}>
                  <Link href={to} className="tr-colors -mx-2 flex items-center gap-3 rounded-md px-2 py-2.5 hover:bg-surface-subtle">
                    {t.kind === 'homework' ? <BookOpen className="size-4 shrink-0 text-ink-3" aria-hidden /> : <CircleCheck className="size-4 shrink-0 text-ink-3" aria-hidden />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{t.title}</span>
                      <span className={cn('t-caption block truncate', t.overdue ? 'text-danger' : 'text-ink-2')}>
                        {[t.kind === 'homework' ? 'Homework' : 'Task', t.subtitle, due?.text].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    {t.overdue && <StatusChip status="overdue" />}
                    <ChevronRight className="size-4 shrink-0 text-ink-3" aria-hidden />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

export function ExamsPeekCard({ exams, href }: { exams: Exam[]; href: string }) {
  const list = exams.slice(0, 5);
  return (
    <Card>
      <CardHeader title="Upcoming exams" action={<ViewAll href={href} label="Schedule" />} />
      <CardBody className="pt-3">
        {list.length === 0 ? (
          <EmptyState compact illustration="empty-events" title="No exams coming up" />
        ) : (
          <ul className="divide-y divide-border">
            {list.map((e, i) => (
              <li key={`${e.examId}-${i}`} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{e.subject}</p>
                  <p className="t-caption truncate text-ink-2">{[e.examName, e.startTime ? fmtClock(e.startTime) : null, e.room].filter(Boolean).join(' · ')}</p>
                </div>
                <span className="t-caption shrink-0 text-ink-2">{fmtDate(e.date, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

export function ResultsPeekCard({ results, href }: { results: { examId: string; examName: string; publishedAt: string }[]; href: string }) {
  const l = useLearner();
  const detail = `${l.base}/${l.isParent ? 'academics' : 'learning'}/results`;
  return (
    <Card>
      <CardHeader title="Results available" action={<ViewAll href={href} />} />
      <CardBody className="pt-3">
        {results.length === 0 ? (
          <EmptyState compact illustration="empty-generic" title="No results published yet" />
        ) : (
          <ul className="divide-y divide-border">
            {results.slice(0, 3).map((r) => (
              <li key={r.examId}>
                <Link href={`${detail}/${r.examId}`} className="tr-colors -mx-2 flex items-center gap-3 rounded-md px-2 py-2.5 hover:bg-surface-subtle">
                  <Trophy className="size-4 shrink-0 text-ink-3" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{r.examName}</span>
                    <span className="t-caption block text-ink-2">Published {fmtDateTime(r.publishedAt)}</span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-ink-3" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

/** Shortcuts to the pages that are not in the main bar (attendance, fees, bus, library …). */
export function MoreCard({ title = 'More from school', href }: { title?: string; href?: string }) {
  const l = useLearner();
  const items = useMoreItems().filter((i) => !(l.isParent && i.id === 'profile'));
  if (items.length === 0) return null;
  return (
    <Card>
      <CardHeader title={title} action={href ? <Button asChild variant="ghost" size="sm"><Link href={href}>All <ArrowRight /></Link></Button> : undefined} />
      <CardBody className="pt-2">
        <ul className="-mx-2">
          {items.map((i) => (
            <li key={i.id}>
              <Link href={`${l.base}${i.href}`} className="tr-colors flex items-center gap-3 rounded-md px-2 py-2 hover:bg-surface-subtle">
                <i.icon className="size-4 shrink-0 text-ink-2" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{i.label}</span>
                  <span className="t-caption block truncate text-ink-2">{i.blurb}</span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-ink-3" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

export const IconClock = CalendarClock;
