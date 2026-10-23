'use client';

import * as React from 'react';
import type { SyllabusCoverageItem, SyllabusTopicItem } from '@school-sync/shared';
import { useSyllabusCoverage, useSyllabusTopics } from '@/lib/client/learner-learning';
import { fmtDate } from '@/lib/format';
import { BarSeries } from '@/components/charts/series-charts';
import { StatusChip } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { ChartCard } from '@/components/ui/chart';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { EmptyState } from '@/components/ui/empty-state';
import { ProgressBar } from '@/components/ui/progress';
import { ErrorState, SkeletonRows } from '../states';
import { useLearner } from '../use-learner';

const pct = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)}%`;

/** How much of each subject's syllabus has been covered in class, plus the topic list per subject. */
export function SyllabusView() {
  const l = useLearner();
  const cov = useSyllabusCoverage(l.studentId, l.q, l.ready);
  const topics = useSyllabusTopics(l.studentId, l.q, l.ready);
  const rows = React.useMemo(() => [...(cov.data ?? [])].sort((a, b) => b.percent - a.percent), [cov.data]);
  const totals = rows.reduce((t, r) => ({ total: t.total + r.totalTopics, done: t.done + r.completed }), { total: 0, done: 0 });
  const overall = totals.total ? Math.round((totals.done / totals.total) * 1000) / 10 : 0;
  const best = rows[0];
  const lowest = rows[rows.length - 1];

  const bySubject = React.useMemo(() => {
    const m = new Map<string, SyllabusTopicItem[]>();
    for (const t of topics.data ?? []) m.set(t.subjectName, [...(m.get(t.subjectName) ?? []), t]);
    return [...m.entries()].map(([name, list]) => [name, list.sort((a, b) => a.ordinal - b.ordinal)] as const).sort((a, b) => a[0].localeCompare(b[0]));
  }, [topics.data]);

  return (
    <section aria-label="Syllabus coverage" className="space-y-6">
      <ChartCard
        title="Syllabus covered"
        description={l.isParent ? `${l.name}’s class, by subject` : 'Your class, by subject'}
        summary={rows.length ? `Across all subjects ${totals.done} of ${totals.total} topics (${pct(overall)}) have been completed.${best && lowest && rows.length > 1 ? ` Furthest along: ${best.subjectName} (${pct(best.percent)}); least: ${lowest.subjectName} (${pct(lowest.percent)}).` : ''}` : undefined}
        height={Math.max(180, rows.length * 34 + 30)}
        loading={cov.isPending}
        error={cov.isError ? cov.error : undefined}
        onRetry={() => void cov.refetch()}
        empty={rows.length === 0}
        emptyText="No syllabus has been set up for this class yet."
        table={{
          columns: [
            { key: 'subject', label: 'Subject' },
            { key: 'completed', label: 'Done', align: 'right' },
            { key: 'inProgress', label: 'In progress', align: 'right' },
            { key: 'notStarted', label: 'Not started', align: 'right' },
            { key: 'percent', label: 'Covered', align: 'right', format: (v) => pct(Number(v)) },
          ],
          rows: rows.map((r) => ({ subject: r.subjectName, completed: r.completed, inProgress: r.inProgress, notStarted: r.notStarted, percent: r.percent })),
        }}
      >
        <BarSeries data={rows.map((r) => ({ subject: r.subjectName, percent: r.percent }))} xKey="subject" yKey="percent" label="Covered" height={Math.max(180, rows.length * 34 + 30)} horizontal yFormat={(v) => `${v}%`} valueFormat={(v) => `${v}%`} />
      </ChartCard>

      <Card>
        <div className="border-b border-border px-5 py-4 max-sm:px-4">
          <h2 className="t-section">Topics by subject</h2>
          <p className="t-caption mt-0.5 text-ink-2">Open a subject to see what has been taught and what’s coming.</p>
        </div>
        {topics.isPending || cov.isPending ? (
          <SkeletonRows rows={4} />
        ) : topics.isError ? (
          <ErrorState error={topics.error} onRetry={() => void topics.refetch()} title="We couldn’t load the topics" />
        ) : bySubject.length === 0 ? (
          <EmptyState compact illustration="empty-generic" title="No topics yet" description="Your teachers haven’t added topics for this class." />
        ) : (
          <Accordion type="multiple">
            {bySubject.map(([name, list]) => {
              const c: SyllabusCoverageItem | undefined = cov.data?.find((x) => x.subjectName === name);
              return (
                <AccordionItem key={name} value={name}>
                  <AccordionTrigger>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{name}</span>
                      <span className="t-caption block font-normal text-ink-2">
                        {c ? `${c.completed} of ${c.totalTopics} topics done` : `${list.length} topics`}
                      </span>
                    </span>
                    {c && (
                      <span className="mr-2 hidden w-28 sm:block">
                        <ProgressBar value={c.percent} label={`${name} covered`} />
                      </span>
                    )}
                    {c && <span className="tnum mr-1 text-[13px] font-medium">{pct(c.percent)}</span>}
                  </AccordionTrigger>
                  <AccordionContent>
                    <ol className="divide-y divide-border rounded-md border border-border">
                      {list.map((t) => (
                        <li key={t.id} className="flex items-center gap-3 px-3 py-2.5">
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm">{t.title}</span>
                            <span className="t-caption block text-ink-3">
                              {[t.termName, t.plannedHours ? `${t.plannedHours} h planned` : null, t.progress?.completedAt ? `done ${fmtDate(t.progress.completedAt.slice(0, 10))}` : null].filter(Boolean).join(' · ')}
                            </span>
                          </span>
                          <StatusChip status={t.progress?.status ?? 'not_started'} label={t.progress?.status === 'in_progress' ? 'In progress' : undefined} />
                        </li>
                      ))}
                    </ol>
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        )}
      </Card>
    </section>
  );
}
