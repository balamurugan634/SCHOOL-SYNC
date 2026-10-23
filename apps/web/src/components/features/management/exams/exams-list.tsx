'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import type { ExamOut } from '@school-sync/shared';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { ProgressBar } from '@/components/ui/progress';
import { PageHeader } from '@/components/shell/page-header';
import { useExams } from '@/lib/client/exams-admin';
import { useYearList, yearOptions } from '@/lib/client/options';
import { useUrlState } from '@/lib/client/url-state';
import { fmtDate } from '@/lib/format';
import { useAccess } from '../shared/access';
import { ClearFiltersButton, FilterChip, FilterSelect, SearchBox } from '../shared/controls';
import { paths } from '../shared/paths';
import { ExamFormDrawer } from './exam-form';
import { dateRange, EXAM_STATUS_LABEL, EXAM_STATUS_OPTIONS, EXAM_TYPE_LABEL, EXAM_TYPE_OPTIONS, ExamStatusChip, ExamsAreaTabs } from './meta';

const DEFAULTS = { q: '', status: '', examType: '', academicYearId: '', page: 1, pageSize: 25 };

function SheetProgress({ e }: { e: ExamOut }) {
  const s = e.sheets;
  if (!s || s.total === 0) return <span className="text-ink-3">{e.status === 'draft' || e.status === 'scheduled' ? 'Not started' : '—'}</span>;
  const done = s.approved + s.published;
  if (s.published === s.total) return <span className="text-sm">All {s.total} published</span>;
  return (
    <div className="w-36">
      <p className="t-caption tnum text-ink-2">
        {done} of {s.total} approved
        {s.returned > 0 ? `, ${s.returned} returned` : ''}
      </p>
      <ProgressBar value={done} max={s.total} tone={done === s.total ? 'success' : 'brand'} label={`${e.name}: ${done} of ${s.total} mark sheets approved or published`} className="mt-1" />
    </div>
  );
}

export function ExamsList() {
  const router = useRouter();
  const access = useAccess();
  const [f, set, reset] = useUrlState(DEFAULTS);
  const [creating, setCreating] = React.useState(false);
  const years = useYearList();
  const q = useExams(f);
  const yearName = yearOptions(years.data).find((o) => o.value === f.academicYearId)?.label;
  const active = [f.q && `Search “${f.q}”`, f.status && EXAM_STATUS_LABEL[f.status as keyof typeof EXAM_STATUS_LABEL], f.examType && EXAM_TYPE_LABEL[f.examType as keyof typeof EXAM_TYPE_LABEL], f.academicYearId && (yearName ?? 'Year')].filter(Boolean).length;

  const columns: Column<ExamOut>[] = [
    {
      id: 'name',
      header: 'Exam',
      label: 'Exam',
      mobile: 'title',
      cell: (e) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{e.name}</p>
          <p className="t-caption text-ink-2">
            {EXAM_TYPE_LABEL[e.examType]}
            {e.termName ? ` · ${e.termName}` : ''}
          </p>
        </div>
      ),
    },
    { id: 'status', header: 'Status', mobile: 'status', cell: (e) => <ExamStatusChip status={e.status} /> },
    { id: 'dates', header: 'Dates', mobile: 'sub', cell: (e) => <span className="tnum">{dateRange(e.startDate, e.endDate, (s) => fmtDate(s, { day: 'numeric', month: 'short', year: 'numeric' }))}</span> },
    { id: 'year', header: 'Year', mobile: 'hide', defaultHidden: true, cell: (e) => e.academicYearName ?? '—' },
    { id: 'papers', header: 'Papers', align: 'right', mobile: 'detail', cell: (e) => e.paperCount },
    { id: 'sheets', header: 'Mark sheets', mobile: 'hide', cell: (e) => <SheetProgress e={e} /> },
  ];

  return (
    <>
      <PageHeader
        title="Exams"
        description="Plan exams, build the schedule, follow marks entry and publish results."
        actions={
          access.can('exams:create') && (
            <Button onClick={() => setCreating(true)} disabled={!access.ok('exams:create')} title={access.hint('exams:create')}>
              <Plus /> New exam
            </Button>
          )
        }
      />
      <ExamsAreaTabs />
      <DataTable
        id="exams-list"
        caption="Exams"
        columns={columns}
        rows={q.data?.data}
        rowKey={(e) => e.id}
        loading={q.isPending}
        error={q.isError ? q.error : undefined}
        onRetry={() => void q.refetch()}
        page={f.page}
        pageSize={f.pageSize}
        total={q.data?.meta.total}
        onPageChange={(page) => set({ page })}
        onPageSizeChange={(pageSize) => set({ pageSize })}
        onRowClick={(e) => router.push(paths.exam(e.id))}
        filters={
          <>
            <SearchBox value={f.q} onChange={(v) => set({ q: v })} placeholder="Search exams" />
            <FilterSelect label="Status" value={f.status} onChange={(v) => set({ status: v })} options={EXAM_STATUS_OPTIONS} allLabel="All statuses" />
            <FilterSelect label="Type" value={f.examType} onChange={(v) => set({ examType: v })} options={EXAM_TYPE_OPTIONS} allLabel="All types" />
            <FilterSelect label="Academic year" value={f.academicYearId} onChange={(v) => set({ academicYearId: v })} options={yearOptions(years.data)} allLabel="All years" />
            {active > 0 && (
              <>
                {f.status && <FilterChip label={EXAM_STATUS_LABEL[f.status as keyof typeof EXAM_STATUS_LABEL] ?? f.status} onRemove={() => set({ status: '' })} />}
                {f.examType && <FilterChip label={EXAM_TYPE_LABEL[f.examType as keyof typeof EXAM_TYPE_LABEL] ?? f.examType} onRemove={() => set({ examType: '' })} />}
                <ClearFiltersButton onClick={() => reset()} />
              </>
            )}
          </>
        }
        empty={
          active > 0 ? (
            <EmptyState illustration="no-results" title="No exams match these filters" description="Try a different status or year, or clear the filters." action={<Button variant="secondary" onClick={() => reset()}>Clear filters</Button>} compact />
          ) : (
            <EmptyState illustration="empty-generic" title="No exams yet" description="Create the first exam, add its schedule, then schedule it for students and teachers." action={access.ok('exams:create') ? <Button onClick={() => setCreating(true)}><Plus /> New exam</Button> : undefined} compact />
          )
        }
      />
      <ExamFormDrawer open={creating} onClose={() => setCreating(false)} onSaved={(e, created) => created && router.push(paths.exam(e.id))} />
    </>
  );
}
