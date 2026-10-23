'use client';

import * as React from 'react';
import Link from 'next/link';
import type { CorrectionOut } from '@school-sync/shared';
import { PageHeader } from '@/components/shell/page-header';
import { Badge, StatusChip } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Drawer, DrawerContent, SheetBody, SheetFooter } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useCorrectionActions, useCorrections } from '@/lib/client/people-staff';
import { useUrlState } from '@/lib/client/url-state';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { useAccess } from '../shared/access';
import { ClearFiltersButton, FilterChip, FilterSelect, SearchBox } from '../shared/controls';
import { ReasonDialog } from '../shared/dialogs';
import { DefList } from '../shared/detail';
import { paths } from '../shared/paths';
import { titleCase } from './ui';

const FIELD_LABEL: Record<string, string> = {
  firstName: 'First name',
  lastName: 'Last name',
  dob: 'Date of birth',
  gender: 'Gender',
  bloodGroup: 'Blood group',
  nationality: 'Nationality',
  religion: 'Religion',
  category: 'Category',
  address: 'Address',
  medicalNotes: 'Medical notes',
};

const STATUS_OPTIONS = [
  { value: 'pending', label: 'Waiting for a decision' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'cancelled', label: 'Withdrawn' },
];

function show(field: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return 'Empty';
  if (field === 'dob' && typeof v === 'string') return fmtDate(v);
  if (field === 'gender' && typeof v === 'string') return titleCase(v);
  if (typeof v === 'object') return Object.values(v as Record<string, unknown>).filter(Boolean).join(', ') || 'Empty';
  return String(v);
}

export function CorrectionsQueue() {
  const acc = useAccess();
  const [f, set, reset] = useUrlState({ q: '', status: 'pending', page: 1, pageSize: 25 });
  const q = useCorrections({ ...f, status: f.status === 'all' ? '' : f.status });
  const [selected, setSelected] = React.useState<CorrectionOut | null>(null);

  const active = [f.q && { key: 'q' as const, label: `Search: ${f.q}` }, f.status !== 'pending' && { key: 'status' as const, label: f.status === 'all' ? 'All requests' : (STATUS_OPTIONS.find((o) => o.value === f.status)?.label ?? f.status) }].filter(Boolean) as { key: 'q' | 'status'; label: string }[];

  const columns: Column<CorrectionOut>[] = [
    { id: 'student', header: 'Student', mobile: 'title', cell: (r) => <span className="block min-w-0"><span className="block truncate text-sm font-medium">{r.studentName}</span><span className="t-caption block text-ink-2">{r.admissionNo}</span></span> },
    { id: 'changes', header: 'Change requested', mobile: 'sub', cell: (r) => Object.keys(r.changes).map((k) => FIELD_LABEL[k] ?? k).join(', ') },
    { id: 'by', header: 'Requested by', mobile: 'detail', cell: (r) => <span>{r.requestedByName ?? 'Unknown'} <span className="t-caption text-ink-2">({r.requesterRole})</span></span> },
    { id: 'when', header: 'Received', mobile: 'detail', cell: (r) => fmtDate(r.createdAt) },
    { id: 'status', header: 'Status', mobile: 'status', cell: (r) => <StatusChip status={r.status === 'cancelled' ? 'cancelled' : r.status} label={r.status === 'cancelled' ? 'Withdrawn' : r.status === 'pending' ? 'Waiting' : undefined} /> },
  ];

  const clearAll = () => reset(['q', 'status']);
  return (
    <>
      <PageHeader title="Record corrections" description="Parents and students can ask the school to correct official details such as a name or date of birth. Nothing changes until you approve." />
      <DataTable
        id="people-corrections"
        caption="Record correction requests"
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
        onRowClick={setSelected}
        activeRowKey={selected?.id}
        filters={
          <>
            <SearchBox value={f.q} onChange={(v) => set({ q: v })} placeholder="Search student or admission no." />
            <FilterSelect label="Status" value={f.status === 'pending' ? '' : f.status} onChange={(v) => set({ status: v || 'pending' })} options={[...STATUS_OPTIONS.filter((o) => o.value !== 'pending'), { value: 'all', label: 'Every request' }]} allLabel="Waiting for a decision" />
            {active.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
                {active.map((a) => <FilterChip key={a.key} label={a.label} onRemove={() => set({ [a.key]: a.key === 'status' ? 'pending' : '' })} />)}
                <ClearFiltersButton onClick={clearAll} />
              </div>
            )}
          </>
        }
        empty={
          active.length > 0 ? (
            <EmptyState illustration="no-results" title="No requests match these filters" filters={active.map((a) => <FilterChip key={a.key} label={a.label} onRemove={() => set({ [a.key]: a.key === 'status' ? 'pending' : '' })} />)} action={<ClearFiltersButton onClick={clearAll} />} />
          ) : (
            <EmptyState illustration="success" title="Nothing is waiting for you" description="When a parent or student asks for a correction it appears here." />
          )
        }
      />
      <RequestDrawer request={selected} onClose={() => setSelected(null)} onDecided={setSelected} canDecide={acc.can('students:edit', 'school')} writable={acc.ok('students:edit', 'school')} hint={acc.hint('students:edit', 'school')} />
    </>
  );
}

function RequestDrawer({ request, onClose, onDecided, canDecide, writable, hint }: { request: CorrectionOut | null; onClose: () => void; onDecided: (r: CorrectionOut) => void; canDecide: boolean; writable: boolean; hint?: string }) {
  const { approve, reject } = useCorrectionActions();
  const [mode, setMode] = React.useState<'approve' | 'reject' | null>(null);
  const r = request;
  const pending = r?.status === 'pending';
  return (
    <>
      <Drawer open={!!r} onOpenChange={(o) => !o && onClose()}>
        {r && (
          <DrawerContent title={`Correction for ${r.studentName}`} description={`${r.admissionNo} · received ${fmtDateTime(r.createdAt)}`} showTitle>
            <SheetBody>
              <div className="flex flex-wrap items-center gap-2">
                <StatusChip status={r.status === 'cancelled' ? 'cancelled' : r.status} label={r.status === 'cancelled' ? 'Withdrawn' : r.status === 'pending' ? 'Waiting' : undefined} />
                <Badge variant="neutral">{r.requesterRole === 'parent' ? 'Asked by a parent' : 'Asked by the student'}</Badge>
              </div>
              <DefList items={[{ label: 'Requested by', value: r.requestedByName }, { label: 'Reason given', value: r.reason }]} />
              <div>
                <h3 className="t-section mb-2">What would change</h3>
                <div className="overflow-x-auto rounded-md border border-border">
                  <Table>
                    <THead>
                      <tr>
                        <TH>Field</TH>
                        <TH>Now</TH>
                        <TH>Proposed</TH>
                      </tr>
                    </THead>
                    <TBody>
                      {Object.keys(r.changes).map((k) => (
                        <TR key={k}>
                          <TD className="font-medium">{FIELD_LABEL[k] ?? k}</TD>
                          <TD className="text-ink-2">{show(k, r.original[k])}</TD>
                          <TD>{show(k, r.changes[k])}</TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </div>
                <p className="t-caption mt-2 text-ink-2">Approving applies these values to <Link href={paths.student(r.studentId)} className="text-brand-ink hover:underline">{r.studentName}’s record</Link> and notifies the person who asked.</p>
              </div>
              {!pending && (
                <Banner tone={r.status === 'approved' ? 'success' : 'info'} title={r.status === 'approved' ? 'Approved and applied' : r.status === 'rejected' ? 'Rejected' : 'Withdrawn by the requester'}>
                  {r.decidedAt ? `Decided ${fmtDateTime(r.decidedAt)}.` : null} {r.decisionNote}
                </Banner>
              )}
            </SheetBody>
            {pending && canDecide && (
              <SheetFooter>
                <Button variant="danger" onClick={() => setMode('reject')} disabled={!writable} title={hint}>Reject</Button>
                <Button onClick={() => setMode('approve')} disabled={!writable} title={hint}>Approve and apply</Button>
              </SheetFooter>
            )}
          </DrawerContent>
        )}
      </Drawer>
      {r && (
        <ReasonDialog
          open={mode !== null}
          onOpenChange={(o) => !o && setMode(null)}
          title={mode === 'approve' ? 'Approve this correction?' : 'Reject this correction?'}
          description={mode === 'approve' ? `The proposed values replace the current ones on ${r.studentName}’s record straight away, and the change is recorded in the audit log.` : `The record stays as it is and ${r.requestedByName ?? 'the requester'} is told it was rejected. Explain why so they know what to do next.`}
          label={mode === 'approve' ? 'Note (optional)' : 'Reason for rejecting'}
          required={mode === 'reject'}
          confirmLabel={mode === 'approve' ? 'Approve and apply' : 'Reject request'}
          destructive={mode === 'reject'}
          onSubmit={async (note) => {
            const res = mode === 'approve' ? await approve.run({ id: r.id, note }) : await reject.run({ id: r.id, note });
            if (res.ok) {
              onDecided(res.data);
              return true;
            }
            return false;
          }}
        />
      )}
    </>
  );
}

