'use client';

import * as React from 'react';
import { addDays, addWeeks, format, parseISO, startOfWeek } from 'date-fns';
import { ArrowLeftRight, ChevronLeft, ChevronRight } from 'lucide-react';
import type { TimetableGridResponse } from '@school-sync/shared';
import { useTimetableGrid, useTimetableToday } from '@/lib/client/learner-learning';
import { useMediaQuery } from '@/lib/client/use-media-query';
import { fmtClock, todayIso } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { IconButton } from '@/components/ui/icon-button';
import { Skeleton } from '@/components/ui/skeleton';
import { QueryView } from '../states';
import { useLearner } from '../use-learner';
import { useUrlParams } from '../url-state';
import { Segmented } from '../comms/common';

const DAY_SHORT = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_LONG = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const iso = (d: Date) => format(d, 'yyyy-MM-dd');

/** Weekly timetable of the student's (or child's) section. The week is in the URL (`?week=YYYY-MM-DD`). */
export function TimetableView() {
  const l = useLearner();
  const { get, set } = useUrlParams();
  const today = todayIso();
  const raw = get('week');
  const anchor = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : today;
  const monday = startOfWeek(parseISO(anchor), { weekStartsOn: 1 });
  const weekIso = iso(monday);
  const thisWeek = weekIso === iso(startOfWeek(parseISO(today), { weekStartsOn: 1 }));
  const grid = useTimetableGrid(l.sectionId, weekIso);
  const now = useTimetableToday(l.studentId, l.q, thisWeek && !!l.studentId);
  const wide = useMediaQuery('(min-width: 768px)', true);
  const go = (d: Date) => set({ week: iso(d) === iso(startOfWeek(parseISO(today), { weekStartsOn: 1 })) ? null : iso(d) });
  const sunday = addDays(monday, 6);
  const range = `${format(monday, 'd MMM')} – ${format(sunday, 'd MMM yyyy')}`;

  return (
    <section aria-label="Weekly timetable" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <IconButton label="Previous week" variant="secondary" onClick={() => go(addWeeks(monday, -1))}>
            <ChevronLeft />
          </IconButton>
          <IconButton label="Next week" variant="secondary" onClick={() => go(addWeeks(monday, 1))}>
            <ChevronRight />
          </IconButton>
          <Button variant="secondary" size="sm" className="ml-1" disabled={thisWeek} onClick={() => go(parseISO(today))}>
            This week
          </Button>
        </div>
        <p className="text-sm font-medium" aria-live="polite">
          {range}
        </p>
      </div>
      <QueryView
        query={grid}
        skeleton={<Skeleton className="h-96 w-full" />}
        isEmpty={(g) => g.slots.length === 0}
        empty={
          <Card>
            <EmptyState illustration="empty-events" title="No timetable yet" description={l.isParent ? `The timetable for ${l.name}’s class hasn’t been published.` : 'Your class timetable hasn’t been published yet.'} />
          </Card>
        }
      >
        {(g) => (wide ? <WeekGrid g={g} monday={monday} todayIso={today} currentPeriodId={thisWeek ? now.data?.current?.periodId ?? null : null} /> : <DayList g={g} monday={monday} todayIso={today} currentPeriodId={thisWeek ? now.data?.current?.periodId ?? null : null} />)}
      </QueryView>
      <p className="t-caption text-ink-2">
        <ArrowLeftRight className="mr-1 inline size-3.5 align-text-bottom" aria-hidden />
        “Cover” marks a lesson taken by another teacher that day.
      </p>
    </section>
  );
}

function cellFor(g: TimetableGridResponse, dow: number, periodId: string) {
  const slot = g.slots.find((s) => s.dayOfWeek === dow && s.periodId === periodId) ?? null;
  const sub = slot ? (g.substitutions.find((x) => x.slotId === slot.id && x.dayOfWeek === dow) ?? null) : null;
  return { slot, sub };
}

function Lesson({ g, dow, periodId, compact }: { g: TimetableGridResponse; dow: number; periodId: string; compact?: boolean }) {
  const { slot, sub } = cellFor(g, dow, periodId);
  if (!slot) return <span className="text-ink-3" aria-label="Free period">—</span>;
  const teacher = sub ? sub.substituteTeacherName : slot.teacherName;
  return (
    <span className="block min-w-0">
      <span className="block truncate font-medium">{slot.subjectName ?? 'Lesson'}</span>
      <span className={cn('t-caption block truncate text-ink-2', compact && 'text-[11px]')}>{[teacher, slot.room].filter(Boolean).join(' · ')}</span>
      {sub && (
        <span className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium text-warning" title={sub.reason ?? undefined}>
          <ArrowLeftRight className="size-3" aria-hidden /> Cover{sub.originalTeacherName ? ` for ${sub.originalTeacherName}` : ''}
        </span>
      )}
    </span>
  );
}

function WeekGrid({ g, monday, todayIso: today, currentPeriodId }: { g: TimetableGridResponse; monday: Date; todayIso: string; currentPeriodId: string | null }) {
  const days = g.workingDays.slice().sort((a, b) => a - b);
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="t-table w-full min-w-[720px] border-separate border-spacing-0">
          <caption className="sr-only">Timetable for {g.section.gradeName} {g.section.name}, week of {format(monday, 'd MMMM yyyy')}</caption>
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-[1] h-11 w-28 border-b border-border bg-surface-subtle px-4 text-left text-ink-2">Period</th>
              {days.map((d) => {
                const date = iso(addDays(monday, d - 1));
                const isToday = date === today;
                return (
                  <th key={d} scope="col" aria-current={isToday ? 'date' : undefined} className={cn('h-11 border-b border-border px-3 text-left', isToday ? 'bg-brand-soft text-brand-ink' : 'bg-surface-subtle text-ink-2')}>
                    <span className="block font-semibold">{DAY_SHORT[d]}</span>
                    <span className="t-caption block font-normal">{format(addDays(monday, d - 1), 'd MMM')}</span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {g.periods.map((p) =>
              p.isBreak ? (
                <tr key={p.id}>
                  <th scope="row" className="sticky left-0 border-b border-border bg-surface px-4 py-2 text-left font-normal text-ink-3">
                    {fmtClock(p.startTime)}
                  </th>
                  <td colSpan={days.length} className="border-b border-border bg-surface-subtle px-3 py-2 text-center text-[12px] text-ink-3">
                    {p.name} · {fmtClock(p.startTime)} – {fmtClock(p.endTime)}
                  </td>
                </tr>
              ) : (
                <tr key={p.id}>
                  <th scope="row" className="sticky left-0 z-[1] border-b border-border bg-surface px-4 py-3 text-left align-top">
                    <span className="block font-medium">{p.name}</span>
                    <span className="t-caption block font-normal text-ink-2">
                      {fmtClock(p.startTime)} – {fmtClock(p.endTime)}
                    </span>
                  </th>
                  {days.map((d) => {
                    const date = iso(addDays(monday, d - 1));
                    const isNow = date === today && currentPeriodId === p.id;
                    return (
                      <td key={d} className={cn('relative min-w-[120px] border-b border-border px-3 py-3 align-top', date === today && 'bg-brand-soft/40', isNow && 'bg-brand-soft')}>
                        {isNow && <Badge variant="accent" className="mb-1">Now</Badge>}
                        <Lesson g={g} dow={d} periodId={p.id} />
                      </td>
                    );
                  })}
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** Phones: one day at a time — a seven-column grid does not fit and scrolling sideways hides the lessons. */
function DayList({ g, monday, todayIso: today, currentPeriodId }: { g: TimetableGridResponse; monday: Date; todayIso: string; currentPeriodId: string | null }) {
  const days = g.workingDays.slice().sort((a, b) => a - b);
  const todayDow = days.find((d) => iso(addDays(monday, d - 1)) === today);
  const [day, setDay] = React.useState<number>(todayDow ?? days[0] ?? 1);
  React.useEffect(() => {
    if (!days.includes(day)) setDay(days[0] ?? 1);
  }, [days, day]);
  return (
    <div className="space-y-3">
      <Segmented label="Day of the week" value={String(day)} onChange={(v) => setDay(Number(v))} options={days.map((d) => ({ value: String(d), label: DAY_SHORT[d]! }))} />
      <Card>
        <CardBody className="pt-4">
          <h3 className="t-section mb-2">
            {DAY_LONG[day]} <span className="t-caption font-normal text-ink-2">{format(addDays(monday, day - 1), 'd MMM')}</span>
          </h3>
          <ol className="-mx-2">
            {g.periods.map((p) => {
              const isNow = iso(addDays(monday, day - 1)) === today && currentPeriodId === p.id;
              if (p.isBreak) {
                return (
                  <li key={p.id} className="px-2 py-2 text-[12px] text-ink-3">
                    {p.name} · {fmtClock(p.startTime)} – {fmtClock(p.endTime)}
                  </li>
                );
              }
              return (
                <li key={p.id} className={cn('flex items-start gap-3 rounded-md px-2 py-2.5', isNow && 'bg-brand-soft')}>
                  <span className="tnum w-[84px] shrink-0 text-[13px] text-ink-2">
                    {fmtClock(p.startTime)}
                    <span className="block text-[11px] text-ink-3">{p.name}</span>
                  </span>
                  <div className="min-w-0 flex-1 text-sm">
                    <Lesson g={g} dow={day} periodId={p.id} />
                  </div>
                  {isNow && <Badge variant="accent">Now</Badge>}
                </li>
              );
            })}
          </ol>
        </CardBody>
      </Card>
    </div>
  );
}
