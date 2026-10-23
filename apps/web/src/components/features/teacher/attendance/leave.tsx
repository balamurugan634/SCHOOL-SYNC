'use client';

import * as React from 'react';
import { Check } from 'lucide-react';
import type { LeaveItem } from '@school-sync/shared';
import { sectionOutLabel, useMySections, useTeacherScope } from '@/lib/client/teacher';
import { useDecideLeave, useLeaveList, type LeaveFilters } from '@/lib/client/teacher-classes';
import { teacherError } from '@/lib/client/teacher-errors';
import { fileHref } from '@/lib/client/teacher-upload';
import { fmtDate, fmtDateTime, plural } from '@/lib/format';
import { Badge, StatusChip } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Drawer, DrawerContent, SheetBody, SheetFooter } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { toast } from '@/components/ui/toaster';
import { PageHeader } from '@/components/shell/page-header';
import { FilterSelect, Meta, useUrlState, useWriteGate } from '../common';

const TYPE: Record<string, string> = { sick: 'Sick', casual: 'Casual', family: 'Family', event: 'Event', other: 'Other' };
const STATUS_OPTIONS = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'all', label: 'All statuses' },
];

/** Student leave in my classes. Class teachers approve or reject (a note is needed to reject); everyone else sees it read-only. */
export function LeaveScreen() {
  const url = useUrlState();
  const scope = useTeacherScope();
  const sections = useMySections();
  const gate = useWriteGate();
  const decide = useDecideLeave();
  const statusParam = url.get('status', 'pending');
  const filters: LeaveFilters = { status: statusParam === 'all' ? '' : (statusParam as LeaveFilters['status']), sectionId: url.get('section'), page: url.num('page', 1), pageSize: url.num('size', 25) };
  const q = useLeaveList(filters);
  const openId = url.get('open');
  const open = q.data?.data.find((l) => l.id === openId) ?? null;
  const [busy, setBusy] = React.useState<string | null>(null);

  const quickApprove = (l: LeaveItem) => {
    setBusy(l.id);
    decide.mutate(
      { id: l.id, decision: 'approve' },
      {
        onSuccess: () => toast.success('Leave approved', { description: `${l.studentName} will show as on leave for ${plural(l.days, 'school day')}.` }),
        onError: (e) => toast.error(teacherError(e), { duration: 8000 }),
        onSettled: () => setBusy(null),
      },
    );
  };

  const columns: Column<LeaveItem>[] = [
    {
      id: 'student',
      header: 'Student',
      cell: (r) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{r.studentName}</p>
          <p className="t-caption text-ink-3">{[r.sectionName, r.admissionNo].filter(Boolean).join(' · ')}</p>
        </div>
      ),
      mobile: 'title',
    },
    {
      id: 'dates',
      header: 'Dates',
      cell: (r) => (
        <div>
          <p>
            {fmtDate(r.fromDate, { day: 'numeric', month: 'short' })}
            {r.toDate !== r.fromDate ? ` to ${fmtDate(r.toDate, { day: 'numeric', month: 'short' })}` : ''}
          </p>
          <p className="t-caption text-ink-3">{plural(r.days, 'school day')}</p>
        </div>
      ),
      sortable: true,
      sortValue: (r) => r.fromDate,
      mobile: 'sub',
    },
    { id: 'type', header: 'Type', cell: (r) => <Badge variant="neutral">{TYPE[r.leaveType] ?? r.leaveType}</Badge>, mobile: 'detail' },
    { id: 'reason', header: 'Reason', cell: (r) => <span className="line-clamp-2 max-w-[30ch] text-ink-2">{r.reason}</span>, mobile: 'hide' },
    { id: 'by', header: 'Applied by', cell: (r) => <span className="text-ink-2">{r.requestedByName ?? '—'}</span>, defaultHidden: true, mobile: 'hide' },
    { id: 'status', header: 'Status', cell: (r) => <StatusChip status={r.status} />, mobile: 'status' },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      label: 'Actions',
      hideable: false,
      align: 'right',
      cell: (r) =>
        r.status === 'pending' && r.canDecide ? (
          <span className="inline-flex items-center gap-1.5">
            <Button size="sm" variant="secondary" loading={busy === r.id} disabled={gate.readOnly || busy !== null} aria-label={`Approve leave for ${r.studentName}`} onClick={(e) => { e.stopPropagation(); quickApprove(r); }}>
              <Check /> Approve
            </Button>
            <Button size="sm" variant="ghost" disabled={gate.readOnly || busy !== null} aria-label={`Review leave for ${r.studentName}`} onClick={(e) => { e.stopPropagation(); url.set({ open: r.id }, { keepPage: true }); }}>
              Review
            </Button>
          </span>
        ) : null,
      mobile: 'hide',
    },
  ];

  return (
    <>
      <PageHeader title="Student leave" description={scope.isClassTeacher ? 'Approve or reject leave for the class you lead. Parents and students are told the moment you decide.' : 'Leave requests in your classes. Only the class teacher can decide them.'} />
      {!scope.isClassTeacher && (
        <Banner tone="info" className="mb-4">
          You can see leave for the classes you teach, so you know who will be away. Class teachers approve and reject it.
        </Banner>
      )}
      <DataTable<LeaveItem>
        id="teacher-leave"
        caption="Student leave requests"
        rows={q.data?.data}
        rowKey={(r) => r.id}
        loading={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
        page={filters.page}
        pageSize={filters.pageSize}
        total={q.data?.meta.total}
        onPageChange={(p) => url.set({ page: p }, { keepPage: true })}
        onPageSizeChange={(n) => url.set({ size: n })}
        onRowClick={(r) => url.set({ open: r.id }, { keepPage: true })}
        activeRowKey={openId}
        filters={
          <>
            <Select aria-label="Status" className="w-full sm:w-44" value={statusParam} onValueChange={(v) => url.set({ status: v === 'pending' ? null : v })} options={STATUS_OPTIONS} />
            <FilterSelect label="Class" value={filters.sectionId} allLabel="All my classes" onChange={(v) => url.set({ section: v })} options={(sections.data ?? []).map((s) => ({ value: s.id, label: sectionOutLabel(s) }))} />
          </>
        }
        columns={columns}
        empty={
          <EmptyState
            illustration="empty-generic"
            compact
            title={statusParam === 'pending' ? 'No leave is waiting for a decision' : 'No leave requests match'}
            description={statusParam === 'pending' ? 'New requests from parents appear here.' : 'Try another status or class.'}
            action={statusParam !== 'pending' || filters.sectionId ? <Button variant="secondary" size="sm" onClick={() => url.set({ status: null, section: null })}>Show pending</Button> : undefined}
          />
        }
      />
      <Drawer open={!!open} onOpenChange={(o) => !o && url.set({ open: null }, { keepPage: true })}>
        <DrawerContent title="Leave request" description="Review and decide" showTitle>
          {open && <LeaveDrawerBody key={open.id} item={open} onClose={() => url.set({ open: null }, { keepPage: true })} />}
        </DrawerContent>
      </Drawer>
    </>
  );
}

function LeaveDrawerBody({ item, onClose }: { item: LeaveItem; onClose: () => void }) {
  const gate = useWriteGate();
  const decide = useDecideLeave();
  const [note, setNote] = React.useState('');
  const [noteError, setNoteError] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const run = (decision: 'approve' | 'reject') => {
    setError(null);
    if (decision === 'reject' && !note.trim()) {
      setNoteError(true);
      return;
    }
    decide.mutate(
      { id: item.id, decision, note: note.trim() || undefined },
      {
        onSuccess: () => {
          toast.success(decision === 'approve' ? 'Leave approved' : 'Leave rejected', { description: decision === 'approve' ? `${item.studentName} is marked on leave for those days.` : 'The family has been told, with your note.' });
          onClose();
        },
        onError: (e) => setError(teacherError(e)),
      },
    );
  };

  return (
    <>
      <SheetBody className="space-y-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="text-base font-semibold">{item.studentName}</p>
          <StatusChip status={item.status} />
        </div>
        <Meta
          items={[
            { label: 'Class', value: item.sectionName },
            { label: 'Type', value: TYPE[item.leaveType] ?? item.leaveType },
            { label: 'From', value: fmtDate(item.fromDate, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }) },
            { label: 'To', value: fmtDate(item.toDate, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }) },
            { label: 'School days', value: item.days },
            { label: 'Applied by', value: `${item.requestedByName ?? '—'} · ${fmtDateTime(item.createdAt)}` },
          ]}
        />
        <div>
          <p className="t-caption text-ink-2">Reason</p>
          <p className="mt-0.5 whitespace-pre-wrap text-sm">{item.reason}</p>
        </div>
        {item.attachmentFileId && (
          <a href={fileHref(item.attachmentFileId)} target="_blank" rel="noreferrer" className="inline-flex min-h-9 items-center text-sm text-brand-ink underline-offset-4 hover:underline">
            Open the attached document
          </a>
        )}

        {item.status !== 'pending' && (
          <Banner tone={item.status === 'approved' ? 'success' : 'info'} title={`${item.status === 'approved' ? 'Approved' : item.status === 'rejected' ? 'Rejected' : 'Cancelled'}${item.decidedByName ? ` by ${item.decidedByName}` : ''}${item.decidedAt ? ` · ${fmtDateTime(item.decidedAt)}` : ''}`}>
            {item.decisionNote ?? (item.status === 'cancelled' ? 'The family withdrew this request.' : 'No note was added.')}
          </Banner>
        )}
        {item.status === 'pending' && !item.canDecide && (
          <Banner tone="info" title="Not yours to decide">
            Only the class teacher of {item.sectionName ?? 'this class'}, or the school office, can approve or reject leave.
          </Banner>
        )}
        {item.status === 'pending' && item.canDecide && (
          <>
            <Field label="Note to the family" htmlFor="leave-note" hint="Optional when you approve. Required when you reject." error={noteError && !note.trim() ? 'Say why you are rejecting it.' : null}>
              <Textarea
                id="leave-note"
                rows={3}
                maxLength={500}
                value={note}
                invalid={noteError && !note.trim()}
                onChange={(e) => {
                  setNote(e.target.value);
                  setNoteError(false);
                }}
              />
            </Field>
            <p className="t-caption text-ink-2">Approved days show as leave in the roll call and don’t count against the student’s attendance.</p>
          </>
        )}
        {error && <Banner tone="danger">{error}</Banner>}
        {gate.readOnly && item.status === 'pending' && item.canDecide && <Banner tone="locked">{gate.reason}</Banner>}
      </SheetBody>
      {item.status === 'pending' && item.canDecide && (
        <SheetFooter>
          <Button variant="danger" onClick={() => run('reject')} loading={decide.isPending && decide.variables?.decision === 'reject'} disabled={gate.readOnly || decide.isPending}>
            Reject
          </Button>
          <Button onClick={() => run('approve')} loading={decide.isPending && decide.variables?.decision === 'approve'} disabled={gate.readOnly || decide.isPending}>
            Approve leave
          </Button>
        </SheetFooter>
      )}
    </>
  );
}
