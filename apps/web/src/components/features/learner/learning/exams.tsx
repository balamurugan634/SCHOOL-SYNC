'use client';

import * as React from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import type { ExamOut, PaperOut } from '@school-sync/shared';
import { useExamPapers, useExams } from '@/lib/client/learner-learning';
import { fmtClock, fmtDate, todayIso } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState, SkeletonRows } from '../states';
import { useLearner } from '../use-learner';

const TYPE_LABEL: Record<string, string> = { unit_test: 'Unit test', quiz: 'Quiz', midterm: 'Mid-term', final: 'Final', practical: 'Practical', other: 'Exam' };

type Phase = 'upcoming' | 'ongoing' | 'finished' | 'published';
function phaseOf(e: ExamOut, today: string): Phase {
  if (e.status === 'published') return 'published';
  if (e.endDate && e.endDate < today) return 'finished';
  if (e.startDate && e.startDate <= today) return 'ongoing';
  return 'upcoming';
}

/** Exam schedule: every exam the school has scheduled for the class, with its papers (date, time, room). */
export function ExamsView() {
  const l = useLearner();
  const exams = useExams();
  const today = todayIso();
  const list = React.useMemo(() => {
    const rank = (e: ExamOut) => (['ongoing', 'upcoming'].includes(phaseOf(e, today)) ? 0 : 1);
    return [...(exams.data ?? [])].sort((a, b) => rank(a) - rank(b) || (rank(a) === 0 ? (a.startDate ?? '9999').localeCompare(b.startDate ?? '9999') : (b.startDate ?? '').localeCompare(a.startDate ?? '')));
  }, [exams.data, today]);

  if (exams.isPending) return <Card><SkeletonRows rows={3} /></Card>;
  if (exams.isError && !exams.data) return <Card><ErrorState error={exams.error} onRetry={() => void exams.refetch()} title="We couldn’t load the exam schedule" /></Card>;
  if (list.length === 0) {
    return (
      <Card>
        <EmptyState illustration="empty-events" title="No exams scheduled" description={l.isParent ? `When the school schedules exams for ${l.name}’s class they appear here.` : 'When the school schedules exams for your class they appear here.'} />
      </Card>
    );
  }
  const firstOpen = list.find((e) => ['ongoing', 'upcoming'].includes(phaseOf(e, today)))?.id ?? list[0]!.id;
  return (
    <section aria-label="Exam schedule" className="space-y-4">
      {list.map((e) => (
        <ExamCard key={e.id} exam={e} phase={phaseOf(e, today)} defaultOpen={e.id === firstOpen} />
      ))}
    </section>
  );
}

function ExamCard({ exam, phase, defaultOpen }: { exam: ExamOut; phase: Phase; defaultOpen: boolean }) {
  const l = useLearner();
  const [open, setOpen] = React.useState(defaultOpen);
  const papers = useExamPapers(exam.id, open);
  const mine = React.useMemo(() => (papers.data ?? []).filter((p) => !l.gradeName || p.gradeName === l.gradeName).sort((a, b) => (a.examDate ?? '9999').localeCompare(b.examDate ?? '9999') || (a.startTime ?? '').localeCompare(b.startTime ?? '')), [papers.data, l.gradeName]);
  const panel = `exam-${exam.id}`;
  const detailHref = `${l.base}/${l.isParent ? 'academics' : 'learning'}/results/${exam.id}`;
  return (
    <Card>
      <div className="flex items-start gap-3 px-5 py-4 max-sm:px-4">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={panel} className="min-w-0 flex-1 rounded-md text-left">
          <span className="flex flex-wrap items-center gap-2">
            <span className="t-section">{exam.name}</span>
            <Badge variant="outline">{TYPE_LABEL[exam.examType] ?? 'Exam'}</Badge>
            {phase === 'ongoing' && <Badge variant="primary">Happening now</Badge>}
            {phase === 'upcoming' && <Badge variant="accent">Upcoming</Badge>}
            {phase === 'finished' && <Badge variant="neutral">Results awaited</Badge>}
            {phase === 'published' && <Badge variant="success">Results published</Badge>}
          </span>
          <span className="t-caption mt-1 block text-ink-2">
            {[exam.termName, exam.startDate ? `${fmtDate(exam.startDate, { day: 'numeric', month: 'short' })}${exam.endDate && exam.endDate !== exam.startDate ? ` – ${fmtDate(exam.endDate, { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}` : 'Dates to be announced', `Pass mark ${exam.passPercent}%`].filter(Boolean).join(' · ')}
          </span>
        </button>
        {phase === 'published' && (
          <Button asChild variant="secondary" size="sm">
            <Link href={detailHref}>
              Results <ChevronRight />
            </Link>
          </Button>
        )}
      </div>
      {open && (
        <CardBody id={panel} className="border-t border-border pt-4">
          {papers.isPending ? (
            <div className="space-y-2" aria-busy="true">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : papers.isError ? (
            <ErrorState compact error={papers.error} onRetry={() => void papers.refetch()} title="We couldn’t load this schedule" />
          ) : mine.length === 0 ? (
            <p className="text-sm text-ink-2">The timetable for this exam hasn’t been set yet. Dates and rooms appear here once they are.</p>
          ) : (
            <PaperTable papers={mine} today={todayIso()} />
          )}
        </CardBody>
      )}
    </Card>
  );
}

function PaperTable({ papers, today }: { papers: PaperOut[]; today: string }) {
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="t-table w-full">
          <caption className="sr-only">Exam papers</caption>
          <thead>
            <tr className="text-left text-ink-2">
              <th scope="col" className="pb-2 pr-4 font-medium">Date</th>
              <th scope="col" className="pb-2 pr-4 font-medium">Subject</th>
              <th scope="col" className="pb-2 pr-4 font-medium">Time</th>
              <th scope="col" className="pb-2 pr-4 font-medium">Room</th>
              <th scope="col" className="pb-2 text-right font-medium">Max marks</th>
            </tr>
          </thead>
          <tbody>
            {papers.map((p) => (
              <tr key={p.id} className="border-t border-border">
                <td className="py-2.5 pr-4 font-medium">{p.examDate ? fmtDate(p.examDate, { weekday: 'short', day: 'numeric', month: 'short' }) : 'TBA'}{p.examDate === today && <Badge variant="primary" className="ml-2">Today</Badge>}</td>
                <td className="py-2.5 pr-4">{p.subjectName}</td>
                <td className="tnum py-2.5 pr-4">{p.startTime ? `${fmtClock(p.startTime)}${p.endTime ? ` – ${fmtClock(p.endTime)}` : ''}` : '—'}</td>
                <td className="py-2.5 pr-4">{p.room ?? '—'}</td>
                <td className="tnum py-2.5 text-right">{p.maxMarks}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-border md:hidden">
        {papers.map((p) => (
          <li key={p.id} className="py-2.5 first:pt-0 last:pb-0">
            <p className="flex items-center justify-between gap-3 text-sm font-medium">
              {p.subjectName}
              <span className="t-caption font-normal text-ink-2">{p.maxMarks} marks</span>
            </p>
            <p className="t-caption text-ink-2">
              {[p.examDate ? fmtDate(p.examDate, { weekday: 'short', day: 'numeric', month: 'short' }) : 'Date to be announced', p.startTime ? `${fmtClock(p.startTime)}${p.endTime ? ` – ${fmtClock(p.endTime)}` : ''}` : null, p.room].filter(Boolean).join(' · ')}
            </p>
          </li>
        ))}
      </ul>
    </>
  );
}
