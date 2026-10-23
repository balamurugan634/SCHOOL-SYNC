'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { AttendanceCorrectionItem } from '@school-sync/shared';
import { useMySections, sectionOutLabel } from '@/lib/client/teacher';
import { useCorrections, useDecideCorrection, type CorrectionFilters } from '@/lib/client/teacher-classes';
import { teacherError } from '@/lib/client/teacher-errors';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { StatusChip } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Drawer, DrawerContent, SheetBody, SheetFooter } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, Textarea } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toaster';
import { PageHeader } from '@/components/shell/page-header';
import { useMe, useMeContext, usePermissions } from '@/components/me-context';
import { FilterSelect, Meta, useUrlState, useWriteGate } from '../common';

const STATUSES = [
  { value: 'pending', label: 'Waiting for a decision' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

/** Correction requests: the ones I raised, and (class teachers) the ones waiting for my decision. */
export function CorrectionsScreen() {
  const { can } = usePermissions();
  const { base } = useMeContext();
  const url = useUrlState();
  const sections = useMySections();
  const canDecide = can('attendance:approve');
  const tab = canDecide && url.get('tab') !== 'mine' ? 'decide' : 'mine';
  const filters: CorrectionFilters = {
    status: (url.get('status') as CorrectionFilters['status']) || 'pending',
    sectionId: url.get('section'),
    mine: tab === 'mine',
    page: url.num('page', 1),
    pageSize: url.num('size', 25),
  };
  const q = useCorrections(filters);
  const openId = url.get('open');
  const open = q.data?.data.find((c) => c.id === openId) ?? null;

  const columns: Column<AttendanceCorrectionItem>[] = [
    {
      id: 'student',
      header: 'Student',
      cell: (r) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{r.studentName}</p>
          <p className="t-caption text-ink-3">{r.admissionNo}</p>
        </div>
      ),
      mobile: 'title',
    },
    {
      id: 'when',
      header: 'Class and day',
      cell: (r) => (
        <div>
          <p>{fmtDate(r.date, { weekday: 'short', day: 'numeric', month: 'short' })}</p>
          <p className="t-caption text-ink-3">{r.sectionName}</p>
        </div>
      ),
      mobile: 'sub',
    },
    {
      id: 'change',
      header: 'Change',
      cell: (r) => (
        <span className="inline-flex items-center gap-1.5">
          <StatusChip status={r.fromStatus} />
          <ArrowRight className="size-3.5 text-ink-3" aria-label="to" />
          <StatusChip status={r.toStatus} />
        </span>
      ),
      mobile: 'detail',
    },
    { id: 'reason', header: 'Reason', cell: (r) => <span className="line-clamp-2 max-w-[28ch] text-ink-2">{r.reason}</span>, mobile: 'hide' },
    { id: 'by', header: 'Asked by', cell: (r) => <span className="text-ink-2">{r.requestedByName ?? '—'}</span>, defaultHidden: tab === 'mine', mobile: 'detail' },
    { id: 'status', header: 'Status', cell: (r) => <StatusChip status={r.status} />, mobile: 'status' },
  ];

  return (
    <>
      <PageHeader title="Attendance corrections" description={canDecide ? 'Corrections you asked for, and requests from other teachers waiting for your decision.' : 'Corrections you asked for. The class teacher decides them.'} actions={<Button asChild variant="secondary"><Link href={`${base}/attendance/history`}>Request a correction</Link></Button>} />

      {canDecide && (
        <Tabs value={tab} onValueChange={(v) => url.set({ tab: v === 'decide' ? null : v, status: null })}>
          <TabsList aria-label="Corrections view" className="mb-4">
            <TabsTrigger value="decide">To decide</TabsTrigger>
            <TabsTrigger value="mine">My requests</TabsTrigger>
          </TabsList>
        </Tabs>
      )}

      <DataTable<AttendanceCorrectionItem>
        id={`teacher-corrections-${tab}`}
        caption={tab === 'mine' ? 'Correction requests I made' : 'Correction requests to decide'}
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
            <FilterSelect label="Status" value={filters.status === 'pending' ? '' : filters.status} allLabel="Waiting for a decision" onChange={(v) => url.set({ status: v })} options={STATUSES.filter((s) => s.value !== 'pending')} />
            <FilterSelect label="Class" value={filters.sectionId} allLabel="All my classes" onChange={(v) => url.set({ section: v })} options={(sections.data ?? []).map((s) => ({ value: s.id, label: sectionOutLabel(s) }))} />
          </>
        }
        columns={columns}
        empty={
          <EmptyState
            illustration="empty-generic"
            compact
            title={filters.status === 'pending' ? (tab === 'mine' ? 'You have no pending correction requests' : 'Nothing is waiting for your decision') : 'No corrections with that status'}
            description={tab === 'mine' ? 'Open a day in the attendance history to ask for a change to a submitted roll call.' : 'When a colleague asks to change a record in your class, it shows up here.'}
          />
        }
      />

      <CorrectionDrawer item={open} onClose={() => url.set({ open: null }, { keepPage: true })} />
    </>
  );
}

function CorrectionDrawer({ item, onClose }: { item: AttendanceCorrectionItem | null; onClose: () => void }) {
  return (
    <Drawer open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DrawerContent title="Correction request" description="Review the change and decide" showTitle>
        {item && <DrawerBody key={item.id} item={item} onClose={onClose} />}
      </DrawerContent>
    </Drawer>
  );
}

function DrawerBody({ item, onClose }: { item: AttendanceCorrectionItem; onClose: () => void }) {
  const me = useMe();
  const gate = useWriteGate();
  const decide = useDecideCorrection();
  const [note, setNote] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [noteError, setNoteError] = React.useState(false);
  const mineRequest = item.requestedBy === me.id;

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
          toast.success(decision === 'approve' ? 'Correction approved' : 'Correction rejected', { description: decision === 'approve' ? 'The attendance record now shows the new status.' : 'The requester has been told.' });
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
        <div className="flex items-center gap-2 rounded-md border border-border bg-surface-subtle px-3 py-2.5">
          <StatusChip status={item.fromStatus} />
          <ArrowRight className="size-4 text-ink-3" aria-label="changed to" />
          <StatusChip status={item.toStatus} />
        </div>
        <Meta
          items={[
            { label: 'Class', value: item.sectionName },
            { label: 'Day', value: fmtDate(item.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) },
            { label: 'Asked by', value: `${item.requestedByName ?? '—'} · ${fmtDateTime(item.createdAt)}` },
            { label: 'Admission number', value: item.admissionNo },
          ]}
        />
        <div>
          <p className="t-caption text-ink-2">Reason</p>
          <p className="mt-0.5 whitespace-pre-wrap text-sm">{item.reason}</p>
        </div>

        {item.status !== 'pending' && (
          <Banner tone={item.status === 'approved' ? 'success' : 'warning'} title={`${item.status === 'approved' ? 'Approved' : 'Rejected'}${item.decidedByName ? ` by ${item.decidedByName}` : ''}${item.decidedAt ? ` · ${fmtDateTime(item.decidedAt)}` : ''}`}>
            {item.decisionNote ?? 'No note was added.'}
          </Banner>
        )}

        {item.status === 'pending' && !item.canDecide && (
          <Banner tone="info" title={mineRequest ? 'You asked for this correction' : 'Not yours to decide'}>
            {mineRequest ? 'You can’t decide your own request. The class teacher or the school office approves or rejects it, and you’ll be told.' : `Only the class teacher of ${item.sectionName}, or the school office, can approve or reject this.`}
          </Banner>
        )}

        {item.status === 'pending' && item.canDecide && (
          <>
            <Field label="Note" htmlFor="corr-note" hint="Required when you reject. Shown to the person who asked." error={noteError && !note.trim() ? 'Say why you are rejecting it.' : null}>
              <Textarea
                id="corr-note"
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
            <p className="t-caption text-ink-2">Approving changes the attendance record and tells the student’s verified guardians. The old value is kept in the audit trail.</p>
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
            Approve correction
          </Button>
        </SheetFooter>
      )}
    </>
  );
}
