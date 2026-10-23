'use client';

import * as React from 'react';
import Link from 'next/link';
import { CheckCircle2, ShieldAlert, XCircle } from 'lucide-react';
import type { ExamAnalyticsOut } from '@school-sync/shared';
import { useClassResults, useExamAnalytics, useExams, type ClassResults } from '@/lib/client/teacher-marks';
import { secLabel, useMySections, useTeacherScope } from '@/lib/client/teacher';
import { isOutOfScope } from '@/lib/client/teacher-errors';
import { fmtDate, percent, plural } from '@/lib/format';
import { Badge, StatusChip } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ChartCard } from '@/components/ui/chart';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { StatTile } from '@/components/ui/stat-tile';
import { BarSeries } from '@/components/charts/series-charts';
import { PageHeader } from '@/components/shell/page-header';
import { useMeContext } from '@/components/me-context';
import { ErrorCard, useUrlState } from '../common';
import { CLASS_CONFIG, ClassBars, RankedBars } from './results-charts';
import { ExamSelect, ExamStatusChip } from './marks-shared';

type Row = ExamAnalyticsOut['rows'][number];
const compact = (grade: string, section: string) => `${grade.replace(/^grade\s*/i, '')}${section}`;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Results & analytics for the sheets in my scope, plus the ranked class results when I lead the class. */
export function ResultsScreen() {
  const url = useUrlState();
  const { base } = useMeContext();
  const exams = useExams();
  const list = React.useMemo(() => (exams.data ?? []).filter((e) => e.status === 'published' || e.status === 'under_review' || e.status === 'marks_entry'), [exams.data]);
  const wanted = url.get('exam');
  const exam = list.find((e) => e.id === wanted) ?? list.find((e) => e.status === 'published') ?? list[0] ?? null;
  const analytics = useExamAnalytics(exam?.id);

  return (
    <>
      <PageHeader
        title="Results"
        description="How your classes did. Figures cover the mark sheets you teach, once they are submitted."
        actions={list.length > 0 ? <ExamSelect exams={list} value={exam?.id ?? ''} onChange={(v) => url.set({ exam: v })} /> : undefined}
      />

      {exams.isPending ? (
        <Skeleton className="h-64 w-full" aria-busy />
      ) : exams.isError ? (
        <ErrorCard error={exams.error} onRetry={() => void exams.refetch()} title="We couldn’t load the exams" />
      ) : !exam ? (
        <Card>
          <EmptyState
            illustration="empty-generic"
            title="No results to show yet"
            description="Results appear once marks entry has opened for an exam."
            action={
              <Button asChild variant="secondary">
                <Link href={`${base}/marks/exams`}>See the exam schedule</Link>
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="space-y-6">
          <p className="t-caption flex flex-wrap items-center gap-2 text-ink-2">
            <ExamStatusChip status={exam.status} />
            {exam.publishedAt ? `Published ${fmtDate(exam.publishedAt)}` : exam.startDate ? `Held ${fmtDate(exam.startDate, { day: 'numeric', month: 'short' })}` : null}
            {exam.status !== 'published' && <span>· Only submitted, approved and published sheets are counted.</span>}
          </p>
          <Analytics q={analytics} />
          <ClassResultsCard examId={exam.id} published={exam.status === 'published'} />
        </div>
      )}
    </>
  );
}

/* ───────────────────────── analytics ───────────────────────── */

function Analytics({ q }: { q: ReturnType<typeof useExamAnalytics> }) {
  const a = q.data;
  const rows = React.useMemo(() => a?.rows ?? [], [a]);

  const totals = React.useMemo(() => {
    const withAvg = rows.filter((r) => r.averagePercent !== null && r.appeared > 0);
    const appeared = rows.reduce((n, r) => n + r.appeared, 0);
    const pass = rows.reduce((n, r) => n + r.passCount, 0);
    const wAvg = withAvg.reduce((n, r) => n + (r.averagePercent ?? 0) * r.appeared, 0) / Math.max(1, withAvg.reduce((n, r) => n + r.appeared, 0));
    return { appeared, absent: rows.reduce((n, r) => n + r.absent, 0), avg: withAvg.length ? wAvg : null, passRate: appeared ? (pass / appeared) * 100 : null };
  }, [rows]);

  if (q.isError) return <ErrorCard error={q.error} onRetry={() => void q.refetch()} title="We couldn’t load the analytics" />;
  const empty = !!a && (a.sheetsIncluded === 0 || rows.length === 0);

  const ranked = [...rows]
    .filter((r) => r.averagePercent !== null)
    .sort((x, y) => (y.averagePercent ?? 0) - (x.averagePercent ?? 0))
    .map((r) => ({ label: `${r.subjectName} ${compact(r.gradeName, r.sectionName)}`, value: round1(r.averagePercent ?? 0), r }));
  const dist = a?.distribution ?? [];
  const distTotal = dist.reduce((n, d) => n + d.count, 0);
  const peak = dist.reduce<(typeof dist)[number] | null>((m, d) => (!m || d.count > m.count ? d : m), null);
  const grades = a?.gradeDistribution ?? [];
  const topGrade = grades.reduce<(typeof grades)[number] | null>((m, g) => (!m || g.count > m.count ? g : m), null);
  const sections = (a?.sections ?? []).map((s) => ({ label: compact(s.gradeName, s.sectionName), average: s.averagePercent === null ? null : round1(s.averagePercent), pass: s.passPercent === null ? null : round1(s.passPercent), students: s.students }));
  const sectionsWithData = sections.filter((s) => s.average !== null);

  if (empty) {
    return (
      <Card>
        <EmptyState illustration="empty-generic" title="No marks to analyse yet" description="Analytics appear once at least one of your mark sheets for this exam is submitted." />
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Mark sheets counted" value={a?.sheetsIncluded} state={q.isPending ? 'loading' : 'ready'} hint="Submitted or later" />
        <StatTile label="Students appeared" value={totals.appeared} state={q.isPending ? 'loading' : 'ready'} hint={totals.absent ? `${totals.absent} absent` : undefined} />
        <StatTile label="Average score" value={totals.avg === null ? '—' : percent(round1(totals.avg))} state={q.isPending ? 'loading' : 'ready'} hint="Weighted by students" />
        <StatTile label="Pass rate" value={totals.passRate === null ? '—' : percent(round1(totals.passRate))} state={q.isPending ? 'loading' : 'ready'} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard
          title="Score distribution"
          description="Students by overall percentage, in 10-point bands"
          height={240}
          loading={q.isPending}
          empty={!q.isPending && distTotal === 0}
          summary={peak && distTotal > 0 ? `${peak.count} of ${plural(distTotal, 'student')} scored in the ${peak.range}% band, the most common range.` : undefined}
          table={{ columns: [{ key: 'range', label: 'Band (%)' }, { key: 'count', label: 'Students', align: 'right' }], rows: dist.map((d) => ({ range: d.range, count: d.count })) }}
        >
          <BarSeries data={dist.map((d) => ({ range: d.range, count: d.count }))} xKey="range" yKey="count" label="Students" height={240} />
        </ChartCard>

        <ChartCard
          title="Average by subject and class"
          description="Highest first"
          height={Math.max(200, ranked.length * 36 + 40)}
          loading={q.isPending}
          empty={!q.isPending && ranked.length === 0}
          summary={ranked.length > 0 ? `Highest average: ${ranked[0]!.label} at ${percent(ranked[0]!.value)}; lowest: ${ranked[ranked.length - 1]!.label} at ${percent(ranked[ranked.length - 1]!.value)}.` : undefined}
          table={{ columns: [{ key: 'label', label: 'Subject and class' }, { key: 'value', label: 'Average %', align: 'right' }], rows: ranked.map((r) => ({ label: r.label, value: r.value })) }}
        >
          <RankedBars data={ranked.map((r) => ({ label: r.label, value: r.value }))} label="Average %" height={Math.max(200, ranked.length * 36 + 40)} />
        </ChartCard>

        {sectionsWithData.length > 0 && (
          <ChartCard
            title="Classes compared"
            description="Class average and pass rate"
            height={240}
            loading={q.isPending}
            legend={CLASS_CONFIG}
            summary={`Class averages range from ${percent(Math.min(...sectionsWithData.map((s) => s.average!)))} to ${percent(Math.max(...sectionsWithData.map((s) => s.average!)))}.`}
            table={{ columns: [{ key: 'label', label: 'Class' }, { key: 'students', label: 'Students', align: 'right' }, { key: 'average', label: 'Average %', align: 'right' }, { key: 'pass', label: 'Pass rate %', align: 'right' }], rows: sections }}
          >
            <ClassBars data={sections} height={240} />
          </ChartCard>
        )}

        <ChartCard
          title="Grades"
          description="Students by overall grade"
          height={240}
          loading={q.isPending}
          empty={!q.isPending && grades.length === 0}
          summary={topGrade ? `The most common grade is ${topGrade.grade}, with ${plural(topGrade.count, 'student')}.` : undefined}
          table={{ columns: [{ key: 'grade', label: 'Grade' }, { key: 'count', label: 'Students', align: 'right' }], rows: grades }}
        >
          <BarSeries data={grades.map((g) => ({ ...g }))} xKey="grade" yKey="count" label="Students" height={240} />
        </ChartCard>
      </div>

      <RowsTable rows={rows} loading={q.isPending} />

      {(a?.topPerformers.length ?? 0) > 0 && (
        <Card>
          <CardHeader title="Top performers" description="Highest overall percentage across the sheets above" />
          <CardBody className="pt-3">
            <ol className="divide-y divide-border">
              {a!.topPerformers.map((t, i) => (
                <li key={t.studentId} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                  <span className="tnum w-6 shrink-0 text-right text-[13px] text-ink-3">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{t.name}</p>
                    <p className="t-caption truncate text-ink-2">
                      {t.sectionName} · {t.admissionNo}
                    </p>
                  </div>
                  <span className="figure text-lg leading-6">{percent(round1(t.percent))}</span>
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function RowsTable({ rows, loading }: { rows: Row[]; loading: boolean }) {
  const columns: Column<Row>[] = [
    {
      id: 'subject',
      header: 'Subject',
      mobile: 'title',
      sortable: true,
      sortValue: (r) => r.subjectName,
      cell: (r) => (
        <span className="block min-w-0">
          <span className="block truncate font-medium">{r.subjectName}</span>
          <span className="t-caption block text-ink-2">{secLabel(r.gradeName, r.sectionName)}</span>
        </span>
      ),
    },
    { id: 'status', header: 'Sheet', mobile: 'status', cell: (r) => <StatusChip status={r.sheetStatus} /> },
    { id: 'appeared', header: 'Appeared', align: 'right', mobile: 'detail', sortable: true, sortValue: (r) => r.appeared, cell: (r) => <span className="tnum">{r.appeared}/{r.students}{r.absent ? <span className="text-ink-3"> · {r.absent} absent</span> : null}</span> },
    { id: 'avg', header: 'Average', align: 'right', mobile: 'value', sortable: true, sortValue: (r) => r.averagePercent, cell: (r) => percent(r.averagePercent === null ? null : round1(r.averagePercent)) },
    { id: 'high', header: 'Highest', align: 'right', mobile: 'detail', sortable: true, sortValue: (r) => r.highestPercent, cell: (r) => percent(r.highestPercent) },
    { id: 'low', header: 'Lowest', align: 'right', mobile: 'detail', sortable: true, sortValue: (r) => r.lowestPercent, cell: (r) => percent(r.lowestPercent) },
    { id: 'pass', header: 'Pass rate', align: 'right', mobile: 'detail', sortable: true, sortValue: (r) => r.passPercent, cell: (r) => percent(r.passPercent === null ? null : round1(r.passPercent)) },
  ];
  return (
    <section aria-labelledby="rows-h" className="space-y-3">
      <h2 id="rows-h" className="t-section">
        Subject by class
      </h2>
      <DataTable<Row> id="teacher-marks-analytics" caption="Marks by subject and class" rows={rows} rowKey={(r) => `${r.sectionId}:${r.subjectId}`} loading={loading} columns={columns} empty={<EmptyState compact title="No sheets to show" />} />
    </section>
  );
}

/* ───────────────────────── class results (class teacher) ───────────────────────── */

function ClassResultsCard({ examId, published }: { examId: string; published: boolean }) {
  const url = useUrlState();
  const scope = useTeacherScope();
  const sections = useMySections();
  const list = React.useMemo(() => sections.data ?? [], [sections.data]);
  const wanted = url.get('section');
  const sec = list.find((s) => s.id === wanted) ?? list.find((s) => scope.isLead(s.id)) ?? list[0] ?? null;
  const leads = !!sec && scope.isLead(sec.id);
  const q = useClassResults(examId, leads ? sec!.id : null);

  if (!scope.isClassTeacher) return null; // subject teachers have no class-wide results

  return (
    <Card>
      <CardHeader
        title="Class results"
        description="Ranked results of the class you lead, once the exam’s marks are published."
        action={
          list.length > 1 ? (
            <Select aria-label="Class" className="w-44" value={sec?.id ?? ''} onValueChange={(v) => url.set({ section: v })} options={list.map((s) => ({ value: s.id, label: secLabel(s.gradeName, s.name) }))} />
          ) : undefined
        }
      />
      <CardBody className="pt-4">
        {sections.isPending ? (
          <Skeleton className="h-48 w-full" />
        ) : !sec ? (
          <EmptyState compact title="No class to show" />
        ) : !leads ? (
          <EmptyState compact icon={<ShieldAlert />} title="Class results are available to the class teacher" description={`You teach ${secLabel(sec.gradeName, sec.name)} but don’t lead it. Choose a class you lead to see its ranked results.`} />
        ) : q.isPending ? (
          <Skeleton className="h-48 w-full" aria-busy />
        ) : q.isError ? (
          isOutOfScope(q.error) ? (
            <EmptyState compact icon={<ShieldAlert />} title="Class results are available to the class teacher" description="This class’s results aren’t available to you." />
          ) : (
            <ErrorCard error={q.error} onRetry={() => void q.refetch()} className="border-0 shadow-none" />
          )
        ) : (
          <ClassTable data={q.data} published={published} />
        )}
      </CardBody>
    </Card>
  );
}

type CRow = ClassResults['data'][number];

function ClassTable({ data, published }: { data: ClassResults; published: boolean }) {
  const provisional = data.data.some((r) => r.subjectsPublished < data.subjectsExpected);
  const columns: Column<CRow>[] = [
    { id: 'rank', header: 'Rank', align: 'right', mobile: 'value', sortable: true, sortValue: (r) => r.rank, cell: (r) => <span className="tnum font-medium">{r.rank ?? '—'}</span> },
    { id: 'name', header: 'Student', mobile: 'title', sortable: true, sortValue: (r) => r.name, cell: (r) => <span className="block min-w-0"><span className="block truncate font-medium">{r.name}</span><span className="t-caption block text-ink-2">Roll {r.rollNo ?? '—'} · {r.admissionNo}</span></span> },
    { id: 'total', header: 'Total', align: 'right', mobile: 'detail', cell: (r) => <span className="tnum">{r.totalMarks}/{r.maxTotal}</span> },
    { id: 'percent', header: 'Percent', align: 'right', mobile: 'detail', sortable: true, sortValue: (r) => r.percent, cell: (r) => percent(r.percent) },
    { id: 'grade', header: 'Grade', mobile: 'detail', cell: (r) => r.grade ?? '—' },
    {
      id: 'result',
      header: 'Result',
      mobile: 'status',
      cell: (r) =>
        r.result === 'pass' ? (
          <Badge variant="success" icon={<CheckCircle2 aria-hidden />}>Pass</Badge>
        ) : r.result === 'fail' ? (
          <Badge variant="danger" icon={<XCircle aria-hidden />}>Fail</Badge>
        ) : (
          <span className="text-ink-3">—</span>
        ),
    },
  ];
  return (
    <div className="space-y-3">
      {provisional && data.data.length > 0 && <Banner tone="info">Some students have fewer than {data.subjectsExpected} published subjects, so their totals and ranks are provisional.</Banner>}
      <DataTable<CRow>
        id="teacher-marks-class-results"
        caption="Class results"
        rows={data.data}
        rowKey={(r) => r.studentId}
        columns={columns}
        empty={<EmptyState compact illustration="empty-generic" title={published ? 'No published results for this class yet' : 'Results are not published yet'} description={published ? 'Results appear once the subject sheets of this class are published.' : 'Class results appear after the school publishes the exam.'} />}
      />
    </div>
  );
}
