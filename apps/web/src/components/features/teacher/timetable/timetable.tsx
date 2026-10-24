'use client';

import * as React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { PeriodOut, TimetableDayResponse, TimetableEntry, TimetableSubstitutionItem } from '@school-sync/shared';
import { useTeacherScope, usePeriods } from '@/lib/client/teacher';
import { addDaysIso, mondayOf, weekDates } from '@/lib/client/teacher-dates';
import { useMyWeek, useSubstitutions } from '@/lib/client/teacher-learning';
import { useMediaQuery } from '@/lib/client/use-media-query';
import { fmtClock, fmtDate, plural, todayIso } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { IconButton } from '@/components/ui/icon-button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/shell/page-header';
import { ErrorCard, useUrlState } from '../common';

const dayName = (iso: string) => fmtDate(iso, { weekday: 'short' });
const dayNum = (iso: string) => fmtDate(iso, { day: 'numeric', month: 'short' });

/** My week: a read-only grid of my lessons (periods × days), with covers I give and lessons covered for me. */
export function TimetableScreen() {
  const url = useUrlState();
  const today = todayIso();
  const monday = mondayOf(url.get('week') || today);
  const dates = weekDates(monday);
  const week = useMyWeek(dates);
  const periods = usePeriods();
  const subs = useSubstitutions(monday, addDaysIso(monday, 6));
  const scope = useTeacherScope();
  const wide = useMediaQuery('(min-width: 768px)', true);

  // school days: working days, plus any day that has an entry anyway
  const days = dates
    .map((date, i) => ({ date, day: week.days[i] }))
    .filter((d) => !d.day || d.day.isWorkingDay || d.day.entries.length > 0);
  const loading = week.isPending || periods.isPending;
  const lessons = days.reduce((n, d) => n + (d.day?.entries.filter((e) => e.relation === 'own' || e.relation === 'covering').length ?? 0), 0);
  const covering = days.reduce((n, d) => n + (d.day?.entries.filter((e) => e.relation === 'covering').length ?? 0), 0);
  const covered = days.reduce((n, d) => n + (d.day?.entries.filter((e) => e.relation === 'covered').length ?? 0), 0);

  const [mobileDay, setMobileDay] = React.useState<string | null>(null);
  const activeDay = mobileDay && days.some((d) => d.date === mobileDay) ? mobileDay : (days.find((d) => d.date === today)?.date ?? days[0]?.date ?? null);
  const isThisWeek = monday === mondayOf(today);

  return (
    <>
      <PageHeader
        title="Timetable"
        description={!loading && !week.error ? `${plural(lessons, 'lesson')} this week${covering > 0 ? ` · ${plural(covering, 'cover')} for colleagues` : ''}${covered > 0 ? ` · ${plural(covered, 'lesson')} covered for you` : ''}` : 'Your lessons for the week.'}
        actions={
          <div className="flex items-center gap-1" role="group" aria-label="Choose week">
            <IconButton label="Previous week" variant="secondary" onClick={() => url.set({ week: addDaysIso(monday, -7) })}>
              <ChevronLeft />
            </IconButton>
            <Button variant="secondary" disabled={isThisWeek} onClick={() => url.set({ week: null })}>
              This week
            </Button>
            <IconButton label="Next week" variant="secondary" onClick={() => url.set({ week: addDaysIso(monday, 7) })}>
              <ChevronRight />
            </IconButton>
          </div>
        }
      />
      <p className="t-caption -mt-4 mb-4 text-ink-2" aria-live="polite">
        {fmtDate(monday, { day: 'numeric', month: 'long' })} to {fmtDate(addDaysIso(monday, 6), { day: 'numeric', month: 'long', year: 'numeric' })}
      </p>

      {week.error && !loading ? (
        <ErrorCard error={week.error} onRetry={week.refetch} title="We couldn’t load your timetable" />
      ) : loading ? (
        <Card>
          <div className="space-y-3 p-5" aria-busy>
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        </Card>
      ) : days.length === 0 || lessons + covered === 0 ? (
        <Card>
          <EmptyState illustration="empty-events" title="No lessons this week" description="Nothing is on your timetable for these dates. Try another week, or ask the school office if it looks wrong." />
        </Card>
      ) : wide ? (
        <WeekGrid days={days} periods={periods.data ?? []} today={today} />
      ) : (
        <>
          <Tabs value={activeDay ?? undefined} onValueChange={setMobileDay}>
            <TabsList aria-label="Day of the week" className="mb-3">
              {days.map((d) => (
                <TabsTrigger key={d.date} value={d.date}>
                  {dayName(d.date)} {fmtDate(d.date, { day: 'numeric' })}
                  {d.date === today && <span className="size-1.5 rounded-full bg-accent" aria-label="today" />}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          {activeDay && <DayList day={days.find((d) => d.date === activeDay)?.day} periods={periods.data ?? []} />}
        </>
      )}

      <SubstitutionsCard className="mt-6" subs={subs.data} loading={subs.isPending} error={subs.error} onRetry={() => void subs.refetch()} staffId={scope.staffId} />
    </>
  );
}

/* ───────────────────────── desktop grid ───────────────────────── */

function WeekGrid({ days, periods, today }: { days: { date: string; day: TimetableDayResponse | undefined }[]; periods: PeriodOut[]; today: string }) {
  const rows = [...periods].sort((a, b) => a.ordinal - b.ordinal);
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-separate border-spacing-0 text-sm">
          <caption className="sr-only">Your lessons by period and day</caption>
          <thead>
            <tr>
              <th scope="col" className="t-colhead sticky left-0 z-[2] h-12 w-28 border-b border-border bg-surface-subtle px-3 text-left text-ink-2">
                Period
              </th>
              {days.map((d) => (
                <th key={d.date} scope="col" className={cn('t-colhead h-12 border-b border-l border-border bg-surface-subtle px-3 text-left', d.date === today ? 'text-brand-ink' : 'text-ink-2')}>
                  <span className="block normal-case tracking-normal">
                    <span className="text-[13px] font-medium">{dayName(d.date)}</span> <span className="font-normal">{dayNum(d.date)}</span>
                    {d.date === today && (
                      <Badge variant="accent" className="ml-2">
                        Today
                      </Badge>
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((p) =>
              p.isBreak ? (
                <tr key={p.id}>
                  <th scope="row" className="sticky left-0 z-[1] border-b border-border bg-surface px-3 py-1.5 text-left font-normal">
                    <span className="t-caption text-ink-3">{p.name}</span>
                  </th>
                  <td colSpan={days.length} className="border-b border-l border-border bg-surface-subtle/60 px-3 py-1.5 text-center">
                    <span className="t-caption tnum text-ink-3">
                      {fmtClock(p.startTime)} – {fmtClock(p.endTime)}
                    </span>
                  </td>
                </tr>
              ) : (
                <tr key={p.id}>
                  <th scope="row" className="sticky left-0 z-[1] border-b border-border bg-surface px-3 py-2.5 text-left align-top font-normal">
                    <span className="block text-[13px] font-medium">{p.name}</span>
                    <span className="t-caption tnum text-ink-3">
                      {fmtClock(p.startTime)} – {fmtClock(p.endTime)}
                    </span>
                  </th>
                  {days.map((d) => {
                    const e = d.day?.entries.find((x) => x.periodId === p.id);
                    return (
                      <td key={d.date} className={cn('h-[76px] min-w-[132px] border-b border-l border-border px-2 py-1.5 align-top', e?.state === 'current' && 'bg-brand-soft')} aria-current={e?.state === 'current' ? 'time' : undefined}>
                        {e ? <Cell e={e} /> : <span className="t-caption text-ink-disabled" aria-label="Free period">—</span>}
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

function Cell({ e }: { e: TimetableEntry }) {
  const covered = e.relation === 'covered';
  return (
    <div className="space-y-0.5">
      <p className={cn('text-[13px] font-medium leading-5', covered && 'text-ink-3 line-through decoration-ink-3/60')}>{e.subjectName ?? e.periodName}</p>
      <p className="t-caption text-ink-2">
        {e.sectionName}
        {e.room ? ` · ${e.room}` : ''}
      </p>
      {e.relation === 'covering' && (
        <Badge variant="accent" className="mt-0.5">
          Covering{e.substitution?.originalTeacherName ? ` for ${e.substitution.originalTeacherName.split(' ')[0]}` : ''}
        </Badge>
      )}
      {covered && <p className="t-caption text-ink-2">Covered by {e.substitution?.substituteTeacherName ?? e.teacherName ?? 'a colleague'}</p>}
      {e.state === 'current' && <Badge variant="accent">Now</Badge>}
    </div>
  );
}

/* ───────────────────────── phone: one day ───────────────────────── */

function DayList({ day, periods }: { day: TimetableDayResponse | undefined; periods: PeriodOut[] }) {
  if (!day) return null;
  const rows = [...periods].sort((a, b) => a.ordinal - b.ordinal);
  return (
    <Card>
      <ol aria-label="Periods" className="divide-y divide-border">
        {rows.map((p) => {
          const e = day.entries.find((x) => x.periodId === p.id);
          return (
            <li key={p.id} className={cn('flex gap-3 px-4 py-3', e?.state === 'current' && 'bg-brand-soft')} aria-current={e?.state === 'current' ? 'time' : undefined}>
              <div className="w-[84px] shrink-0">
                <p className="text-[13px] font-medium">{p.name}</p>
                <p className="t-caption tnum text-ink-3">{fmtClock(p.startTime)}</p>
              </div>
              <div className="min-w-0 flex-1">{p.isBreak ? <p className="t-caption text-ink-3">Break</p> : e ? <Cell e={e} /> : <p className="t-caption text-ink-3">Free period</p>}</div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

/* ───────────────────────── covers ───────────────────────── */

function SubstitutionsCard({ subs, loading, error, onRetry, staffId, className }: { subs: TimetableSubstitutionItem[] | undefined; loading: boolean; error: unknown; onRetry: () => void; staffId: string | null; className?: string }) {
  const mineGiving = (subs ?? []).filter((s) => s.substituteStaffId === staffId);
  const mineTaken = (subs ?? []).filter((s) => s.originalStaffId === staffId);
  const others = (subs ?? []).filter((s) => s.substituteStaffId !== staffId && s.originalStaffId !== staffId);
  return (
    <Card className={className}>
      <CardHeader title="Cover arrangements this week" description="One-day substitutions that involve you or your classes." />
      <CardBody className="pt-3">
        {loading ? (
          <Skeleton className="h-20 w-full" />
        ) : error ? (
          <ErrorCard error={error} onRetry={onRetry} />
        ) : (subs ?? []).length === 0 ? (
          <p className="text-sm text-ink-2">No covers are arranged for this week.</p>
        ) : (
          <div className="space-y-5">
            <CoverList title="You are covering" items={mineGiving} who={(s) => `for ${s.originalTeacherName ?? 'a colleague'}`} />
            <CoverList title="Covered for you" items={mineTaken} who={(s) => `by ${s.substituteTeacherName}`} />
            <CoverList title="Other covers in your classes" items={others} who={(s) => `${s.substituteTeacherName} for ${s.originalTeacherName ?? 'a colleague'}`} />
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function CoverList({ title, items, who }: { title: string; items: TimetableSubstitutionItem[]; who: (s: TimetableSubstitutionItem) => string }) {
  if (items.length === 0) return null;
  return (
    <section aria-label={title}>
      <h3 className="t-label mb-1.5">{title}</h3>
      <ul className="divide-y divide-border rounded-md border border-border">
        {items.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2.5">
            <span className="w-28 shrink-0 text-[13px] font-medium">{fmtDate(s.date, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
            <span className="t-caption tnum w-36 shrink-0 text-ink-2">
              {s.periodName} · {fmtClock(s.startTime)}
            </span>
            <span className="min-w-0 flex-1 text-sm">
              {s.sectionName}
              {s.subjectName ? ` · ${s.subjectName}` : ''} <span className="text-ink-2">{who(s)}</span>
              {s.reason ? <span className="t-caption block text-ink-3">{s.reason}</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
