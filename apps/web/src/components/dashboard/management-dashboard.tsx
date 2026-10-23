'use client';

import * as React from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, CheckCircle2, ChevronRight, Info, OctagonAlert } from 'lucide-react';
import type { ManagementDashboard as Dash } from '@school-sync/shared';
import { useManagementDashboard } from '@/lib/client/hooks';
import { fmtDate, fmtMonth, fmtMonthShort, fmtDay, money, moneyCompact, percent, plural } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Badge, StatusChip } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardBody, CardHeader } from '../ui/card';
import { ChartCard } from '../ui/chart';
import { EmptyState } from '../ui/empty-state';
import { ProgressBar } from '../ui/progress';
import { Reveal, useFirstLoad } from '../ui/reveal';
import { Skeleton } from '../ui/skeleton';
import { StatTile } from '../ui/stat-tile';
import { BarSeries, LineSeries } from '../charts/series-charts';
import { PageHeader } from '../shell/page-header';
import { LicenseCard } from '../setup/license-card';
import { useMeContext, usePermissions } from '../me-context';
import { errorMessage } from '@/lib/problem';

const APPROVALS: { key: keyof Dash['approvals']; label: string; href: string }[] = [
  { key: 'studentLeave', label: 'Student leave requests', href: '/leave' },
  { key: 'staffLeave', label: 'Staff leave requests', href: '/staff/attendance' },
  { key: 'attendanceCorrections', label: 'Attendance corrections', href: '/attendance' },
  { key: 'markSheetsForReview', label: 'Mark sheets to review', href: '/exams' },
  { key: 'admissions', label: 'Admission applications', href: '/admissions' },
  { key: 'correctionRequests', label: 'Record correction requests', href: '/students' },
  { key: 'concessions', label: 'Fee concessions', href: '/finance/structures' },
  { key: 'refunds', label: 'Refund requests', href: '/finance/payments' },
  { key: 'expenses', label: 'Expenses to approve', href: '/finance/expenses' },
];

/** The management home. Every block is hidden when the API returns `null` for it (the caller may not see it). */
export function ManagementDashboard() {
  const q = useManagementDashboard();
  const first = useFirstLoad('dash:management');
  const { base } = useMeContext();
  const { can, canAny } = usePermissions();
  const d = q.data;
  // While loading we do not yet know which blocks the API will return, so the skeleton mirrors what the caller's
  // permissions imply — otherwise blocks that never arrive (e.g. attendance for an accountant) would shift the page.
  const predicted = {
    attendance: can('attendance:view', 'school'),
    finance: canAny('fees:view', 'payments:view'),
    approvals: ([['leave:approve'], ['staff_leave:approve'], ['attendance:approve'], ['marks:approve'], ['admissions:approve'], ['students:edit'], ['fees:approve'], ['payments:approve'], ['expenses:approve']] as const).filter(([p]) => can(p)).length,
    alerts: can('attendance:view', 'school'),
  };
  const showAttendance = q.isPending ? predicted.attendance : !!d?.attendance;
  const showFinance = q.isPending ? predicted.finance : !!d?.finance;
  const showApprovals = q.isPending ? predicted.approvals > 0 : !!d && hasApprovals(d.approvals);
  const showAlerts = q.isPending ? predicted.alerts : !!d && d.alerts.length > 0;

  return (
    <>
      <PageHeader title="Dashboard" description="The school at a glance, and what needs a decision." actions={d && <Badge variant="accent">{fmtDate(d.date, { weekday: 'long', day: 'numeric', month: 'long' })}</Badge>} />

      {q.isError && !d ? (
        <Card>
          <EmptyState illustration="error-offline" title="We couldn’t load the dashboard" description={errorMessage(q.error)} action={<Button variant="secondary" onClick={() => void q.refetch()}>Try again</Button>} />
        </Card>
      ) : (
        <div className="space-y-6">
          {/* KPI row */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {q.isPending || !d ? (
              [0, 1, 2, 3].map((i) => <StatTile key={i} label="Loading" state="loading" />)
            ) : (
              <>
                <Reveal first={first} index={0}><StatTile label="Students" value={d.kpis.students} hint={`${plural(d.kpis.grades, 'grade')}`} /></Reveal>
                <Reveal first={first} index={1}><StatTile label="Staff" value={d.kpis.staff} /></Reveal>
                <Reveal first={first} index={2}><StatTile label="Parents and guardians" value={d.kpis.parents} /></Reveal>
                <Reveal first={first} index={3}><StatTile label="Classes" value={d.kpis.sections} hint="Sections this year" /></Reveal>
              </>
            )}
          </div>

          {/* children of `contents` wrappers flow as one column on phones (ordered by priority) and as 8 + 4 columns on desktop */}
          <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="contents lg:flex lg:flex-col lg:gap-6">
              {showAttendance && (
                <div className="order-1 lg:order-none">
                  <AttendanceToday d={d} loading={q.isPending} base={base} />
                </div>
              )}
              {showAttendance && (
                <div className="order-4 lg:order-none">
                  <ChartCard
                    title="Attendance, last 7 days"
                    description="Share of marked students present each day"
                    height={220}
                    loading={q.isPending}
                    empty={!!d?.attendance && d.attendance.trend.length === 0}
                    summary={d?.attendance ? trendSummary(d.attendance.trend) : undefined}
                    table={{ columns: [{ key: 'date', label: 'Date' }, { key: 'percentPresent', label: '% present', align: 'right' }, { key: 'present', label: 'Present', align: 'right' }, { key: 'absent', label: 'Absent', align: 'right' }, { key: 'late', label: 'Late', align: 'right' }], rows: (d?.attendance?.trend ?? []).map((t) => ({ ...t, date: fmtDate(t.date, { weekday: 'short', day: 'numeric', month: 'short' }), percentPresent: percent(t.percentPresent) })) }}
                  >
                    <LineSeries data={(d?.attendance?.trend ?? []).map((t) => ({ ...t }))} xKey="date" yKey="percentPresent" label="Present" height={220} xFormat={(v) => fmtDay(String(v))} tooltipLabel={(v) => fmtDate(String(v), { weekday: 'long', day: 'numeric', month: 'long' })} yFormat={(v) => `${v}%`} valueFormat={(v) => `${v}%`} {...trendAxis(d?.attendance?.trend ?? [])} />
                  </ChartCard>
                </div>
              )}
              {showFinance && (
                <div className="order-5 lg:order-none">
                  <FinanceBlock d={d} loading={q.isPending} base={base} />
                </div>
              )}
              <div className="order-6 lg:order-none">
                <ChartCard
                  title="Enrolment by grade"
                  description="Active students in each grade"
                  height={Math.max(180, (d?.enrollmentByGrade.length ?? 5) * 44)}
                  loading={q.isPending}
                  empty={!!d && d.enrollmentByGrade.length === 0}
                  summary={d ? enrolmentSummary(d.enrollmentByGrade) : undefined}
                  table={{ columns: [{ key: 'grade', label: 'Grade' }, { key: 'students', label: 'Students', align: 'right' }], rows: d?.enrollmentByGrade ?? [] }}
                >
                  <BarSeries data={(d?.enrollmentByGrade ?? []).map((g) => ({ ...g }))} xKey="grade" yKey="students" label="Students" horizontal height={Math.max(180, (d?.enrollmentByGrade.length ?? 5) * 44)} />
                </ChartCard>
              </div>
            </div>

            <div className="contents lg:flex lg:flex-col lg:gap-6">
              {showApprovals && (
                <div className="order-2 lg:order-none">
                  <Approvals d={d} loading={q.isPending} base={base} skeletonRows={predicted.approvals} />
                </div>
              )}
              {showAlerts && (
                <div className="order-3 lg:order-none">
                  <Alerts d={d} loading={q.isPending} base={base} />
                </div>
              )}
              {d?.exams && d.exams.upcoming.length > 0 && (
                <div className="order-7 lg:order-none">
                  <Card>
                    <CardHeader title="Upcoming exams" description={d.exams.underReviewCount > 0 ? `${plural(d.exams.underReviewCount, 'exam')} under review` : undefined} />
                    <CardBody className="pt-3">
                      <ul className="divide-y divide-border">
                        {d.exams.upcoming.map((e) => (
                          <li key={e.examId} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">{e.name}</p>
                              <p className="t-caption text-ink-2">{e.startDate ? `Starts ${fmtDate(e.startDate)}` : 'No date yet'}</p>
                            </div>
                            <StatusChip status={e.status} />
                          </li>
                        ))}
                      </ul>
                    </CardBody>
                  </Card>
                </div>
              )}
              {d?.license && (
                <div className="order-8 lg:order-none">
                  <LicenseCard data={d.license} />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const hasApprovals = (a: Dash['approvals']) => Object.values(a).some((v) => v !== null);

/** y-axis 5-point band below the lowest day, up to 100 %, with whole-number ticks */
function trendAxis(t: { percentPresent: number | null }[]): { domain: [number, number]; ticks: number[] } {
  const v = t.map((x) => x.percentPresent).filter((x): x is number => x !== null);
  const lo = v.length ? Math.max(0, Math.floor((Math.min(...v) - 1) / 5) * 5) : 90;
  const step = Math.max(1, Math.round((100 - lo) / 5));
  const ticks = Array.from({ length: Math.floor((100 - lo) / step) + 1 }, (_, i) => lo + i * step);
  return { domain: [lo, 100], ticks: ticks[ticks.length - 1] === 100 ? ticks : [...ticks, 100] };
}

function trendSummary(t: NonNullable<Dash['attendance']>['trend']): string {
  const v = t.filter((x) => x.percentPresent !== null);
  if (v.length === 0) return 'No attendance has been marked in this period.';
  const last = v[v.length - 1]!;
  const avg = v.reduce((a, x) => a + (x.percentPresent ?? 0), 0) / v.length;
  return `Averaged ${percent(avg)} present over ${plural(v.length, 'day')}; the latest day (${fmtDate(last.date, { day: 'numeric', month: 'short' })}) was ${percent(last.percentPresent)}.`;
}
function enrolmentSummary(g: Dash['enrollmentByGrade']): string {
  if (g.length === 0) return '';
  const total = g.reduce((a, x) => a + x.students, 0);
  const top = [...g].sort((a, b) => b.students - a.students)[0]!;
  return `${plural(total, 'student')} across ${plural(g.length, 'grade')}; the largest is ${top.grade} with ${top.students}.`;
}

function AttendanceToday({ d, loading, base }: { d?: Dash; loading: boolean; base: string }) {
  const a = d?.attendance;
  return (
    <Card>
      <CardHeader
        title="Today’s attendance"
        description={a ? (a.isWorkingDay ? `${a.sectionsMarked} of ${a.sectionsTotal} classes have marked attendance` : undefined) : undefined}
        action={
          <Button asChild variant="ghost" size="sm">
            <Link href={`${base}/attendance`}>
              Details <ArrowRight />
            </Link>
          </Button>
        }
      />
      <CardBody className="pt-4">
        {loading || !a ? (
          <div className="min-h-[148px] space-y-4">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-1.5 w-full" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        ) : !a.isWorkingDay ? (
          <p className="text-sm text-ink-2">{a.holiday ? `Holiday: ${a.holiday}.` : 'Today is not a working day.'} No attendance is expected.</p>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
              <div>
                <p className="figure text-[36px] leading-10">{percent(a.totals.percentPresent)}</p>
                <p className="t-caption text-ink-2">present of {a.totals.markedStudents.toLocaleString()} marked students</p>
              </div>
              <dl className="grid flex-1 grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
                {([['present', a.totals.present], ['absent', a.totals.absent], ['late', a.totals.late], ['half_day', a.totals.half_day]] as const).map(([k, n]) => (
                  <div key={k}>
                    <dt><StatusChip status={k} /></dt>
                    <dd className="figure mt-1 text-xl leading-7">{n}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div>
              <ProgressBar value={a.sectionsMarked} max={a.sectionsTotal} label="Classes that have marked attendance" />
              <p className="t-caption mt-1.5 text-ink-2">
                {a.totals.unmarkedStudents > 0 ? `${plural(a.totals.unmarkedStudents, 'student')} not marked yet` : 'Every student has been marked'}
              </p>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function FinanceBlock({ d, loading, base }: { d?: Dash; loading: boolean; base: string }) {
  const f = d?.finance;
  const cur = f?.currency ?? 'INR';
  const byMonth = f?.byMonth ?? [];
  return (
    <Card>
      <CardHeader
        title="Fees"
        description={f ? `${fmtDate(f.from)} – ${fmtDate(f.to)}` : undefined}
        action={
          <Button asChild variant="secondary" size="sm">
            <Link href={`${base}/finance/invoices`}>View invoices</Link>
          </Button>
        }
      />
      <CardBody className="space-y-5 pt-4">
        {loading || !f ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 lg:grid-cols-4">
            <Fig label="Collected" value={moneyCompact(f.netCollectedMinor, cur)} title={money(f.netCollectedMinor, cur)} />
            <Fig label="Outstanding" value={moneyCompact(f.outstandingMinor, cur)} title={money(f.outstandingMinor, cur)} />
            <Fig label="Overdue" value={moneyCompact(f.overdueMinor, cur)} title={money(f.overdueMinor, cur)} tone={f.overdueMinor > 0 ? 'danger' : undefined} />
            <Fig label="Collection rate" value={percent(f.collectionRatePercent)} />
          </dl>
        )}
        <ChartCard
          className="border-0 shadow-none [&>div:first-child]:px-0 [&>div:last-child]:px-0"
          title="Collected by month"
          height={200}
          loading={loading}
          empty={!!f && byMonth.every((m) => m.collectedMinor === 0)}
          summary={f ? `Net collected ${money(f.netCollectedMinor, cur)} against ${money(f.invoicedMinor, cur)} invoiced; ${money(f.outstandingMinor, cur)} is still outstanding.` : undefined}
          table={{ columns: [{ key: 'month', label: 'Month' }, { key: 'collected', label: 'Collected', align: 'right' }], rows: byMonth.map((m) => ({ month: fmtMonth(m.month), collected: money(m.collectedMinor, cur) })) }}
        >
          <BarSeries data={byMonth.map((m) => ({ month: m.month, collected: m.collectedMinor / 100 }))} xKey="month" yKey="collected" label="Collected" height={200} xFormat={(v) => fmtMonthShort(String(v))} tooltipLabel={(v) => fmtMonth(String(v))} yFormat={(v) => moneyCompact(v * 100, cur).replace(/\.0+(?=\D|$)/, '')} valueFormat={(v) => money(v * 100, cur)} />
        </ChartCard>
      </CardBody>
    </Card>
  );
}

function Fig({ label, value, title, tone }: { label: string; value: string; title?: string; tone?: 'danger' }) {
  return (
    <div>
      <dt className="t-caption text-ink-2">{label}</dt>
      <dd className={cn('figure mt-0.5 text-[26px] leading-8', tone === 'danger' && 'text-danger')} title={title}>
        {value}
      </dd>
    </div>
  );
}

function Approvals({ d, loading, base, skeletonRows = 4 }: { d?: Dash; loading: boolean; base: string; skeletonRows?: number }) {
  const rows = d ? APPROVALS.filter((r) => d.approvals[r.key] !== null).map((r) => ({ ...r, n: d.approvals[r.key] as number })) : [];
  const total = rows.reduce((a, r) => a + r.n, 0);
  return (
    <Card>
      <CardHeader title="Needs your approval" description={d ? (total > 0 ? `${plural(total, 'item')} waiting` : undefined) : undefined} />
      <CardBody className="pt-2">
        {loading || !d ? (
          <div className="-mx-2 space-y-0 pt-0">
            {Array.from({ length: Math.max(1, skeletonRows) }, (_, i) => (
              <div key={i} className="flex h-10 items-center px-2">
                <Skeleton className="h-4 w-full" />
              </div>
            ))}
          </div>
        ) : total === 0 ? (
          <p className="flex items-center gap-2 py-3 text-sm text-ink-2">
            <CheckCircle2 className="size-4 text-success" aria-hidden /> Nothing is waiting for you.
          </p>
        ) : (
          <ul className="-mx-2">
            {rows.map((r) => (
              <li key={r.key}>
                <Link href={`${base}${r.href}`} className="tr-colors flex h-10 items-center gap-3 rounded-md px-2 hover:bg-surface-subtle">
                  <span className={cn('flex-1 text-sm', r.n === 0 && 'text-ink-3')}>{r.label}</span>
                  <span className={cn('figure min-w-6 text-right text-lg', r.n === 0 && 'text-ink-3')}>{r.n}</span>
                  <ChevronRight className="size-4 text-ink-3" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

const SEVERITY = {
  critical: { icon: OctagonAlert, label: 'Critical', cls: 'text-danger' },
  warning: { icon: AlertTriangle, label: 'Warning', cls: 'text-warning' },
  info: { icon: Info, label: 'Info', cls: 'text-brand-ink' },
} as const;

function Alerts({ d, loading, base }: { d?: Dash; loading: boolean; base: string }) {
  return (
    <Card>
      <CardHeader title="Alerts" />
      <CardBody className="pt-3">
        {loading || !d ? (
          <div className="space-y-3">
            {[0, 1].map((i) => <Skeleton key={i} className="h-11 w-full" />)}
          </div>
        ) : (
          <ul className="space-y-3">
            {d.alerts.map((a) => {
              const S = SEVERITY[a.severity];
              const body = (
                <>
                  <S.icon className={cn('mt-0.5 size-4 shrink-0', S.cls)} aria-hidden />
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="sr-only">{S.label}: </span>
                    {a.message}
                  </span>
                  {a.route && <ChevronRight className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />}
                </>
              );
              return (
                <li key={a.key}>
                  {a.route ? (
                    <Link href={`${base}${a.route}`} className="tr-colors -mx-2 flex items-start gap-2.5 rounded-md px-2 py-1 hover:bg-surface-subtle">{body}</Link>
                  ) : (
                    <div className="flex items-start gap-2.5">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
