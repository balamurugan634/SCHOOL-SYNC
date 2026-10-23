'use client';

import * as React from 'react';
import { Plus, X } from 'lucide-react';
import { LEAVE_STATUSES, LEAVE_TYPES, staffLeaveCreateBody, type StaffLeaveItem } from '@school-sync/shared';
import { fmtDate, fmtDateTime, plural, todayIso } from '@/lib/format';
import { applyApiErrors, useZodForm } from '@/lib/client/use-zod-form';
import { useUnsavedGuard } from '@/lib/client/use-unsaved-guard';
import { commsError } from '@/lib/client/teacher-comms';
import { useApplyStaffLeave, useCancelStaffLeave, useStaffLeaveBalance, useStaffLeaveList } from '@/lib/client/teacher-me';
import { usePermissions } from '@/components/me-context';
import { StatusChip } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DataTable } from '@/components/ui/data-table';
import { Drawer, DrawerContent, SheetBody, SheetFooter } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { FormDate, FormSection, FormSelect, FormTextarea } from '@/components/ui/form';
import { StatTile } from '@/components/ui/stat-tile';
import { toast } from '@/components/ui/toaster';
import { ErrorCard, FilterSelect, useUrlState, useWriteGate } from '../common';

const TYPE_LABEL: Record<string, string> = { sick: 'Sick leave', casual: 'Casual leave', family: 'Family', event: 'Event or duty', other: 'Other' };
const PAGE_SIZE = 10;
const range = (a: string, b: string) => (a === b ? fmtDate(a) : `${fmtDate(a, { day: 'numeric', month: 'short' })} – ${fmtDate(b)}`);

export function StaffLeaveScreen() {
  const url = useUrlState();
  const { can } = usePermissions();
  const gate = useWriteGate();
  const status = url.get('status');
  const page = url.num('page', 1);
  const applying = url.get('apply') === '1';
  const list = useStaffLeaveList({ status, page, pageSize: PAGE_SIZE });
  const [cancelling, setCancelling] = React.useState<StaffLeaveItem | null>(null);
  const [dirty, setDirty] = React.useState(false);
  const { guard, dialog } = useUnsavedGuard(dirty, { title: 'Discard this leave request?', description: 'You have not sent your request yet. If you close now it is lost.', confirmLabel: 'Discard request' });
  const cancel = useCancelStaffLeave();
  const canApply = can('staff_leave:create');

  return (
    <div className="space-y-6">
      <Balance />

      <section aria-labelledby="reqs" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="reqs" className="t-section">My requests</h2>
          {canApply && (
            <Button onClick={() => url.set({ apply: '1' }, { keepPage: true })} disabled={gate.readOnly} title={gate.reason}>
              <Plus /> Apply for leave
            </Button>
          )}
        </div>
        <DataTable
          id="teacher-staff-leave"
          caption="My leave requests"
          rows={list.data?.data}
          rowKey={(r) => r.id}
          loading={list.isPending}
          error={list.error}
          onRetry={() => void list.refetch()}
          page={page}
          pageSize={PAGE_SIZE}
          total={list.data?.meta.total}
          onPageChange={(p) => url.set({ page: p }, { keepPage: true })}
          filters={<FilterSelect label="Status" value={status} onChange={(v) => url.set({ status: v })} allLabel="Any status" options={LEAVE_STATUSES.map((s) => ({ value: s, label: s[0]!.toUpperCase() + s.slice(1) }))} />}
          columns={[
            {
              id: 'dates',
              header: 'Dates',
              mobile: 'title',
              hideable: false,
              cell: (r) => (
                <div>
                  <p className="font-medium">{range(r.fromDate, r.toDate)}</p>
                  <p className="t-caption text-ink-2">{plural(r.days, 'school day')}</p>
                </div>
              ),
            },
            { id: 'type', header: 'Type', mobile: 'sub', cell: (r) => TYPE_LABEL[r.leaveType] ?? r.leaveType },
            { id: 'reason', header: 'Reason', mobile: 'detail', cell: (r) => <span className="line-clamp-2 max-w-[28ch] whitespace-normal">{r.reason}</span> },
            { id: 'status', header: 'Status', mobile: 'status', cell: (r) => <StatusChip status={r.status} /> },
            {
              id: 'decision',
              header: 'Decision',
              mobile: 'detail',
              cell: (r) =>
                r.status === 'pending' ? (
                  <span className="text-ink-3">Waiting for the office</span>
                ) : r.decidedByName || r.decisionNote ? (
                  <span className="block max-w-[30ch] whitespace-normal">
                    {r.decidedByName ? `${r.decidedByName}${r.decidedAt ? `, ${fmtDateTime(r.decidedAt)}` : ''}` : ''}
                    {r.decisionNote && <span className="t-caption block text-ink-2">“{r.decisionNote}”</span>}
                  </span>
                ) : (
                  '—'
                ),
            },
            {
              id: 'actions',
              header: <span className="sr-only">Actions</span>,
              label: 'Actions',
              mobile: 'detail',
              hideable: false,
              align: 'right',
              cell: (r) =>
                r.canCancel ? (
                  <Button variant="ghost" size="sm" disabled={gate.readOnly} onClick={() => setCancelling(r)} aria-label={`Cancel leave ${range(r.fromDate, r.toDate)}`}>
                    <X /> Cancel
                  </Button>
                ) : null,
            },
          ]}
          empty={
            status ? (
              <EmptyState illustration="no-results" title="No requests with that status" action={<Button variant="secondary" size="sm" onClick={() => url.set({ status: null })}>Clear filter</Button>} />
            ) : (
              <EmptyState illustration="empty-generic" title="You haven’t asked for leave this year" description="Apply for leave and the school office will approve or reject it. You are told either way." action={canApply ? <Button onClick={() => url.set({ apply: '1' })}><Plus /> Apply for leave</Button> : undefined} />
            )
          }
        />
      </section>

      <Drawer open={applying} onOpenChange={(o) => !o && guard(() => { setDirty(false); url.set({ apply: null }, { keepPage: true }); })}>
        <DrawerContent title="Apply for leave" description="Your request goes to the school office" showTitle onInteractOutside={(e) => dirty && e.preventDefault()}>
          {applying && (
            <ApplyForm
              onDirtyChange={setDirty}
              onCancel={() => guard(() => { setDirty(false); url.set({ apply: null }, { keepPage: true }); })}
              onDone={() => {
                setDirty(false);
                url.set({ apply: null, status: null }, { keepPage: true });
              }}
            />
          )}
        </DrawerContent>
      </Drawer>

      <ConfirmDialog
        open={!!cancelling}
        onOpenChange={(o) => !o && setCancelling(null)}
        title="Cancel this leave request?"
        description={cancelling ? <>Your request for {range(cancelling.fromDate, cancelling.toDate)} ({plural(cancelling.days, 'school day')}) is withdrawn. You can apply again later.</> : null}
        confirmLabel="Cancel request"
        cancelLabel="Keep request"
        destructive
        loading={cancel.isPending}
        onConfirm={() =>
          cancelling &&
          cancel.mutate(cancelling.id, {
            onSuccess: () => {
              toast.success('Leave request cancelled');
              setCancelling(null);
            },
            onError: (e) => {
              toast.error(commsError(e), { duration: 8000 });
              setCancelling(null);
            },
          })
        }
      />
      {dialog}
    </div>
  );
}

/* ───────────────────────── balance ───────────────────────── */

function Balance() {
  const q = useStaffLeaveBalance();
  const d = q.data;
  return (
    <Card>
      <CardHeader title="My leave this year" description={d?.academicYear ? `Academic year ${d.academicYear}, in school days` : 'In school days'} />
      <CardBody className="pt-4">
        {q.isError ? (
          <ErrorCard error={q.error} onRetry={() => void q.refetch()} title="We couldn’t load your leave balance" className="border-0 shadow-none" />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatTile label="Taken (approved)" value={d?.totalApprovedDays} hint={d ? `${d.totalPendingDays} pending` : undefined} state={q.isPending ? 'loading' : 'ready'} />
            {LEAVE_TYPES.map((t) => {
              const row = d?.byType.find((b) => b.leaveType === t);
              return <StatTile key={t} label={TYPE_LABEL[t]!} value={row?.approvedDays ?? 0} hint={row && row.pendingDays > 0 ? `${row.pendingDays} pending` : undefined} state={q.isPending ? 'loading' : 'ready'} />;
            })}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

/* ───────────────────────── apply ───────────────────────── */

function ApplyForm({ onDone, onCancel, onDirtyChange }: { onDone: () => void; onCancel: () => void; onDirtyChange: (d: boolean) => void }) {
  const gate = useWriteGate();
  const apply = useApplyStaffLeave();
  const today = todayIso();
  const form = useZodForm(staffLeaveCreateBody, { defaultValues: { leaveType: 'casual', fromDate: today, toDate: today, reason: '' } });
  const [error, setError] = React.useState<string | null>(null);
  const dirty = form.formState.isDirty;
  React.useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  React.useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  const submit = form.handleSubmit(
    async (v) => {
      setError(null);
      try {
        const r = await apply.mutateAsync(v);
        toast.success('Leave requested', { description: `${range(r.fromDate, r.toDate)} · ${plural(r.days, 'school day')}. The school office will decide.` });
        form.reset(v);
        onDone();
      } catch (e) {
        const m = applyApiErrors(form, e);
        setError(m === null ? 'Some details need fixing. Check the highlighted fields.' : commsError(e));
      }
    },
    () => setError('Some details need fixing. Check the highlighted fields.'),
  );

  return (
    <form onSubmit={submit} noValidate>
      <SheetBody>
        {gate.readOnly && <Banner tone="locked">{gate.reason}</Banner>}
        {error && <Banner tone="danger" onDismiss={() => setError(null)}>{error}</Banner>}
        <FormSection title="Leave">
          <FormSelect control={form.control} name="leaveType" label="Type" options={LEAVE_TYPES.map((t) => ({ value: t, label: TYPE_LABEL[t]! }))} />
          <div className="grid grid-cols-2 gap-3">
            <FormDate control={form.control} name="fromDate" label="From" required />
            <FormDate control={form.control} name="toDate" label="To" required hint="Last day away" />
          </div>
          <FormTextarea control={form.control} name="reason" label="Reason" required rows={4} maxLength={1000} hint="The office sees this. Only school days are counted." />
        </FormSection>
      </SheetBody>
      <SheetFooter>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={apply.isPending}>Cancel</Button>
        <Button type="submit" loading={apply.isPending} disabled={gate.readOnly}>Send request</Button>
      </SheetFooter>
    </form>
  );
}
