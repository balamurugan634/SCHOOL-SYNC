'use client';

import * as React from 'react';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import type { AttendanceRosterStudent } from '@school-sync/shared';
import { Badge, StatusChip } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { ChartCard } from '@/components/ui/chart';
import { DataTable, type Column } from '@/components/ui/data-table';
import { DatePicker } from '@/components/ui/date-picker';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { StatTile } from '@/components/ui/stat-tile';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LineSeries } from '@/components/charts/series-charts';
import { PageHeader } from '@/components/shell/page-header';
import { useRoster } from '@/lib/client/hooks';
import { useSectionRangeSummary } from '@/lib/client/attendance-admin';
import { sectionLabel, sectionOptions, useSectionList } from '@/lib/client/options';
import { useUrlState } from '@/lib/client/url-state';
import { fmtDateTime, percent, plural, todayIso } from '@/lib/format';
import { useAccess } from '../shared/access';
import { DefList, ErrorPanel, Panel } from '../shared/detail';
import { paths } from '../shared/paths';
import { AttendanceTabs } from './attendance-tabs';
import { longDate, shortDate, StatusCounts, TableSection, trendAxis } from './status-bits';

const shift = (iso: string, by: number): string => {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const t = new Date(y, m - 1, d + by);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
};

/** `/admin/attendance/class` — one class's register for a day (read-only) and its attendance over a date range. */
export function ClassViewScreen() {
  const [p, set] = useUrlState({ sectionId: '', date: '', tab: 'day', from: '', to: '' });
  const today = todayIso();
  const date = p.date || today;
  const secQ = useSectionList();
  const sections = Array.isArray(secQ.data) ? secQ.data : undefined;
  const section = sections?.find((s) => s.id === p.sectionId);
  const tab = p.tab === 'range' ? 'range' : 'day';

  return (
    <>
      <PageHeader title="Class attendance" description="Look at one class’s register for a day, or its attendance over a period." />
      <AttendanceTabs />

      <div className="mb-6 grid gap-3 sm:grid-cols-[minmax(0,18rem)_auto] sm:items-end">
        <Field label="Class" htmlFor="class-view-section">
          {secQ.isPending ? (
            <Skeleton className="h-9 w-full" />
          ) : (
            <Select id="class-view-section" value={p.sectionId} onValueChange={(v) => set({ sectionId: v })} options={sectionOptions(sections)} placeholder={secQ.isError ? 'Could not load classes' : 'Choose a class'} disabled={secQ.isError} />
          )}
        </Field>
        {tab === 'day' && (
          <Field label="Date" htmlFor="class-view-date">
            <div className="w-44">
              <DatePicker id="class-view-date" value={date} onChange={(v) => set({ date: v === today ? '' : v })} max={today} presets={[{ label: 'Yesterday', value: shift(today, -1) }]} />
            </div>
          </Field>
        )}
      </div>

      {secQ.isError ? (
        <ErrorPanel error={secQ.error} onRetry={() => void secQ.refetch()} title="We couldn’t load the classes" />
      ) : !p.sectionId ? (
        <Panel>
          <EmptyState illustration="no-results" title="Choose a class" description="Pick a class above to see who was present, absent or late." compact />
        </Panel>
      ) : (
        <Tabs value={tab} onValueChange={(v) => set({ tab: v })}>
          <TabsList aria-label="Class attendance views">
            <TabsTrigger value="day">Day register</TabsTrigger>
            <TabsTrigger value="range">Over a period</TabsTrigger>
          </TabsList>
          <TabsContent value="day">
            <DayRegister sectionId={p.sectionId} date={date} sectionName={section ? sectionLabel(section) : undefined} />
          </TabsContent>
          <TabsContent value="range">
            <RangeSummary sectionId={p.sectionId} from={p.from || shift(today, -29)} to={p.to || today} today={today} onChange={(from, to) => set({ from: from === shift(today, -29) ? '' : from, to: to === today ? '' : to })} />
          </TabsContent>
        </Tabs>
      )}
    </>
  );
}

function DayRegister({ sectionId, date, sectionName }: { sectionId: string; date: string; sectionName?: string }) {
  const a = useAccess();
  const q = useRoster(sectionId, date);
  const r = q.data;

  const cols: Column<AttendanceRosterStudent>[] = [
    { id: 'roll', header: 'Roll', cell: (s) => <span className="tnum">{s.rollNo ?? '—'}</span>, sortable: true, sortValue: (s) => s.rollNo, className: 'w-16', mobile: 'hide' },
    {
      id: 'student',
      header: 'Student',
      cell: (s) => (a.can('students:view') ? (
        <Link href={paths.student(s.studentId)} className="font-medium text-brand-ink underline-offset-4 hover:underline">
          {s.name}
        </Link>
      ) : (
        <span className="font-medium">{s.name}</span>
      )),
      sortable: true,
      sortValue: (s) => s.name,
      mobile: 'title',
    },
    { id: 'admission', header: 'Admission no.', cell: (s) => <span className="tnum">{s.admissionNo}</span>, mobile: 'sub' },
    {
      id: 'status',
      header: 'Status',
      cell: (s) =>
        s.status ? (
          <span className="inline-flex flex-wrap items-center gap-1.5">
            <StatusChip status={s.status} />
            {s.source === 'leave' && <span className="t-caption text-ink-2">from approved leave</span>}
          </span>
        ) : s.onApprovedLeave ? (
          <StatusChip status="leave" label="Leave approved" />
        ) : (
          <StatusChip status="todo" label="Not marked" />
        ),
      sortable: true,
      sortValue: (s) => s.status ?? 'zz',
      mobile: 'status',
    },
    { id: 'remarks', header: 'Remarks', cell: (s) => s.remarks ?? <span className="text-ink-3">—</span>, mobile: 'detail' },
  ];

  if (q.isError && !r) return <ErrorPanel error={q.error} onRetry={() => void q.refetch()} title="We couldn’t load this class register" />;
  return (
    <div className="space-y-6">
      {r?.holiday && (
        <Banner tone="info" title={`Holiday: ${r.holiday}`}>
          No attendance is expected on {longDate(r.date)}.
        </Banner>
      )}
      {r && !r.holiday && !r.isWorkingDay && (
        <Banner tone="info" title="Not a school day">
          {longDate(r.date)} is not a working day, so no attendance is expected.
        </Banner>
      )}
      {r?.isFuture && <Banner tone="info" title="This date is in the future">Attendance cannot be recorded yet.</Banner>}

      <Panel title={r ? `${r.gradeName} ${r.sectionName}` : sectionName} description={longDate(date)}>
        {q.isPending || !r ? (
          <div className="space-y-4">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : (
          <div className="space-y-5">
            <StatusCounts counts={r.counts} unmarked={r.counts.unmarked} />
            {r.session ? (
              <DefList
                cols={2}
                items={[
                  { label: 'Roll call', value: r.session.status === 'submitted' ? <Badge variant="success">Submitted</Badge> : <Badge variant="warning">Draft, not submitted</Badge> },
                  { label: 'Taken by', value: r.session.takenByName },
                  { label: 'Submitted', value: r.session.submittedAt ? fmtDateTime(r.session.submittedAt) : null },
                  { label: 'Teacher can edit until', value: r.session.editableUntil ? fmtDateTime(r.session.editableUntil) : null },
                  ...(r.mode === 'period' ? [{ label: 'Period', value: r.periodName ?? 'Choose a period' }] : []),
                ]}
              />
            ) : (
              !r.holiday && r.isWorkingDay && !r.isFuture && (
                <p className="flex items-center gap-2 text-sm text-ink-2">
                  <AlertTriangle className="size-4 text-warning" aria-hidden /> No roll call has been submitted for this class on this day.
                </p>
              )
            )}
            {r.warnings.length > 0 && (
              <ul className="space-y-1">
                {r.warnings.map((w) => (
                  <li key={w} className="t-caption text-ink-2">
                    {w}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Panel>

      <TableSection title="Students" description={r ? plural(r.students.length, 'student') : undefined}>
        <DataTable
          id="attendance-class-day"
          caption="Attendance of each student on the chosen day"
          columns={cols}
          rows={r?.students}
          rowKey={(s) => s.studentId}
          loading={q.isPending}
          error={q.isError ? q.error : null}
          onRetry={() => void q.refetch()}
          empty={<EmptyState illustration="empty-generic" title="No students in this class" description="Students enrolled in this section for the year will be listed here." compact />}
        />
      </TableSection>
    </div>
  );
}

function RangeSummary({ sectionId, from, to, today, onChange }: { sectionId: string; from: string; to: string; today: string; onChange: (from: string, to: string) => void }) {
  const a = useAccess();
  const invalid = from > to ? 'The start date must not be after the end date.' : null;
  const q = useSectionRangeSummary(invalid ? null : sectionId, from, to);
  const s = q.data;

  type Row = NonNullable<typeof s>['students'][number];
  const cols: Column<Row>[] = [
    { id: 'roll', header: 'Roll', cell: (r) => <span className="tnum">{r.rollNo ?? '—'}</span>, sortable: true, sortValue: (r) => r.rollNo, className: 'w-16', mobile: 'hide' },
    {
      id: 'name',
      header: 'Student',
      cell: (r) => (a.can('students:view') ? (
        <Link href={paths.student(r.studentId, 'attendance')} className="font-medium text-brand-ink underline-offset-4 hover:underline">
          {r.name}
        </Link>
      ) : (
        <span className="font-medium">{r.name}</span>
      )),
      sortable: true,
      sortValue: (r) => r.name,
      mobile: 'title',
    },
    { id: 'short', header: 'Minimum', cell: (r) => (r.isShort ? <Badge variant="warning" icon={<AlertTriangle aria-hidden />}>Below minimum</Badge> : <span className="text-ink-3">—</span>), mobile: 'status' },
    { id: 'present', header: 'Present', cell: (r) => r.present, align: 'right', sortable: true, sortValue: (r) => r.present, mobile: 'detail' },
    { id: 'late', header: 'Late', cell: (r) => r.late, align: 'right', sortable: true, sortValue: (r) => r.late, mobile: 'detail' },
    { id: 'half', header: 'Half day', cell: (r) => r.half_day, align: 'right', sortable: true, sortValue: (r) => r.half_day, mobile: 'hide' },
    { id: 'absent', header: 'Absent', cell: (r) => r.absent, align: 'right', sortable: true, sortValue: (r) => r.absent, mobile: 'detail' },
    { id: 'leave', header: 'Leave', cell: (r) => r.leave, align: 'right', sortable: true, sortValue: (r) => r.leave, mobile: 'hide' },
    { id: 'pct', header: '% present', label: 'Percent present', cell: (r) => percent(r.percentage), align: 'right', sortable: true, sortValue: (r) => r.percentage, mobile: 'value' },
  ];

  const shortCount = s?.students.filter((x) => x.isShort).length ?? 0;
  const dayRows = s?.days ?? [];
  const marked = dayRows.filter((d) => d.percentage !== null);

  return (
    <div className="space-y-6">
      <div className="grid max-w-md grid-cols-2 gap-3">
        <Field label="From" htmlFor="range-from">
          <DatePicker id="range-from" value={from} onChange={(v) => onChange(v, to)} max={today} invalid={!!invalid} />
        </Field>
        <Field label="To" htmlFor="range-to">
          <DatePicker id="range-to" value={to} onChange={(v) => onChange(from, v)} max={today} invalid={!!invalid} />
        </Field>
        {invalid && (
          <p role="alert" className="t-caption col-span-2 text-danger">
            {invalid}
          </p>
        )}
      </div>

      {q.isError && !s ? (
        <ErrorPanel error={q.error} onRetry={() => void q.refetch()} title="We couldn’t load this period" />
      ) : invalid ? null : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {q.isPending || !s ? (
              [0, 1, 2, 3].map((i) => <StatTile key={i} label="Loading" state="loading" />)
            ) : (
              <>
                <StatTile label="Present" value={percent(s.totals.percentage)} hint={`over ${plural(dayRows.length, 'marked day')}`} />
                <StatTile label="Students" value={s.strength} />
                <StatTile label="Absences" value={s.totals.absent} hint={`${s.totals.late} late · ${s.totals.half_day} half day`} />
                <StatTile label="Below minimum" value={shortCount} hint={shortCount ? 'see the table below' : 'nobody is short'} />
              </>
            )}
          </div>
          <ChartCard
            title="Daily attendance"
            description="Share of the class present on each marked day"
            height={220}
            loading={q.isPending}
            empty={!!s && marked.length === 0}
            emptyText="No roll call was submitted in this period."
            summary={s && marked.length ? `${percent(s.totals.percentage)} present overall across ${plural(marked.length, 'marked day')}.` : undefined}
            table={{ columns: [{ key: 'date', label: 'Date' }, { key: 'percentage', label: '% present', align: 'right' }, { key: 'present', label: 'Present', align: 'right' }, { key: 'absent', label: 'Absent', align: 'right' }, { key: 'late', label: 'Late', align: 'right' }], rows: marked.map((d) => ({ ...d, date: longDate(d.date), percentage: percent(d.percentage) })) }}
          >
            <LineSeries data={marked.map((d) => ({ ...d }))} xKey="date" yKey="percentage" label="Present" height={220} xFormat={(v) => shortDate(String(v))} tooltipLabel={(v) => longDate(String(v))} yFormat={(v) => `${v}%`} valueFormat={(v) => `${v}%`} {...trendAxis(marked.map((d) => ({ percentPresent: d.percentage })))} />
          </ChartCard>
          <TableSection title="Students" description={s ? `${s.sectionName} · ${s.gradeName}` : undefined}>
            <DataTable
              id="attendance-class-range"
              caption="Attendance of each student over the chosen period"
              columns={cols}
              rows={s?.students}
              rowKey={(r) => r.studentId}
              loading={q.isPending}
              error={q.isError ? q.error : null}
              onRetry={() => void q.refetch()}
              empty={<EmptyState illustration="empty-generic" title="No students to show" description="This class has no active students." compact />}
            />
          </TableSection>
        </>
      )}
    </div>
  );
}
