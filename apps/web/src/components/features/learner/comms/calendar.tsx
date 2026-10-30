'use client';

import * as React from 'react';
import Link from 'next/link';
import { addDays, addMonths, endOfMonth, endOfWeek, format, isSameMonth, parseISO, startOfMonth, startOfWeek, subMonths } from 'date-fns';
import { CalendarDays, ChevronLeft, ChevronRight, ExternalLink, MapPin } from 'lucide-react';
import type { CalendarItem } from '@school-sync/shared';
import { cn } from '@/lib/cn';
import { fmtClock, todayIso } from '@/lib/format';
import { useCalendar } from '@/lib/client/learner-comms';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { IconButton } from '@/components/ui/icon-button';
import { Skeleton } from '@/components/ui/skeleton';
import { JoinButton } from '../../online-meeting/online-meeting';
import { ErrorState } from '../states';
import { useLearner } from '../use-learner';
import { useUrlParams } from '../url-state';
import { fmtSpan, isoDate, Segmented } from './common';
import { EventDetailDrawer } from './events';
import { EVENT_BACKED, KIND_META, kindMeta } from './kinds';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const WEEK = { weekStartsOn: 1 as const };

const timeLabel = (i: Pick<CalendarItem, 'allDay' | 'startTime' | 'endTime'>): string | null => (i.allDay ? 'All day' : i.startTime ? (i.endTime ? `${fmtClock(i.startTime)} – ${fmtClock(i.endTime)}` : fmtClock(i.startTime)) : null);

/** The calendar item a click should lead to (`event` = open the shared drawer). */
function useItemTarget() {
  const l = useLearner();
  return (i: CalendarItem): { type: 'event'; id: string } | { type: 'link'; href: string } | null => {
    if (EVENT_BACKED.includes(i.kind)) return { type: 'event', id: i.entityId };
    if (i.kind === 'exam_paper') return { type: 'link', href: l.isParent ? `${l.base}/academics?tab=exams` : `${l.base}/learning?tab=exams` };
    if (i.kind === 'homework_due') return { type: 'link', href: l.isParent ? `${l.base}/academics/homework/${i.entityId}` : `${l.base}/learning/homework/${i.entityId}` };
    return null;
  };
}

/** Items per day of the visible grid; multi-day items appear on every day they cover. */
function groupByDay(items: CalendarItem[], from: string, to: string): Map<string, CalendarItem[]> {
  const m = new Map<string, CalendarItem[]>();
  for (const it of items) {
    let d = it.date < from ? from : it.date;
    const end = it.endDate > to ? to : it.endDate;
    for (let guard = 0; d <= end && guard < 45; guard++) {
      m.set(d, [...(m.get(d) ?? []), it]);
      d = isoDate(addDays(parseISO(d), 1));
    }
  }
  for (const [k, list] of m) m.set(k, [...list].sort((a, b) => Number(b.allDay) - Number(a.allDay) || (a.startTime ?? '').localeCompare(b.startTime ?? '') || a.title.localeCompare(b.title)));
  return m;
}

/** Month grid + agenda for GET /calendar. `?view=month|agenda&month=YYYY-MM&day=YYYY-MM-DD` live in the URL. */
export function CalendarPanel() {
  const l = useLearner();
  const { get, set } = useUrlParams();
  const view = get('view') === 'agenda' ? 'agenda' : 'month';
  const today = todayIso();
  const monthRaw = get('month');
  const monthStart = startOfMonth(monthRaw && MONTH_RE.test(monthRaw) ? parseISO(`${monthRaw}-01`) : parseISO(today));
  const monthKey = format(monthStart, 'yyyy-MM');
  const gridStart = startOfWeek(monthStart, WEEK);
  const gridEnd = endOfWeek(endOfMonth(monthStart), WEEK);
  const from = isoDate(gridStart);
  const to = isoDate(gridEnd);
  const dayRaw = get('day');
  const defaultDay = isSameMonth(parseISO(today), monthStart) ? today : isoDate(monthStart);
  const day = dayRaw && DAY_RE.test(dayRaw) && dayRaw >= from && dayRaw <= to ? dayRaw : defaultDay;
  const eventId = get('open');
  const q = useCalendar(l.studentId, from, to);
  const target = useItemTarget();

  const byDay = groupByDay(q.data ?? [], from, to);

  const gotoMonth = (d: Date) => set({ month: format(d, 'yyyy-MM'), day: null });
  const selectDay = (d: string) => set({ day: d === defaultDay ? null : d });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <IconButton label="Previous month" variant="secondary" onClick={() => gotoMonth(subMonths(monthStart, 1))}>
            <ChevronLeft />
          </IconButton>
          <IconButton label="Next month" variant="secondary" onClick={() => gotoMonth(addMonths(monthStart, 1))}>
            <ChevronRight />
          </IconButton>
        </div>
        <h2 className="t-section min-w-36 px-1" aria-live="polite">{format(monthStart, 'MMMM yyyy')}</h2>
        <Button variant="secondary" size="sm" onClick={() => set({ month: null, day: null })} disabled={monthKey === today.slice(0, 7) && !dayRaw}>
          Today
        </Button>
        <div className="ml-auto">
          <Segmented label="Calendar view" value={view} onChange={(v) => set({ view: v === 'agenda' ? 'agenda' : null })} options={[{ value: 'month', label: 'Month' }, { value: 'agenda', label: 'Agenda' }]} />
        </div>
      </div>

      {q.isPending ? (
        <Card><CardBody><Skeleton className="h-[420px] w-full" /></CardBody></Card>
      ) : q.isError && !q.data ? (
        <Card><ErrorState error={q.error} onRetry={() => void q.refetch()} /></Card>
      ) : view === 'month' ? (
        <>
          <MonthGrid gridStart={gridStart} gridEnd={gridEnd} monthStart={monthStart} byDay={byDay} today={today} day={day} onDay={selectDay} onMonth={(d) => set({ month: format(d, 'yyyy-MM'), day: isoDate(d) })} fetching={q.isFetching} />
          <DayPanel day={day} items={byDay.get(day) ?? []} target={target} onEvent={(id) => set({ open: id }, { push: true })} />
        </>
      ) : (
        <Agenda items={q.data ?? []} monthStart={monthStart} target={target} onEvent={(id) => set({ open: id }, { push: true })} />
      )}

      <Legend />
      <EventDetailDrawer id={eventId} onClose={() => set({ open: null })} />
    </div>
  );
}

function MonthGrid({ gridStart, gridEnd, monthStart, byDay, today, day, onDay, onMonth, fetching }: { gridStart: Date; gridEnd: Date; monthStart: Date; byDay: Map<string, CalendarItem[]>; today: string; day: string; onDay: (d: string) => void; onMonth: (d: Date) => void; fetching: boolean }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const pendingFocus = React.useRef(false);
  const days: Date[] = [];
  for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) days.push(d);
  const weeks: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  const first = isoDate(gridStart);
  const last = isoDate(gridEnd);

  React.useEffect(() => {
    if (pendingFocus.current) {
      pendingFocus.current = false;
      ref.current?.querySelector<HTMLElement>(`[data-day="${day}"]`)?.focus();
    }
  }, [day, monthStart]);

  const onKey = (e: React.KeyboardEvent) => {
    const cur = parseISO(day);
    let next: Date | null = null;
    switch (e.key) {
      case 'ArrowLeft': next = addDays(cur, -1); break;
      case 'ArrowRight': next = addDays(cur, 1); break;
      case 'ArrowUp': next = addDays(cur, -7); break;
      case 'ArrowDown': next = addDays(cur, 7); break;
      case 'Home': next = startOfWeek(cur, WEEK); break;
      case 'End': next = endOfWeek(cur, WEEK); break;
      case 'PageUp': next = subMonths(cur, 1); break;
      case 'PageDown': next = addMonths(cur, 1); break;
      default: return;
    }
    e.preventDefault();
    pendingFocus.current = true;
    const iso = isoDate(next);
    if (iso < first || iso > last) onMonth(next);
    else onDay(iso);
  };

  return (
    <Card className="overflow-hidden">
      <div role="grid" aria-label={`${format(monthStart, 'MMMM yyyy')} calendar`} aria-busy={fetching || undefined} ref={ref} onKeyDown={onKey}>
        <div role="row" className="grid grid-cols-7 border-b border-border bg-surface-subtle">
          {weeks[0]!.map((d) => (
            <div key={d.getDay()} role="columnheader" aria-label={format(d, 'EEEE')} className="t-caption px-2 py-2 text-center font-medium text-ink-2">
              <span aria-hidden>{format(d, 'EEE')}</span>
            </div>
          ))}
        </div>
        {weeks.map((w, wi) => (
          <div key={wi} role="row" className="grid grid-cols-7 border-b border-border last:border-b-0">
            {w.map((d) => {
              const iso = isoDate(d);
              const items = byDay.get(iso) ?? [];
              const inMonth = isSameMonth(d, monthStart);
              const isToday = iso === today;
              const selected = iso === day;
              return (
                <div key={iso} role="gridcell" aria-selected={selected} className="border-r border-border last:border-r-0">
                  <button
                    type="button"
                    data-day={iso}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => onDay(iso)}
                    aria-label={`${format(d, 'EEEE d MMMM')}${isToday ? ', today' : ''}${items.length ? `, ${items.length} item${items.length === 1 ? '' : 's'}` : ', nothing scheduled'}`}
                    className={cn('tr-colors flex h-full min-h-14 w-full flex-col items-stretch gap-1 p-1.5 text-left hover:bg-surface-subtle sm:min-h-[104px]', !inMonth && 'bg-surface-subtle/60 text-ink-3', selected && 'bg-brand-soft hover:bg-brand-soft')}
                  >
                    <span className={cn('tnum grid size-6 place-items-center rounded-full text-[13px]', isToday ? 'bg-accent-soft font-semibold text-accent-ink' : inMonth ? 'font-medium' : 'font-normal')}>{d.getDate()}</span>
                    {/* tablet / desktop: up to two labelled chips */}
                    <span className="hidden min-w-0 flex-col gap-0.5 sm:flex">
                      {items.slice(0, 2).map((it) => {
                        const k = kindMeta(it.kind);
                        return (
                          <span key={it.id} className={cn('flex min-w-0 items-center gap-1 rounded px-1 text-[11px] leading-[18px]', k.chip, it.status === 'cancelled' && 'line-through opacity-70')}>
                            <k.icon className="size-3 shrink-0" aria-hidden />
                            <span className="truncate">{it.title}</span>
                          </span>
                        );
                      })}
                      {items.length > 2 && <span className="px-1 text-[11px] leading-4 text-ink-2">+{items.length - 2} more</span>}
                    </span>
                    {/* phone: a count, the list is under the grid */}
                    {items.length > 0 && <span className="tnum mx-auto rounded-full bg-surface-sunken px-1.5 text-[11px] leading-4 text-ink-2 sm:hidden" aria-hidden>{items.length}</span>}
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </Card>
  );
}

type Target = ReturnType<ReturnType<typeof useItemTarget>>;

function ItemRow({ item, target, onEvent }: { item: CalendarItem; target: Target; onEvent: (id: string) => void }) {
  const k = kindMeta(item.kind);
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={cn('text-sm font-medium', item.status === 'cancelled' && 'text-ink-2 line-through')}>{item.title}</span>
          <Badge className={k.chip} icon={<k.icon aria-hidden />}>{k.label}</Badge>
          {item.status === 'cancelled' && <Badge variant="neutral">Cancelled</Badge>}
        </span>
        <span className="t-caption mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-ink-2">
          <span>{fmtSpan(item.date, item.endDate)}</span>
          {timeLabel(item) && <span>{timeLabel(item)}</span>}
          {item.subtitle && <span>{item.subtitle}</span>}
          {item.location && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3" aria-hidden /> {item.location}
            </span>
          )}
        </span>
      </span>
      {target?.type === 'link' && <ExternalLink className="mt-1 size-4 shrink-0 text-ink-3" aria-hidden />}
    </>
  );
  const cls = 'tr-colors flex w-full items-start gap-3 px-5 py-3.5 text-left max-sm:px-4';
  const main =
    target?.type === 'event' ? (
      <button type="button" onClick={() => onEvent(target.id)} className={cn(cls, 'hover:bg-surface-subtle')}>{body}</button>
    ) : target?.type === 'link' ? (
      <Link href={target.href} className={cn(cls, 'hover:bg-surface-subtle')}>{body}</Link>
    ) : (
      <div className={cls}>{body}</div>
    );
  // the Join link sits under the item, not inside its button / link (an interactive element must not contain another)
  const join = item.status !== 'cancelled' && item.joinUrl ? (
    <div className="px-5 pb-3.5 max-sm:px-4">
      <JoinButton url={item.joinUrl} />
    </div>
  ) : null;
  return join ? (
    <>
      {main}
      {join}
    </>
  ) : (
    main
  );
}

function DayPanel({ day, items, target, onEvent }: { day: string; items: CalendarItem[]; target: ReturnType<typeof useItemTarget>; onEvent: (id: string) => void }) {
  return (
    <Card>
      <section aria-label="Selected day">
        <h3 className="t-section px-5 pt-4 max-sm:px-4">{format(parseISO(day), 'EEEE d MMMM')}</h3>
        {items.length === 0 ? (
          <EmptyState compact illustration="empty-events" title="Nothing scheduled this day" />
        ) : (
          <ul className="mt-2 divide-y divide-border pb-1">
            {items.map((i) => (
              <li key={i.id}>
                <ItemRow item={i} target={target(i)} onEvent={onEvent} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </Card>
  );
}

function Agenda({ items, monthStart, target, onEvent }: { items: CalendarItem[]; monthStart: Date; target: ReturnType<typeof useItemTarget>; onEvent: (id: string) => void }) {
  const ms = isoDate(monthStart);
  const me = isoDate(endOfMonth(monthStart));
  const groups = React.useMemo(() => {
    const m = new Map<string, CalendarItem[]>();
    for (const it of items) {
      if (it.endDate < ms || it.date > me) continue;
      const key = it.date < ms ? ms : it.date;
      m.set(key, [...(m.get(key) ?? []), it]);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([d, list]) => [d, list.sort((a, b) => Number(b.allDay) - Number(a.allDay) || (a.startTime ?? '').localeCompare(b.startTime ?? ''))] as const);
  }, [items, ms, me]);
  if (groups.length === 0) return <Card><EmptyState illustration="empty-events" title={`Nothing scheduled in ${format(monthStart, 'MMMM')}`} description="Try another month, or check back later." /></Card>;
  return (
    <Card className="overflow-hidden">
      <ol aria-label={`Agenda for ${format(monthStart, 'MMMM yyyy')}`} className="divide-y divide-border">
        {groups.map(([d, list]) => (
          <li key={d} className="flex gap-3 sm:gap-5">
            <div className="w-16 shrink-0 px-4 pt-4 text-center sm:w-24" aria-hidden>
              <p className="t-caption text-ink-2">{format(parseISO(d), 'EEE')}</p>
              <p className="figure text-2xl leading-7">{format(parseISO(d), 'd')}</p>
            </div>
            <ul className="min-w-0 flex-1 divide-y divide-border">
              <li className="sr-only">{format(parseISO(d), 'EEEE d MMMM')}</li>
              {list.map((i) => (
                <li key={i.id}>
                  <ItemRow item={i} target={target(i)} onEvent={onEvent} />
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function Legend() {
  return (
    <section aria-label="Legend">
      <ul className="t-caption flex flex-wrap gap-x-4 gap-y-1.5 text-ink-2">
        {Object.entries(KIND_META).map(([k, m]) => (
          <li key={k} className="flex items-center gap-1.5">
            <m.icon className="size-3.5" aria-hidden /> {m.label}
          </li>
        ))}
        <li className="flex items-center gap-1.5">
          <CalendarDays className="size-3.5" aria-hidden /> Today is marked with a warm circle
        </li>
      </ul>
    </section>
  );
}
