'use client';

import * as React from 'react';
import type { ExamAnalyticsOut, ExamOut } from '@school-sync/shared';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ChartCard } from '@/components/ui/chart';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { BarSeries } from '@/components/charts/series-charts';
import { useExamAnalytics, useGradeScales } from '@/lib/client/exams-admin';
import { percent } from '@/lib/format';
import { ErrorPanel } from '../shared/detail';
import { FilterSelect } from '../shared/controls';
import { SheetStatusChip } from './meta';

type Row = ExamAnalyticsOut['rows'][number];
const cls = (r: { gradeName: string; sectionName: string }) => `${r.gradeName} ${r.sectionName}`;

/** Per class / subject results for an exam. Every figure is computed by the API; nothing is recalculated here. */
export function ExamAnalytics({ exam }: { exam: ExamOut }) {
  const q = useExamAnalytics(exam.id);
  const scales = useGradeScales();
  const [section, setSection] = React.useState('');
  const [page, setPage] = React.useState(1);
  const d = q.data;

  const scale = scales.data?.find((s) => s.id === exam.gradeScaleId) ?? scales.data?.find((s) => s.isDefault);
  const gradeOrder = React.useMemo(() => new Map((scale?.bands ?? []).sort((a, b) => b.minPercent - a.minPercent).map((b, i) => [b.label, i])), [scale]);
  const grades = React.useMemo(() => [...(d?.gradeDistribution ?? [])].sort((a, b) => (gradeOrder.get(a.grade) ?? 99) - (gradeOrder.get(b.grade) ?? 99) || a.grade.localeCompare(b.grade)), [d, gradeOrder]);

  if (q.isError) return <ErrorPanel error={q.error} onRetry={() => void q.refetch()} title="We couldn’t load the analytics" />;
  if (!q.isPending && d && d.sheetsIncluded === 0) {
    return (
      <Card>
        <EmptyState illustration="empty-generic" title="No marks to analyse yet" description="Analytics cover mark sheets that are submitted, approved or published. They appear as soon as teachers submit." compact />
      </Card>
    );
  }

  const secs = d?.sections ?? [];
  const bySection = secs.map((s) => ({ label: cls(s), averagePercent: s.averagePercent ?? 0, passPercent: s.passPercent ?? 0, students: s.students }));
  const best = [...secs].filter((s) => s.averagePercent !== null).sort((a, b) => b.averagePercent! - a.averagePercent!);
  const secHeight = Math.max(180, secs.length * 40);
  const topCount = d?.distribution.reduce((m, b) => (b.count > m.count ? b : m), { range: '', from: 0, to: 0, count: -1 });

  const rows = (d?.rows ?? []).filter((r) => !section || r.sectionId === section);
  const pageSize = 25;
  const shown = rows.slice((page - 1) * pageSize, page * pageSize);
  const columns: Column<Row>[] = [
    { id: 'class', header: 'Class', sortable: true, sortValue: (r) => cls(r), mobile: 'title', cell: (r) => <span className="font-medium">{cls(r)}</span> },
    { id: 'subject', header: 'Subject', sortable: true, sortValue: (r) => r.subjectName, mobile: 'sub', cell: (r) => r.subjectName },
    { id: 'status', header: 'Sheet', mobile: 'status', cell: (r) => <SheetStatusChip status={r.sheetStatus} /> },
    { id: 'appeared', header: 'Appeared', align: 'right', mobile: 'detail', cell: (r) => `${r.appeared} of ${r.students}${r.absent ? ` (${r.absent} abs.)` : ''}` },
    { id: 'avg', header: 'Average', align: 'right', sortable: true, sortValue: (r) => r.averagePercent, mobile: 'value', cell: (r) => percent(r.averagePercent) },
    { id: 'high', header: 'Highest', align: 'right', sortable: true, sortValue: (r) => r.highestPercent, mobile: 'hide', cell: (r) => percent(r.highestPercent) },
    { id: 'low', header: 'Lowest', align: 'right', sortable: true, sortValue: (r) => r.lowestPercent, mobile: 'hide', cell: (r) => percent(r.lowestPercent) },
    { id: 'pass', header: 'Pass', align: 'right', sortable: true, sortValue: (r) => r.passPercent, mobile: 'detail', cell: (r) => percent(r.passPercent) },
  ];

  return (
    <div className="space-y-6">
      {exam.status !== 'published' && d && (
        <Banner tone="info">These figures cover {d.sheetsIncluded} submitted, approved or published mark sheets, so they can still change until everything is published.</Banner>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard
          title="Average by class"
          description="Average percentage across all subjects of the class"
          height={secHeight}
          loading={q.isPending}
          empty={!!d && secs.length === 0}
          summary={best.length ? `Highest average: ${cls(best[0]!)} at ${percent(best[0]!.averagePercent)}. Lowest: ${cls(best[best.length - 1]!)} at ${percent(best[best.length - 1]!.averagePercent)}.` : undefined}
          table={{ columns: [{ key: 'label', label: 'Class' }, { key: 'students', label: 'Students', align: 'right' }, { key: 'averagePercent', label: 'Average %', align: 'right', format: (v) => percent(v as number) }, { key: 'passPercent', label: 'Pass %', align: 'right', format: (v) => percent(v as number) }], rows: bySection }}
        >
          <BarSeries data={bySection} xKey="label" yKey="averagePercent" label="Average" horizontal height={secHeight} yFormat={(v) => `${v}%`} valueFormat={(v) => `${v}%`} />
        </ChartCard>
        <ChartCard
          title="Pass percentage by class"
          description="Share of the class that passed"
          height={secHeight}
          loading={q.isPending}
          empty={!!d && secs.length === 0}
          summary={secs.length ? `Pass percentage ranges from ${percent(Math.min(...secs.map((s) => s.passPercent ?? 0)))} to ${percent(Math.max(...secs.map((s) => s.passPercent ?? 0)))} across ${secs.length} classes.` : undefined}
          table={{ columns: [{ key: 'label', label: 'Class' }, { key: 'passPercent', label: 'Pass %', align: 'right', format: (v) => percent(v as number) }], rows: bySection }}
        >
          <BarSeries data={bySection} xKey="label" yKey="passPercent" label="Pass" horizontal height={secHeight} yFormat={(v) => `${v}%`} valueFormat={(v) => `${v}%`} />
        </ChartCard>
        <ChartCard
          title="How students scored"
          description="Number of students by overall percentage"
          height={240}
          loading={q.isPending}
          empty={!!d && d.distribution.every((b) => b.count === 0)}
          summary={topCount && topCount.count > 0 ? `Most students (${topCount.count}) scored between ${topCount.from}% and ${topCount.to}%.` : undefined}
          table={{ columns: [{ key: 'range', label: 'Percentage' }, { key: 'count', label: 'Students', align: 'right' }], rows: d?.distribution ?? [] }}
        >
          <BarSeries data={(d?.distribution ?? []).map((b) => ({ ...b }))} xKey="range" yKey="count" label="Students" height={240} />
        </ChartCard>
        <ChartCard
          title="Grades awarded"
          description={scale ? `Using the ${scale.name} scale` : 'Letter grades across all students'}
          height={240}
          loading={q.isPending}
          empty={!!d && grades.length === 0}
          summary={grades.length ? `${[...grades].sort((a, b) => b.count - a.count)[0]!.grade} is the most common grade (${[...grades].sort((a, b) => b.count - a.count)[0]!.count} students).` : undefined}
          table={{ columns: [{ key: 'grade', label: 'Grade' }, { key: 'count', label: 'Students', align: 'right' }], rows: grades }}
        >
          <BarSeries data={grades.map((g) => ({ ...g }))} xKey="grade" yKey="count" label="Students" height={240} />
        </ChartCard>
      </div>

      <Card>
        <CardHeader title="Top performers" description="Highest overall percentage across the published subjects" />
        <CardBody className="pt-3">
          {q.isPending ? (
            <Skeleton className="h-40 w-full" />
          ) : (d?.topPerformers.length ?? 0) === 0 ? (
            <p className="text-sm text-ink-2">No ranked students yet.</p>
          ) : (
            <ol className="divide-y divide-border">
              {d!.topPerformers.map((t, i) => (
                <li key={t.studentId} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                  <span className="figure w-7 text-right text-xl text-ink-2">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{t.name}</p>
                    <p className="t-caption text-ink-2">{t.sectionName} · {t.admissionNo}</p>
                  </div>
                  <div className="text-right">
                    <p className="tnum text-sm font-medium">{percent(t.percent)}</p>
                    <p className="t-caption tnum text-ink-2">{t.totalMarks} marks</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </CardBody>
      </Card>

      <div className="space-y-3">
        <h2 className="t-section">By class and subject</h2>
        <DataTable
          id="exam-analytics-rows"
          caption="Results by class and subject"
          columns={columns}
          rows={shown}
          rowKey={(r) => `${r.sectionId}-${r.subjectId}`}
          loading={q.isPending}
                    page={page}
          pageSize={pageSize}
          total={rows.length}
          onPageChange={setPage}
          filters={<FilterSelect label="Class" value={section} onChange={(v) => { setSection(v); setPage(1); }} options={secs.map((s) => ({ value: s.sectionId, label: cls(s) }))} allLabel="All classes" />}
          empty={<EmptyState illustration="no-results" title="No rows for this class" action={<Button variant="secondary" size="sm" onClick={() => setSection('')}>Show all classes</Button>} compact />}
        />
      </div>
    </div>
  );
}
