'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowRight, Check, X } from 'lucide-react';
import type { AttendanceCorrectionItem, AttendanceStatus } from '@school-sync/shared';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Select } from '@/components/ui/select';
import { Drawer, DrawerContent, SheetBody, SheetFooter } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusChip } from '@/components/ui/badge';
import { PageHeader } from '@/components/shell/page-header';
import { useCorrections, useDecideCorrection } from '@/lib/client/attendance-admin';
import { sectionLabel, sectionOptions, useSectionList } from '@/lib/client/options';
import { useUrlState } from '@/lib/client/url-state';
import { fmtDateTime, plural } from '@/lib/format';
import { useAccess } from '../shared/access';
import { ClearFiltersButton, FilterChip, FilterSelect } from '../shared/controls';
import { ReasonDialog } from '../shared/dialogs';
import { DefList } from '../shared/detail';
import { paths } from '../shared/paths';
import { AttendanceTabs } from './attendance-tabs';
import { BulkApproveDialog } from './bulk-approve';
import { longDate, STATUS_WORD } from './status-bits';

const STATUS_FILTER = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

function Change({ from, to }: { from: AttendanceStatus; to: AttendanceStatus }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <StatusChip status={from} />
      <ArrowRight className="size-3.5 text-ink-3" aria-label="changed to" role="img" />
      <StatusChip status={to} />
    </span>
  );
}

/** `/admin/attendance/corrections` — teachers' requests to change a submitted attendance record, waiting for a decision. */
export function CorrectionsScreen() {
  const a = useAccess();
  const [p, set, reset] = useUrlState({ status: 'pending', sectionId: '', page: 1, size: 25 });
  const q = useCorrections({ status: p.status, sectionId: p.sectionId, page: p.page, pageSize: p.size });
  const secQ = useSectionList();
  const sections = Array.isArray(secQ.data) ? secQ.data : undefined;
  const decide = useDecideCorrection();
  const [open, setOpen] = React.useState<AttendanceCorrectionItem | null>(null);
  const [dlg, setDlg] = React.useState<{ item: AttendanceCorrectionItem; decision: 'approve' | 'reject' } | null>(null);
  const [sel, setSel] = React.useState<Set<string>>(new Set());
  const [bulk, setBulk] = React.useState(false);
  const canDecide = a.ok('attendance:approve');
  const filtered = p.status !== 'pending' || !!p.sectionId;

  const act = (item: AttendanceCorrectionItem, decision: 'approve' | 'reject') => setDlg({ item, decision });
  const rowActions = (r: AttendanceCorrectionItem) =>
    r.status === 'pending' && r.canDecide ? (
      <span className="inline-flex gap-1.5" onClick={(e) => e.stopPropagation()}>
        <Button size="sm" variant="secondary" onClick={() => act(r, 'approve')} disabled={!canDecide} title={a.hint('attendance:approve')} aria-label={`Approve correction for ${r.studentName}`}>
          <Check /> Approve
        </Button>
        <Button size="sm" variant="danger" onClick={() => act(r, 'reject')} disabled={!canDecide} title={a.hint('attendance:approve')} aria-label={`Reject correction for ${r.studentName}`}>
          <X /> Reject
        </Button>
      </span>
    ) : null;

  const cols: Column<AttendanceCorrectionItem>[] = [
    { id: 'student', header: 'Student', cell: (r) => <span className="font-medium">{r.studentName}</span>, sortable: true, sortValue: (r) => r.studentName, mobile: 'title' },
    { id: 'class', header: 'Class', cell: (r) => <span>{r.sectionName}{r.rollNo ? <span className="text-ink-3"> · roll {r.rollNo}</span> : null}</span>, mobile: 'sub' },
    { id: 'date', header: 'Day', cell: (r) => longDateShort(r.date), sortable: true, sortValue: (r) => r.date, mobile: 'detail' },
    { id: 'change', header: 'Change', cell: (r) => <Change from={r.fromStatus} to={r.toStatus} />, mobile: 'detail' },
    { id: 'reason', header: 'Reason', cell: (r) => <span className="line-clamp-2 max-w-xs">{r.reason}</span>, mobile: 'hide' },
    { id: 'by', header: 'Asked by', cell: (r) => r.requestedByName ?? '—', mobile: 'detail', defaultHidden: false },
    { id: 'status', header: 'Status', cell: (r) => <StatusChip status={r.status} />, mobile: 'status' },
    { id: 'actions', header: <span className="sr-only">Actions</span>, label: 'Actions', cell: rowActions, hideable: false, align: 'right', mobile: 'hide' },
  ];

  return (
    <>
      <PageHeader title="Attendance corrections" description="Teachers ask for a change when a roll call was marked wrongly after the edit window closed. Approving updates the record and tells the family." />
      <AttendanceTabs />
      <DataTable
        id="attendance-corrections"
        caption="Attendance correction requests"
        columns={cols}
        rows={q.data?.data}
        rowKey={(r) => r.id}
        loading={q.isPending}
        error={q.isError ? q.error : null}
        onRetry={() => void q.refetch()}
        page={p.page}
        pageSize={p.size}
        total={q.data?.meta.total}
        onPageChange={(page) => set({ page })}
        onPageSizeChange={(size) => set({ size, page: 1 })}
        selectable={p.status === 'pending' && canDecide}
        selected={sel}
        onSelectedChange={setSel}
        bulkActions={(rows) => {
          const ids = rows.filter((r) => r.status === 'pending' && r.canDecide).map((r) => r.id);
          return (
            <Button size="sm" onClick={() => setBulk(true)} disabled={ids.length === 0}>
              <Check /> Approve {ids.length}
            </Button>
          );
        }}
        onRowClick={setOpen}
        filters={
          <>
            <Select aria-label="Status" className="w-36" value={p.status} onValueChange={(v) => set({ status: v })} options={STATUS_FILTER} />
            <FilterSelect label="Class" value={p.sectionId} onChange={(v) => set({ sectionId: v })} options={sectionOptions(sections)} allLabel="All classes" disabled={!sections} />
          </>
        }
        empty={
          filtered ? (
            <EmptyState illustration="no-results" title="No corrections match" description="Try another status or class." filters={
                <>
                  {p.status !== 'pending' && <FilterChip label={`Status: ${p.status}`} onRemove={() => reset(['status'])} />}
                  {p.sectionId && <FilterChip label={sections?.find((s) => s.id === p.sectionId)?.name ? sectionLabel(sections.find((s) => s.id === p.sectionId)!) : 'One class'} onRemove={() => reset(['sectionId'])} />}
                </>
              } action={<ClearFiltersButton onClick={() => reset()} />} compact />
          ) : (
            <EmptyState illustration="success" title="No corrections are waiting" description="When a teacher asks to change a submitted roll call it will appear here for a decision." compact />
          )
        }
      />

      <Drawer open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <DrawerContent title="Attendance correction" description={open ? `${open.studentName} · ${longDate(open.date)}` : undefined} showTitle>
          {open && (
            <>
              <SheetBody>
                <div className="flex items-center gap-3">
                  <Change from={open.fromStatus} to={open.toStatus} />
                </div>
                <DefList
                  items={[
                    { label: 'Student', value: a.can('students:view') ? <Link href={paths.student(open.studentId, 'attendance')} className="text-brand-ink underline-offset-4 hover:underline">{open.studentName}</Link> : open.studentName },
                    { label: 'Admission no.', value: open.admissionNo },
                    { label: 'Class', value: <Link href={paths.attendanceClass(open.sectionId, open.date)} className="text-brand-ink underline-offset-4 hover:underline">{open.sectionName}</Link> },
                    { label: 'Day', value: longDate(open.date) },
                    { label: 'Reason', value: open.reason },
                    { label: 'Asked by', value: open.requestedByName },
                    { label: 'Asked on', value: fmtDateTime(open.createdAt) },
                    { label: 'Status', value: <StatusChip status={open.status} /> },
                    ...(open.status !== 'pending' ? [{ label: 'Decided by', value: open.decidedByName }, { label: 'Decided on', value: open.decidedAt ? fmtDateTime(open.decidedAt) : null }, { label: 'Note', value: open.decisionNote }] : []),
                  ]}
                />
                {open.status === 'pending' && <p className="t-caption text-ink-2">Approving changes this student’s record from {STATUS_WORD[open.fromStatus]} to {STATUS_WORD[open.toStatus]} and notifies the student and verified guardians. The change is kept in the audit log.</p>}
              </SheetBody>
              {open.status === 'pending' && open.canDecide && (
                <SheetFooter>
                  <Button variant="danger" onClick={() => act(open, 'reject')} disabled={!canDecide} title={a.hint('attendance:approve')}>
                    <X /> Reject
                  </Button>
                  <Button onClick={() => act(open, 'approve')} disabled={!canDecide} title={a.hint('attendance:approve')}>
                    <Check /> Approve
                  </Button>
                </SheetFooter>
              )}
            </>
          )}
        </DrawerContent>
      </Drawer>

      <ReasonDialog
        open={!!dlg}
        onOpenChange={(o) => !o && setDlg(null)}
        title={dlg?.decision === 'approve' ? 'Approve this correction?' : 'Reject this correction?'}
        description={dlg ? `${dlg.item.studentName}, ${longDate(dlg.item.date)}: ${STATUS_WORD[dlg.item.fromStatus]} → ${STATUS_WORD[dlg.item.toStatus]}.` : undefined}
        label={dlg?.decision === 'approve' ? 'Note (optional)' : 'Why is it rejected?'}
        required={dlg?.decision === 'reject'}
        placeholder={dlg?.decision === 'reject' ? 'The teacher will read this.' : 'Anything the teacher should know.'}
        confirmLabel={dlg?.decision === 'approve' ? 'Approve correction' : 'Reject correction'}
        destructive={dlg?.decision === 'reject'}
        consequence={dlg?.decision === 'approve' ? 'The record is updated now and the student and verified guardians are notified.' : 'The record stays as it is and the teacher is told why.'}
        onSubmit={async (note) => {
          if (!dlg) return false;
          const r = await decide.go({ id: dlg.item.id, decision: dlg.decision, note });
          if (r.ok) setOpen(null);
          return r.ok;
        }}
      />
      <BulkApproveDialog
        open={bulk}
        onOpenChange={setBulk}
        ids={(q.data?.data ?? []).filter((r) => sel.has(r.id) && r.status === 'pending' && r.canDecide).map((r) => r.id)}
        kind="correction"
        noun="correction"
        consequence={`Each record is changed to the requested status and the students and their verified guardians are notified. ${plural(sel.size, 'selected request')} will be processed one by one.`}
        onDone={() => setSel(new Set())}
      />
    </>
  );
}

const longDateShort = (s: string) => longDate(s).replace(/^[A-Za-z]+, /, '');
