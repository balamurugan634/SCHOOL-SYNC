'use client';

import * as React from 'react';
import { Check, Plus, X } from 'lucide-react';
import { z } from 'zod';
import { concessionCreateBody, type ConcessionOut } from '@school-sync/shared';
import { useConcessions, useDecideConcession, useFeeCategories, useRequestConcession } from '@/lib/client/finance';
import { amountText, parseMinor } from '@/lib/client/mgmt';
import { applyApiErrors, useZodForm } from '@/lib/client/use-zod-form';
import { fmtDate } from '@/lib/format';
import { Banner } from '@/components/ui/banner';
import { StatusChip } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { FormActions, FormInput, FormSelect, FormTextarea } from '@/components/ui/form';
import { Field } from '@/components/ui/input';
import { toast } from '@/components/ui/toaster';
import { ReasonDialog } from '../common/dialogs';
import { ChoicePills, ClearFilters, FilterBar, FilterChips, SearchBox } from '../common/filters';
import { GuardedButton } from '../common/guarded';
import { StudentPicker, type PickerOption } from '../common/picker';
import { useListState } from '../common/url-state';
import { useMgmt } from '../common/use-mgmt';

const STATUS_OPTIONS = [
  { value: '' as const, label: 'All' },
  { value: 'pending' as const, label: 'Pending' },
  { value: 'approved' as const, label: 'Approved' },
  { value: 'rejected' as const, label: 'Rejected' },
];

export function ConcessionsTab() {
  const { writeBlock, money } = useMgmt();
  const ls = useListState({ pageSize: 25 });
  const status = ls.get('status') as '' | 'pending' | 'approved' | 'rejected';
  const studentId = ls.get('student');
  const q = useConcessions({ page: ls.page, pageSize: ls.pageSize, q: ls.q || undefined, status: status || undefined, studentId: studentId || undefined });
  const [requesting, setRequesting] = React.useState(false);
  const [decide, setDecide] = React.useState<{ row: ConcessionOut; decision: 'approve' | 'reject' } | null>(null);
  const decideMut = useDecideConcession();
  const approveBlock = writeBlock('fees:approve', 'school');
  const requestBlock = writeBlock('fees:create', 'school');
  const filtered = ls.hasFilters(['status', 'student']);

  const valueText = (c: ConcessionOut) => (c.type === 'percent' ? `${(c.value / 100).toFixed(c.value % 100 === 0 ? 0 : 2)}% off` : `${money(c.value)} for the year`);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[62ch] text-sm text-ink-2">Concessions and scholarships reduce a student’s dues. A request has no effect until it is approved, and approval only applies to dues generated afterwards.</p>
        <GuardedButton blocked={requestBlock} onClick={() => setRequesting(true)}>
          <Plus /> Request a concession
        </GuardedButton>
      </div>
      {approveBlock && !q.isPending && (q.data?.data ?? []).some((c) => c.status === 'pending') && <Banner tone="info">You can see pending requests, but approving or rejecting them is done by the accounts team.</Banner>}
      <DataTable<ConcessionOut>
        id="fees-concessions"
        rows={q.data?.data}
        rowKey={(r) => r.id}
        loading={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
        caption="Fee concessions"
        page={ls.page}
        pageSize={ls.pageSize}
        total={q.data?.meta.total}
        onPageChange={ls.setPage}
        onPageSizeChange={ls.setPageSize}
        filters={
          <FilterBar>
            <SearchBox value={ls.qInput} onChange={ls.setQInput} placeholder="Search student or concession" />
            <ChoicePills label="Status" value={status} onChange={(v) => ls.set({ status: v })} options={STATUS_OPTIONS} />
          </FilterBar>
        }
        empty={
          filtered ? (
            <EmptyState illustration="no-results" title="No concessions match" filters={<FilterChips chips={[...(ls.q ? [{ label: 'Search', value: ls.q }] : []), ...(status ? [{ label: 'Status', value: status }] : [])]} />} action={<ClearFilters onClear={() => ls.clear()} />} />
          ) : (
            <EmptyState illustration="empty-generic" title="No concessions yet" description="Request one for a student, for example a sibling discount or a scholarship." action={<GuardedButton blocked={requestBlock} onClick={() => setRequesting(true)}>Request a concession</GuardedButton>} />
          )
        }
        columns={[
          { id: 'student', header: 'Student', cell: (r) => (<div className="min-w-0"><p className="truncate font-medium">{r.studentName}</p><p className="t-caption text-ink-3">{r.admissionNo}</p></div>), mobile: 'title' },
          { id: 'name', header: 'Concession', cell: (r) => (<div className="min-w-0"><p className="truncate">{r.name}</p>{r.reason && <p className="t-caption truncate text-ink-3">{r.reason}</p>}</div>), mobile: 'sub' },
          { id: 'value', header: 'Value', cell: (r) => valueText(r), align: 'right', mobile: 'value' },
          { id: 'applies', header: 'Applies to', cell: (r) => r.categoryName ?? 'All fees', mobile: 'detail', label: 'Applies to' },
          { id: 'applied', header: 'Applied so far', cell: (r) => (r.status === 'approved' ? money(r.appliedMinor) : '—'), align: 'right', mobile: 'detail', label: 'Applied so far' },
          { id: 'status', header: 'Status', cell: (r) => <StatusChip status={r.status} />, mobile: 'status' },
          { id: 'date', header: 'Requested', cell: (r) => fmtDate(r.createdAt), mobile: 'hide' },
          {
            id: 'actions',
            header: <span className="sr-only">Decide</span>,
            label: 'Decide',
            hideable: false,
            align: 'right',
            mobile: 'hide',
            cell: (r) =>
              r.status === 'pending' ? (
                <div className="flex justify-end gap-1.5">
                  <GuardedButton blocked={approveBlock} size="sm" variant="secondary" onClick={() => setDecide({ row: r, decision: 'approve' })}>
                    <Check /> Approve
                  </GuardedButton>
                  <GuardedButton blocked={approveBlock} size="sm" variant="danger" onClick={() => setDecide({ row: r, decision: 'reject' })}>
                    <X /> Reject
                  </GuardedButton>
                </div>
              ) : null,
          },
        ]}
      />
      <RequestDialog open={requesting} onClose={() => setRequesting(false)} />
      <ReasonDialog
        open={!!decide}
        onOpenChange={(o) => !o && setDecide(null)}
        title={decide?.decision === 'approve' ? `Approve “${decide.row.name}”?` : `Reject “${decide?.row.name ?? ''}”?`}
        description={
          decide?.decision === 'approve' ? (
            <>
              {decide.row.studentName}’s dues generated from now on will be reduced by {valueText(decide.row)}. Invoices that already exist are not changed.
            </>
          ) : (
            <>The request for {decide?.row.studentName} is closed and no discount is applied. It cannot be reopened; a new request can be made.</>
          )
        }
        label="Note"
        hint="Optional. Kept with the decision."
        required={false}
        confirmLabel={decide?.decision === 'approve' ? 'Approve concession' : 'Reject concession'}
        destructive={decide?.decision === 'reject'}
        onConfirm={async (note) => {
          if (!decide) return;
          await decideMut.mutateAsync({ id: decide.row.id, decision: decide.decision, note });
          toast.success(decide.decision === 'approve' ? 'Concession approved' : 'Concession rejected');
        }}
      />
    </div>
  );
}

const requestForm = z.object({
  name: z.string().trim().min(2, 'Name it (at least 2 characters)').max(120),
  type: z.enum(['percent', 'fixed']),
  value: amountText('a value'),
  categoryId: z.string(),
  reason: z.string().trim().max(500),
});

function RequestDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { money } = useMgmt();
  const cats = useFeeCategories(open);
  const request = useRequestConcession();
  const [student, setStudent] = React.useState<PickerOption | null>(null);
  const [tried, setTried] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const form = useZodForm(requestForm, { defaultValues: { name: '', type: 'percent', value: '', categoryId: 'all', reason: '' } });
  const type = form.watch('type');
  React.useEffect(() => {
    if (open) {
      form.reset({ name: '', type: 'percent', value: '', categoryId: 'all', reason: '' });
      setStudent(null);
      setTried(false);
      setErr(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = form.handleSubmit(async (v) => {
    setTried(true);
    if (!student) return;
    setErr(null);
    // percent is typed as "10" or "12.5" and sent as basis points; fixed is a yearly amount in minor units
    if (v.type === 'percent' && Number(v.value) > 100) {
      form.setError('value', { message: 'A percentage cannot be more than 100' });
      return;
    }
    try {
      const body = concessionCreateBody.parse({ studentId: student.value, name: v.name, type: v.type, value: v.type === 'percent' ? Math.round(Number(v.value) * 100) : parseMinor(v.value)!, categoryId: v.categoryId === 'all' ? null : v.categoryId, reason: v.reason || null });
      await request.mutateAsync(body);
      toast.success('Concession requested', { description: 'It takes effect once an approver accepts it.' });
      onClose();
    } catch (e) {
      setErr(applyApiErrors(form, e, { value: 'value' }));
    }
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Request a concession" description="Percent off, or a fixed amount for the whole academic year. It needs approval before it affects any bill.">
        <form onSubmit={submit} noValidate className="mt-4 space-y-4">
          <Field label="Student" required error={tried && !student ? 'Choose a student' : null}>
            <StudentPicker selected={student} onSelect={setStudent} invalid={tried && !student} />
          </Field>
          <FormInput control={form.control} name="name" label="Concession name" required placeholder="Sibling discount" maxLength={120} />
          <div className="grid gap-4 sm:grid-cols-2">
            <FormSelect control={form.control} name="type" label="Type" options={[{ value: 'percent', label: 'Percent off' }, { value: 'fixed', label: 'Fixed amount for the year' }]} />
            <FormInput control={form.control} name="value" label={type === 'percent' ? 'Percent' : 'Amount'} required inputMode="decimal" autoComplete="off" placeholder={type === 'percent' ? '10' : '5000'} hint={type === 'percent' ? 'For example 10 for 10% off.' : `Total discount across the year${form.watch('value') && parseMinor(form.watch('value')) ? `: ${money(parseMinor(form.watch('value'))!)}` : ''}.`} />
          </div>
          <FormSelect control={form.control} name="categoryId" label="Applies to" options={[{ value: 'all', label: 'All fees' }, ...(cats.data?.data ?? []).filter((c) => c.isActive).map((c) => ({ value: c.id, label: c.name }))]} />
          <FormTextarea control={form.control} name="reason" label="Reason" rows={2} maxLength={500} hint="Optional, helps the approver." />
          {err && <Banner tone="danger">{err}</Banner>}
          <FormActions className="-mx-5 -mb-5 mt-2 border-t px-5">
            <Button variant="secondary" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={request.isPending}>
              Send request
            </Button>
          </FormActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}
