'use client';

import * as React from 'react';
import Link from 'next/link';
import { CheckCircle2, CircleDashed } from 'lucide-react';
import type { AttendanceSchoolSummaryResponse } from '@school-sync/shared';
import { Badge } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { ChartCard } from '@/components/ui/chart';
import { DataTable, type Column } from '@/components/ui/data-table';
import { DatePicker } from '@/components/ui/date-picker';
import { EmptyState } from '@/components/ui/empty-state';
import { StatTile } from '@/components/ui/stat-tile';
import { LineSeries } from '@/components/charts/series-charts';
import { PageHeader } from '@/components/shell/page-header';
import { useSchoolSummary } from '@/lib/client/attendance-admin';
import { useUrlState } from '@/lib/client/url-state';
import { percent, plural, todayIso } from '@/lib/format';
import { cn } from '@/lib/cn';
import { useAccess } from '../shared/access';
import { ErrorPanel } from '../shared/detail';
import { paths } from '../shared/paths';
import { AttendanceTabs } from './attendance-tabs';
import { ExportCard } from './export-card';
import { ShortageScanCard } from './shortage-scan';
import { longDate, shortDate, TableSection, trendAxis, trendSummary } from './status-bits';

type Summary = AttendanceSchoolSummaryResponse;
type SectionRow = Summary['sections'][number];
type Absentee = Summary['absentees'][number];

/** `/admin/attendance` — the school's attendance for a day: totals, classes, absentees and the trend. */
export function SchoolSummaryScreen() {
  const [p, set] = useUrlState({ date: '', days: 7 });
  const days: 7 | 31 = p.days === 31 ? 31 : 7;
  const q = useSchoolSummary({ date: p.date || undefined, trendDays: days });
  const d = q.data;
  const today = todayIso();

  return (
    <>
      <PageHeader
        title="Attendance"
        description="How the school is doing on a day, which classes have not marked yet, and who is away."
        actions={
          <div className="w-44">
            <DatePicker value={p.date || d?.date || today} onChange={(v) => set({ date: v === today ? '' : v })} max={today} presets={[{ label: 'Yesterday', value: shiftDay(today, -1) }]} />
          </div>
        }
      />
      <AttendanceTabs />

      {q.isError && !d ? (
        <ErrorPanel error={q.error} onRetry={() => void q.refetch()} title="We couldn’t load attendance" />
      ) : (
        <div className="space-y-6">
          {d && !d.isWorkingDay && (
            <Banner tone="info" title={d.holiday ? `Holiday: ${d.holiday}` : 'Not a school day'}>
              {longDate(d.date)} is {d.holiday ? 'a holiday' : 'not a working day'}, so no attendance is expected. Pick another date to see a school day.
            </Banner>
          )}

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {q.isPending || !d ? (
              [0, 1, 2, 3].map((i) => <StatTile key={i} label="Loading" state="loading" />)
            ) : (
              <>
                <StatTile label="Present" value={percent(d.totals.percentPresent)} hint={`of ${d.totals.markedStudents.toLocaleString()} marked students`} />
                <StatTile label="Absent" value={d.totals.absent} hint={`${d.totals.late} late · ${d.totals.half_day} half day`} />
                <StatTile label="Classes marked" value={`${d.sectionsMarked} of ${d.sectionsTotal}`} hint={d.totals.unmarkedStudents > 0 ? `${plural(d.totals.unmarkedStudents, 'student')} not marked yet` : 'Everyone is marked'} />
                <StatTile label="On approved leave" value={d.totals.leave} hint={`${d.totals.activeStudents.toLocaleString()} active students`} />
              </>
            )}
          </div>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="min-w-0 space-y-6">
              <TrendChart d={d} loading={q.isPending} days={days} onDays={(v) => set({ days: v })} fetching={q.isFetching} />
              <TableSection title="Classes" description={d ? `${d.sectionsMarked} of ${d.sectionsTotal} classes have submitted attendance for ${longDate(d.date)}` : undefined}>
                <ClassesTable d={d} loading={q.isPending} error={q.isError ? q.error : null} onRetry={() => void q.refetch()} />
              </TableSection>
              <TableSection title="Marked absent" description={d ? (d.absenteesTotal > d.absentees.length ? `Showing ${d.absentees.length} of ${d.absenteesTotal} students` : plural(d.absenteesTotal, 'student')) : undefined}>
                <AbsenteesTable d={d} loading={q.isPending} />
              </TableSection>
            </div>
            <div className="min-w-0 space-y-6">
              <ShortageScanCard />
              <ExportCard />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function shiftDay(iso: string, by: number): string {
  const [y, m, dd] = iso.split('-').map(Number) as [number, number, number];
  const t = new Date(y, m - 1, dd + by);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

function TrendChart({ d, loading, days, onDays, fetching }: { d?: Summary; loading: boolean; days: 7 | 31; onDays: (n: 7 | 31) => void; fetching: boolean }) {
  const trend = d?.trend ?? [];
  const marked = trend.filter((t) => t.percentPresent !== null);
  return (
    <ChartCard
      title={`Attendance, last ${days} days`}
      description="Share of marked students present each school day"
      height={240}
      loading={loading}
      empty={!!d && marked.length === 0}
      emptyText="No attendance has been marked in this period."
      summary={d ? trendSummary(trend) : undefined}
      actions={
        <div className={cn('inline-flex rounded-md border border-border bg-surface-subtle p-0.5', fetching && 'opacity-70')} role="group" aria-label="Trend length">
          {([7, 31] as const).map((n) => (
            <button key={n} type="button" aria-pressed={days === n} onClick={() => onDays(n)} className={cn('tr-colors h-7 rounded-[6px] px-2.5 text-xs font-medium sm:h-6', days === n ? 'bg-surface text-ink shadow-[0_0_0_1px_var(--border)]' : 'text-ink-3 hover:text-ink')}>
              {n} days
            </button>
          ))}
        </div>
      }
      table={{
        columns: [
          { key: 'date', label: 'Date' },
          { key: 'percentPresent', label: '% present', align: 'right' },
          { key: 'present', label: 'Present', align: 'right' },
          { key: 'late', label: 'Late', align: 'right' },
          { key: 'half_day', label: 'Half day', align: 'right' },
          { key: 'absent', label: 'Absent', align: 'right' },
          { key: 'leave', label: 'Leave', align: 'right' },
        ],
        rows: trend.map((t) => ({ ...t, date: longDate(t.date), percentPresent: percent(t.percentPresent) })),
      }}
    >
      <LineSeries data={trend.map((t) => ({ ...t }))} xKey="date" yKey="percentPresent" label="Present" height={240} xFormat={(v) => shortDate(String(v))} tooltipLabel={(v) => longDate(String(v))} yFormat={(v) => `${v}%`} valueFormat={(v) => `${v}%`} {...trendAxis(trend)} />
    </ChartCard>
  );
}

function ClassesTable({ d, loading, error, onRetry }: { d?: Summary; loading: boolean; error: unknown; onRetry: () => void }) {
  const date = d?.date;
  const cols: Column<SectionRow>[] = [
    {
      id: 'class',
      header: 'Class',
      cell: (r) => (
        <Link href={paths.attendanceClass(r.sectionId, date)} className="font-medium text-brand-ink underline-offset-4 hover:underline">
          {r.gradeName} {r.name}
        </Link>
      ),
      sortable: true,
      sortValue: (r) => `${r.gradeName} ${r.name}`,
      mobile: 'title',
    },
    { id: 'teacher', header: 'Class teacher', cell: (r) => r.classTeacherName ?? <span className="text-ink-3">Not assigned</span>, sortable: true, sortValue: (r) => r.classTeacherName ?? '', mobile: 'sub' },
    {
      id: 'marked',
      header: 'Roll call',
      cell: (r) =>
        r.marked ? (
          <Badge variant="success" icon={<CheckCircle2 aria-hidden />}>
            Submitted
          </Badge>
        ) : (
          <Badge variant="warning" icon={<CircleDashed aria-hidden />}>
            Not marked
          </Badge>
        ),
      sortable: true,
      sortValue: (r) => (r.marked ? 1 : 0),
      mobile: 'status',
    },
    { id: 'strength', header: 'Students', cell: (r) => r.strength, align: 'right', sortable: true, sortValue: (r) => r.strength, mobile: 'hide' },
    { id: 'present', header: 'Present', cell: (r) => (r.marked ? r.present : '—'), align: 'right', sortable: true, sortValue: (r) => r.present, mobile: 'detail' },
    { id: 'late', header: 'Late', cell: (r) => (r.marked ? r.late : '—'), align: 'right', sortable: true, sortValue: (r) => r.late, mobile: 'detail' },
    { id: 'half', header: 'Half day', cell: (r) => (r.marked ? r.half_day : '—'), align: 'right', sortable: true, sortValue: (r) => r.half_day, defaultHidden: true, mobile: 'hide' },
    { id: 'absent', header: 'Absent', cell: (r) => (r.marked ? r.absent : '—'), align: 'right', sortable: true, sortValue: (r) => r.absent, mobile: 'detail' },
    { id: 'leave', header: 'Leave', cell: (r) => (r.marked ? r.leave : '—'), align: 'right', sortable: true, sortValue: (r) => r.leave, defaultHidden: true, mobile: 'hide' },
    { id: 'pct', header: '% present', label: 'Percent present', cell: (r) => (r.marked ? percent(r.percentPresent) : '—'), align: 'right', sortable: true, sortValue: (r) => r.percentPresent, mobile: 'value' },
  ];
  return (
    <DataTable
      id="attendance-sections"
      caption="Classes and whether they have marked attendance"
      columns={cols}
      rows={d?.sections}
      rowKey={(r) => r.sectionId}
      loading={loading}
      error={error}
      onRetry={onRetry}
      empty={<EmptyState illustration="empty-generic" title="No classes yet" description="Classes appear here once sections are created for the current academic year." compact />}
    />
  );
}

function AbsenteesTable({ d, loading }: { d?: Summary; loading: boolean }) {
  const a = useAccess();
  const cols: Column<Absentee>[] = [
    {
      id: 'student',
      header: 'Student',
      cell: (r) => (a.can('students:view') ? (
        <Link href={paths.student(r.studentId)} className="font-medium text-brand-ink underline-offset-4 hover:underline">
          {r.name}
        </Link>
      ) : (
        <span className="font-medium">{r.name}</span>
      )),
      sortable: true,
      sortValue: (r) => r.name,
      mobile: 'title',
    },
    { id: 'admission', header: 'Admission no.', cell: (r) => <span className="tnum">{r.admissionNo}</span>, mobile: 'sub' },
    { id: 'class', header: 'Class', cell: (r) => r.sectionName, sortable: true, sortValue: (r) => r.sectionName, mobile: 'detail' },
    { id: 'remarks', header: 'Remarks', cell: (r) => r.remarks ?? <span className="text-ink-3">—</span>, mobile: 'detail' },
  ];
  return (
    <DataTable
      id="attendance-absentees"
      caption="Students marked absent"
      columns={cols}
      rows={d?.absentees}
      rowKey={(r) => r.studentId}
      loading={loading}
      compact
      empty={<EmptyState illustration="success" title="Nobody is marked absent" description={d && d.totals.markedStudents === 0 ? 'No class has submitted attendance for this day yet.' : 'Every marked student was present, late or on approved leave.'} compact />}
    />
  );
}
