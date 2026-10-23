'use client';

import * as React from 'react';
import Link from 'next/link';
import { CheckCircle2, ChevronRight, Clock3 } from 'lucide-react';
import { useAttendanceToday } from '@/lib/client/hooks';
import { sectionOutLabel, useMyTeaching, useTeacherScope } from '@/lib/client/teacher';
import { useAllCoverage } from '@/lib/client/teacher-learning';
import { plural } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ProgressBar } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/shell/page-header';
import { useMeContext } from '@/components/me-context';
import { ErrorCard } from '../common';

/** My Classes: every section I teach in or lead, with today's attendance state and syllabus coverage of my subjects. */
export function ClassesScreen() {
  const teaching = useMyTeaching();
  const scope = useTeacherScope();
  const today = useAttendanceToday();
  const coverage = useAllCoverage();
  const { base } = useMeContext();
  const sections = teaching.sections;

  return (
    <>
      <PageHeader title="My classes" description="The classes you teach or lead, with their students, attendance and syllabus progress." />
      {teaching.isPending ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-52 w-full" />
          ))}
        </div>
      ) : teaching.error && !sections ? (
        <ErrorCard error={teaching.error} onRetry={teaching.refetch} title="We couldn’t load your classes" />
      ) : !sections || sections.length === 0 ? (
        <Card>
          <EmptyState
            illustration="empty-generic"
            title="No classes yet"
            description="You aren’t assigned to a class or subject for this academic year. If that looks wrong, ask the school office."
            action={
              <Button asChild variant="secondary">
                <Link href={base || '/'}>Back to home</Link>
              </Button>
            }
          />
        </Card>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Your classes">
          {sections.map((s) => {
            const mine = teaching.pairs.filter((p) => p.sectionId === s.id && p.via === 'teach');
            const lead = scope.isLead(s.id);
            const att = today.data?.items.filter((i) => i.sectionId === s.id) ?? [];
            const attMarked = att.filter((i) => i.marked).length;
            const shown = coverage.data?.filter((c) => c.sectionId === s.id && (lead || mine.some((m) => m.subjectId === c.subjectId))) ?? [];
            const total = shown.reduce((a, c) => a + c.totalTopics, 0);
            const done = shown.reduce((a, c) => a + c.completed, 0);
            const pct = total > 0 ? Math.round((done / total) * 100) : null;
            return (
              <li key={s.id}>
                <Card interactive className="h-full">
                  <Link href={`${base}/classes/${s.id}`} className="block h-full rounded-lg" aria-label={`${sectionOutLabel(s)}: open class`}>
                    <CardBody className="flex h-full flex-col gap-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h2 className="t-section truncate">{sectionOutLabel(s)}</h2>
                          <p className="t-caption mt-0.5 text-ink-2">
                            {plural(s.studentCount, 'student')}
                            {s.room ? ` · Room ${s.room}` : ''}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {lead && <Badge variant="primary">Class teacher</Badge>}
                          <ChevronRight className="size-4 text-ink-3" aria-hidden />
                        </div>
                      </div>

                      <div>
                        <p className="t-caption text-ink-2">{lead && mine.length === 0 ? 'You lead this class' : 'You teach'}</p>
                        {mine.length > 0 ? (
                          <ul className="mt-1.5 flex flex-wrap gap-1.5">
                            {mine.map((m) => (
                              <li key={m.subjectId}>
                                <Badge variant="neutral">{m.subjectName}</Badge>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="mt-1 text-sm text-ink-2">{s.classTeacherName ? `Class teacher: ${s.classTeacherName}` : 'No class teacher assigned'}</p>
                        )}
                      </div>

                      <div className="mt-auto space-y-3">
                        {att.length > 0 && (
                          <p className={cn('flex items-center gap-1.5 text-[13px]', attMarked === att.length ? 'text-success' : 'text-warning')}>
                            {attMarked === att.length ? <CheckCircle2 className="size-4" aria-hidden /> : <Clock3 className="size-4" aria-hidden />}
                            {att.length === 1 ? (att[0]!.marked ? 'Attendance marked today' : 'Attendance not yet marked') : `${attMarked} of ${att.length} periods marked today`}
                          </p>
                        )}
                        <div>
                          <div className="t-caption mb-1 flex items-center justify-between text-ink-2">
                            <span>Syllabus covered{lead ? '' : ' (your subjects)'}</span>
                            <span className="tnum">{coverage.isPending ? '…' : pct === null ? '—' : `${pct}%`}</span>
                          </div>
                          <ProgressBar value={pct ?? 0} max={100} label={`${sectionOutLabel(s)} syllabus covered`} />
                        </div>
                      </div>
                    </CardBody>
                  </Link>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
