'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ClipboardCheck, NotebookPen } from 'lucide-react';
import type { StudentListItem } from '@school-sync/shared';
import { useAttendanceToday } from '@/lib/client/hooks';
import { sectionOutLabel, useMyTeaching, useSectionDetail, useTeacherScope } from '@/lib/client/teacher';
import { clsKeys, useSectionAttendanceSummary, useSectionHomeworkCompletion, useSectionStudents } from '@/lib/client/teacher-classes';
import { addDaysIso } from '@/lib/client/teacher-dates';
import { useCoverage } from '@/lib/client/teacher-learning';
import { isOutOfScope } from '@/lib/client/teacher-errors';
import { dueLabel, fmtDate, percent, plural, todayIso } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Badge, StatusChip } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ChartCard } from '@/components/ui/chart';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { SearchField } from '@/components/ui/input';
import { ProgressBar } from '@/components/ui/progress';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { StatTile } from '@/components/ui/stat-tile';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/shell/page-header';
import { LineSeries } from '@/components/charts/series-charts';
import { useMeContext, usePermissions } from '@/components/me-context';
import { ErrorCard, OutOfScope, useUrlState } from '../common';
import { useQueryClient } from '@tanstack/react-query';

const TABS = ['students', 'subjects', 'attendance', 'homework'] as const;
type Tab = (typeof TABS)[number];
const RANGES = [
  { value: '14', label: 'Last 14 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
];

export function ClassDetailScreen({ sectionId }: { sectionId: string }) {
  const { base } = useMeContext();
  const url = useUrlState();
  const { can } = usePermissions();
  const scope = useTeacherScope();
  const detail = useSectionDetail(sectionId);
  const today = useAttendanceToday();
  const tab: Tab = (TABS as readonly string[]).includes(url.get('tab')) ? (url.get('tab') as Tab) : 'students';
  const days = Number(url.get('r', '30')) || 30;
  const to = todayIso();
  const from = addDaysIso(to, -(days - 1));

  if (detail.isError && isOutOfScope(detail.error)) {
    return (
      <>
        <PageHeader title="Class" crumbs={[{ label: 'Home', href: base || '/' }, { label: 'My classes', href: `${base}/classes` }]} />
        <OutOfScope what="This class" backHref={`${base}/classes`} backLabel="Back to my classes" />
      </>
    );
  }
  if (detail.isError && !detail.data) {
    return (
      <>
        <PageHeader title="Class" crumbs={[{ label: 'Home', href: base || '/' }, { label: 'My classes', href: `${base}/classes` }]} />
        <ErrorCard error={detail.error} onRetry={() => void detail.refetch()} title="We couldn’t load this class" />
      </>
    );
  }

  const s = detail.data;
  const att = today.data?.items.filter((i) => i.sectionId === sectionId) ?? [];
  const pending = att.find((i) => !i.marked) ?? att[0];
  const lead = scope.isLead(sectionId);

  return (
    <>
      <PageHeader
        title={s ? sectionOutLabel(s) : 'Class'}
        description={s ? `${plural(s.studentCount, 'student')}${s.room ? ` · Room ${s.room}` : ''} · Class teacher: ${s.classTeacherName ?? 'not assigned'}${lead ? ' (you)' : ''}` : undefined}
        crumbs={[{ label: 'Home', href: base || '/' }, { label: 'My classes', href: `${base}/classes` }, { label: s ? sectionOutLabel(s) : '…' }]}
        actions={
          <>
            {pending && can('attendance:create') && (
              <Button asChild variant="secondary">
                <Link href={`${base}/attendance?class=${pending.sectionId}:${pending.periodId ?? ''}`}>
                  <ClipboardCheck /> {pending.marked ? 'Roll call' : 'Take attendance'}
                </Link>
              </Button>
            )}
            {can('homework:create') && (
              <Button asChild>
                <Link href={`${base}/homework/new?section=${sectionId}`}>
                  <NotebookPen /> New homework
                </Link>
              </Button>
            )}
          </>
        }
      />

      <Tabs value={tab} onValueChange={(v) => url.set({ tab: v === 'students' ? null : v })}>
        <TabsList aria-label="Class sections">
          <TabsTrigger value="students">Students</TabsTrigger>
          <TabsTrigger value="subjects">Subjects and syllabus</TabsTrigger>
          <TabsTrigger value="attendance">Attendance</TabsTrigger>
          <TabsTrigger value="homework">Homework</TabsTrigger>
        </TabsList>
        <TabsContent value="students">
          <StudentsTab sectionId={sectionId} from={from} to={to} days={days} />
        </TabsContent>
        <TabsContent value="subjects">
          <SubjectsTab sectionId={sectionId} />
        </TabsContent>
        <TabsContent value="attendance">
          <AttendanceTab sectionId={sectionId} from={from} to={to} days={days} onDays={(v) => url.set({ r: v === '30' ? null : v }, { keepPage: true })} />
        </TabsContent>
        <TabsContent value="homework">
          <HomeworkTab sectionId={sectionId} />
        </TabsContent>
      </Tabs>
    </>
  );
}

/* ───────────────────────── students ───────────────────────── */

function StudentsTab({ sectionId, from, to, days }: { sectionId: string; from: string; to: string; days: number }) {
  const router = useRouter();
  const { base } = useMeContext();
  const students = useSectionStudents(sectionId);
  const summary = useSectionAttendanceSummary(sectionId, from, to);
  const hw = useSectionHomeworkCompletion(sectionId);
  const [q, setQ] = React.useState('');
  const qc = useQueryClient();

  const attBy = React.useMemo(() => new Map((summary.data?.students ?? []).map((s) => [s.studentId, s])), [summary.data]);
  const rows = React.useMemo(() => {
    const t = q.trim().toLowerCase();
    return (students.data ?? []).filter((s) => !t || s.name.toLowerCase().includes(t) || s.admissionNo.toLowerCase().includes(t));
  }, [students.data, q]);
  const open = (s: StudentListItem) => router.push(`${base}/classes/${sectionId}/students/${s.id}`);

  const columns: Column<StudentListItem>[] = [
    { id: 'roll', header: 'Roll', label: 'Roll number', cell: (r) => <span className="tnum text-ink-2">{r.rollNo ?? '—'}</span>, sortable: true, sortValue: (r) => r.rollNo ?? 9999, className: 'w-16', mobile: 'hide' },
    {
      id: 'name',
      header: 'Student',
      cell: (r) => (
        <div className="min-w-0">
          <Link href={`${base}/classes/${sectionId}/students/${r.id}`} onClick={(e) => e.stopPropagation()} className="font-medium hover:underline">
            {r.name}
          </Link>
          <p className="t-caption text-ink-3">
            {r.admissionNo}
            {r.rollNo ? ` · Roll ${r.rollNo}` : ''}
          </p>
        </div>
      ),
      sortable: true,
      sortValue: (r) => r.name,
      mobile: 'title',
    },
    {
      id: 'att',
      header: `Attendance (${days} days)`,
      label: 'Attendance',
      align: 'right',
      sortable: true,
      sortValue: (r) => attBy.get(r.id)?.percentage ?? -1,
      cell: (r) => {
        if (summary.isPending) return <Skeleton className="ml-auto h-4 w-12" />;
        const a = attBy.get(r.id);
        if (!a || a.percentage === null) return <span className="text-ink-3">—</span>;
        return (
          <span className="inline-flex items-center justify-end gap-2">
            {a.isShort && (
              <Badge variant="danger" icon={<AlertTriangle aria-hidden />}>
                Short
              </Badge>
            )}
            <span className="tnum">{percent(a.percentage)}</span>
          </span>
        );
      },
      mobile: 'value',
    },
    {
      id: 'hw',
      header: 'Homework handed in',
      label: 'Homework',
      align: 'right',
      sortable: true,
      sortValue: (r) => (hw.data && hw.data.total > 0 ? (hw.data.byStudent.get(r.id)?.submitted ?? 0) / hw.data.total : -1),
      cell: (r) => {
        if (hw.isPending) return <Skeleton className="ml-auto h-4 w-12" />;
        if (!hw.data || hw.data.total === 0) return <span className="text-ink-3">—</span>;
        const n = Math.min(hw.data.byStudent.get(r.id)?.submitted ?? 0, hw.data.total);
        return (
          <span className="tnum">
            {n} of {hw.data.total}
          </span>
        );
      },
      mobile: 'detail',
    },
  ];

  const fails = [summary.isError && 'attendance', hw.isError && 'homework'].filter(Boolean) as string[];

  return (
    <div className="space-y-3">
      {fails.length > 0 && (
        <p className="t-caption flex flex-wrap items-center gap-2 text-ink-2" role="status">
          <AlertTriangle className="size-3.5 text-warning" aria-hidden />
          We couldn’t load the {fails.join(' and ')} figures for this class.
          <button
            type="button"
            className="font-medium text-brand-ink underline-offset-4 hover:underline"
            onClick={() => {
              void summary.refetch();
              void qc.invalidateQueries({ queryKey: clsKeys.secHomework(sectionId) });
            }}
          >
            Try again
          </button>
        </p>
      )}
      <DataTable<StudentListItem>
        id="teacher-class-students"
        caption="Students in this class"
        rows={rows}
        rowKey={(r) => r.id}
        loading={students.isPending}
        error={students.error}
        onRetry={() => void students.refetch()}
        onRowClick={open}
        compact
        filters={<SearchField className="w-full sm:w-72" value={q} onChange={setQ} placeholder="Search name or admission number" hint={null} />}
        columns={columns}
        empty={
          q ? (
            <EmptyState illustration="no-results" compact title="No students match your search" action={<Button variant="secondary" size="sm" onClick={() => setQ('')}>Clear search</Button>} />
          ) : (
            <EmptyState illustration="empty-generic" compact title="No students in this class yet" description="Students appear here once the office allocates them to the section." />
          )
        }
      />
    </div>
  );
}

/* ───────────────────────── subjects and syllabus ───────────────────────── */

function SubjectsTab({ sectionId }: { sectionId: string }) {
  const { base } = useMeContext();
  const detail = useSectionDetail(sectionId);
  const coverage = useCoverage(sectionId);
  const teaching = useMyTeaching();
  const scope = useTeacherScope();
  const cov = new Map((coverage.data ?? []).map((c) => [c.subjectId, c]));
  const rows = detail.data?.teachingAssignments ?? [];
  const lead = scope.isLead(sectionId);

  return (
    <Card>
      <CardHeader title="Subjects" description="Who teaches what in this class, and how much of the syllabus has been covered." />
      <CardBody className="pt-3">
        {detail.isPending ? (
          <div className="space-y-3" aria-busy>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : detail.isError ? (
          <ErrorCard error={detail.error} onRetry={() => void detail.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState compact illustration="empty-generic" title="No subjects assigned yet" description="The office assigns subject teachers to each class." />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((a) => {
              const c = cov.get(a.subjectId);
              const mine = teaching.teaches(sectionId, a.subjectId);
              const canUpdate = mine || lead;
              return (
                <li key={a.id} className="grid gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,220px)_auto] sm:items-center">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      <span className="truncate">{a.subjectName}</span>
                      {mine && <Badge variant="primary">You</Badge>}
                    </p>
                    <p className="t-caption text-ink-2">{a.staffName}</p>
                  </div>
                  <div>
                    {coverage.isPending ? (
                      <Skeleton className="h-4 w-full" />
                    ) : c ? (
                      <>
                        <div className="t-caption mb-1 flex justify-between text-ink-2">
                          <span>
                            {c.completed} of {c.totalTopics} topics
                          </span>
                          <span className="tnum">{percent(c.percent, 0)}</span>
                        </div>
                        <ProgressBar value={c.percent} max={100} label={`${a.subjectName} syllabus covered`} />
                      </>
                    ) : (
                      <span className="t-caption text-ink-3">No syllabus topics yet</span>
                    )}
                  </div>
                  <div className="sm:text-right">
                    {canUpdate ? (
                      <Button asChild variant="secondary" size="sm">
                        <Link href={`${base}/syllabus?section=${sectionId}&subject=${a.subjectId}`}>Update progress</Link>
                      </Button>
                    ) : (
                      <span className="t-caption text-ink-3">Taught by a colleague</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

/* ───────────────────────── attendance ───────────────────────── */

function AttendanceTab({ sectionId, from, to, days, onDays }: { sectionId: string; from: string; to: string; days: number; onDays: (v: string) => void }) {
  const { base } = useMeContext();
  const q = useSectionAttendanceSummary(sectionId, from, to);
  const d = q.data;
  const series = (d?.days ?? []).filter((x) => x.percentage !== null);
  const short = (d?.students ?? []).filter((s) => s.isShort).sort((a, b) => (a.percentage ?? 0) - (b.percentage ?? 0));
  const lowest = series.length ? [...series].sort((a, b) => (a.percentage ?? 0) - (b.percentage ?? 0))[0] : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="w-full sm:w-48">
          <Select aria-label="Date range" value={String(days)} onValueChange={onDays} options={RANGES} />
        </div>
        <Button asChild variant="secondary" size="sm">
          <Link href={`${base}/attendance/history?section=${sectionId}`}>Day-by-day history and corrections</Link>
        </Button>
      </div>

      {q.isError && !d ? (
        <ErrorCard error={q.error} onRetry={() => void q.refetch()} title="We couldn’t load attendance for this class" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile label="Present" value={q.isPending ? undefined : percent(d?.totals.percentage)} state={q.isPending ? 'loading' : 'ready'} hint={`over ${plural(series.length, 'school day')}`} />
            <StatTile label="Absences" value={d?.totals.absent} state={q.isPending ? 'loading' : 'ready'} hint="student-days" />
            <StatTile label="Late" value={d?.totals.late} state={q.isPending ? 'loading' : 'ready'} hint="student-days" />
            <StatTile label="Below the attendance target" value={q.isPending ? undefined : short.length} state={q.isPending ? 'loading' : 'ready'} hint={short.length === 1 ? 'student' : 'students'} />
          </div>

          <ChartCard
            title="Daily attendance"
            description={`Share of marked students present each school day, ${fmtDate(from, { day: 'numeric', month: 'short' })} to ${fmtDate(to, { day: 'numeric', month: 'short' })}`}
            height={240}
            loading={q.isPending}
            empty={!!d && series.length === 0}
            emptyText="No roll call has been submitted in this period yet."
            summary={d && series.length > 0 ? `Averaged ${percent(d.totals.percentage)} present over ${plural(series.length, 'school day')}${lowest ? `; the lowest day was ${fmtDate(lowest.date, { day: 'numeric', month: 'short' })} at ${percent(lowest.percentage)}` : ''}.` : undefined}
            table={{
              columns: [
                { key: 'date', label: 'Date' },
                { key: 'percentage', label: '% present', align: 'right' },
                { key: 'present', label: 'Present', align: 'right' },
                { key: 'absent', label: 'Absent', align: 'right' },
                { key: 'late', label: 'Late', align: 'right' },
                { key: 'half_day', label: 'Half day', align: 'right' },
              ],
              rows: series.map((x) => ({ ...x, date: fmtDate(x.date, { weekday: 'short', day: 'numeric', month: 'short' }), percentage: percent(x.percentage) })),
            }}
          >
            <LineSeries data={series.map((x) => ({ ...x }))} xKey="date" yKey="percentage" label="Present" height={240} xFormat={(v) => fmtDate(String(v), { day: 'numeric', month: 'short' })} tooltipLabel={(v) => fmtDate(String(v), { weekday: 'long', day: 'numeric', month: 'long' })} yFormat={(v) => `${v}%`} valueFormat={(v) => `${v}%`} domain={axisDomain(series.map((x) => x.percentage))} />
          </ChartCard>

          <Card>
            <CardHeader title="Students below the target" description="Their attendance over the selected period is under the school’s minimum." />
            <CardBody className="pt-3">
              {q.isPending ? (
                <Skeleton className="h-16 w-full" />
              ) : short.length === 0 ? (
                <p className="text-sm text-ink-2">No student is below the target in this period.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {short.map((s) => (
                    <li key={s.studentId} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                      <Link href={`${base}/classes/${sectionId}/students/${s.studentId}`} className="min-w-0 truncate text-sm font-medium hover:underline">
                        {s.name}
                      </Link>
                      <span className="t-caption tnum shrink-0 text-danger">
                        {percent(s.percentage)} · {s.absent} absent
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}

/** A y-axis band that starts below the lowest value (rounded to 5) and ends at 100. */
function axisDomain(v: (number | null)[]): [number, number] {
  const nums = v.filter((x): x is number => x !== null);
  const lo = nums.length ? Math.max(0, Math.floor((Math.min(...nums) - 2) / 5) * 5) : 0;
  return [Math.min(lo, 95), 100];
}

/* ───────────────────────── homework ───────────────────────── */

function HomeworkTab({ sectionId }: { sectionId: string }) {
  const { base } = useMeContext();
  const hw = useSectionHomeworkCompletion(sectionId);
  const list = [...(hw.data?.homework ?? [])].sort((a, b) => b.dueAt.localeCompare(a.dueAt)).slice(0, 12);
  return (
    <Card>
      <CardHeader
        title="Homework for this class"
        description={hw.data ? `${plural(hw.data.homework.length, 'item')}${hw.data.total > 0 ? ` · ${hw.data.total} take online hand-ins` : ''}` : undefined}
        action={
          <Button asChild variant="secondary" size="sm">
            <Link href={`${base}/homework?scope=class&section=${sectionId}`}>View all</Link>
          </Button>
        }
      />
      <CardBody className="pt-3">
        {hw.isPending ? (
          <div className="space-y-3" aria-busy>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : hw.isError ? (
          <ErrorCard error={hw.error} onRetry={() => void hw.refetch()} />
        ) : list.length === 0 ? (
          <EmptyState
            compact
            illustration="empty-homework"
            title="No homework for this class yet"
            action={
              <Button asChild size="sm">
                <Link href={`${base}/homework/new?section=${sectionId}`}>Set homework</Link>
              </Button>
            }
          />
        ) : (
          <ul className="divide-y divide-border">
            {list.map((h) => {
              const due = dueLabel(h.dueAt);
              const handed = h.stats ? Math.max(0, h.stats.totalStudents - h.stats.missing) : 0;
              return (
                <li key={h.id} className="py-2.5 first:pt-0 last:pb-0">
                  <Link href={`${base}/homework/${h.id}`} className="-mx-2 grid gap-2 rounded-md px-2 py-1 hover:bg-surface-subtle sm:grid-cols-[minmax(0,1fr)_200px_auto] sm:items-center">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{h.title}</p>
                      <p className={cn('t-caption truncate', due.overdue && h.status === 'published' ? 'text-danger' : 'text-ink-2')}>
                        {h.subjectName} · due {due.text}
                        {h.teacherName ? ` · ${h.teacherName}` : ''}
                      </p>
                    </div>
                    {h.allowSubmission && h.stats && h.status !== 'draft' ? (
                      <div className="flex items-center gap-2">
                        <ProgressBar className="flex-1" value={handed} max={h.stats.totalStudents} label={`${h.title}: handed in`} />
                        <span className="t-caption tnum shrink-0 text-ink-2">
                          {handed}/{h.stats.totalStudents}
                        </span>
                      </div>
                    ) : (
                      <span className="t-caption text-ink-3">{h.allowSubmission ? '' : 'No online hand-in'}</span>
                    )}
                    <StatusChip status={h.status} label={h.status === 'closed' ? 'Closed' : undefined} />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
