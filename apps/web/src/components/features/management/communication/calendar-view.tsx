'use client';

import * as React from 'react';
import Link from 'next/link';
import { addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameMonth, isToday, parseISO, startOfMonth, startOfWeek } from 'date-fns';
import { ChevronLeft, ChevronRight, Circle, FileText, Flag, Trophy, Users, CalendarDays, NotebookPen } from 'lucide-react';
import type { CalendarItem, CalendarKind } from '@school-sync/shared';
import { useCalendar } from '@/lib/client/communication';
import { useUrlState } from '@/lib/client/use-url-state';
import { fmtClock } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { IconButton } from '@/components/ui/icon-button';
import { Skeleton } from '@/components/ui/skeleton';
import { JoinButton } from '../../online-meeting/online-meeting';
import { CHART } from '../common/charts';
import { ErrorPanel } from '../common/states';
import { useMgmt } from '../common/use-mgmt';

const iso = (d: Date) => format(d, 'yyyy-MM-dd');

export const KIND_STYLE: Record<CalendarKind, { label: string; color: string; Icon: React.ComponentType<{ className?: string }> }> = {
  holiday: { label: 'Holiday', color: CHART[1], Icon: Flag },
  event: { label: 'Event', color: CHART[0], Icon: CalendarDays },
  ptm: { label: 'Parent–teacher meeting', color: CHART[2], Icon: Users },
  sports: { label: 'Sports', color: CHART[5], Icon: Trophy },
  exam: { label: 'Exam', color: CHART[4], Icon: FileText },
  exam_paper: { label: 'Exam paper', color: CHART[4], Icon: FileText },
  homework_due: { label: 'Homework due', color: CHART[3], Icon: NotebookPen },
  other: { label: 'Other', color: 'var(--ink-3)', Icon: Circle },
};
const EVENT_KINDS_LINKED: CalendarKind[] = ['holiday', 'event', 'ptm', 'sports', 'exam', 'other'];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function when(i: CalendarItem): string {
  if (i.allDay || !i.startTime) return 'All day';
  return `${fmtClock(i.startTime)}${i.endTime ? ` – ${fmtClock(i.endTime)}` : ''}`;
}

/** Month grid + day panel, or an agenda list for the month. Every kind is text + icon + a colour from the chart palette. */
export function CalendarView() {
  const { base } = useMgmt();
  const url = useUrlState();
  const monthParam = url.get('m');
  const mode = url.get('cal') === 'agenda' ? 'agenda' : 'month';
  const month = React.useMemo(() => (/^\d{4}-\d{2}$/.test(monthParam) ? parseISO(`${monthParam}-01`) : startOfMonth(new Date())), [monthParam]);
  const gridStart = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
  const gridEnd = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
  const q = useCalendar({ from: iso(gridStart), to: iso(gridEnd) });
  const [hidden, setHidden] = React.useState<Set<CalendarKind>>(new Set());
  const [selected, setSelected] = React.useState<string>(() => iso(new Date()));
  const setMonth = (d: Date) => url.set({ m: format(d, 'yyyy-MM') === format(new Date(), 'yyyy-MM') ? null : format(d, 'yyyy-MM') }, { resetPage: false });

  const items = (q.data?.data ?? []).filter((i) => !hidden.has(i.kind));
  const byDay = React.useMemo(() => {
    const m = new Map<string, CalendarItem[]>();
    for (const it of items) {
      const start = parseISO(it.date);
      const end = parseISO(it.endDate);
      for (const d of eachDayOfInterval({ start: start < gridStart ? gridStart : start, end: end > gridEnd ? gridEnd : end })) {
        const k = iso(d);
        m.set(k, [...(m.get(k) ?? []), it]);
      }
    }
    for (const [, list] of m) list.sort((a, b) => (a.allDay === b.allDay ? (a.startTime ?? '').localeCompare(b.startTime ?? '') : a.allDay ? -1 : 1));
    return m;
  }, [items, gridStart, gridEnd]);
  const kindsPresent = React.useMemo(() => [...new Set((q.data?.data ?? []).map((i) => i.kind))], [q.data]);
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });
  const weeks = Array.from({ length: days.length / 7 }, (_, i) => days.slice(i * 7, i * 7 + 7));
  const selectedItems = byDay.get(selected) ?? [];
  const monthItems = [...byDay.entries()].filter(([k]) => isSameMonth(parseISO(k), month)).sort(([a], [b]) => (a < b ? -1 : 1));

  const linkFor = (i: CalendarItem) => (EVENT_KINDS_LINKED.includes(i.kind) && i.id.startsWith('event:') ? `${base}/communication/events/${i.entityId}` : null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <IconButton label="Previous month" variant="secondary" onClick={() => setMonth(addMonths(month, -1))}>
            <ChevronLeft />
          </IconButton>
          <IconButton label="Next month" variant="secondary" onClick={() => setMonth(addMonths(month, 1))}>
            <ChevronRight />
          </IconButton>
          <Button variant="secondary" onClick={() => { setMonth(new Date()); setSelected(iso(new Date())); }}>
            Today
          </Button>
          <h2 className="t-section ml-2" aria-live="polite">
            {format(month, 'MMMM yyyy')}
          </h2>
        </div>
        <div className="inline-flex rounded-md border border-border bg-surface-subtle p-0.5" role="group" aria-label="Calendar layout">
          {(['month', 'agenda'] as const).map((m) => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => url.set({ cal: m === 'month' ? null : m }, { resetPage: false })} className={cn('tr-colors h-8 rounded-[6px] px-3 text-[13px] font-medium', mode === m ? 'bg-surface text-ink shadow-[0_0_0_1px_var(--border)]' : 'text-ink-3 hover:text-ink')}>
              {m === 'month' ? 'Month' : 'Agenda'}
            </button>
          ))}
        </div>
      </div>

      {kindsPresent.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Show on the calendar">
          {kindsPresent.map((k) => {
            const s = KIND_STYLE[k];
            const off = hidden.has(k);
            return (
              <li key={k}>
                <button
                  type="button"
                  aria-pressed={!off}
                  onClick={() => setHidden((h) => { const n = new Set(h); if (n.has(k)) n.delete(k); else n.add(k); return n; })}
                  className={cn('tr-colors inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium', off ? 'border-border bg-surface text-ink-3 line-through' : 'border-border-strong bg-surface text-ink')}
                >
                  <span className="size-2.5 rounded-[3px]" style={{ background: s.color }} aria-hidden />
                  {s.label}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {q.isError && !q.data ? (
        <Card>
          <ErrorPanel error={q.error} onRetry={() => void q.refetch()} title="We couldn’t load the calendar" />
        </Card>
      ) : q.isPending ? (
        <Skeleton className="h-[520px] w-full" aria-busy />
      ) : mode === 'agenda' ? (
        <Card>
          <CardBody className="p-0">
            {monthItems.length === 0 ? (
              <EmptyState illustration="empty-events" compact title="Nothing on the calendar this month" description="Events, holidays and exam dates show up here." />
            ) : (
              <ol className="divide-y divide-border">
                {monthItems.map(([day, list]) => (
                  <li key={day} className="grid gap-3 px-4 py-3 sm:grid-cols-[120px_minmax(0,1fr)]">
                    <p className={cn('text-sm font-medium', isToday(parseISO(day)) && 'text-accent-ink')}>
                      {format(parseISO(day), 'EEE d MMM')}
                      {isToday(parseISO(day)) && <span className="t-caption ml-2 rounded bg-accent-soft px-1.5 py-0.5 text-accent-ink">Today</span>}
                    </p>
                    <ul className="space-y-1.5">
                      {list.map((i) => (
                        <ItemRow key={`${i.id}-${day}`} i={i} href={linkFor(i)} />
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
            )}
          </CardBody>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <Card className="overflow-hidden">
            <table className="w-full table-fixed border-collapse" aria-label={`Calendar, ${format(month, 'MMMM yyyy')}`}>
              <thead>
                <tr>
                  {WEEKDAYS.map((d) => (
                    <th key={d} scope="col" className="t-colhead h-9 border-b border-border bg-surface-subtle text-center text-ink-2">
                      {d}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {weeks.map((w) => (
                  <tr key={iso(w[0]!)}>
                    {w.map((d) => {
                      const k = iso(d);
                      const list = byDay.get(k) ?? [];
                      const out = !isSameMonth(d, month);
                      const sel = selected === k;
                      return (
                        <td key={k} className={cn('h-[84px] border-b border-r border-border p-0 align-top last:border-r-0 sm:h-[104px]', out && 'bg-surface-subtle/60')}>
                          <button type="button" onClick={() => setSelected(k)} aria-pressed={sel} aria-label={`${format(d, 'EEEE d MMMM')}, ${list.length} item${list.length === 1 ? '' : 's'}`} className={cn('tr-colors flex size-full flex-col items-stretch gap-1 p-1 text-left hover:bg-surface-subtle focus-visible:bg-surface-subtle sm:p-1.5', sel && 'bg-brand-soft hover:bg-brand-soft')}>
                            <span className={cn('grid size-6 place-items-center self-end rounded-full text-[12px] font-medium sm:self-start', out ? 'text-ink-3' : 'text-ink', isToday(d) && 'bg-accent text-white')}>{d.getDate()}</span>
                            <span className="hidden min-w-0 flex-1 flex-col gap-0.5 sm:flex">
                              {list.slice(0, 2).map((i) => (
                                <span key={i.id} className="flex min-w-0 items-center gap-1 rounded-[4px] bg-surface-sunken px-1 py-0.5 text-[11px] leading-4" style={{ borderLeft: `3px solid ${KIND_STYLE[i.kind].color}` }}>
                                  <span className="truncate">{i.title}</span>
                                </span>
                              ))}
                              {list.length > 2 && <span className="text-[11px] text-ink-3">+{list.length - 2} more</span>}
                            </span>
                            <span className="flex flex-wrap justify-end gap-0.5 sm:hidden" aria-hidden>
                              {list.slice(0, 4).map((i) => (
                                <span key={i.id} className="size-1.5 rounded-full" style={{ background: KIND_STYLE[i.kind].color }} />
                              ))}
                            </span>
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Card className="self-start">
            <CardBody>
              <h3 className="t-section">{format(parseISO(selected), 'EEEE d MMMM')}</h3>
              {selectedItems.length === 0 ? (
                <p className="mt-2 text-sm text-ink-2">Nothing scheduled.</p>
              ) : (
                <ul className="mt-3 space-y-2" aria-label={`Items on ${selected}`}>
                  {selectedItems.map((i) => (
                    <ItemRow key={i.id} i={i} href={linkFor(i)} />
                  ))}
                </ul>
              )}
              {format(parseISO(selected), 'yyyy-MM') !== format(month, 'yyyy-MM') && <p className="t-caption mt-3 text-ink-3">This day belongs to a neighbouring month.</p>}
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  );
}

function ItemRow({ i, href }: { i: CalendarItem; href: string | null }) {
  const s = KIND_STYLE[i.kind];
  const body = (
    <>
      <s.Icon className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{i.title}</span>
        <span className="t-caption block text-ink-2">
          {s.label} · {when(i)}
          {i.location ? ` · ${i.location}` : ''}
          {i.status === 'cancelled' ? ' · Cancelled' : ''}
        </span>
        {i.subtitle && i.kind !== 'event' && <span className="t-caption block text-ink-3">{i.subtitle}</span>}
      </span>
    </>
  );
  const cls = 'flex items-start gap-2 rounded-md border-l-[3px] bg-surface-subtle px-2.5 py-2';
  // the Join link sits next to the item (not inside its link: a link must not contain another interactive element)
  const join = i.status !== 'cancelled' ? <JoinButton url={i.joinUrl} /> : null;
  return (
    <li className={cn(join && 'flex flex-wrap items-start gap-1.5 sm:flex-nowrap')}>
      {href ? (
        <Link href={href} className={cn(cls, 'tr-colors hover:bg-surface-sunken min-w-0 flex-1', i.status === 'cancelled' && 'opacity-70')} style={{ borderLeftColor: s.color }}>
          {body}
        </Link>
      ) : (
        <div className={cn(cls, 'min-w-0 flex-1')} style={{ borderLeftColor: s.color }}>
          {body}
        </div>
      )}
      {join && <div className="shrink-0 pt-1">{join}</div>}
    </li>
  );
}
