'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, Upload } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { assetUrl } from '@/lib/assets';
import { fetchAllStudents, useStudents } from '@/lib/client/people';
import { gradeOptions, sectionOptions, useGradeList, useSectionList } from '@/lib/client/options';
import { useUrlState } from '@/lib/client/url-state';
import { fmtDate } from '@/lib/format';
import type { SectionOut, StudentListItem } from '@school-sync/shared';
import { useAccess } from '../shared/access';
import { ClearFiltersButton, FilterChip, FilterSelect, SearchBox } from '../shared/controls';
import { PersonCell } from '../shared/detail';
import { paths } from '../shared/paths';
import { CsvExportButton } from './csv-export';
import { asArray, STUDENT_STATUS_LABEL, STUDENT_STATUS_OPTIONS, StudentStatusChip, titleCase } from './ui';

export function StudentsList() {
  const router = useRouter();
  const acc = useAccess();
  const [f, set, reset] = useUrlState({ q: '', gradeId: '', sectionId: '', status: '', page: 1, pageSize: 25 });
  const grades = useGradeList();
  const sectionQ = useSectionList({ gradeId: f.gradeId || undefined });
  const sections = { data: asArray<SectionOut>(sectionQ.data), isPending: sectionQ.isPending };
  const q = useStudents(f);

  const gradeName = grades.data?.find((g) => g.id === f.gradeId)?.name;
  const sectionName = sections.data?.find((s) => s.id === f.sectionId)?.name;
  const active = [
    f.q && { key: 'q', label: `Search: ${f.q}` },
    f.gradeId && { key: 'gradeId', label: gradeName ?? 'Grade', also: ['sectionId'] },
    f.sectionId && { key: 'sectionId', label: `Section ${sectionName ?? ''}`.trim() },
    f.status && { key: 'status', label: STUDENT_STATUS_LABEL[f.status as keyof typeof STUDENT_STATUS_LABEL] ?? f.status },
  ].filter(Boolean) as { key: 'q' | 'gradeId' | 'sectionId' | 'status'; label: string; also?: ('sectionId')[] }[];

  const columns: Column<StudentListItem>[] = [
    {
      id: 'name',
      header: 'Student',
      mobile: 'title',
      cell: (r) => (
        <Link href={paths.student(r.id)} onClick={(e) => e.stopPropagation()} className="block min-w-0 rounded-md focus-visible:outline-none">
          <PersonCell name={r.name} sub={r.admissionNo} src={assetUrl(r.photoUrl)} />
        </Link>
      ),
    },
    { id: 'class', header: 'Class', label: 'Class', mobile: 'sub', cell: (r) => (r.gradeName ? `${r.gradeName} ${r.sectionName ?? ''}`.trim() : <span className="text-ink-3">Not placed</span>) },
    { id: 'roll', header: 'Roll no.', mobile: 'hide', align: 'right', sortable: true, sortValue: (r) => r.rollNo, cell: (r) => r.rollNo ?? '—' },
    { id: 'gender', header: 'Gender', mobile: 'hide', cell: (r) => (r.gender ? titleCase(r.gender) : '—') },
    { id: 'dob', header: 'Date of birth', mobile: 'hide', defaultHidden: true, cell: (r) => fmtDate(r.dob) },
    { id: 'status', header: 'Status', mobile: 'status', cell: (r) => <StudentStatusChip status={r.status} /> },
  ];

  const canCreate = acc.can('students:create', 'school');
  const total = q.data?.meta.total;

  return (
    <>
      <PageHeader
        title="Students"
        description={total !== undefined ? `${total.toLocaleString()} ${total === 1 ? 'student' : 'students'}${f.status ? '' : ' currently at the school'}. Search, filter and open a record.` : 'Student records, documents and class placement.'}
        actions={
          canCreate && (
            <>
              <Button variant="secondary" asChild={!acc.readOnly} disabled={acc.readOnly} title={acc.hint('students:create', 'school')}>
                {acc.readOnly ? <span><Upload /> Import</span> : <Link href={paths.studentImport}><Upload /> Import</Link>}
              </Button>
              <Button asChild={!acc.readOnly} disabled={acc.readOnly} title={acc.hint('students:create', 'school')}>
                {acc.readOnly ? <span><Plus /> Add student</span> : <Link href={paths.studentNew}><Plus /> Add student</Link>}
              </Button>
            </>
          )
        }
      />
      <DataTable
        memoRows
        id="people-students"
        caption="Students"
        rows={q.data?.data}
        rowKey={(r) => r.id}
        loading={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
        columns={columns}
        page={f.page}
        pageSize={f.pageSize}
        total={q.data?.meta.total}
        onPageChange={(page) => set({ page })}
        onPageSizeChange={(pageSize) => set({ pageSize, page: 1 })}
        onRowClick={(r) => router.push(paths.student(r.id))}
        filters={
          <>
            <SearchBox value={f.q} onChange={(v) => set({ q: v })} placeholder="Search name or admission no." />
            <FilterSelect label="Grade" value={f.gradeId} onChange={(v) => set({ gradeId: v, sectionId: '' })} options={gradeOptions(grades.data)} allLabel="All grades" />
            <FilterSelect label="Section" value={f.sectionId} onChange={(v) => set({ sectionId: v })} options={sectionOptions(sections.data)} allLabel="All sections" disabled={sections.isPending && !sections.data} />
            <FilterSelect label="Status" value={f.status} onChange={(v) => set({ status: v })} options={STUDENT_STATUS_OPTIONS} allLabel="Current students" />
            {active.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
                {active.map((a) => (
                  <FilterChip key={a.key} label={a.label} onRemove={() => set({ [a.key]: '', ...(a.also ? { sectionId: '' } : {}) })} />
                ))}
                <ClearFiltersButton onClick={() => reset(['q', 'gradeId', 'sectionId', 'status'])} />
              </div>
            )}
          </>
        }
        toolbar={
          acc.can('students:export') && (
            <CsvExportButton
              filename="students.csv"
              disabled={!q.data || q.data.meta.total === 0}
              build={async () => {
                const all = await fetchAllStudents(f);
                return {
                  header: ['Admission no', 'First name', 'Last name', 'Grade', 'Section', 'Roll no', 'Gender', 'Date of birth', 'Status'],
                  rows: all.map((s) => [s.admissionNo, s.firstName, s.lastName, s.gradeName, s.sectionName, s.rollNo, s.gender, s.dob, STUDENT_STATUS_LABEL[s.status]]),
                };
              }}
            />
          )
        }
        empty={
          active.length > 0 ? (
            <EmptyState illustration="no-results" title="No students match these filters" description="Try a different search, or remove a filter." filters={active.map((a) => <FilterChip key={a.key} label={a.label} onRemove={() => set({ [a.key]: '' })} />)} action={<ClearFiltersButton onClick={() => reset(['q', 'gradeId', 'sectionId', 'status'])} />} />
          ) : (
            <EmptyState
              illustration="empty-generic"
              title="No students on the roll yet"
              description="Add students one by one, or import a CSV of your existing list."
              action={
                canCreate && !acc.readOnly ? (
                  <>
                    <Button asChild><Link href={paths.studentNew}>Add student</Link></Button>
                    <Button variant="secondary" asChild><Link href={paths.studentImport}>Import CSV</Link></Button>
                  </>
                ) : undefined
              }
            />
          )
        }
      />
    </>
  );
}
