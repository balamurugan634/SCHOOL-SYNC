'use client';

import * as React from 'react';
import Link from 'next/link';
import { AlertTriangle, Pencil } from 'lucide-react';
import type { AttendanceRosterStudent } from '@school-sync/shared';
import { useAttendanceToday, useRoster } from '@/lib/client/hooks';
import { sectionOutLabel, useMySections, usePeriods } from '@/lib/client/teacher';
import { useSectionAttendanceSummary, type SectionAttendanceSummary } from '@/lib/client/teacher-classes';
import { addDaysIso, startOfMonthIso } from '@/lib/client/teacher-dates';
import { codeMessage, isOutOfScope } from '@/lib/client/teacher-errors';
import { fmtDate, percent, plural, todayIso } from '@/lib/format';
import { Badge, StatusChip } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { ChartCard } from '@/components/ui/chart';
import { DataTable, type Column } from '@/components/ui/data-table';
import { DatePicker } from '@/components/ui/date-picker';
import { Drawer, DrawerContent, SheetBody } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { StatTile } from '@/components/ui/stat-tile';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/shell/page-header';
import { LineSeries } from '@/components/charts/series-charts';
import { useMeContext } from '@/components/me-context';
import { ErrorCard, OutOfScope, useUrlState } from '../common';
import { CorrectionDialog, type CorrectionTarget } from './correction-dialog';

type Day = SectionAttendanceSummary['days'][number];
type StudentRow = SectionAttendanceSummary['students'][number];

/** Attendance history of one class over a range, per day and per student; any day opens its roll call, where a correction can be requested. */
export function AttendanceHistoryScreen() {
  const { base } = useMeContext();
  const url = useUrlState();
  const sections = useMySections();
  const today = useAttendanceToday();
  const mode = today.data?.mode ?? 'daily';
  const periods = usePeriods();

  const sectionId = url.get('section') || sections.data?.[0]?.id || '';
  const to = url.get('to') || todayIso();
  const from = url.get('from') || addDaysIso(to, -29);
  const date = url.get('date');
  const periodId = url.get('period');
  const view = url.get('view', 'days') === 'students' ? 'students' : 'days';
  const summary = useSectionAttendanceSummary(sectionId || null, from, to);
  const d = summary.data;
  const series = (d?.days ?? []).filter((x) => x.percentage !== null);

  const setRange = (f: string, t: string) => url.set({ from: f, to: t });
  const dayColumns: Column<Day>[] = [
    { id: 'date', header: 'Date', cell: (r) => <span className="font-medium">{fmtDate(r.date, { weekday: 'short', day: 'numeric', month: 'short' })}</span>, sortable: true, sortValue: (r) => r.date, mobile: 'title' },
    { id: 'pct', header: '% present', align: 'right', cell: (r) => <span className="tnum">{percent(r.percentage)}</span>, sortable: true, sortValue: (r) => r.percentage ?? -1, mobile: 'value' },
    { id: 'present', header: 'Present', align: 'right', cell: (r) => r.present, sortable: true, sortValue: (r) => r.present, mobile: 'detail' },
    { id: 'absent', header: 'Absent', align: 'right', cell: (r) => (r.absent > 0 ? <span className="text-danger">{r.absent}</span> : 0), sortable: true, sortValue: (r) => r.absent, mobile: 'detail' },
    { id: 'late', header: 'Late', align: 'right', cell: (r) => r.late, sortable: true, sortValue: (r) => r.late, mobile: 'detail' },
    { id: 'half', header: 'Half day', align: 'right', cell: (r) => r.half_day, defaultHidden: true, mobile: 'hide' },
    { id: 'leave', header: 'On leave', align: 'right', cell: (r) => r.leave, defaultHidden: true, mobile: 'hide' },
  ];
  const studentColumns: Column<StudentRow>[] = [
    { id: 'roll', header: 'Roll', cell: (r) => <span className="tnum text-ink-2">{r.rollNo ?? '—'}</span>, sortable: true, sortValue: (r) => r.rollNo ?? 9999, className: 'w-16', mobile: 'hide' },
    {
      id: 'name',
      header: 'Student',
      cell: (r) => (
        <Link href={`${base}/classes/${sectionId}/students/${r.studentId}`} className="font-medium hover:underline">
          {r.name}
        </Link>
      ),
      sortable: true,
      sortValue: (r) => r.name,
      mobile: 'title',
    },
    {
      id: 'pct',
      header: '% present',
      align: 'right',
      sortable: true,
      sortValue: (r) => r.percentage ?? -1,
      cell: (r) => (
        <span className="inline-flex items-center justify-end gap-2">
          {r.isShort && (
            <Badge variant="danger" icon={<AlertTriangle aria-hidden />}>
              Short
            </Badge>
          )}
          <span className="tnum">{percent(r.percentage)}</span>
        </span>
      ),
      mobile: 'value',
    },
    { id: 'absent', header: 'Absent', align: 'right', cell: (r) => r.absent, sortable: true, sortValue: (r) => r.absent, mobile: 'detail' },
    { id: 'late', header: 'Late', align: 'right', cell: (r) => r.late, sortable: true, sortValue: (r) => r.late, mobile: 'detail' },
    { id: 'leave', header: 'On leave', align: 'right', cell: (r) => r.leave, defaultHidden: true, mobile: 'hide' },
  ];

  return (
    <>
      <PageHeader title="Attendance history" description="See any class day by day, open a day’s roll call, and ask for a correction once editing has closed." />

      <Card className="mb-6">
        <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.2fr)_repeat(3,minmax(0,1fr))]">
          <Labeled label="Class">
            <Select aria-label="Class" value={sectionId || undefined} onValueChange={(v) => url.set({ section: v, date: null })} placeholder={sections.isPending ? 'Loading…' : 'Choose a class'} options={(sections.data ?? []).map((s) => ({ value: s.id, label: sectionOutLabel(s) }))} />
          </Labeled>
          <Labeled label="From">
            <DatePicker value={from} max={to} onChange={(v) => setRange(v, to)} />
          </Labeled>
          <Labeled label="To">
            <DatePicker value={to} min={from} max={todayIso()} onChange={(v) => setRange(from, v)} />
          </Labeled>
          <Labeled label="Open a day">
            <DatePicker value={date} max={todayIso()} placeholder="Pick a date" onChange={(v) => url.set({ date: v }, { keepPage: true })} />
          </Labeled>
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-4">
            <span className="t-caption text-ink-2">Quick ranges</span>
            <Button variant="secondary" size="sm" onClick={() => setRange(addDaysIso(todayIso(), -6), todayIso())}>
              Last 7 days
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setRange(addDaysIso(todayIso(), -29), todayIso())}>
              Last 30 days
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setRange(startOfMonthIso(todayIso()), todayIso())}>
              This month
            </Button>
            {mode === 'period' && (
              <div className="ml-auto w-full sm:w-52">
                <Select aria-label="Period" value={periodId ?? undefined} onValueChange={(v) => url.set({ period: v }, { keepPage: true })} placeholder="Period (for day detail)" options={(periods.data ?? []).filter((p) => !p.isBreak).map((p) => ({ value: p.id, label: p.name }))} />
              </div>
            )}
          </div>
        </CardBody>
      </Card>

      {!sectionId && !sections.isPending ? (
        <Card>
          <EmptyState illustration="empty-generic" title="No classes to show" description="You aren’t assigned to a class yet." />
        </Card>
      ) : summary.isError && !d ? (
        isOutOfScope(summary.error) ? <OutOfScope what="This class’s attendance" backHref={`${base}/attendance`} backLabel="Back to roll call" /> : <ErrorCard error={summary.error} onRetry={() => void summary.refetch()} title="We couldn’t load attendance" />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile label="Present" value={summary.isPending ? undefined : percent(d?.totals.percentage)} state={summary.isPending ? 'loading' : 'ready'} hint={`over ${plural(series.length, 'school day')}`} />
            <StatTile label="Absences" value={d?.totals.absent} state={summary.isPending ? 'loading' : 'ready'} hint="student-days" />
            <StatTile label="Late" value={d?.totals.late} state={summary.isPending ? 'loading' : 'ready'} hint="student-days" />
            <StatTile label="Students" value={d?.strength} state={summary.isPending ? 'loading' : 'ready'} hint={d ? `${(d.students ?? []).filter((s) => s.isShort).length} below the target` : undefined} />
          </div>

          <ChartCard
            title="Daily attendance"
            description="Share of marked students present each school day"
            height={220}
            loading={summary.isPending}
            empty={!!d && series.length === 0}
            emptyText="No roll call was submitted in this period."
            summary={d && series.length > 0 ? `Averaged ${percent(d.totals.percentage)} present over ${plural(series.length, 'school day')}.` : undefined}
            table={{
              columns: [{ key: 'date', label: 'Date' }, { key: 'percentage', label: '% present', align: 'right' }, { key: 'present', label: 'Present', align: 'right' }, { key: 'absent', label: 'Absent', align: 'right' }, { key: 'late', label: 'Late', align: 'right' }],
              rows: series.map((x) => ({ ...x, date: fmtDate(x.date, { weekday: 'short', day: 'numeric', month: 'short' }), percentage: percent(x.percentage) })),
            }}
          >
            <LineSeries data={series.map((x) => ({ ...x }))} xKey="date" yKey="percentage" label="Present" height={220} xFormat={(v) => fmtDate(String(v), { day: 'numeric', month: 'short' })} tooltipLabel={(v) => fmtDate(String(v), { weekday: 'long', day: 'numeric', month: 'long' })} yFormat={(v) => `${v}%`} valueFormat={(v) => `${v}%`} domain={domainFor(series.map((x) => x.percentage))} />
          </ChartCard>

          <Tabs value={view} onValueChange={(v) => url.set({ view: v === 'days' ? null : v }, { keepPage: true })}>
            <TabsList aria-label="History view">
              <TabsTrigger value="days">By day</TabsTrigger>
              <TabsTrigger value="students">By student</TabsTrigger>
            </TabsList>
            <TabsContent value="days">
              <DataTable<Day>
                id="teacher-att-days"
                caption="Attendance by day"
                rows={[...(d?.days ?? [])].sort((a, b) => b.date.localeCompare(a.date))}
                rowKey={(r) => r.date}
                loading={summary.isPending}
                error={summary.error}
                onRetry={() => void summary.refetch()}
                onRowClick={(r) => url.set({ date: r.date }, { keepPage: true })}
                activeRowKey={date}
                compact
                columns={dayColumns}
                empty={<EmptyState compact illustration="empty-generic" title="No roll call in this period" description="Pick a longer range, or open a specific day above." />}
              />
              <p className="t-caption mt-2 text-ink-2">Select a day to see who was marked what, and to request a correction.</p>
            </TabsContent>
            <TabsContent value="students">
              <DataTable<StudentRow> id="teacher-att-students" caption="Attendance by student" rows={d?.students} rowKey={(r) => r.studentId} loading={summary.isPending} error={summary.error} onRetry={() => void summary.refetch()} compact columns={studentColumns} empty={<EmptyState compact illustration="empty-generic" title="No students in this class" />} />
            </TabsContent>
          </Tabs>
        </div>
      )}

      <DayDrawer sectionId={sectionId} date={date} periodId={periodId} mode={mode} onClose={() => url.set({ date: null }, { keepPage: true })} />
    </>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <span className="t-label block text-ink">{label}</span>
      {children}
    </div>
  );
}

function domainFor(v: (number | null)[]): [number, number] {
  const nums = v.filter((x): x is number => x !== null);
  const lo = nums.length ? Math.max(0, Math.floor((Math.min(...nums) - 2) / 5) * 5) : 0;
  return [Math.min(lo, 95), 100];
}

/* ───────────────────────── one day ───────────────────────── */

function DayDrawer({ sectionId, date, periodId, mode, onClose }: { sectionId: string; date: string | null; periodId: string | null; mode: 'daily' | 'period'; onClose: () => void }) {
  return (
    <Drawer open={!!date && !!sectionId} onOpenChange={(o) => !o && onClose()}>
      <DrawerContent title="Day detail" description="Roll call for one class and day" showTitle>
        {date && sectionId && <DayBody sectionId={sectionId} date={date} periodId={periodId} mode={mode} />}
      </DrawerContent>
    </Drawer>
  );
}

function DayBody({ sectionId, date, periodId, mode }: { sectionId: string; date: string; periodId: string | null; mode: 'daily' | 'period' }) {
  const { base } = useMeContext();
  const needsPeriod = mode === 'period' && !periodId;
  const roster = useRoster(needsPeriod ? null : sectionId, date, periodId);
  const [target, setTarget] = React.useState<CorrectionTarget | null>(null);
  const r = roster.data;

  if (needsPeriod) {
    return (
      <SheetBody>
        <Banner tone="info">This school takes attendance per period. Choose a period above the table, then open the day again.</Banner>
      </SheetBody>
    );
  }
  if (roster.isPending) {
    return (
      <SheetBody>
        <Skeleton className="h-5 w-48" />
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </SheetBody>
    );
  }
  if (roster.isError || !r) {
    return (
      <SheetBody>
        <ErrorCard error={roster.error} onRetry={() => void roster.refetch()} title="We couldn’t load this day" />
      </SheetBody>
    );
  }

  const blocked = !r.canSubmit ? codeMessage(r.blockedReason) : null;
  const submitted = r.session?.status === 'submitted';
  const rollCallHref = `${base}/attendance?date=${date}&class=${sectionId}:${periodId ?? ''}`;

  return (
    <>
      <SheetBody className="space-y-4">
        <div>
          <h2 className="t-section">
            {r.gradeName} {r.sectionName}
            {r.periodName ? ` · ${r.periodName}` : ''}
          </h2>
          <p className="t-caption text-ink-2">{fmtDate(r.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
        </div>

        {r.holiday || !r.isWorkingDay ? <Banner tone="info">{r.holiday ? `Holiday: ${r.holiday}.` : 'That date is not a school working day.'}</Banner> : null}
        {!submitted && r.isWorkingDay && !r.holiday && <Banner tone="warning" title="No roll call was submitted">{r.canSubmit ? 'You can take it now.' : (blocked ?? 'It can’t be taken from here.')}</Banner>}
        {submitted && r.canSubmit && (
          <Banner tone="info" title="You can still edit this roll call">
            Changes are made directly while the edit window is open.
          </Banner>
        )}
        {submitted && !r.canSubmit && r.canRequestCorrection && (
          <Banner tone="info" title="Editing has closed">
            Ask for a correction for a student below. The class teacher approves it, and the student’s family is told when a record changes.
          </Banner>
        )}
        {submitted && !r.canSubmit && !r.canRequestCorrection && blocked && <Banner tone="warning">{blocked}</Banner>}

        {r.session?.takenByName && (
          <p className="t-caption text-ink-2">
            Taken by {r.session.takenByName}
            {r.session.status === 'draft' ? ' (draft)' : ''}
          </p>
        )}

        <dl className="flex flex-wrap gap-x-4 gap-y-1">
          {(['present', 'absent', 'late', 'half_day', 'leave'] as const)
            .filter((k) => r.counts[k] > 0 || k === 'present' || k === 'absent')
            .map((k) => (
              <div key={k} className="flex items-center gap-1.5">
                <dt>
                  <StatusChip status={k} />
                </dt>
                <dd className="figure text-lg leading-6">{r.counts[k]}</dd>
              </div>
            ))}
          {r.counts.unmarked > 0 && (
            <div className="flex items-center gap-1.5">
              <dt className="t-caption text-ink-2">Not marked</dt>
              <dd className="figure text-lg leading-6 text-warning">{r.counts.unmarked}</dd>
            </div>
          )}
        </dl>

        <ul className="divide-y divide-border rounded-md border border-border" aria-label="Students">
          {r.students.map((s: AttendanceRosterStudent) => (
            <li key={s.studentId} className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
              <span className="tnum w-7 shrink-0 text-right text-[13px] text-ink-3">{s.rollNo ?? ''}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{s.name}</p>
                {s.remarks && <p className="t-caption truncate text-ink-2">{s.remarks}</p>}
              </div>
              {s.status ? <StatusChip status={s.status} /> : <span className="t-caption text-ink-3">Not marked</span>}
              {r.canRequestCorrection && s.recordId && s.status && (
                <Button variant="secondary" size="sm" aria-label={`Request a correction for ${s.name}`} onClick={() => setTarget({ recordId: s.recordId!, studentName: s.name, date: r.date, status: s.status! })}>
                  <Pencil /> Correct
                </Button>
              )}
            </li>
          ))}
        </ul>
        {r.students.length === 0 && <EmptyState compact title="No students in this class" />}
      </SheetBody>
      {(r.canSubmit || !submitted) && (
        <div className="sticky bottom-0 border-t border-border bg-surface-raised px-5 py-3">
          <Button asChild className="w-full sm:w-auto" disabled={!r.canSubmit}>
            <Link href={rollCallHref} aria-disabled={!r.canSubmit}>
              Open roll call for this day
            </Link>
          </Button>
        </div>
      )}
      <CorrectionDialog target={target} onClose={() => setTarget(null)} />
    </>
  );
}
