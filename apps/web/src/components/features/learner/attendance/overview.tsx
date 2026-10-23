'use client';

import * as React from 'react';
import { Info } from 'lucide-react';
import type { AttendanceStudentSummaryResponse } from '@school-sync/shared';
import { useAttendanceMonth, useAttendanceSummary } from '@/lib/client/learner-attendance';
import { fmtDate, fmtMonth, fmtMonthShort, percent, plural, todayIso } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Banner } from '@/components/ui/banner';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ChartCard } from '@/components/ui/chart';
import { ProgressRing } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { BarSeries } from '@/components/charts/series-charts';
import { ErrorState } from '../states';
import { useLearner } from '../use-learner';
import { useUrlParams } from '../url-state';
import { DayGrid, MonthHeatStrip, monthOf } from './heat';
import { STATUS_ORDER, STATUS_VIEW } from './status';

const pctTone = (p: number | null, threshold: number) => (p === null ? 'neutral' : p < threshold ? 'danger' : p < threshold + 10 ? 'warning' : 'success');

function SummaryCard({ s }: { s: AttendanceStudentSummaryResponse }) {
  const l = useLearner();
  const pct = s.totals.percentage;
  const tone = pctTone(pct, s.shortage.thresholdPercent);
  return (
    <Card>
      <CardBody className="flex flex-col gap-5 sm:flex-row sm:items-center">
        <div className="flex items-center gap-4">
          <ProgressRing value={(pct ?? 0) / 100} size={96} stroke={9} tone={tone} label={pct === null ? 'No attendance recorded yet' : `Attendance ${percent(pct)}`}>
            <span className="figure text-[22px] leading-6">{pct === null ? '—' : percent(pct)}</span>
          </ProgressRing>
          <div className="min-w-0">
            <p className="t-section">{l.isParent ? `${l.name}’s attendance` : 'Your attendance'}</p>
            <p className="t-caption text-ink-2">
              {fmtDate(s.from)} to {fmtDate(s.to)}
            </p>
            <p className="t-caption mt-1 text-ink-2">
              {plural(s.totals.total, 'school day')} marked
              {s.totals.leave > 0 ? ' · days on approved leave are not counted against you' : ''}
            </p>
          </div>
        </div>
        <dl className="grid flex-1 grid-cols-3 gap-3 sm:grid-cols-5 sm:pl-4">
          {STATUS_ORDER.map((st) => {
            const v = STATUS_VIEW[st];
            return (
              <div key={st} className="rounded-md bg-surface-subtle px-3 py-2">
                <dt className="t-caption flex items-center gap-1 text-ink-2">
                  <v.icon className="size-3.5" aria-hidden /> {v.label}
                </dt>
                <dd className="figure text-[24px] leading-8">{s.totals[st]}</dd>
              </div>
            );
          })}
        </dl>
      </CardBody>
      {s.shortage.isShort && (
        <div className="px-5 pb-5 max-sm:px-4 max-sm:pb-4">
          <Banner tone="warning" title={`Below the ${s.shortage.thresholdPercent}% attendance requirement`}>
            Attendance under {s.shortage.thresholdPercent}% can affect exam eligibility. Please speak to the class teacher about catching up.
          </Banner>
        </div>
      )}
    </Card>
  );
}

function MonthlyChart({ s }: { s: AttendanceStudentSummaryResponse }) {
  const rows = s.months.map((m) => ({ month: m.month, label: fmtMonthShort(m.month), percentage: m.percentage ?? 0, present: m.present, late: m.late, half_day: m.half_day, leave: m.leave, absent: m.absent, total: m.total }));
  const withData = s.months.filter((m) => m.percentage !== null);
  const best = withData.length ? withData.reduce((a, b) => ((b.percentage ?? 0) > (a.percentage ?? 0) ? b : a)) : null;
  const worst = withData.length ? withData.reduce((a, b) => ((b.percentage ?? 0) < (a.percentage ?? 0) ? b : a)) : null;
  const summary = best && worst ? (best.month === worst.month ? `Attendance in ${fmtMonth(best.month)} was ${percent(best.percentage)}.` : `Highest in ${fmtMonth(best.month)} at ${percent(best.percentage)}, lowest in ${fmtMonth(worst.month)} at ${percent(worst.percentage)}.`) : undefined;
  const pctFmt = (v: unknown) => (typeof v === 'number' ? percent(v) : '—');
  return (
    <ChartCard
      title="Month by month"
      description="Attendance percentage for each month of the academic year"
      summary={summary}
      height={220}
      empty={rows.length === 0}
      emptyText="Attendance will appear here once the first days are marked."
      table={{
        columns: [
          { key: 'month', label: 'Month', format: (v) => fmtMonth(String(v)) },
          { key: 'present', label: 'Present', align: 'right' },
          { key: 'late', label: 'Late', align: 'right' },
          { key: 'half_day', label: 'Half day', align: 'right' },
          { key: 'leave', label: 'Leave', align: 'right' },
          { key: 'absent', label: 'Absent', align: 'right' },
          { key: 'percentage', label: 'Attendance', align: 'right', format: pctFmt },
        ],
        rows,
      }}
    >
      <BarSeries data={rows} xKey="label" yKey="percentage" label="Attendance %" height={220} yFormat={(v) => `${v}%`} valueFormat={(v) => percent(v)} tooltipLabel={(v) => String(v)} />
    </ChartCard>
  );
}

/** Summary + chart + heat strip + daily grid for the learner on screen. */
export function AttendanceOverview() {
  const l = useLearner();
  const { get, set } = useUrlParams();
  const summary = useAttendanceSummary(l.studentId);
  const s = summary.data;
  const currentMonth = monthOf(todayIso());
  const lastMonth = s ? monthOf(s.to) : currentMonth;
  const requested = get('month');
  const month = requested && /^\d{4}-(0[1-9]|1[0-2])$/.test(requested) ? requested : lastMonth;
  const monthQ = useAttendanceMonth(l.studentId, month);

  if (summary.isPending) {
    return (
      <div className="space-y-6" aria-busy="true">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }
  if (summary.isError && !s) {
    return (
      <Card>
        <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />
      </Card>
    );
  }
  if (!s) return null;
  if (s.totals.total === 0 && s.months.length === 0) {
    return (
      <Card>
        <EmptyState illustration="empty-events" title="No attendance has been marked yet" description={`Once the class teacher takes attendance, ${l.isParent ? `${l.name}’s` : 'your'} record, monthly trend and calendar appear here.`} />
      </Card>
    );
  }
  const setMonth = (m: string) => set({ month: m === lastMonth ? null : m });
  return (
    <div className="space-y-6">
      <SummaryCard s={s} />
      <Card>
        <CardHeader title="Months at a glance" description="Darker means higher attendance. Pick a month to see its days." />
        <CardBody className="pt-4">
          <MonthHeatStrip summary={s} picked={month} onPick={setMonth} />
        </CardBody>
      </Card>
      <DayGrid month={month} onMonth={setMonth} records={monthQ.data} loading={monthQ.isFetching} error={monthQ.isError ? monthQ.error : null} onRetry={() => void monthQ.refetch()} min={monthOf(s.from)} max={lastMonth} />
      <MonthlyChart s={s} />
      <p className={cn('t-caption text-ink-3', 'flex items-start gap-1.5')}>
        <Info className="mt-px size-3.5 shrink-0" aria-hidden />
        Percentage = (present + late + ½ half-days) ÷ days marked. Days on approved leave are left out.
      </p>
    </div>
  );
}
