'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Send, Undo2 } from 'lucide-react';
import type { ExamOut, SheetOut } from '@school-sync/shared';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { bff } from '@/lib/client/fetcher';
import { useExamMutation, useExamPicker, useExamSections, useSheets, type SheetBulkPublishOut } from '@/lib/client/exams-admin';
import { sectionOptions, subjectOptions, useSubjectList } from '@/lib/client/options';
import { useUrlState } from '@/lib/client/url-state';
import { fmtDateTime, plural } from '@/lib/format';
import { useAccess } from '../shared/access';
import { ClearFiltersButton, FilterSelect } from '../shared/controls';
import { ReasonDialog } from '../shared/dialogs';
import { paths } from '../shared/paths';
import { GenerateSheetsButton } from './generate-dialog';
import { SHEET_STATUS_OPTIONS, SheetStatusChip } from './meta';
import { CAN_APPROVE, CAN_PUBLISH, CAN_RETURN, useBulkSheetAction, useSheetActions } from './sheet-actions';
import { SheetDrawer } from './sheet-drawer';

/** Mark sheets of one exam (the "Mark sheets" tab). */
export function ExamSheets({ exam }: { exam: ExamOut }) {
  return <SheetsQueue exam={exam} defaultStatus="all" />;
}

/**
 * The review queue: mark sheets filtered by exam / class / subject / status with approve, return (note required) and publish,
 * per sheet and in bulk. With `exam` it is the per-exam tab (plus generate and publish-all); without it, the cross-exam queue.
 */
export function SheetsQueue({ exam, defaultStatus }: { exam?: ExamOut; defaultStatus: string }) {
  const router = useRouter();
  const access = useAccess();
  const [f, set, reset] = useUrlState({ examId: '', sectionId: '', subjectId: '', status: defaultStatus, page: 1, pageSize: 25 });
  const examId = exam?.id ?? f.examId;
  const statusParam = f.status === 'all' ? '' : f.status;
  const q = useSheets({ examId, sectionId: f.sectionId, subjectId: f.subjectId, status: statusParam, page: f.page, pageSize: f.pageSize });
  const exams = useExamPicker(!exam);
  const sections = useExamSections(exam?.academicYearId);
  const subjects = useSubjectList();
  const actions = useSheetActions();
  const bulk = useBulkSheetAction();

  const [open, setOpen] = React.useState<SheetOut | null>(null);
  const [sel, setSel] = React.useState<Set<string>>(new Set());
  const [bulkReturn, setBulkReturn] = React.useState<SheetOut[] | null>(null);
  const [bulkConfirm, setBulkConfirm] = React.useState<{ kind: 'approve' | 'publish'; rows: SheetOut[] } | null>(null);
  const [publishAll, setPublishAll] = React.useState(false);

  const publishApproved = useExamMutation(() => bff<SheetBulkPublishOut>(`/exams/${exam!.id}/sheets/publish`, { method: 'POST', body: { sectionId: f.sectionId || undefined, subjectId: f.subjectId || undefined } }), {
    success: (r) => `Published ${plural(r.published, 'sheet')}${r.skipped ? `; ${r.skipped} not ready` : ''}`,
  });

  const filtered = !!(f.sectionId || f.subjectId || f.status !== defaultStatus || (!exam && f.examId));
  const canDecide = access.can('marks:approve');
  const canPub = access.can('marks:publish');
  const approvedCount = exam?.sheets?.approved ?? 0;

  const columns: Column<SheetOut>[] = [
    ...(!exam ? [{ id: 'exam', header: 'Exam', mobile: 'sub' as const, cell: (s: SheetOut) => <span className="text-ink-2">{s.examName}</span> }] : []),
    { id: 'class', header: 'Class', mobile: 'title', cell: (s) => <span className="font-medium">{s.gradeName} {s.sectionName}</span> },
    { id: 'subject', header: 'Subject', mobile: 'sub', cell: (s) => s.subjectName },
    { id: 'teacher', header: 'Teacher', mobile: 'detail', cell: (s) => s.teacherName ?? <span className="text-ink-3">Not assigned</span> },
    { id: 'entered', header: 'Entered', align: 'right', mobile: 'detail', cell: (s) => <span className="tnum">{s.enteredCount}/{s.studentCount}{s.absentCount ? ` (${s.absentCount} abs.)` : ''}</span> },
    { id: 'submitted', header: 'Submitted', mobile: 'hide', defaultHidden: !!exam, cell: (s) => (s.submittedAt ? <span className="tnum">{fmtDateTime(s.submittedAt)}</span> : '—') },
    { id: 'status', header: 'Status', mobile: 'status', cell: (s) => <SheetStatusChip status={s.status} /> },
    {
      id: 'actions',
      header: <span className="sr-only">Quick actions</span>,
      label: 'Quick actions',
      hideable: false,
      align: 'right',
      mobile: 'hide',
      cell: (s) => (
        <span className="inline-flex gap-1.5" onClick={(e) => e.stopPropagation()}>
          {canDecide && CAN_APPROVE(s) && (
            <Button size="sm" variant="secondary" disabled={!access.ok('marks:approve') || actions.busy} onClick={() => void actions.approve.run(s)} aria-label={`Approve ${s.subjectName} for ${s.gradeName} ${s.sectionName}`}>
              Approve
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setOpen(s)} aria-label={`Open ${s.subjectName} for ${s.gradeName} ${s.sectionName}`}>
            Open
          </Button>
        </span>
      ),
    },
  ];

  const bulkBar = (rows: SheetOut[]) => {
    const a = rows.filter(CAN_APPROVE);
    const r = rows.filter(CAN_RETURN);
    const p = rows.filter(CAN_PUBLISH);
    return (
      <>
        {canDecide && (
          <Button size="sm" variant="secondary" disabled={a.length === 0 || !access.ok('marks:approve')} onClick={() => setBulkConfirm({ kind: 'approve', rows: a })} title={access.hint('marks:approve')}>
            <CheckCircle2 /> Approve {a.length || ''}
          </Button>
        )}
        {canDecide && (
          <Button size="sm" variant="secondary" disabled={r.length === 0 || !access.ok('marks:approve')} onClick={() => setBulkReturn(r)} title={access.hint('marks:approve')}>
            <Undo2 /> Return {r.length || ''}
          </Button>
        )}
        {canPub && (
          <Button size="sm" variant="secondary" disabled={p.length === 0 || !access.ok('marks:publish')} onClick={() => setBulkConfirm({ kind: 'publish', rows: p })} title={access.hint('marks:publish')}>
            <Send /> Publish {p.length || ''}
          </Button>
        )}
      </>
    );
  };

  return (
    <div className="space-y-4">
      {exam && (
        <div className="flex flex-wrap items-center gap-2">
          <GenerateSheetsButton exam={exam} />
          {canPub && exam.status !== 'draft' && exam.status !== 'scheduled' && (
            <Button variant="secondary" disabled={!access.ok('marks:publish') || approvedCount === 0} onClick={() => setPublishAll(true)} title={approvedCount === 0 ? 'No approved sheets to publish yet' : access.hint('marks:publish')}>
              <Send /> Publish all approved{approvedCount ? ` (${approvedCount})` : ''}
            </Button>
          )}
          {exam.status === 'draft' && <p className="t-caption text-ink-2">Schedule the exam before generating mark sheets.</p>}
        </div>
      )}
      <DataTable
        id={exam ? 'exam-sheets' : 'review-queue'}
        caption="Mark sheets"
        columns={columns}
        rows={q.data?.data}
        rowKey={(s) => s.id}
        loading={q.isPending}
        error={q.isError ? q.error : undefined}
        onRetry={() => void q.refetch()}
        page={f.page}
        pageSize={f.pageSize}
        total={q.data?.meta.total}
        onPageChange={(page) => set({ page })}
        onPageSizeChange={(pageSize) => set({ pageSize })}
        selectable={canDecide || canPub}
        selected={sel}
        onSelectedChange={setSel}
        bulkActions={bulkBar}
        onRowClick={(s) => setOpen(s)}
        filters={
          <>
            {!exam && <FilterSelect label="Exam" value={f.examId} onChange={(v) => set({ examId: v })} options={(exams.data ?? []).filter((e) => e.status !== 'draft').map((e) => ({ value: e.id, label: e.name }))} allLabel="All exams" />}
            <FilterSelect label="Status" value={f.status === 'all' ? '' : f.status} onChange={(v) => set({ status: v || 'all' })} options={SHEET_STATUS_OPTIONS} allLabel="All statuses" />
            <FilterSelect label="Class" value={f.sectionId} onChange={(v) => set({ sectionId: v })} options={sectionOptions(sections.data)} allLabel="All classes" />
            <FilterSelect label="Subject" value={f.subjectId} onChange={(v) => set({ subjectId: v })} options={subjectOptions(subjects.data)} allLabel="All subjects" />
            {filtered && <ClearFiltersButton onClick={() => reset(['examId', 'sectionId', 'subjectId', 'status', 'page'])} />}
          </>
        }
        empty={
          filtered ? (
            <EmptyState illustration="no-results" title="No mark sheets match these filters" description="Try another status or class, or clear the filters." action={<Button variant="secondary" onClick={() => reset(['examId', 'sectionId', 'subjectId', 'status', 'page'])}>Clear filters</Button>} compact />
          ) : exam ? (
            <EmptyState illustration="empty-homework" title="No mark sheets yet" description={exam.status === 'draft' ? 'Schedule the exam, then generate the sheets.' : 'Generate the sheets so each subject teacher has one to fill in.'} action={<GenerateSheetsButton exam={exam} variant="primary" />} compact />
          ) : (
            <EmptyState illustration="success" title="Nothing waiting for review" description="Submitted mark sheets appear here for approval." action={<Button variant="secondary" onClick={() => router.push(paths.exams)}>Go to exams</Button>} compact />
          )
        }
      />

      <SheetDrawer sheet={open} onClose={() => setOpen(null)} />

      <ReasonDialog
        open={bulkReturn !== null}
        onOpenChange={(o) => !o && setBulkReturn(null)}
        title={`Return ${bulkReturn ? plural(bulkReturn.length, 'sheet') : 'sheets'} to their teachers?`}
        description="Each subject teacher is notified with this note and can fix and resubmit."
        label="Note for the teachers"
        required
        minLength={3}
        confirmLabel="Return sheets"
        consequence="The same note is sent for every selected sheet. Nothing becomes visible to students."
        onSubmit={async (note) => {
          const r = await bulk.run({ kind: 'return', sheets: bulkReturn ?? [], note });
          if (r.ok) setSel(new Set());
          return r.ok;
        }}
      />
      <ConfirmDialog
        open={bulkConfirm !== null}
        onOpenChange={(o) => !bulk.isPending && !o && setBulkConfirm(null)}
        title={bulkConfirm?.kind === 'publish' ? `Publish ${bulkConfirm ? plural(bulkConfirm.rows.length, 'sheet') : ''}?` : `Approve ${bulkConfirm ? plural(bulkConfirm.rows.length, 'sheet') : ''}?`}
        description={bulkConfirm?.kind === 'publish' ? 'Students and their verified guardians can see these marks and are notified. Later changes need a correction with a reason.' : 'Approved sheets are ready to publish. Nothing is visible to students until they are published.'}
        confirmLabel={bulkConfirm?.kind === 'publish' ? 'Publish' : 'Approve'}
        loading={bulk.isPending}
        onConfirm={async () => {
          if (!bulkConfirm) return;
          const r = await bulk.run({ kind: bulkConfirm.kind, sheets: bulkConfirm.rows });
          if (r.ok) {
            setBulkConfirm(null);
            setSel(new Set());
          }
        }}
      />
      <ConfirmDialog
        open={publishAll}
        onOpenChange={(o) => !publishApproved.isPending && setPublishAll(o)}
        title="Publish all approved sheets?"
        description={`${f.sectionId || f.subjectId ? 'Approved sheets in the selected class / subject' : `All ${approvedCount} approved sheets of ${exam?.name ?? 'this exam'}`} are published. Students and their verified guardians can see the marks and are notified. Sheets that are not approved stay hidden.`}
        confirmLabel="Publish approved sheets"
        loading={publishApproved.isPending}
        onConfirm={async () => {
          const r = await publishApproved.run();
          if (r.ok) setPublishAll(false);
        }}
      />
    </div>
  );
}
