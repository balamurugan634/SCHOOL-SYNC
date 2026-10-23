'use client';

import * as React from 'react';
import { CheckCircle2, LogIn, LogOut, Lock } from 'lucide-react';
import type { StaffAttendanceRecord } from '@school-sync/shared';
import { fmtClock, fmtDate, fmtMonth, percent, plural, todayIso } from '@/lib/format';
import { commsError } from '@/lib/client/teacher-comms';
import { useCheckInOut, useMyStaffAttendance } from '@/lib/client/teacher-me';
import { usePermissions } from '@/components/me-context';
import { StatusChip } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { DatePicker } from '@/components/ui/date-picker';
import { EmptyState } from '@/components/ui/empty-state';
import { ProgressRing } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { StatTile } from '@/components/ui/stat-tile';
import { toast } from '@/components/ui/toaster';
import { ErrorCard, FilterSelect, useUrlState, useWriteGate } from '../common';

const isoPlus = (iso: string, days: number): string => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const RANGES: Record<string, string> = { '30d': 'Last 30 days', month: 'This month', '90d': 'Last 3 months', custom: 'Custom dates' };

/** "07:10", "16:31" → minutes between them (null when either is missing). */
const minutes = (a: string | null, b: string | null): number | null => {
  if (!a || !b) return null;
  const [ah, am] = a.split(':').map(Number) as [number, number];
  const [bh, bm] = b.split(':').map(Number) as [number, number];
  const d = bh * 60 + bm - (ah * 60 + am);
  return d >= 0 ? d : null;
};
const hm = (m: number | null) => (m === null ? '—' : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`);

const PAGE_SIZE = 10;

export function StaffAttendanceScreen() {
  const url = useUrlState();
  const today = todayIso();
  const range = RANGES[url.get('range', '30d')] ? url.get('range', '30d') : '30d';
  const page = url.num('page', 1);
  const bounds = React.useMemo(() => {
    if (range === 'month') return { from: `${today.slice(0, 7)}-01`, to: today };
    if (range === '90d') return { from: isoPlus(today, -89), to: today };
    if (range === 'custom') {
      const f = url.get('from') || isoPlus(today, -29);
      const t = url.get('to') || today;
      return f <= t ? { from: f, to: t } : { from: t, to: f };
    }
    return { from: isoPlus(today, -29), to: today };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, url.sp, today]);
  const q = useMyStaffAttendance(bounds);
  const d = q.data;
  const records = React.useMemo(() => [...(d?.records ?? [])].sort((a, b) => b.date.localeCompare(a.date)), [d]);
  const tooLong = range === 'custom' && Math.round((new Date(bounds.to).getTime() - new Date(bounds.from).getTime()) / 86_400_000) > 365;

  return (
    <div className="space-y-6">
      <TodayCard q={q} />

      <div className="flex flex-wrap items-end gap-3">
        <FilterSelect label="Period" value={range === '30d' ? '' : range} onChange={(v) => url.set({ range: v || null, from: null, to: null })} allLabel={RANGES['30d']!} options={Object.entries(RANGES).filter(([k]) => k !== '30d').map(([value, label]) => ({ value, label }))} />
        {range === 'custom' && (
          <>
            <label className="flex flex-col gap-1 text-[13px] font-medium">
              From
              <DatePicker className="w-40" value={bounds.from} max={today} onChange={(v) => url.set({ from: v })} />
            </label>
            <label className="flex flex-col gap-1 text-[13px] font-medium">
              To
              <DatePicker className="w-40" value={bounds.to} max={today} onChange={(v) => url.set({ to: v })} />
            </label>
          </>
        )}
        <p className="t-caption pb-2 text-ink-2" suppressHydrationWarning>
          {fmtDate(bounds.from)} – {fmtDate(bounds.to)}
        </p>
      </div>
      {tooLong && <Banner tone="warning">The longest range the school can show is 366 days. Shorten the dates.</Banner>}

      {q.isError && !d ? (
        <ErrorCard error={q.error} onRetry={() => void q.refetch()} title="We couldn’t load your attendance" />
      ) : (
        <>
          <section aria-label="Attendance summary" className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
            <Card>
              <CardBody className="flex items-center gap-4">
                {q.isPending || !d ? (
                  <Skeleton className="size-[88px] rounded-full" />
                ) : (
                  <ProgressRing value={(d.totals.percentage ?? 0) / 100} size={88} stroke={8} tone={d.totals.percentage === null ? 'neutral' : d.totals.percentage >= 90 ? 'success' : d.totals.percentage >= 75 ? 'warning' : 'danger'} label="Your attendance percentage">
                    <span className="figure text-xl leading-6">{percent(d.totals.percentage, 0)}</span>
                  </ProgressRing>
                )}
                <div>
                  <p className="t-section">Attendance</p>
                  <p className="t-caption text-ink-2">{d ? (d.totals.total === 0 ? 'Nothing recorded in this period.' : `${plural(d.totals.total, 'recorded day')}, ${percent(d.totals.percentage)} counted present`) : 'Loading…'}</p>
                </div>
              </CardBody>
            </Card>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {(
                [
                  ['Present', d?.totals.present],
                  ['Late', d?.totals.late],
                  ['Half day', d?.totals.half_day],
                  ['Absent', d?.totals.absent],
                ] as const
              ).map(([label, v]) => (
                <StatTile key={label} label={label} value={v} state={q.isPending ? 'loading' : 'ready'} hint={label === 'Present' && d && d.totals.leave > 0 ? `${d.totals.leave} on leave` : undefined} />
              ))}
            </div>
          </section>

          <section aria-labelledby="hist" className="space-y-3">
            <h2 id="hist" className="t-section">Daily record</h2>
            <DataTable
              id="teacher-staff-attendance"
              caption="My daily attendance"
              compact
              rows={records.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)}
              rowKey={(r) => r.id}
              loading={q.isPending}
              page={page}
              pageSize={PAGE_SIZE}
              total={records.length}
              onPageChange={(p) => url.set({ page: p }, { keepPage: true })}
              columns={[
                { id: 'date', header: 'Date', mobile: 'title', hideable: false, cell: (r) => fmtDate(r.date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) },
                { id: 'status', header: 'Status', mobile: 'status', cell: (r) => <StatusChip status={r.status} /> },
                { id: 'in', header: 'Checked in', mobile: 'detail', label: 'Checked in', cell: (r) => (r.checkIn ? fmtClock(r.checkIn) : '—') },
                { id: 'out', header: 'Checked out', mobile: 'detail', label: 'Checked out', cell: (r) => (r.checkOut ? fmtClock(r.checkOut) : '—') },
                { id: 'hours', header: 'Time at school', mobile: 'detail', label: 'Time at school', align: 'right', cell: (r) => hm(minutes(r.checkIn, r.checkOut)) },
                { id: 'note', header: 'Note', mobile: 'sub', defaultHidden: true, cell: (r) => (r.note ?? '') },
              ]}
              empty={<EmptyState illustration="empty-generic" title="No attendance in this period" description="Your check-ins and anything the school office records for you appear here." />}
            />
          </section>

          <MonthlySummary records={records} loading={q.isPending} />
        </>
      )}
    </div>
  );
}

/* ───────────────────────── today ───────────────────────── */

function TodayCard({ q }: { q: ReturnType<typeof useMyStaffAttendance> }) {
  const { can } = usePermissions();
  const gate = useWriteGate();
  const mut = useCheckInOut();
  const [error, setError] = React.useState<string | null>(null);
  const t: StaffAttendanceRecord | null | undefined = q.data?.today;
  const canMark = can('staff_attendance:create');

  const go = (kind: 'check-in' | 'check-out') => {
    setError(null);
    mut.mutate(kind, {
      onSuccess: (r) => toast.success(kind === 'check-in' ? `Checked in at ${fmtClock(r.checkIn ?? '')}` : `Checked out at ${fmtClock(r.checkOut ?? '')}`),
      onError: (e) => {
        const m = commsError(e);
        setError(m);
        toast.error(m, { duration: 8000 });
      },
    });
  };

  const state: 'loading' | 'none' | 'in' | 'out' | 'office' = q.isPending && !q.data ? 'loading' : !t ? 'none' : !t.checkIn ? 'office' : t.checkOut ? 'out' : 'in';

  return (
    <Card>
      <CardHeader title="Today" description={<span suppressHydrationWarning>{fmtDate(todayIso(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span>} />
      <CardBody className="space-y-4 pt-4">
        {error && <Banner tone="danger" onDismiss={() => setError(null)}>{error}</Banner>}
        {state === 'loading' ? (
          <div className="space-y-3">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-12 w-44" />
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0 space-y-1" aria-live="polite">
              {state === 'none' && (
                <>
                  <p className="figure text-2xl leading-8">Not checked in yet</p>
                  <p className="t-caption text-ink-2">Check in when you arrive. Arriving more than 10 minutes after the first period starts is recorded as late.</p>
                </>
              )}
              {state === 'in' && t && (
                <>
                  <p className="figure flex flex-wrap items-center gap-3 text-2xl leading-8">
                    Checked in at {fmtClock(t.checkIn!)} <StatusChip status={t.status} />
                  </p>
                  <p className="t-caption text-ink-2">Check out when you leave, so your day is complete.</p>
                </>
              )}
              {state === 'out' && t && (
                <>
                  <p className="figure flex flex-wrap items-center gap-3 text-2xl leading-8">
                    <CheckCircle2 className="size-6 text-success" aria-hidden /> Day complete <StatusChip status={t.status} />
                  </p>
                  <p className="t-caption text-ink-2">
                    In at {fmtClock(t.checkIn!)}, out at {fmtClock(t.checkOut!)} · {hm(minutes(t.checkIn, t.checkOut))} at school.
                  </p>
                </>
              )}
              {state === 'office' && t && (
                <>
                  <p className="figure flex flex-wrap items-center gap-3 text-2xl leading-8">
                    Recorded by the school office <StatusChip status={t.status} />
                  </p>
                  <p className="t-caption flex items-center gap-1.5 text-ink-2">
                    <Lock className="size-3.5" aria-hidden /> The office has already marked you for today, so you can’t check in or out yourself.
                    {t.note ? ` Note: ${t.note}` : ''}
                  </p>
                </>
              )}
            </div>
            {canMark && (state === 'none' || state === 'in') && (
              <Button size="lg" className="min-w-40" loading={mut.isPending} disabled={gate.readOnly} title={gate.reason} onClick={() => go(state === 'none' ? 'check-in' : 'check-out')}>
                {state === 'none' ? <LogIn /> : <LogOut />}
                {state === 'none' ? 'Check in' : 'Check out'}
              </Button>
            )}
          </div>
        )}
        {!canMark && state !== 'loading' && <p className="t-caption text-ink-2">Your role doesn’t include self check-in. The school office records your attendance.</p>}
      </CardBody>
    </Card>
  );
}

/* ───────────────────────── by month ───────────────────────── */

function MonthlySummary({ records, loading }: { records: StaffAttendanceRecord[]; loading: boolean }) {
  const months = React.useMemo(() => {
    const m = new Map<string, { month: string; present: number; late: number; half_day: number; absent: number; leave: number }>();
    for (const r of records) {
      const k = r.date.slice(0, 7);
      const row = m.get(k) ?? { month: k, present: 0, late: 0, half_day: 0, absent: 0, leave: 0 };
      row[r.status] += 1;
      m.set(k, row);
    }
    return [...m.values()].sort((a, b) => b.month.localeCompare(a.month)).map((r) => {
      const denom = r.present + r.late + r.half_day + r.absent;
      return { ...r, days: denom + r.leave, pct: denom === 0 ? null : ((r.present + r.late + r.half_day / 2) / denom) * 100 };
    });
  }, [records]);

  return (
    <section aria-labelledby="monthly" className="space-y-3">
      <h2 id="monthly" className="t-section">By month</h2>
      <DataTable
        id="teacher-staff-attendance-months"
        caption="My attendance by month"
        compact
        rows={months}
        rowKey={(r) => r.month}
        loading={loading}
        columns={[
          { id: 'month', header: 'Month', mobile: 'title', hideable: false, cell: (r) => fmtMonth(r.month) },
          { id: 'pct', header: 'Attendance', mobile: 'status', align: 'right', cell: (r) => percent(r.pct) },
          { id: 'present', header: 'Present', mobile: 'detail', align: 'right', cell: (r) => r.present },
          { id: 'late', header: 'Late', mobile: 'detail', align: 'right', cell: (r) => r.late },
          { id: 'half', header: 'Half day', mobile: 'detail', align: 'right', cell: (r) => r.half_day },
          { id: 'absent', header: 'Absent', mobile: 'detail', align: 'right', cell: (r) => r.absent },
          { id: 'leave', header: 'On leave', mobile: 'detail', align: 'right', cell: (r) => r.leave },
        ]}
        empty={<EmptyState compact title="No months to summarise" description="Pick a period with recorded days." />}
      />
      <p className="t-caption text-ink-3">Attendance counts present, late and half days against the days you were expected; days on approved leave are left out.</p>
    </section>
  );
}
