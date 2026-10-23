'use client';

import * as React from 'react';
import { Check, Cog, X } from 'lucide-react';
import type { RefundOut } from '@school-sync/shared';
import { useDecideRefund, useRefunds } from '@/lib/client/finance';
import { friendlyError } from '@/lib/client/mgmt';
import { fmtDate } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DataTable } from '@/components/ui/data-table';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, Input, Textarea } from '@/components/ui/input';
import { toast } from '@/components/ui/toaster';
import { ChoicePills, ClearFilters, FilterBar, FilterChips } from '../common/filters';
import { GuardedButton } from '../common/guarded';
import { useListState } from '../common/url-state';
import { useMgmt } from '../common/use-mgmt';

const STATUS = [
  { value: '' as const, label: 'All' },
  { value: 'requested' as const, label: 'Requested' },
  { value: 'approved' as const, label: 'Approved' },
  { value: 'processed' as const, label: 'Processed' },
  { value: 'rejected' as const, label: 'Rejected' },
];

function RefundChip({ status }: { status: RefundOut['status'] }) {
  const v = { requested: 'warning', approved: 'info', processed: 'success', rejected: 'danger' } as const;
  const label = { requested: 'Requested', approved: 'Approved, not processed', processed: 'Processed', rejected: 'Rejected' } as const;
  return <Badge variant={v[status]}>{label[status]}</Badge>;
}

export function RefundsTab() {
  const { writeBlock, money } = useMgmt();
  const ls = useListState({ pageSize: 25 });
  const status = (ls.get('rstatus') || ls.get('status')) as '' | RefundOut['status'];
  const q = useRefunds({ page: ls.page, pageSize: ls.pageSize, q: ls.q || undefined, status: status || undefined });
  const [act, setAct] = React.useState<{ row: RefundOut; action: 'approve' | 'reject' | 'process' } | null>(null);
  const block = writeBlock('payments:approve', 'school');
  const filtered = !!status || !!ls.q;

  return (
    <div className="space-y-4">
      <p className="max-w-[66ch] text-sm text-ink-2">Refund requests wait here for approval. Approving a request (and processing it) returns the money: the payment’s refunded amount and the invoice balance are adjusted together.</p>
      {block && !q.isPending && (q.data?.data ?? []).some((r) => r.status === 'requested' || r.status === 'approved') && <Banner tone="info">You can follow refunds here. Approving, rejecting and processing them needs the approval permission, which your role does not have.</Banner>}
      <DataTable<RefundOut>
        id="fees-refunds"
        rows={q.data?.data}
        rowKey={(r) => r.id}
        loading={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
        caption="Refund requests"
        page={ls.page}
        pageSize={ls.pageSize}
        total={q.data?.meta.total}
        onPageChange={ls.setPage}
        onPageSizeChange={ls.setPageSize}
        filters={
          <FilterBar>
            <ChoicePills label="Refund status" value={status} onChange={(v) => ls.set({ rstatus: v, status: null })} options={STATUS} />
          </FilterBar>
        }
        empty={
          filtered ? (
            <EmptyState illustration="no-results" title="No refunds match" filters={<FilterChips chips={status ? [{ label: 'Status', value: status }] : []} />} action={<ClearFilters onClear={() => ls.clear()} />} />
          ) : (
            <EmptyState illustration="empty-generic" title="No refund requests" description="Refunds are requested from a payment’s receipt. Anything waiting for a decision will show up here." />
          )
        }
        columns={[
          { id: 'student', header: 'Student', cell: (r) => (<><span className="block font-medium">{r.studentName}</span><span className="t-caption block text-ink-3">{r.invoiceNo}{r.receiptNo ? ` · ${r.receiptNo}` : ''}</span></>), mobile: 'title' },
          { id: 'amount', header: 'Amount', cell: (r) => <span className="font-medium">{money(r.amountMinor)}</span>, align: 'right', sortable: true, sortValue: (r) => r.amountMinor, mobile: 'value' },
          { id: 'reason', header: 'Reason', cell: (r) => <span className="block max-w-[34ch] truncate" title={r.reason}>{r.reason}</span>, mobile: 'sub' },
          { id: 'status', header: 'Status', cell: (r) => <RefundChip status={r.status} />, mobile: 'status' },
          { id: 'req', header: 'Requested', cell: (r) => (<><span className="block">{fmtDate(r.createdAt)}</span><span className="t-caption block text-ink-3">{r.requestedByName ?? ''}</span></>), sortable: true, sortValue: (r) => r.createdAt, mobile: 'detail', label: 'Requested' },
          { id: 'dec', header: 'Decided', cell: (r) => (r.decidedAt ? (<><span className="block">{fmtDate(r.decidedAt)}</span><span className="t-caption block text-ink-3">{r.decidedByName ?? ''}</span></>) : '—'), defaultHidden: true, mobile: 'hide' },
          {
            id: 'actions',
            header: <span className="sr-only">Decide</span>,
            label: 'Decide',
            hideable: false,
            align: 'right',
            mobile: 'hide',
            cell: (r) =>
              r.status === 'requested' ? (
                <div className="flex justify-end gap-1.5">
                  <GuardedButton blocked={block} size="sm" variant="secondary" onClick={() => setAct({ row: r, action: 'approve' })}>
                    <Check /> Approve
                  </GuardedButton>
                  <GuardedButton blocked={block} size="sm" variant="danger" onClick={() => setAct({ row: r, action: 'reject' })}>
                    <X /> Reject
                  </GuardedButton>
                </div>
              ) : r.status === 'approved' ? (
                <GuardedButton blocked={block} size="sm" variant="secondary" onClick={() => setAct({ row: r, action: 'process' })}>
                  <Cog /> Process
                </GuardedButton>
              ) : null,
          },
        ]}
      />
      <RefundDecisionDialog target={act} onClose={() => setAct(null)} />
    </div>
  );
}

/** Approve (and process), reject, or process a refund. The idempotency key is created once per open dialog so a retry replays. */
function RefundDecisionDialog({ target, onClose }: { target: { row: RefundOut; action: 'approve' | 'reject' | 'process' } | null; onClose: () => void }) {
  const { money } = useMgmt();
  const decide = useDecideRefund();
  const [note, setNote] = React.useState('');
  const [reference, setReference] = React.useState('');
  const [process, setProcess] = React.useState(true);
  const [err, setErr] = React.useState<string | null>(null);
  const [noteErr, setNoteErr] = React.useState<string | null>(null);
  const key = React.useRef<string>('');
  React.useEffect(() => {
    if (target) {
      setNote('');
      setReference('');
      setProcess(true);
      setErr(null);
      setNoteErr(null);
      key.current = crypto.randomUUID();
    }
  }, [target]);
  if (!target) return null;
  const { row, action } = target;
  const title = action === 'approve' ? 'Approve this refund?' : action === 'reject' ? 'Reject this refund?' : 'Process this refund?';
  const submit = async () => {
    if (action === 'reject' && note.trim().length < 3) {
      setNoteErr('Say why it is being rejected (at least 3 characters).');
      return;
    }
    setErr(null);
    try {
      await decide.mutateAsync({ id: row.id, action, note: note.trim() || undefined, reference: reference.trim() || undefined, process, idempotencyKey: key.current });
      toast.success(action === 'reject' ? 'Refund rejected' : action === 'approve' ? (process ? 'Refund approved and processed' : 'Refund approved') : 'Refund processed');
      onClose();
    } catch (e) {
      setErr(friendlyError(e));
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && !decide.isPending && onClose()}>
      <DialogContent title={title} description={`${row.studentName} · ${row.invoiceNo}${row.receiptNo ? ` · ${row.receiptNo}` : ''}`}>
        <div className="mt-4 space-y-4">
          <p className="rounded-md bg-surface-subtle p-3 text-sm text-ink-2">
            <span className="font-medium text-ink">{money(row.amountMinor)}</span> — “{row.reason}”.{' '}
            {action === 'reject'
              ? 'The request is closed and nothing is returned. The requester is told your reason.'
              : action === 'approve' && !process
                ? 'The request is approved but no money moves until you process it.'
                : 'Processing reduces the payment by this amount and raises the invoice balance by the same amount. An online payment is returned through the gateway first. This cannot be undone.'}
          </p>
          {action === 'approve' && (
            <div className="flex items-start gap-2.5">
              <Checkbox id="rf-process" checked={process} onCheckedChange={(v) => setProcess(v === true)} className="mt-0.5" />
              <label htmlFor="rf-process" className="text-sm">
                Process it now
                <span className="t-caption block text-ink-3">Untick to approve now and process later.</span>
              </label>
            </div>
          )}
          {(action === 'approve' && process) || action === 'process' ? (
            <Field label="Reference" htmlFor="rf-ref" hint="Cheque, bank or gateway reference for the money going back (optional).">
              <Input id="rf-ref" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} />
            </Field>
          ) : null}
          {action !== 'process' && (
            <Field label="Note" htmlFor="rf-note" required={action === 'reject'} error={noteErr} hint={action === 'reject' ? undefined : 'Optional.'}>
              <Textarea id="rf-note" rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} invalid={!!noteErr} />
            </Field>
          )}
          {err && <Banner tone="danger">{err}</Banner>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose} disabled={decide.isPending}>
              Cancel
            </Button>
            <Button variant={action === 'reject' ? 'danger-solid' : 'primary'} loading={decide.isPending} onClick={() => void submit()}>
              {action === 'reject' ? 'Reject refund' : action === 'approve' ? (process ? 'Approve and process' : 'Approve') : 'Process refund'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
