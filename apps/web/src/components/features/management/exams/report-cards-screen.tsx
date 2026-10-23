'use client';

import * as React from 'react';
import { PageHeader } from '@/components/shell/page-header';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useExamPicker } from '@/lib/client/exams-admin';
import { useUrlState } from '@/lib/client/url-state';
import { ErrorPanel } from '../shared/detail';
import { ExamsAreaTabs } from './meta';
import { RemarksPanel } from './remarks-panel';

/** `/admin/exams/report-cards`: pick an exam, then its class remarks, publishing and report-card PDFs. */
export function ReportCardsScreen() {
  const exams = useExamPicker();
  const [p, set] = useUrlState({ exam: '' });
  const usable = (exams.data ?? []).filter((e) => e.status !== 'draft');
  // default: the newest published exam, else the newest scheduled one
  const exam = usable.find((e) => e.id === p.exam) ?? usable.find((e) => e.status === 'published') ?? usable[0];

  return (
    <>
      <PageHeader title="Report cards" description="Check class-teacher remarks, publish them for families, and download report cards." />
      <ExamsAreaTabs />
      {exams.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : exams.isError ? (
        <ErrorPanel error={exams.error} onRetry={() => void exams.refetch()} title="We couldn’t load the exams" />
      ) : !exam ? (
        <Card>
          <EmptyState illustration="empty-generic" title="No exams to report on yet" description="Report cards need an exam that has been scheduled." compact />
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="max-w-sm">
            <Select aria-label="Exam" value={exam.id} onValueChange={(v) => set({ exam: v })} options={usable.map((e) => ({ value: e.id, label: e.name }))} />
          </div>
          <RemarksPanel key={exam.id} exam={exam} />
        </div>
      )}
    </>
  );
}
