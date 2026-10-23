'use client';

import * as React from 'react';
import type { AttendanceStatus } from '@school-sync/shared';
import { StatusChip } from '@/components/ui/badge';
import type { SelectOption } from '@/components/ui/select';
import { percent, plural, fmtDate } from '@/lib/format';

export const STATUS_ORDER: AttendanceStatus[] = ['present', 'late', 'half_day', 'absent', 'leave'];
export const STATUS_WORD: Record<AttendanceStatus, string> = { present: 'Present', late: 'Late', half_day: 'Half day', absent: 'Absent', leave: 'On leave' };
export const statusOptions: SelectOption[] = STATUS_ORDER.map((s) => ({ value: s, label: STATUS_WORD[s] }));

/** Chip + count for each status, in a wrapping row (day totals). Zero counts stay visible so the row is stable. */
export function StatusCounts({ counts, unmarked, className }: { counts: Record<AttendanceStatus, number>; unmarked?: number; className?: string }) {
  return (
    <dl className={className ?? 'flex flex-wrap gap-x-5 gap-y-3'}>
      {STATUS_ORDER.map((s) => (
        <div key={s} className="min-w-[4.5rem]">
          <dt>
            <StatusChip status={s} />
          </dt>
          <dd className="figure mt-1 text-xl leading-7">{counts[s].toLocaleString()}</dd>
        </div>
      ))}
      {unmarked !== undefined && (
        <div className="min-w-[4.5rem]">
          <dt>
            <StatusChip status="todo" label="Not marked" />
          </dt>
          <dd className="figure mt-1 text-xl leading-7">{unmarked.toLocaleString()}</dd>
        </div>
      )}
    </dl>
  );
}

/** Y axis band just below the lowest day, up to 100 %, with whole-number ticks (same idea as the dashboard trend). */
export function trendAxis(t: { percentPresent: number | null }[]): { domain: [number, number]; ticks: number[] } {
  const v = t.map((x) => x.percentPresent).filter((x): x is number => x !== null);
  const lo = v.length ? Math.max(0, Math.floor((Math.min(...v) - 1) / 5) * 5) : 90;
  const step = Math.max(1, Math.round((100 - lo) / 5));
  const ticks = Array.from({ length: Math.floor((100 - lo) / step) + 1 }, (_, i) => lo + i * step);
  return { domain: [lo, 100], ticks: ticks[ticks.length - 1] === 100 ? ticks : [...ticks, 100] };
}

export function trendSummary(t: { date: string; percentPresent: number | null }[]): string {
  const v = t.filter((x) => x.percentPresent !== null);
  if (v.length === 0) return 'No attendance was marked in this period.';
  const avg = v.reduce((a, x) => a + (x.percentPresent ?? 0), 0) / v.length;
  const low = v.reduce((m, x) => ((x.percentPresent ?? 100) < (m.percentPresent ?? 100) ? x : m), v[0]!);
  const last = v[v.length - 1]!;
  return `Averaged ${percent(avg)} present over ${plural(v.length, 'school day')}. The lowest day was ${fmtDate(low.date, { day: 'numeric', month: 'short' })} at ${percent(low.percentPresent)}; the latest (${fmtDate(last.date, { day: 'numeric', month: 'short' })}) was ${percent(last.percentPresent)}.`;
}

export const shortDate = (s: string) => fmtDate(s, { day: 'numeric', month: 'short' });
export const longDate = (s: string) => fmtDate(s, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

/** A heading + optional description above a table (the table draws its own card; no card-in-card). */
export function TableSection({ title, description, actions, children }: { title: string; description?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode }) {
  const id = React.useId();
  return (
    <section aria-labelledby={id}>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 id={id} className="t-section">
            {title}
          </h2>
          {description && <p className="t-caption mt-0.5 text-ink-2">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}
