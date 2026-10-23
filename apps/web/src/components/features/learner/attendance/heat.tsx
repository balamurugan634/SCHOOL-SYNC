'use client';

import * as React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { AttendanceStatus, AttendanceStudentSummaryResponse } from '@school-sync/shared';
import { cn } from '@/lib/cn';
import { dateOnly, fmtMonth, fmtMonthShort, percent, todayIso } from '@/lib/format';
import { IconButton } from '@/components/ui/icon-button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '../states';
import type { AttendanceRecord } from '@/lib/client/learner-attendance';
import { SEVERITY, STATUS_ORDER, STATUS_VIEW } from './status';

// ───────────────────────────── monthly heat strip (sequential palette) ─────────────────────────────

/** 7 steps of the single-hue sequential ramp. Higher attendance = more intense; ranges are printed in the legend. */
const STEPS = [
  { seq: 1, min: 0, label: 'Under 60%' },
  { seq: 2, min: 60, label: '60–69%' },
  { seq: 3, min: 70, label: '70–79%' },
  { seq: 4, min: 80, label: '80–87%' },
  { seq: 5, min: 88, label: '88–93%' },
  { seq: 6, min: 94, label: '94–97%' },
  { seq: 7, min: 98, label: '98–100%' },
] as const;
const stepFor = (pct: number) => [...STEPS].reverse().find((s) => pct >= s.min) ?? STEPS[0];

function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const [fy, fm] = from.slice(0, 7).split('-').map(Number) as [number, number];
  const [ty, tm] = to.slice(0, 7).split('-').map(Number) as [number, number];
  for (let y = fy, m = fm; y < ty || (y === ty && m <= tm); m === 12 ? ((y += 1), (m = 1)) : (m += 1)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    if (out.length >= 14) break;
  }
  return out;
}

/** Month-by-month attendance for the academic year as a heat strip. The number is printed under each cell, never inside it. */
export function MonthHeatStrip({ summary, onPick, picked }: { summary: AttendanceStudentSummaryResponse; onPick?: (month: string) => void; picked?: string }) {
  const byMonth = new Map(summary.months.map((m) => [m.month, m]));
  const months = monthsBetween(summary.from, summary.to);
  return (
    <div>
      <ol className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-12" aria-label="Attendance by month">
        {months.map((m) => {
          const stat = byMonth.get(m);
          const pct = stat?.percentage ?? null;
          const step = pct === null ? null : stepFor(pct);
          const inner = (
            <>
              <span className={cn('block h-9 rounded-md border', step ? 'border-transparent' : 'border-dashed border-border-strong')} style={step ? { background: `var(--seq-${step.seq})` } : undefined} aria-hidden />
              <span className="t-caption mt-1.5 block text-ink-2">{fmtMonthShort(m)}</span>
              <span className="tnum block text-[13px] font-medium">{pct === null ? '—' : percent(pct)}</span>
              <span className="sr-only">{`${fmtMonth(m)}: ${pct === null ? 'no attendance recorded' : `${percent(pct)} attendance`}`}</span>
            </>
          );
          return (
            <li key={m}>
              {onPick ? (
                <button type="button" onClick={() => onPick(m)} aria-pressed={picked === m} className={cn('tr-colors w-full rounded-md p-1 text-left hover:bg-surface-subtle', picked === m && 'bg-surface-subtle ring-1 ring-border-strong')}>
                  {inner}
                </button>
              ) : (
                <div className="p-1">{inner}</div>
              )}
            </li>
          );
        })}
      </ol>
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2" role="group" aria-label="Legend: attendance percentage">
        {STEPS.map((s) => (
          <span key={s.seq} className="t-caption flex items-center gap-1.5 text-ink-2">
            <span className="size-3 rounded-[3px]" style={{ background: `var(--seq-${s.seq})` }} aria-hidden />
            {s.label}
          </span>
        ))}
        <span className="t-caption flex items-center gap-1.5 text-ink-2">
          <span className="size-3 rounded-[3px] border border-dashed border-border-strong" aria-hidden />
          No record
        </span>
      </div>
    </div>
  );
}

// ───────────────────────────── daily month grid (status tokens) ─────────────────────────────

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const pad = (n: number) => String(n).padStart(2, '0');
export const monthOf = (iso: string) => iso.slice(0, 7);
export const shiftMonth = (ym: string, delta: number): string => {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};

export function DayGrid({
  month,
  onMonth,
  records,
  loading,
  error,
  onRetry,
  min,
  max,
}: {
  month: string;
  onMonth: (m: string) => void;
  records: AttendanceRecord[] | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  /** earliest / latest month that makes sense (summary range) */
  min?: string;
  max?: string;
}) {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const days = new Date(y, m, 0).getDate();
  const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7; // Monday first
  const today = todayIso();
  const byDay = React.useMemo(() => {
    const map = new Map<string, AttendanceStatus>();
    for (const r of records ?? []) {
      const prev = map.get(r.date);
      if (!prev || SEVERITY[r.status] > SEVERITY[prev]) map.set(r.date, r.status);
    }
    return map;
  }, [records]);
  const counts = React.useMemo(() => {
    const c: Record<AttendanceStatus, number> = { present: 0, late: 0, half_day: 0, leave: 0, absent: 0 };
    byDay.forEach((s) => (c[s] += 1));
    return c;
  }, [byDay]);

  return (
    <Card>
      <CardHeader
        title={fmtMonth(month)}
        description="Each day with a mark shows its status. Days without a mark — weekends, holidays, days ahead — are left empty."
        action={
          <div className="flex items-center gap-1">
            <IconButton label="Previous month" variant="secondary" size="icon-sm" onClick={() => onMonth(shiftMonth(month, -1))} disabled={!!min && month <= min}>
              <ChevronLeft />
            </IconButton>
            <IconButton label="Next month" variant="secondary" size="icon-sm" onClick={() => onMonth(shiftMonth(month, 1))} disabled={!!max && month >= max}>
              <ChevronRight />
            </IconButton>
          </div>
        }
      />
      <CardBody className="pt-4">
        {error && !records ? (
          <ErrorState error={error} onRetry={onRetry} compact />
        ) : loading && !records ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <>
            <div className="grid grid-cols-7 gap-1 sm:gap-1.5" role="group" aria-label={`Daily attendance for ${fmtMonth(month)}`} aria-busy={loading || undefined}>
              {WEEKDAYS.map((d) => (
                <span key={d} className="t-caption pb-1 text-center text-ink-3" aria-hidden>
                  {d}
                </span>
              ))}
              {Array.from({ length: lead }, (_, i) => (
                <span key={`b${i}`} aria-hidden />
              ))}
              {Array.from({ length: days }, (_, i) => {
                const d = i + 1;
                const iso = `${month}-${pad(d)}`;
                const status = byDay.get(iso);
                const view = status ? STATUS_VIEW[status] : null;
                const isToday = iso === today;
                const long = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' }).format(dateOnly(iso));
                return (
                  <div
                    key={iso}
                    className={cn('relative flex aspect-square min-h-11 flex-col items-center justify-center rounded-md text-[13px] sm:min-h-14', view ? view.cell : 'border border-dashed border-border text-ink-3', isToday && 'ring-2 ring-accent ring-offset-1 ring-offset-surface')}
                    title={view ? `${long}: ${view.label}` : undefined}
                    aria-hidden={view ? undefined : true}
                  >
                    <span className="tnum font-medium">{d}</span>
                    {view && <view.icon className="mt-0.5 size-3.5" aria-hidden />}
                    {view && <span className="sr-only">{`${long}: ${view.label}${isToday ? ' (today)' : ''}`}</span>}
                  </div>
                );
              })}
            </div>
            <ul className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2" aria-label="Legend and counts for this month">
              {STATUS_ORDER.map((s) => {
                const v = STATUS_VIEW[s];
                return (
                  <li key={s} className="t-caption flex items-center gap-1.5 text-ink-2">
                    <span className={cn('grid size-5 place-items-center rounded-[5px]', v.cell)}>
                      <v.icon className="size-3" aria-hidden />
                    </span>
                    {v.label} <span className="tnum font-medium text-ink">{counts[s]}</span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </CardBody>
    </Card>
  );
}
