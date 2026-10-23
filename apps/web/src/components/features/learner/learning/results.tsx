'use client';

import * as React from 'react';
import Link from 'next/link';
import { CheckCircle2, ChevronRight, FileDown, Loader2, TriangleAlert, XCircle } from 'lucide-react';
import type { StudentResultOut } from '@school-sync/shared';
import { reportCardPdfPath, useReportCard, useResults, useResultsProgress } from '@/lib/client/learner-learning';
import { ApiError, errorMessage } from '@/lib/problem';
import { fmtDate, percent } from '@/lib/format';
import { cn } from '@/lib/cn';
import { PageHeader } from '@/components/shell/page-header';
import { BarSeries, LineSeries } from '@/components/charts/series-charts';
import { Badge } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ChartCard } from '@/components/ui/chart';
import { DataTable } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { StatTile } from '@/components/ui/stat-tile';
import { toast } from '@/components/ui/toaster';
import { ErrorState, NeedsLearner, SkeletonRows } from '../states';
import { useGates, useLearner } from '../use-learner';

export function ResultChip({ r }: { r: Pick<StudentResultOut, 'result' | 'complete'> }) {
  if (!r.complete) return <Badge variant="warning" icon={<TriangleAlert aria-hidden />}>Provisional</Badge>;
  if (r.result === 'pass') return <Badge variant="success" icon={<CheckCircle2 aria-hidden />}>Passed</Badge>;
  if (r.result === 'fail') return <Badge variant="danger" icon={<XCircle aria-hidden />}>Not passed</Badge>;
  return null;
}

/** Downloads the report card PDF through the BFF (a failed request shows a message instead of a blank tab). */
export function ReportCardButton({ examId, studentId, variant = 'secondary', size = 'md' }: { examId: string; studentId: string; variant?: 'primary' | 'secondary'; size?: 'sm' | 'md' }) {
  const [busy, setBusy] = React.useState(false);
  const { can } = useGates();
  if (!can('report_cards:view')) return null;
  const run = async () => {
    setBusy(true);
    try {
      const res = await fetch(reportCardPdfPath(examId, studentId), { credentials: 'same-origin' });
      if (!res.ok) {
        let body: unknown = null;
        try {
          body = await res.json();
        } catch {}
        throw ApiError.fromProblem(res.status, body);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = /filename="?([^";]+)"?/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'report-card.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      toast.error(e instanceof ApiError && e.status === 404 ? 'The report card isn’t available yet.' : errorMessage(e, 'We couldn’t download the report card.'), { duration: 8000 });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button variant={variant} size={size} onClick={() => void run()} loading={busy} aria-label="Download report card as PDF">
      <FileDown /> Report card (PDF)
    </Button>
  );
}

// ───────────────────────────── list ─────────────────────────────

/** Published results: one card per exam, a progress trend and the latest exam by subject. */
export function ResultsView() {
  const l = useLearner();
  const results = useResults(l.studentId, l.q, l.ready);
  const progress = useResultsProgress(l.studentId, l.q, l.ready);
  const detailBase = `${l.base}/${l.isParent ? 'academics' : 'learning'}/results`;
  const list = React.useMemo(() => [...(results.data ?? [])].sort((a, b) => (b.startDate ?? '').localeCompare(a.startDate ?? '')), [results.data]);
  const latest = list[0];
  const trend = (progress.data?.exams ?? []).filter((e) => e.percent !== null).map((e) => ({ exam: e.name, percent: e.percent as number, date: e.date }));
  const subjectRows = latest ? latest.subjects.filter((s) => s.percent !== null).map((s) => ({ subject: s.subjectName, percent: s.percent as number })).sort((a, b) => b.percent - a.percent) : [];

  return (
    <section aria-label="Results" className="space-y-6">
      {results.isPending ? (
        <Card>
          <SkeletonRows rows={3} />
        </Card>
      ) : results.isError && !results.data ? (
        <Card>
          <ErrorState error={results.error} onRetry={() => void results.refetch()} title="We couldn’t load the results" />
        </Card>
      ) : list.length === 0 ? (
        <Card>
          <EmptyState illustration="empty-generic" title="No results published yet" description={l.isParent ? `When the school publishes ${l.name}’s exam results they appear here, with the report card.` : 'When the school publishes exam results they appear here, with your report card.'} />
        </Card>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2" aria-label="Published exam results">
          {list.map((r) => (
            <li key={r.examId}>
              <Card interactive className="h-full">
                <CardBody className="flex h-full flex-col gap-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="t-section truncate">{r.examName}</h3>
                      <p className="t-caption mt-0.5 text-ink-2">{[r.termName, r.startDate ? `${fmtDate(r.startDate, { day: 'numeric', month: 'short' })}${r.endDate && r.endDate !== r.startDate ? ` – ${fmtDate(r.endDate, { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}` : null].filter(Boolean).join(' · ')}</p>
                    </div>
                    <ResultChip r={r} />
                  </div>
                  <dl className="grid grid-cols-3 gap-3">
                    <Metric k="Overall" v={percent(r.percent)} />
                    <Metric k="Grade" v={r.grade ?? '—'} />
                    <Metric k="Rank" v={r.rank ? `${r.rank}` : '—'} hint={r.rank ? `of ${r.classSize}` : undefined} />
                  </dl>
                  <div className="mt-auto flex flex-wrap items-center gap-2">
                    <Button asChild size="sm">
                      <Link href={`${detailBase}/${r.examId}`}>
                        View subjects <ChevronRight />
                      </Link>
                    </Button>
                    <ReportCardButton examId={r.examId} studentId={r.studentId} size="sm" />
                  </div>
                </CardBody>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {list.length > 0 && (
        <div className="grid gap-6 lg:grid-cols-2">
          <ChartCard
            title="Progress over exams"
            description="Overall percentage in each published exam"
            summary={trend.length ? (trend.length === 1 ? `Only one exam has been published so far: ${percent(trend[0]!.percent)} in ${trend[0]!.exam}.` : `Latest ${percent(trend[trend.length - 1]!.percent)} in ${trend[trend.length - 1]!.exam}, ${trend[trend.length - 1]!.percent >= trend[trend.length - 2]!.percent ? 'up from' : 'down from'} ${percent(trend[trend.length - 2]!.percent)} in ${trend[trend.length - 2]!.exam}.`) : undefined}
            height={220}
            loading={progress.isPending}
            error={progress.isError ? progress.error : undefined}
            onRetry={() => void progress.refetch()}
            empty={trend.length === 0}
            table={{ columns: [{ key: 'exam', label: 'Exam' }, { key: 'date', label: 'Date', format: (v) => (v ? fmtDate(String(v)) : '—') }, { key: 'percent', label: 'Overall', align: 'right', format: (v) => percent(Number(v)) }], rows: trend }}
          >
            <LineSeries data={trend} xKey="exam" yKey="percent" label="Overall %" height={220} yFormat={(v) => `${v}%`} valueFormat={(v) => `${v}%`} domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} />
          </ChartCard>
          <ChartCard
            title={latest ? `${latest.examName} by subject` : 'Latest exam by subject'}
            description="Highest first"
            summary={subjectRows.length ? `Strongest: ${subjectRows[0]!.subject} (${percent(subjectRows[0]!.percent)}); lowest: ${subjectRows[subjectRows.length - 1]!.subject} (${percent(subjectRows[subjectRows.length - 1]!.percent)}).` : undefined}
            height={Math.max(200, subjectRows.length * 32 + 30)}
            empty={subjectRows.length === 0}
            table={{ columns: [{ key: 'subject', label: 'Subject' }, { key: 'percent', label: 'Percent', align: 'right', format: (v) => percent(Number(v)) }], rows: subjectRows }}
          >
            <BarSeries data={subjectRows} xKey="subject" yKey="percent" label="Percent" height={Math.max(200, subjectRows.length * 32 + 30)} horizontal yFormat={(v) => `${v}%`} valueFormat={(v) => `${v}%`} />
          </ChartCard>
        </div>
      )}
    </section>
  );
}

const Metric = ({ k, v, hint }: { k: string; v: string; hint?: string }) => (
  <div>
    <dt className="t-caption text-ink-2">{k}</dt>
    <dd className="figure text-[28px] leading-9">
      {v}
      {hint && <span className="t-caption ml-1 font-sans font-normal text-ink-2">{hint}</span>}
    </dd>
  </div>
);

// ───────────────────────────── one exam ─────────────────────────────

export function ResultDetailScreen({ examId }: { examId: string }) {
  const l = useLearner();
  return (
    <NeedsLearner>
      <Detail examId={examId} key={`${examId}-${l.studentId}`} />
    </NeedsLearner>
  );
}

function Detail({ examId }: { examId: string }) {
  const l = useLearner();
  const results = useResults(l.studentId, l.q, l.ready);
  const card = useReportCard(examId, l.studentId, l.ready);
  const base = `${l.base}/${l.isParent ? 'academics' : 'learning'}`;
  const crumbs = [{ label: 'Home', href: l.base || '/' }, { label: l.isParent ? 'Academics' : 'Learning', href: `${base}?tab=results` }, { label: 'Results' }];
  const r = results.data?.find((x) => x.examId === examId);

  if (results.isPending) {
    return (
      <>
        <PageHeader title="Results" crumbs={crumbs} />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4" aria-busy="true">
          {[0, 1, 2, 3].map((i) => <StatTile key={i} label="Loading" state="loading" />)}
        </div>
        <Skeleton className="mt-6 h-72 w-full" />
      </>
    );
  }
  if (results.isError && !results.data) {
    return (
      <>
        <PageHeader title="Results" crumbs={crumbs} />
        <Card><ErrorState error={results.error} onRetry={() => void results.refetch()} title="We couldn’t load this result" /></Card>
      </>
    );
  }
  if (!r) {
    return (
      <>
        <PageHeader title="Results" crumbs={crumbs} />
        <Card>
          <EmptyState illustration="empty-generic" title="This result isn’t published" description="Either the exam doesn’t exist or the school hasn’t published its results yet." action={<Button asChild variant="secondary" size="sm"><Link href={`${base}?tab=results`}>Back to results</Link></Button>} />
        </Card>
      </>
    );
  }
  const subjects = r.subjects;
  const bars = subjects.filter((s) => s.percent !== null).map((s) => ({ subject: s.subjectName, percent: s.percent as number })).sort((a, b) => b.percent - a.percent);
  const rc = card.data;

  return (
    <>
      <PageHeader
        title={r.examName}
        description={[l.isParent ? r.studentName : null, r.termName, r.gradeName && r.sectionName ? `${r.gradeName} ${r.sectionName}` : null, r.rollNo ? `Roll ${r.rollNo}` : null].filter(Boolean).join(' · ')}
        crumbs={crumbs}
        actions={<ReportCardButton examId={r.examId} studentId={r.studentId} variant="primary" />}
      />
      {!r.complete && (
        <Banner tone="warning" className="mb-4" title="Provisional result">
          {r.subjectsPublished} of {r.subjectsExpected} subjects are published so far. The totals, grade and rank will change as the rest are released.
        </Banner>
      )}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Overall" value={percent(r.percent)} hint={`${r.totalMarks} of ${r.maxTotal} marks`} />
        <StatTile label="Grade" value={r.grade ?? '—'} hint={r.gradeRemark ?? undefined} />
        <StatTile label="Class rank" value={r.rank ? `${r.rank}` : '—'} hint={r.rank ? `of ${r.classSize} students${r.percentile !== null ? ` · ahead of ${Math.round(r.percentile)}%` : ''}` : 'Not ranked yet'} />
        <div className="rounded-lg border border-border bg-surface p-4 shadow-card sm:p-5">
          <p className="t-caption text-ink-2">Result</p>
          <div className="mt-2 flex min-h-10 items-center"><ResultChip r={r} /></div>
          {rc && <p className="t-caption mt-1 text-ink-2">Pass mark {rc.passPercent}%</p>}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-6">
          <DataTable
            id="result-subjects"
            caption={`${r.examName} marks by subject`}
            rows={subjects}
            rowKey={(s) => s.subjectId}
            columns={[
              { id: 'subject', header: 'Subject', mobile: 'title', sortable: true, sortValue: (s) => s.subjectName, cell: (s) => <span className="font-medium">{s.subjectName}</span> },
              { id: 'marks', header: 'Marks', align: 'right', mobile: 'sub', sortable: true, sortValue: (s) => s.marksObtained, cell: (s) => (s.isAbsent ? <span className="text-ink-2">Absent</span> : <span className="tnum">{s.marksObtained ?? '—'} <span className="text-ink-3">/ {s.maxMarks}</span></span>) },
              { id: 'percent', header: '%', align: 'right', mobile: 'detail', sortable: true, sortValue: (s) => s.percent, cell: (s) => percent(s.percent) },
              { id: 'grade', header: 'Grade', mobile: 'detail', cell: (s) => s.grade ?? '—' },
              {
                id: 'result',
                header: 'Result',
                mobile: 'status',
                cell: (s) => (s.isAbsent ? <Badge variant="neutral">Absent</Badge> : s.passed ? <Badge variant="success" icon={<CheckCircle2 aria-hidden />}>Pass</Badge> : <Badge variant="danger" icon={<XCircle aria-hidden />}>Below pass mark</Badge>),
              },
              { id: 'remarks', header: 'Remarks', defaultHidden: true, mobile: 'hide', cell: (s) => s.remarks ?? '—' },
            ]}
          />
          <ChartCard
            title="Subjects compared"
            description="Percentage in each subject, highest first"
            summary={bars.length ? `${bars[0]!.subject} is the strongest subject at ${percent(bars[0]!.percent)}${bars.length > 1 ? `; ${bars[bars.length - 1]!.subject} is lowest at ${percent(bars[bars.length - 1]!.percent)}` : ''}.` : undefined}
            height={Math.max(200, bars.length * 32 + 30)}
            empty={bars.length === 0}
            table={{ columns: [{ key: 'subject', label: 'Subject' }, { key: 'percent', label: 'Percent', align: 'right', format: (v) => percent(Number(v)) }], rows: bars }}
          >
            <BarSeries data={bars} xKey="subject" yKey="percent" label="Percent" height={Math.max(200, bars.length * 32 + 30)} horizontal yFormat={(v) => `${v}%`} valueFormat={(v) => `${v}%`} />
          </ChartCard>
        </div>

        <aside className="space-y-6" aria-label="Report card details">
          {card.isPending ? (
            <Skeleton className="h-48 w-full" />
          ) : rc ? (
            <>
              {rc.remarks && (rc.remarks.remark || rc.remarks.areasToImprove || rc.remarks.conduct) ? (
                <Card>
                  <CardHeader title="Class teacher’s remarks" />
                  <CardBody className="space-y-3 pt-3 text-sm">
                    {rc.remarks.remark && <p className="leading-6">{rc.remarks.remark}</p>}
                    {rc.remarks.areasToImprove && (
                      <div>
                        <p className="t-label text-ink">To work on</p>
                        <p className="mt-0.5 text-ink-2">{rc.remarks.areasToImprove}</p>
                      </div>
                    )}
                    {rc.remarks.conduct && (
                      <div>
                        <p className="t-label text-ink">Conduct</p>
                        <p className="mt-0.5 text-ink-2">{rc.remarks.conduct}</p>
                      </div>
                    )}
                  </CardBody>
                </Card>
              ) : (
                <Card><CardHeader title="Class teacher’s remarks" /><CardBody className="pt-3 text-sm text-ink-2">Remarks haven’t been published yet.</CardBody></Card>
              )}
              {rc.attendance && (
                <Card>
                  <CardHeader title="Attendance in this period" />
                  <CardBody className="pt-3">
                    <p className="figure text-[28px] leading-9">{percent(rc.attendance.percent)}</p>
                    <p className="t-caption mt-1 text-ink-2">
                      {rc.attendance.present + rc.attendance.late} present of {rc.attendance.totalDays} days · {rc.attendance.absent} absent
                    </p>
                  </CardBody>
                </Card>
              )}
              {rc.gradeScale.length > 0 && (
                <Card>
                  <CardHeader title="Grade scale" />
                  <CardBody className="pt-3">
                    <table className="t-table w-full">
                      <caption className="sr-only">Grade bands</caption>
                      <thead>
                        <tr className="text-left text-ink-2">
                          <th scope="col" className="pb-1.5 font-medium">Grade</th>
                          <th scope="col" className="pb-1.5 text-right font-medium">Percent</th>
                          <th scope="col" className="pb-1.5 pl-3 font-medium">Meaning</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rc.gradeScale.map((b) => (
                          <tr key={b.label} className={cn('border-t border-border', b.label === r.grade && 'bg-brand-soft font-medium')}>
                            <th scope="row" className="py-1.5 text-left font-medium">{b.label}{b.label === r.grade && <span className="sr-only"> (your grade)</span>}</th>
                            <td className="tnum py-1.5 text-right">{b.minPercent}–{b.maxPercent}</td>
                            <td className="py-1.5 pl-3 text-ink-2">{b.remark ?? ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </CardBody>
                </Card>
              )}
            </>
          ) : (
            card.isError && (
              <Card>
                <CardBody className="text-sm text-ink-2">
                  {card.error instanceof ApiError && card.error.status === 404 ? 'The full report card isn’t available yet.' : 'We couldn’t load the report card details.'}
                  {!(card.error instanceof ApiError && card.error.status === 404) && (
                    <Button variant="secondary" size="sm" className="mt-3" onClick={() => void card.refetch()}>
                      {card.isFetching ? <Loader2 className="animate-spin" /> : null} Try again
                    </Button>
                  )}
                </CardBody>
              </Card>
            )
          )}
          <Button asChild variant="secondary" className="w-full">
            <Link href={`${base}?tab=results`}>Back to all results</Link>
          </Button>
        </aside>
      </div>
    </>
  );
}
