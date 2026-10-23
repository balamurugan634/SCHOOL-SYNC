'use client';

import * as React from 'react';
import { PageHeader } from '@/components/shell/page-header';
import { usePermissions } from '@/components/me-context';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useExam } from '@/lib/client/exams-admin';
import { useUrlState } from '@/lib/client/url-state';
import { fmtDate } from '@/lib/format';
import { ExportButton } from '../shared/controls';
import { ErrorPanel } from '../shared/detail';
import { ExamAnalytics } from './exam-analytics';
import { ExamFormDrawer } from './exam-form';
import { ExamOverview } from './exam-overview';
import { ExamSchedule } from './exam-schedule';
import { ExamSheets } from './exam-sheets';
import { ClassResults } from './class-results';
import { RemarksPanel } from './remarks-panel';
import { dateRange, EXAM_TYPE_LABEL, ExamStatusChip } from './meta';

export function ExamDetail({ id }: { id: string }) {
  const q = useExam(id);
  const { can } = usePermissions();
  const [p, set] = useUrlState({ tab: 'overview' });
  const [editing, setEditing] = React.useState(false);
  const exam = q.data;

  const tabs = [
    { id: 'overview', label: 'Overview', show: true },
    { id: 'schedule', label: 'Schedule', show: true },
    { id: 'sheets', label: 'Mark sheets', show: can('marks:view', 'assigned') },
    { id: 'analytics', label: 'Analytics', show: can('marks:view', 'assigned') },
    { id: 'results', label: 'Class results', show: can('marks:view', 'assigned') },
    { id: 'remarks', label: 'Report remarks', show: can('report_cards:view', 'assigned') },
  ].filter((t) => t.show);
  const tab = tabs.some((t) => t.id === p.tab) ? p.tab : 'overview';

  if (q.isPending) {
    return (
      <>
        <PageHeader title="Exam" crumbs={[{ label: 'Home', href: '/admin' }, { label: 'Exams', href: '/admin/exams' }, { label: 'Loading…' }]} />
        <Skeleton className="h-10 w-full max-w-xl" />
        <Skeleton className="mt-6 h-64 w-full" />
      </>
    );
  }
  if (q.isError || !exam) {
    return (
      <>
        <PageHeader title="Exam" crumbs={[{ label: 'Home', href: '/admin' }, { label: 'Exams', href: '/admin/exams' }]} />
        <ErrorPanel error={q.error} onRetry={() => void q.refetch()} title="We couldn’t load this exam" />
      </>
    );
  }

  const showExport = can('marks:export', 'assigned') && exam.status !== 'draft' && exam.status !== 'scheduled';
  return (
    <>
      <PageHeader
        title={exam.name}
        crumbs={[{ label: 'Home', href: '/admin' }, { label: 'Exams', href: '/admin/exams' }, { label: exam.name }]}
        description={
          <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <ExamStatusChip status={exam.status} />
            <span>
              {EXAM_TYPE_LABEL[exam.examType]}
              {exam.termName ? ` · ${exam.termName}` : ''}
              {exam.academicYearName ? ` · ${exam.academicYearName}` : ''}
            </span>
            <span className="tnum">{dateRange(exam.startDate, exam.endDate, (s) => fmtDate(s))}</span>
          </span>
        }
        actions={showExport ? <ExportButton path="/marks/export" query={{ examId: exam.id }} filename={`${exam.name.replace(/\W+/g, '-').toLowerCase()}-marks.csv`} label="Export marks CSV" /> : undefined}
      />
      <Tabs value={tab} onValueChange={(v) => set({ tab: v })}>
        <TabsList aria-label="Exam sections">
          {tabs.map((t) => (
            <TabsTrigger key={t.id} value={t.id}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="overview">
          <ExamOverview exam={exam} onEdit={() => setEditing(true)} goTab={(t) => set({ tab: t })} />
        </TabsContent>
        <TabsContent value="schedule">
          <ExamSchedule exam={exam} />
        </TabsContent>
        {can('marks:view', 'assigned') && (
          <>
            <TabsContent value="sheets">
              <ExamSheets exam={exam} />
            </TabsContent>
            <TabsContent value="analytics">
              <ExamAnalytics exam={exam} />
            </TabsContent>
            <TabsContent value="results">
              <ClassResults exam={exam} />
            </TabsContent>
          </>
        )}
        {can('report_cards:view', 'assigned') && (
          <TabsContent value="remarks">
            <RemarksPanel exam={exam} />
          </TabsContent>
        )}
      </Tabs>
      <ExamFormDrawer open={editing} onClose={() => setEditing(false)} exam={exam} />
    </>
  );
}
