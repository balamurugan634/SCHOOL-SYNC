'use client';

import * as React from 'react';
import { CheckCircle2, FileDown, XCircle } from 'lucide-react';
import type { ExamOut } from '@school-sync/shared';
import { Badge } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Card } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { IconButton } from '@/components/ui/icon-button';
import { Select, type SelectOption } from '@/components/ui/select';
import { toast } from '@/components/ui/toaster';
import { examErrorMessage, useClassResults, useExamSections, type ClassResultRow } from '@/lib/client/exams-admin';
import { sectionOptions } from '@/lib/client/options';
import { useUrlState } from '@/lib/client/url-state';
import { downloadFile } from '@/lib/client/transfer';
import { percent } from '@/lib/format';
import { useAccess } from '../shared/access';
import { ExportButton } from '../shared/controls';
import { ErrorPanel, PersonCell } from '../shared/detail';

function ClassSelect({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: SelectOption[] }) {
  return <Select aria-label="Class" className="min-w-[10rem] sm:w-auto" value={value} onValueChange={onChange} options={options} placeholder="Choose a class" />;
}

/** Published results of one class for the exam: rank, totals, percentage and grade exactly as the API computed them. */
export function ClassResults({ exam }: { exam: ExamOut }) {
  const access = useAccess();
  const sections = useExamSections(exam.academicYearId);
  const [p, set] = useUrlState({ section: '' });
  const sectionId = p.section || sections.data?.[0]?.id || '';
  const q = useClassResults(exam.id, sectionId);
  const section = sections.data?.find((s) => s.id === sectionId);

  const columns: Column<ClassResultRow>[] = [
    { id: 'rank', header: 'Rank', align: 'right', mobile: 'detail', cell: (r) => <span className="tnum">{r.rank ?? '—'}</span> },
    { id: 'student', header: 'Student', mobile: 'title', cell: (r) => <PersonCell name={r.name} sub={`${r.admissionNo}${r.rollNo ? ` · Roll ${r.rollNo}` : ''}`} /> },
    { id: 'total', header: 'Total', align: 'right', mobile: 'detail', cell: (r) => <span className="tnum">{r.totalMarks} / {r.maxTotal}</span> },
    { id: 'percent', header: 'Percentage', align: 'right', mobile: 'value', cell: (r) => <span className="tnum font-medium">{percent(r.percent)}</span> },
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
    { id: 'subjects', header: 'Subjects', align: 'right', mobile: 'hide', cell: (r) => <span className="tnum">{r.subjectsPublished}{q.data ? ` of ${q.data.subjectsExpected}` : ''}</span> },
  ];
  if (access.can('report_cards:view', 'assigned'))
    columns.push({
      id: 'pdf',
      header: <span className="sr-only">Report card</span>,
      label: 'Report card',
      hideable: false,
      align: 'right',
      mobile: 'hide',
      cell: (r) => (
        <IconButton
          label={`Download report card of ${r.name}`}
          size="icon-sm"
          onClick={async () => {
            try {
              await downloadFile(`/report-cards/${exam.id}/students/${r.studentId}/pdf`, undefined, `report-card-${r.admissionNo}.pdf`);
            } catch (e) {
              toast.error(examErrorMessage(e), { duration: 8000 });
            }
          }}
        >
          <FileDown />
        </IconButton>
      ),
    });

  const incomplete = q.data?.data.some((r) => r.subjectsPublished < (q.data?.subjectsExpected ?? 0)) ?? false;
  const none = !sections.isPending && (sections.data?.length ?? 0) === 0;

  return (
    <div className="space-y-4">
      {none ? (
        <Card>
          <EmptyState illustration="empty-generic" title="No classes in this academic year" description="Create sections under Academics › Classes & sections." compact />
        </Card>
      ) : q.isError ? (
        <>
          <ClassSelect value={sectionId} onChange={(v) => set({ section: v })} options={sectionOptions(sections.data)} />
          <ErrorPanel error={q.error} onRetry={() => void q.refetch()} title="We couldn’t load these results" />
        </>
      ) : (
        <>
          {incomplete && <Banner tone="warning">Some students have fewer published subjects than expected, so their totals and ranks are provisional until every subject sheet is published.</Banner>}
          <DataTable
            id="exam-class-results"
            caption={`Results of ${section ? `${section.gradeName} ${section.name}` : 'the class'} in ${exam.name}`}
            columns={columns}
            rows={q.data?.data}
            rowKey={(r) => r.studentId}
            loading={sections.isPending || q.isPending}
            filters={<ClassSelect value={sectionId} onChange={(v) => set({ section: v })} options={sectionOptions(sections.data)} />}
            toolbar={access.can('marks:export', 'assigned') && sectionId ? <ExportButton path="/marks/export" query={{ examId: exam.id, sectionId }} filename={`${exam.name.replace(/\W+/g, '-').toLowerCase()}-${section ? `${section.gradeName}-${section.name}` : 'class'}.csv`} label="Export marks CSV" /> : undefined}
            empty={<EmptyState illustration="empty-generic" title="No published results for this class" description={exam.status === 'published' ? 'Nothing was published for this class.' : 'Results appear here once the mark sheets are published.'} compact />}
          />
        </>
      )}
    </div>
  );
}
