'use client';

import * as React from 'react';
import { Check, CircleDashed, Loader } from 'lucide-react';
import type { SyllabusProgressStatus, SyllabusTopicItem } from '@school-sync/shared';
import { sectionOutLabel, useMySections, useMyTeaching, useTeacherScope } from '@/lib/client/teacher';
import { teacherError } from '@/lib/client/teacher-errors';
import { useBulkTopicProgress, useCoverage, useSetTopicProgress, useTopics } from '@/lib/client/teacher-learning';
import { percent, plural } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ChartCard } from '@/components/ui/chart';
import { EmptyState } from '@/components/ui/empty-state';
import { ProgressBar } from '@/components/ui/progress';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toaster';
import { PageHeader } from '@/components/shell/page-header';
import { BarSeries } from '@/components/charts/series-charts';
import { ErrorCard, useUrlState, useWriteGate } from '../common';

const STATES: { value: SyllabusProgressStatus; label: string; short: string; Icon: typeof Check }[] = [
  { value: 'not_started', label: 'Not started', short: 'Not started', Icon: CircleDashed },
  { value: 'in_progress', label: 'In progress', short: 'In progress', Icon: Loader },
  { value: 'completed', label: 'Completed', short: 'Done', Icon: Check },
];

/** Lesson progress: topics of one subject in one class, with a three-state control, and how much of every subject is covered. */
export function SyllabusProgressScreen() {
  const url = useUrlState();
  const sections = useMySections();
  const teaching = useMyTeaching();
  const scope = useTeacherScope();

  const sectionId = url.get('section') || sections.data?.[0]?.id || '';
  const section = sections.data?.find((s) => s.id === sectionId);
  const pairs = teaching.subjectsOf(sectionId);
  const subjectId = pairs.some((p) => p.subjectId === url.get('subject')) ? url.get('subject') : (pairs.find((p) => p.via === 'teach') ?? pairs[0])?.subjectId || '';
  const pair = pairs.find((p) => p.subjectId === subjectId);
  const coverage = useCoverage(sectionId || null);
  const rows = [...(coverage.data ?? [])].sort((a, b) => b.percent - a.percent);
  const myIds = new Set(teaching.pairs.filter((p) => p.sectionId === sectionId && p.via === 'teach').map((p) => p.subjectId));
  const avg = rows.length ? rows.reduce((a, c) => a + c.percent, 0) / rows.length : 0;

  return (
    <>
      <PageHeader title="Syllabus progress" description="Record where each class has got to, topic by topic. Parents and students see the progress." />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:max-w-2xl">
        <LabeledSelect label="Class">
          <Select aria-label="Class" value={sectionId || undefined} onValueChange={(v) => url.set({ section: v, subject: null })} placeholder={sections.isPending ? 'Loading…' : 'Choose a class'} options={(sections.data ?? []).map((s) => ({ value: s.id, label: sectionOutLabel(s) }))} />
        </LabeledSelect>
        <LabeledSelect label="Subject">
          <Select aria-label="Subject" value={subjectId || undefined} onValueChange={(v) => url.set({ subject: v })} placeholder={teaching.isPending ? 'Loading…' : 'Choose a subject'} options={pairs.map((p) => ({ value: p.subjectId, label: p.via === 'lead' ? `${p.subjectName} (class teacher)` : p.subjectName }))} disabled={pairs.length === 0} />
        </LabeledSelect>
      </div>

      {teaching.error && !sections.data ? (
        <ErrorCard error={teaching.error} onRetry={teaching.refetch} title="We couldn’t load your classes" />
      ) : !sectionId && !sections.isPending ? (
        <Card>
          <EmptyState illustration="empty-generic" title="No classes to show" description="You aren’t assigned to a class yet." />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
          <div className="order-2 lg:order-1">
            {pair && section ? <TopicsCard key={`${sectionId}:${subjectId}`} sectionId={sectionId} gradeId={section.gradeId} subjectId={subjectId} subjectName={pair.subjectName} canUpdate={pair.via === 'teach' || scope.isLead(sectionId)} /> : teaching.isPending ? <Card><div className="p-5"><Skeleton className="h-64 w-full" /></div></Card> : <Card><EmptyState compact illustration="empty-generic" title="No subject to show" description="You don’t teach a subject in this class." /></Card>}
          </div>
          <div className="order-1 lg:order-2">
            <ChartCard
              title="Syllabus covered"
              description={section ? `${sectionOutLabel(section)}: share of each subject’s topics completed` : undefined}
              height={Math.max(200, rows.length * 40)}
              loading={coverage.isPending}
              error={coverage.error}
              onRetry={() => void coverage.refetch()}
              empty={!coverage.isPending && rows.length === 0}
              emptyText="No syllabus topics have been set up for this class yet."
              summary={rows.length ? `On average ${percent(avg, 0)} of the syllabus is covered. ${rows[0]!.subjectName} is furthest on (${percent(rows[0]!.percent, 0)}); ${rows[rows.length - 1]!.subjectName} has the most left (${percent(rows[rows.length - 1]!.percent, 0)}).${myIds.size ? ' Your subjects are marked in the table view.' : ''}` : undefined}
              table={{
                columns: [
                  { key: 'subjectName', label: 'Subject' },
                  { key: 'completed', label: 'Done', align: 'right' },
                  { key: 'inProgress', label: 'In progress', align: 'right' },
                  { key: 'notStarted', label: 'Not started', align: 'right' },
                  { key: 'percent', label: 'Covered', align: 'right', format: (v) => percent(v as number, 0) },
                ],
                rows: rows.map((r) => ({ ...r, subjectName: myIds.has(r.subjectId) ? `${r.subjectName} (yours)` : r.subjectName })),
              }}
            >
              <BarSeries data={rows.map((r) => ({ ...r, subjectName: r.subjectName.length > 12 ? `${r.subjectName.slice(0, 11)}…` : r.subjectName }))} xKey="subjectName" yKey="percent" label="Covered" horizontal height={Math.max(200, rows.length * 40)} yFormat={(v) => `${v}%`} valueFormat={(v) => `${v}%`} />
            </ChartCard>
          </div>
        </div>
      )}
    </>
  );
}

function LabeledSelect({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <span className="t-label block text-ink">{label}</span>
      {children}
    </div>
  );
}

/* ───────────────────────── topics ───────────────────────── */

function TopicsCard({ sectionId, gradeId, subjectId, subjectName, canUpdate }: { sectionId: string; gradeId: string; subjectId: string; subjectName: string; canUpdate: boolean }) {
  const topics = useTopics(gradeId, subjectId, sectionId);
  const set = useSetTopicProgress(gradeId, subjectId, sectionId);
  const bulk = useBulkTopicProgress(sectionId);
  const gate = useWriteGate();
  const [error, setError] = React.useState<string | null>(null);
  const list = React.useMemo(() => topics.data ?? [], [topics.data]);
  const done = list.filter((t) => t.progress?.status === 'completed').length;
  const going = list.filter((t) => t.progress?.status === 'in_progress').length;
  const groups = React.useMemo(() => {
    const m = new Map<string, { name: string; items: SyllabusTopicItem[] }>();
    for (const t of list) {
      const k = t.termId ?? 'none';
      const g = m.get(k) ?? { name: t.termName ?? 'Whole year', items: [] };
      g.items.push(t);
      m.set(k, g);
    }
    return [...m.values()];
  }, [list]);

  const change = (t: SyllabusTopicItem, status: SyllabusProgressStatus) => {
    if ((t.progress?.status ?? 'not_started') === status) return;
    setError(null);
    set.mutate({ topicId: t.id, status }, { onError: (e) => setError(teacherError(e)) });
  };
  const completeAll = (g: { name: string; items: SyllabusTopicItem[] }) => {
    const items = g.items.filter((t) => t.progress?.status !== 'completed').map((t) => ({ topicId: t.id, status: 'completed' as const }));
    if (items.length === 0) return;
    setError(null);
    bulk.mutate(items, {
      onSuccess: () => toast.success(`${g.name}: ${plural(items.length, 'topic')} marked completed`),
      onError: (e) => setError(teacherError(e)),
    });
  };

  return (
    <Card>
      <CardHeader title={subjectName} description={list.length ? `${done} of ${plural(list.length, 'topic')} completed${going ? ` · ${going} in progress` : ''}` : undefined} />
      <CardBody className="space-y-5 pt-4">
        {!canUpdate && <Banner tone="info">You can see this subject’s progress, but only its teacher or the class teacher can change it.</Banner>}
        {gate.readOnly && <Banner tone="locked">{gate.reason}</Banner>}
        {error && (
          <Banner tone="danger" onDismiss={() => setError(null)}>
            {error}
          </Banner>
        )}
        {topics.isPending ? (
          <div className="space-y-2" aria-busy>
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : topics.isError ? (
          <ErrorCard error={topics.error} onRetry={() => void topics.refetch()} title="We couldn’t load the topics" />
        ) : list.length === 0 ? (
          <EmptyState compact illustration="empty-generic" title="No topics for this subject yet" description="The school office sets up the syllabus topics for each grade." />
        ) : (
          <>
            <ProgressBar value={done} max={list.length} label={`${subjectName} topics completed`} />
            {groups.map((g) => (
              <section key={g.name} aria-label={g.name}>
                <div className="mb-1.5 flex items-center justify-between gap-3">
                  <h3 className="t-label">{g.name}</h3>
                  {canUpdate && g.items.some((t) => t.progress?.status !== 'completed') && (
                    <Button variant="ghost" size="sm" onClick={() => completeAll(g)} loading={bulk.isPending} disabled={gate.readOnly || bulk.isPending}>
                      Mark all completed
                    </Button>
                  )}
                </div>
                <ol className="divide-y divide-border rounded-md border border-border">
                  {g.items.map((t) => (
                    <TopicRow key={t.id} t={t} disabled={!canUpdate || gate.readOnly} onChange={(s) => change(t, s)} />
                  ))}
                </ol>
              </section>
            ))}
          </>
        )}
      </CardBody>
    </Card>
  );
}

function TopicRow({ t, disabled, onChange }: { t: SyllabusTopicItem; disabled: boolean; onChange: (s: SyllabusProgressStatus) => void }) {
  const status = t.progress?.status ?? 'not_started';
  return (
    <li className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:gap-4">
      <div className="min-w-0 flex-1">
        <p className={cn('text-sm', status === 'completed' ? 'text-ink-2' : 'font-medium')}>{t.title}</p>
        <p className="t-caption text-ink-3">{t.plannedHours ? `${plural(t.plannedHours, 'planned hour')}` : 'No planned hours'}</p>
      </div>
      <div role="radiogroup" aria-label={`Progress for ${t.title}`} className="flex shrink-0 gap-1">
        {STATES.map((s) => {
          const on = status === s.value;
          return (
            <button
              key={s.value}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={disabled}
              onClick={() => onChange(s.value)}
              className={cn(
                'press tr-colors inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-md border px-2.5 text-[13px] font-medium sm:h-8 sm:flex-none',
                on ? (s.value === 'completed' ? 'border-success bg-success-soft text-success' : s.value === 'in_progress' ? 'border-brand bg-brand-soft text-brand-ink' : 'border-border-strong bg-surface-sunken text-ink') : 'border-border-strong bg-surface text-ink-2 hover:bg-surface-subtle hover:text-ink',
                'disabled:pointer-events-none disabled:opacity-60',
              )}
            >
              <s.Icon className="size-3.5" aria-hidden />
              {s.short}
            </button>
          );
        })}
      </div>
    </li>
  );
}
