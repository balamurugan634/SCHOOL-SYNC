'use client';

import * as React from 'react';
import Link from 'next/link';
import { FileText, Plus, Printer, Undo2 } from 'lucide-react';
import { PAYMENT_METHODS, PAYMENT_STATUSES, refundCreateBody, type PaymentOut, type ReceiptOut } from '@school-sync/shared';
import { usePayments, useReceipt, useRequestRefund } from '@/lib/client/finance';
import { amountText, friendlyError, parseMinor, useGetQuery } from '@/lib/client/mgmt';
import { useUrlState } from '@/lib/client/use-url-state';
import { fmtDate, fmtDateTime, money as fmtMoney } from '@/lib/format';
import { PageHeader } from '@/components/shell/page-header';
import { StatusChip } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Dialog, DialogContent, Drawer, DrawerContent, SheetBody, SheetFooter } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toaster';
import { ExportButton } from '../common/exports';
import { ClearFilters, FilterBar, FilterChips, FilterDate, FilterSelect, SearchBox } from '../common/filters';
import { GuardedButton } from '../common/guarded';
import { esc, printHtml } from '../common/print';
import { ErrorPanel } from '../common/states';
import { useListState, useTabParam } from '../common/url-state';
import { useMgmt } from '../common/use-mgmt';
import { OnlineTab } from './online-tab';
import { RecordPaymentLauncher } from './record-payment-launcher';
import { RefundsTab } from './refunds-tab';

export const METHOD_LABEL: Record<string, string> = { cash: 'Cash', cheque: 'Cheque', bank_transfer: 'Bank transfer', upi: 'UPI', card: 'Card', online: 'Online' };
const PSTATUS_LABEL: Record<string, string> = { pending: 'Pending', succeeded: 'Succeeded', failed: 'Failed', refunded: 'Refunded', partially_refunded: 'Part refunded' };

export function PaymentsPage() {
  const { base, can } = useMgmt();
  const tabs = [
    { value: 'payments', label: 'Payments' },
    { value: 'refunds', label: 'Refunds' },
    { value: 'online', label: 'Online payments' },
  ];
  const [tab, setTab] = useTabParam(tabs.map((t) => t.value));
  return (
    <>
      <PageHeader title="Payments and receipts" description="Everything collected, with receipts, refunds and online payment status." crumbs={[{ label: 'Finance', href: `${base}/finance` }, { label: 'Payments' }]} />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label="Payments sections">
          {tabs.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="payments">
          <PaymentsTab />
        </TabsContent>
        <TabsContent value="refunds">
          <RefundsTab />
        </TabsContent>
        <TabsContent value="online">
          <OnlineTab />
        </TabsContent>
      </Tabs>
      {!can('payments:create', 'school') && <p className="t-caption mt-6 text-ink-3">Your role can view payments and receipts. Recording payments and refunds is done by the accounts team.</p>}
    </>
  );
}

function PaymentsTab() {
  const { writeBlock, money } = useMgmt();
  const ls = useListState({ pageSize: 25 });
  const url = useUrlState();
  const method = ls.get('method');
  const status = ls.get('pstatus');
  const from = ls.get('from');
  const to = ls.get('to');
  const openId = ls.get('payment') || null;
  const query = { page: ls.page, pageSize: ls.pageSize, q: ls.q || undefined, method: method || undefined, status: status || undefined, from: from || undefined, to: to || undefined };
  const q = usePayments(query);
  const [recording, setRecording] = React.useState(false);
  const filtered = ls.hasFilters(['method', 'pstatus', 'from', 'to']);
  const clear = () => ls.clear();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[62ch] text-sm text-ink-2">Open a payment for its receipt, a PDF to print, or to request a refund.</p>
        <div className="flex flex-wrap gap-2">
          <ExportButton path="/payments/export" query={{ q: query.q, method: query.method, status: query.status, from: query.from, to: query.to }} filename="payments.csv" perm="payments:export" />
          <GuardedButton blocked={writeBlock('payments:create', 'school')} onClick={() => setRecording(true)}>
            <Plus /> Record payment
          </GuardedButton>
        </div>
      </div>
      <DataTable<PaymentOut>
        id="fees-payments"
        rows={q.data?.data}
        rowKey={(r) => r.id}
        loading={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
        caption="Payments"
        page={ls.page}
        pageSize={ls.pageSize}
        total={q.data?.meta.total}
        onPageChange={ls.setPage}
        onPageSizeChange={ls.setPageSize}
        onRowClick={(r) => url.set({ payment: r.id }, { resetPage: false })}
        activeRowKey={openId}
        filters={
          <FilterBar>
            <SearchBox value={ls.qInput} onChange={ls.setQInput} placeholder="Receipt, invoice or student" />
            <FilterSelect label="Method" value={method} onChange={(v) => ls.set({ method: v })} options={PAYMENT_METHODS.map((m) => ({ value: m, label: METHOD_LABEL[m] ?? m }))} />
            <FilterSelect label="Status" value={status} onChange={(v) => ls.set({ pstatus: v })} options={PAYMENT_STATUSES.map((s) => ({ value: s, label: PSTATUS_LABEL[s] ?? s }))} />
            <FilterDate label="Paid from" value={from} onChange={(v) => ls.set({ from: v })} max={to || undefined} />
            <FilterDate label="Paid to" value={to} onChange={(v) => ls.set({ to: v })} min={from || undefined} />
          </FilterBar>
        }
        empty={
          filtered ? (
            <EmptyState
              illustration="no-results"
              title="No payments match"
              filters={<FilterChips chips={[...(ls.q ? [{ label: 'Search', value: ls.q }] : []), ...(method ? [{ label: 'Method', value: METHOD_LABEL[method] ?? method }] : []), ...(status ? [{ label: 'Status', value: PSTATUS_LABEL[status] ?? status }] : []), ...(from ? [{ label: 'From', value: fmtDate(from) }] : []), ...(to ? [{ label: 'To', value: fmtDate(to) }] : [])]} />}
              action={<ClearFilters onClear={clear} />}
            />
          ) : (
            <EmptyState illustration="empty-generic" title="No payments recorded yet" description="Payments appear here once fees are collected." action={<GuardedButton blocked={writeBlock('payments:create', 'school')} onClick={() => setRecording(true)}>Record payment</GuardedButton>} />
          )
        }
        columns={[
          { id: 'receipt', header: 'Receipt', cell: (r) => <span className="tnum font-medium">{r.receiptNo ?? '—'}</span>, sortable: true, sortValue: (r) => r.receiptNo ?? '', mobile: 'title' },
          { id: 'student', header: 'Student', cell: (r) => (<><span className="block">{r.studentName}</span><span className="t-caption block text-ink-3">{r.invoiceNo}</span></>), sortable: true, sortValue: (r) => r.studentName, mobile: 'sub' },
          { id: 'method', header: 'Method', cell: (r) => METHOD_LABEL[r.method] ?? r.method, mobile: 'detail', label: 'Method' },
          { id: 'amount', header: 'Amount', cell: (r) => (<><span className="block font-medium">{money(r.amountMinor)}</span>{r.refundedMinor > 0 && <span className="t-caption block text-ink-3">{money(r.refundedMinor)} refunded</span>}</>), align: 'right', sortable: true, sortValue: (r) => r.amountMinor, mobile: 'value' },
          { id: 'status', header: 'Status', cell: (r) => <StatusChip status={r.status} />, mobile: 'status' },
          { id: 'paid', header: 'Paid on', cell: (r) => (r.paidAt ? fmtDateTime(r.paidAt) : '—'), sortable: true, sortValue: (r) => r.paidAt ?? '', mobile: 'detail', label: 'Paid on' },
          { id: 'by', header: 'Received by', cell: (r) => r.receivedByName ?? (r.gateway ? `Gateway (${r.gateway})` : '—'), defaultHidden: true, mobile: 'hide' },
        ]}
      />
      <PaymentDrawer id={openId} onClose={() => url.set({ payment: null }, { resetPage: false })} />
      <RecordPaymentLauncher open={recording} onClose={() => setRecording(false)} />
    </div>
  );
}

// ── payment / receipt drawer ────────────────────────────────────────────────────────────────

function printReceipt(r: ReceiptOut) {
  const m = (n: number) => esc(fmtMoney(n, r.currency));
  printHtml(
    `Receipt ${r.receiptNo}`,
    `<div class="row"><div><h1>${esc(r.school.name)}</h1><p class="muted">${esc(r.school.address)}</p><p class="muted">${esc([r.school.phone, r.school.email].filter(Boolean).join(' · '))}</p></div><div style="text-align:right"><p><strong>Receipt ${esc(r.receiptNo)}</strong></p><p class="muted">${esc(fmtDateTime(r.paidAt))}</p></div></div>
     <div class="box"><p><strong>${esc(r.student.name)}</strong></p><p class="muted">${esc(r.student.admissionNo)}${r.student.grade ? ` · ${esc(r.student.grade)}${r.student.section ? ` ${esc(r.student.section)}` : ''}` : ''}</p></div>
     <h2>${esc(r.invoice.invoiceNo)} · ${esc(r.invoice.title)}</h2>
     <table><thead><tr><th>Item</th><th class="r">Amount</th><th class="r">Discount</th></tr></thead><tbody>${r.items.map((i) => `<tr><td>${esc(i.description)}</td><td class="r">${m(i.amountMinor)}</td><td class="r">${i.discountMinor ? m(i.discountMinor) : ''}</td></tr>`).join('')}</tbody></table>
     <div class="box"><div class="row"><span><strong>Amount received</strong></span><strong>${m(r.payment.amountMinor)}</strong></div><div class="row"><span>Method</span><span>${esc(METHOD_LABEL[r.payment.method] ?? r.payment.method)}${r.payment.reference ? ` · ${esc(r.payment.reference)}` : ''}</span></div>${r.payment.refundedMinor ? `<div class="row"><span>Refunded</span><span>${m(r.payment.refundedMinor)}</span></div>` : ''}<div class="row"><span>Invoice balance after this payment</span><span>${m(r.invoice.balanceMinor)}</span></div></div>
     ${r.receivedBy ? `<p class="muted" style="margin-top:12px">Received by ${esc(r.receivedBy)}</p>` : ''}`,
  );
}

function PaymentDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { base, money, writeBlock } = useMgmt();
  const pay = useGetQuery<PaymentOut>(['payments', 'one', id], id ? `/payments/${id}` : null, undefined, { staleTime: 10_000 });
  const p = pay.data;
  const hasReceipt = !!p && !!p.receiptNo && p.status !== 'pending' && p.status !== 'failed';
  const rc = useReceipt(hasReceipt ? id : null);
  const [refunding, setRefunding] = React.useState(false);
  const refundable = p ? p.amountMinor - p.refundedMinor : 0;
  const canRefund = !!p && (p.status === 'succeeded' || p.status === 'partially_refunded') && refundable > 0;

  return (
    <>
      <Drawer open={!!id} onOpenChange={(o) => !o && onClose()}>
        <DrawerContent title={p?.receiptNo ? `Receipt ${p.receiptNo}` : 'Payment'} description={p ? `${p.studentName} · ${p.invoiceNo}` : undefined} showTitle>
          {pay.isPending ? (
            <SheetBody aria-busy>
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-40 w-full" />
            </SheetBody>
          ) : pay.isError || !p ? (
            <ErrorPanel error={pay.error} onRetry={() => void pay.refetch()} title="We couldn’t load this payment" />
          ) : (
            <>
              <SheetBody>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="figure text-[28px] leading-9">{money(p.amountMinor)}</p>
                    <p className="t-caption text-ink-2">
                      {METHOD_LABEL[p.method] ?? p.method}
                      {p.reference ? ` · ${p.reference}` : ''}
                    </p>
                  </div>
                  <StatusChip status={p.status} />
                </div>
                {p.refundedMinor > 0 && <Banner tone="info">{money(p.refundedMinor)} of this payment has been refunded.</Banner>}
                {p.status === 'pending' && <Banner tone="warning">This online payment is still waiting for the gateway to confirm. It is not counted as paid yet.</Banner>}
                {p.status === 'failed' && <Banner tone="danger">The payment failed at the gateway, so nothing was collected.</Banner>}
                <dl className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-lg border border-border p-4 text-sm">
                  <Info label="Student" value={p.studentName} />
                  <Info label="Invoice" value={<Link className="font-medium text-brand-ink underline-offset-4 hover:underline" href={`${base}/finance/invoices?invoice=${p.invoiceId}`}>{p.invoiceNo}</Link>} />
                  <Info label="Paid on" value={p.paidAt ? fmtDateTime(p.paidAt) : '—'} />
                  <Info label="Received by" value={p.receivedByName ?? (p.gateway ? `Gateway (${p.gateway})` : '—')} />
                </dl>
                {p.notes && <p className="rounded-md bg-surface-subtle p-3 text-sm text-ink-2">{p.notes}</p>}

                {hasReceipt && (
                  <section aria-labelledby="rc-h">
                    <h3 id="rc-h" className="t-section mb-2">
                      Receipt
                    </h3>
                    {rc.isPending ? (
                      <Skeleton className="h-40 w-full" />
                    ) : rc.isError || !rc.data ? (
                      <ErrorPanel error={rc.error} onRetry={() => void rc.refetch()} title="We couldn’t load the receipt" />
                    ) : (
                      <ReceiptCard r={rc.data} />
                    )}
                  </section>
                )}
              </SheetBody>
              <SheetFooter>
                <Button variant="secondary" onClick={onClose}>
                  Close
                </Button>
                {hasReceipt && (
                  <>
                    <Button asChild variant="secondary">
                      <a href={`/api/bff/payments/${p.id}/receipt/pdf`} target="_blank" rel="noreferrer">
                        <FileText /> PDF
                      </a>
                    </Button>
                    <Button variant="secondary" disabled={!rc.data} onClick={() => rc.data && printReceipt(rc.data)}>
                      <Printer /> Print
                    </Button>
                  </>
                )}
                {canRefund && (
                  <GuardedButton blocked={writeBlock('payments:create', 'school')} variant="danger" onClick={() => setRefunding(true)}>
                    <Undo2 /> Request refund
                  </GuardedButton>
                )}
              </SheetFooter>
            </>
          )}
        </DrawerContent>
      </Drawer>
      {p && <RefundRequestDialog payment={p} open={refunding} onClose={() => setRefunding(false)} />}
    </>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="t-caption text-ink-2">{label}</dt>
      <dd className="mt-0.5 truncate">{value}</dd>
    </div>
  );
}

function ReceiptCard({ r }: { r: ReceiptOut }) {
  const m = (n: number) => fmtMoney(n, r.currency);
  return (
    <div className="rounded-lg border border-border bg-surface p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{r.school.name}</p>
          <p className="t-caption text-ink-2">{r.school.address}</p>
        </div>
        <div className="text-right">
          <p className="tnum font-medium">{r.receiptNo}</p>
          <p className="t-caption text-ink-2">{fmtDateTime(r.paidAt)}</p>
        </div>
      </div>
      <p className="mt-3 font-medium">{r.student.name}</p>
      <p className="t-caption text-ink-2">
        {r.student.admissionNo}
        {r.student.grade ? ` · ${r.student.grade}${r.student.section ? ` ${r.student.section}` : ''}` : ''}
      </p>
      <p className="t-caption mt-3 text-ink-2">
        {r.invoice.invoiceNo} · {r.invoice.title}
      </p>
      <ul className="mt-1 divide-y divide-border">
        {r.items.map((i) => (
          <li key={i.id} className="flex justify-between gap-3 py-1.5">
            <span>{i.description}</span>
            <span className="tnum">{m(i.amountMinor)}</span>
          </li>
        ))}
      </ul>
      <dl className="mt-3 space-y-1 border-t border-border pt-3">
        <div className="flex justify-between">
          <dt className="font-medium">Amount received</dt>
          <dd className="tnum font-medium">{m(r.payment.amountMinor)}</dd>
        </div>
        <div className="flex justify-between text-ink-2">
          <dt>Invoice balance after this payment</dt>
          <dd className="tnum">{m(r.invoice.balanceMinor)}</dd>
        </div>
      </dl>
    </div>
  );
}

// ── refund request ──────────────────────────────────────────────────────────────────────────

function RefundRequestDialog({ payment, open, onClose }: { payment: PaymentOut; open: boolean; onClose: () => void }) {
  const { money, can } = useMgmt();
  const request = useRequestRefund();
  const max = payment.amountMinor - payment.refundedMinor;
  const [amount, setAmount] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [errs, setErrs] = React.useState<{ amount?: string; reason?: string }>({});
  const [formErr, setFormErr] = React.useState<string | null>(null);
  const attempt = React.useRef<{ key: string; sig: string } | null>(null);
  React.useEffect(() => {
    if (open) {
      setAmount((max / 100).toFixed(2));
      setReason('');
      setErrs({});
      setFormErr(null);
      attempt.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, payment.id]);

  const submit = async () => {
    const e: typeof errs = {};
    const parsed = amountText('the amount to refund').safeParse(amount);
    const minor = parsed.success ? parseMinor(amount) : null;
    if (!parsed.success) e.amount = parsed.error.issues[0]?.message;
    else if (minor! > max) e.amount = `That is more than can be refunded (${money(max)})`;
    if (reason.trim().length < 3) e.reason = 'Give a reason (at least 3 characters)';
    setErrs(e);
    if (e.amount || e.reason || minor === null) return;
    setFormErr(null);
    const body = refundCreateBody.parse({ amountMinor: minor, reason: reason.trim() });
    const sig = JSON.stringify(body);
    if (!attempt.current || attempt.current.sig !== sig) attempt.current = { key: crypto.randomUUID(), sig };
    try {
      await request.mutateAsync({ paymentId: payment.id, body, idempotencyKey: attempt.current.key });
      toast.success('Refund requested', { description: can('payments:approve', 'school') ? 'Approve it from the Refunds tab.' : 'It now waits for approval.' });
      attempt.current = null;
      onClose();
    } catch (err) {
      setFormErr(friendlyError(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Request a refund" description={`${payment.receiptNo ?? 'Payment'} · ${payment.studentName} · up to ${money(max)}`}>
        <div className="mt-4 space-y-4">
          <Field label="Amount to refund" htmlFor="rf-amount" required error={errs.amount} hint="A full or partial refund.">
            <Input id="rf-amount" inputMode="decimal" autoComplete="off" value={amount} onChange={(ev) => setAmount(ev.target.value)} invalid={!!errs.amount} />
          </Field>
          <Field label="Reason" htmlFor="rf-reason" required error={errs.reason}>
            <Textarea id="rf-reason" rows={3} maxLength={300} value={reason} onChange={(ev) => setReason(ev.target.value)} invalid={!!errs.reason} />
          </Field>
          <p className="rounded-md bg-surface-subtle p-3 text-sm text-ink-2">The request goes to the approval queue. Nothing is returned, and the invoice does not change, until someone with approval rights approves and processes it.</p>
          {formErr && <Banner tone="danger">{formErr}</Banner>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button loading={request.isPending} onClick={() => void submit()}>
              Send refund request
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
