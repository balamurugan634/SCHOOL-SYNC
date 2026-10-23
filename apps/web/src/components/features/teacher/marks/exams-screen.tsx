'use client';

import * as React from 'react';
import Link from 'next/link';
import { CalendarDays, ClipboardList } from 'lucide-react';
import type { ExamOut, PaperOut, SheetOut } from '@school-sync/shared';
import { useExamPapers, useExams, useMarkSheets, sheetNeedsAction } from '@/lib/client/teacher-marks';
import { secLabel, useMyTeaching } from '@/lib/client/teacher';
import { cn } from '@/lib/cn';
import { fmtClock, fmtDate, plural } from '@/lib/format';
import { Badge, StatusChip } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { ProgressBar } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/shell/page-header';
import { useMeContext } from '@/components/me-context';
import { ErrorCard, FilterSelect, useUrlState } from '../common';
import { ExamStatusChip, FilterChips, examStatusLabel } from './marks-shared';

const STATUS_OPTIONS = ['scheduled', 'marks_entry', 'under_review', 'published'].map((v) => ({ value: v, label: examStatusLabel(v) }));
const EXAM_TYPE: Record<string, string> = { unit_test: 'Unit test', quiz: 'Quiz', midterm: 'Mid-term', final: 'Final', practical: 'Practical', other: 'Exam' };

const dateRange = (a: string | null, b: string | null): string => (a && b && a !== b ? `${fmtDate(a, { day: 'numeric', month: 'short' })} – ${fmtDate(b, { day: 'numeric', month: 'short', year: 'numeric' })}` : a ? fmtDate(a) : 'Dates to be announced');

/** Exam schedule: pick an exam, see its papers (my subjects marked) and the mark sheets I owe for it. */
export function ExamsScreen() {
  const url = useUrlState();
  const status = url.get('status');
  const upcoming = url.get('upcoming') === '1';
  const exams = useExams({ status: status || undefined, upcoming });
  const list = exams.data ?? [];
  const wanted = url.get('exam');
  const selected = list.find((e) => e.id === wanted) ?? list.find((e) => e.status === 'marks_entry') ?? list[0] ?? null;
  const filtered = !!(status || upcoming);

  return (
    <>
      <PageHeader title="Exams" description="The exam schedule for your classes, and the mark sheets you owe for each exam." />

      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-2">
          <FilterSelect label="Filter by status" allLabel="All statuses" value={status} onChange={(v) => url.set({ status: v })} options={STATUS_OPTIONS} />
          <FilterChips label="Time" value={upcoming ? 'up' : 'all'} onChange={(v) => url.set({ upcoming: v === 'up' ? '1' : null })} options={[{ value: 'all', label: 'All exams' }, { value: 'up', label: 'Upcoming' }]} />
        </div>

        {exams.isPending ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-[112px] w-full" />
            ))}
          </div>
        ) : exams.isError ? (
          <ErrorCard error={exams.error} onRetry={() => void exams.refetch()} title="We couldn’t load the exams" />
        ) : list.length === 0 ? (
          <Card>
            <EmptyState
              illustration={filtered ? 'no-results' : 'empty-events'}
              title={filtered ? 'No exams match' : 'No exams scheduled yet'}
              description={filtered ? 'Try a different status, or show all exams.' : 'When the school schedules an exam for your classes it will appear here.'}
              action={filtered ? <Button variant="secondary" onClick={() => url.set({ status: null, upcoming: null })}>Clear filters</Button> : undefined}
            />
          </Card>
        ) : (
          <>
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Exams">
              {list.map((e) => (
                <li key={e.id}>
                  <ExamCard exam={e} selected={e.id === selected?.id} onSelect={() => url.set({ exam: e.id })} />
                </li>
              ))}
            </ul>
            {selected && <ExamDetail exam={selected} />}
          </>
        )}
      </div>
    </>
  );
}

function ExamCard({ exam, selected, onSelect }: { exam: ExamOut; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn('tr-colors flex h-full w-full flex-col gap-2 rounded-lg border bg-surface p-4 text-left shadow-card hover:border-border-strong', selected ? 'border-brand ring-1 ring-brand' : 'border-border')}
    >
      <span className="flex items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">{exam.name}</span>
          <span className="t-caption block text-ink-2">
            {EXAM_TYPE[exam.examType] ?? 'Exam'}
            {exam.termName ? ` · ${exam.termName}` : ''}
          </span>
        </span>
        <ExamStatusChip status={exam.status} />
      </span>
      <span className="t-caption flex items-center gap-1.5 text-ink-2">
        <CalendarDays className="size-3.5 shrink-0 text-ink-3" aria-hidden />
        {dateRange(exam.startDate, exam.endDate)}
      </span>
      <span className="t-caption text-ink-3">{plural(exam.paperCount, 'paper')} · pass mark {exam.passPercent}%</span>
    </button>
  );
}

function ExamDetail({ exam }: { exam: ExamOut }) {
  const { base } = useMeContext();
  const papers = useExamPapers(exam.id);
  const sheets = useMarkSheets({ examId: exam.id, mine: true });
  const teaching = useMyTeaching();
  const [mineOnly, setMineOnly] = React.useState<'all' | 'mine'>('all');

  const isMine = React.useCallback((p: PaperOut) => teaching.pairs.some((t) => t.via === 'teach' && t.gradeId === p.gradeId && t.subjectId === p.subjectId), [teaching.pairs]);

  const rows = React.useMemo(() => {
    const all = [...(papers.data ?? [])].sort((a, b) => (a.examDate ?? '9999').localeCompare(b.examDate ?? '9999') || (a.startTime ?? '').localeCompare(b.startTime ?? '') || a.gradeName.localeCompare(b.gradeName, undefined, { numeric: true }));
    return mineOnly === 'mine' ? all.filter(isMine) : all;
  }, [papers.data, mineOnly, isMine]);

  const columns: Column<PaperOut>[] = [
    {
      id: 'date',
      header: 'Date',
      mobile: 'sub',
      cell: (p) => (
        <span className="whitespace-nowrap">
          {p.examDate ? fmtDate(p.examDate, { weekday: 'short', day: 'numeric', month: 'short' }) : 'To be announced'}
          {p.startTime && <span className="text-ink-2"> · {fmtClock(p.startTime)}{p.endTime ? `–${fmtClock(p.endTime)}` : ''}</span>}
        </span>
      ),
    },
    {
      id: 'subject',
      header: 'Subject',
      mobile: 'title',
      cell: (p) => (
        <span className="flex items-center gap-2">
          <span className="font-medium">{p.subjectName}</span>
          {isMine(p) && <Badge variant="primary">Yours</Badge>}
        </span>
      ),
    },
    { id: 'grade', header: 'Grade', mobile: 'status', cell: (p) => <span className="whitespace-nowrap">{p.gradeName}</span> },
    { id: 'room', header: 'Room', mobile: 'detail', cell: (p) => p.room ?? '—' },
    { id: 'marks', header: 'Max / pass', label: 'Max / pass marks', align: 'right', mobile: 'detail', cell: (p) => <span className="tnum">{p.maxMarks}{p.passMarks !== null ? ` / ${p.passMarks}` : ''}</span> },
  ];

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section aria-labelledby="schedule-h" className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 id="schedule-h" className="t-section">
              Schedule · {exam.name}
            </h2>
            <p className="t-caption text-ink-2">Papers for the grades you teach.</p>
          </div>
          <FilterChips label="Papers" value={mineOnly} onChange={setMineOnly} options={[{ value: 'all', label: 'All papers' }, { value: 'mine', label: 'My subjects' }]} />
        </div>
        <DataTable<PaperOut>
          id="teacher-marks-papers"
          caption={`Papers of ${exam.name}`}
          rows={rows}
          rowKey={(p) => p.id}
          loading={papers.isPending}
          error={papers.isError ? papers.error : undefined}
          onRetry={() => void papers.refetch()}
          columns={columns}
          empty={
            <EmptyState
              compact
              illustration="empty-events"
              title={mineOnly === 'mine' ? 'None of these papers are in your subjects' : 'No papers on the schedule yet'}
              description={mineOnly === 'mine' ? undefined : 'The school adds papers when it sets the exam timetable.'}
              action={mineOnly === 'mine' ? <Button variant="secondary" size="sm" onClick={() => setMineOnly('all')}>Show all papers</Button> : undefined}
            />
          }
        />
      </section>

      <Card className="h-fit">
        <CardHeader title="My sheets for this exam" description={exam.status === 'scheduled' ? 'Marks entry opens closer to the exam.' : undefined} />
        <CardBody className="pt-3">
          {sheets.isPending ? (
            <div className="space-y-2" aria-busy>
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : sheets.isError ? (
            <ErrorCard error={sheets.error} onRetry={() => void sheets.refetch()} title="We couldn’t load your sheets" className="border-0 shadow-none" />
          ) : (sheets.data ?? []).length === 0 ? (
            <EmptyState compact icon={<ClipboardList />} title="No mark sheets for you yet" description={exam.status === 'draft' || exam.status === 'scheduled' ? 'Sheets are created when marks entry opens.' : 'You aren’t the subject teacher on any paper of this exam.'} />
          ) : (
            <ul className="divide-y divide-border">
              {[...(sheets.data ?? [])]
                .sort((a, b) => Number(sheetNeedsAction(b)) - Number(sheetNeedsAction(a)))
                .map((s) => (
                  <SheetLink key={s.id} s={s} href={`${base}/marks/sheets/${s.id}`} />
                ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function SheetLink({ s, href }: { s: SheetOut; href: string }) {
  return (
    <li className="py-2.5 first:pt-0 last:pb-0">
      <Link href={href} className="tr-colors -mx-2 block rounded-md px-2 py-1 hover:bg-surface-subtle">
        <span className="flex items-start justify-between gap-3">
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{s.subjectName}</span>
            <span className="t-caption block text-ink-2">{secLabel(s.gradeName, s.sectionName)}</span>
          </span>
          <StatusChip status={s.status} />
        </span>
        <span className="mt-1.5 flex items-center gap-2">
          <ProgressBar value={s.enteredCount} max={s.studentCount} label={`${s.enteredCount} of ${s.studentCount} entered for ${s.subjectName} ${secLabel(s.gradeName, s.sectionName)}`} className="flex-1" tone={s.enteredCount >= s.studentCount ? 'success' : 'brand'} />
          <span className="t-caption tnum text-ink-2">
            {s.enteredCount}/{s.studentCount}
          </span>
        </span>
      </Link>
    </li>
  );
}
