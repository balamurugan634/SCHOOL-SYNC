'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle } from 'lucide-react';
import type { InvoiceOut, PaymentOut } from '@school-sync/shared';
import { useFeeSummary, useLearnerInvoices, useLearnerPayments } from '@/lib/client/learner-fees';
import { fmtDate, fmtDateTime, money, plural } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Badge, StatusChip } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { Select } from '@/components/ui/select';
import { StatTile } from '@/components/ui/stat-tile';
import { useGates, useLearner } from '../use-learner';
import { usePageParam, useUrlParams } from '../url-state';
import { PayButton } from './pay-dialog';
import { ReceiptDialog } from './receipt-dialog';

const INVOICE_FILTERS = [
  { value: 'all', label: 'All invoices' },
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'partial', label: 'Part paid' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'paid', label: 'Paid' },
];
const PAYMENT_FILTERS = [
  { value: 'all', label: 'All payments' },
  { value: 'succeeded', label: 'Succeeded' },
  { value: 'pending', label: 'Pending' },
  { value: 'failed', label: 'Failed' },
  { value: 'refunded', label: 'Refunded' },
  { value: 'partially_refunded', label: 'Part refunded' },
];
const METHOD: Record<string, string> = { cash: 'Cash', cheque: 'Cheque', bank_transfer: 'Bank transfer', upi: 'UPI', card: 'Card', online: 'Online' };

/** Which child(ren) the money screens cover. Parents with several children may switch to "All children" (kept in the URL). */
export function useFeeScope() {
  const l = useLearner();
  const { get, set } = useUrlParams();
  const all = l.isParent && l.kids.length > 1 && get('child') === 'all';
  return {
    l,
    all,
    /** null = every linked child */
    studentId: all ? null : l.studentId,
    setAll: (v: boolean) => set({ child: v ? 'all' : null, page: null, ppage: null }),
    canChoose: l.isParent && l.kids.length > 1,
  };
}

export function ChildScopeSelect() {
  const { l, all, setAll, canChoose } = useFeeScope();
  if (!canChoose) return null;
  return (
    <Select
      aria-label="Which child"
      className="w-48"
      value={all ? 'all' : 'one'}
      onValueChange={(v) => setAll(v === 'all')}
      options={[
        { value: 'one', label: l.name },
        { value: 'all', label: 'All children' },
      ]}
    />
  );
}

// ───────────────────────────── summary tiles ─────────────────────────────

export function FeeSummaryTiles() {
  const { l, studentId } = useFeeScope();
  const { currency } = useGates();
  const q = useFeeSummary(studentId, l.isParent);
  const s = q.data;
  if (q.isError && !s) {
    return (
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-surface p-4 sm:col-span-3" role="alert">
          <p className="text-sm text-ink-2">We couldn’t add up the fees. <button type="button" className="font-medium text-brand-ink underline-offset-4 hover:underline" onClick={() => void q.refetch()}>Try again</button></p>
        </div>
      </div>
    );
  }
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <StatTile label="Due now" state={q.isPending ? 'loading' : 'ready'} value={s ? money(s.outstandingMinor, currency) : '—'} hint={s ? (s.openCount === 0 ? 'Nothing outstanding' : `${plural(s.openCount, 'open invoice')}, incl. late fees`) : undefined} />
      <StatTile label="Overdue" state={q.isPending ? 'loading' : 'ready'} value={s ? money(s.overdueMinor, currency) : '—'} hint={s ? (s.overdueCount > 0 ? `${plural(s.overdueCount, 'invoice')} past the due date` : 'Nothing overdue') : undefined} delta={s && s.overdueCount > 0 ? { value: 'Overdue', direction: 'down', good: false } : null} />
      <StatTile label="Next due date" state={q.isPending ? 'loading' : 'ready'} value={s?.next ? fmtDate(s.next.dueDate, { day: 'numeric', month: 'short' }) : '—'} hint={s ? (s.next ? `${money(s.next.amountDueNowMinor, currency)} · ${s.next.title}` : 'No upcoming dues') : undefined} />
    </div>
  );
}

// ───────────────────────────── invoices table ─────────────────────────────

export function InvoicesTable() {
  const router = useRouter();
  const { l, all, studentId } = useFeeScope();
  const { currency } = useGates();
  const { get, set } = useUrlParams();
  const [page, setPage] = usePageParam('page');
  const raw = get('status');
  const status = INVOICE_FILTERS.some((f) => f.value === raw && f.value !== 'all') ? (raw as string) : '';
  const [pageSize, setPageSize] = React.useState(10);
  const q = useLearnerInvoices(studentId, l.isParent, { page, pageSize, status });
  const detail = (id: string) => `${l.base}/fees/${id}`;
  const showChild = l.isParent && all;

  const columns: Column<InvoiceOut>[] = [
    {
      id: 'invoice',
      header: 'Invoice',
      cell: (r) => (
        <div className="min-w-0">
          <Link href={detail(r.id)} onClick={(e) => e.stopPropagation()} className="font-medium text-ink underline-offset-4 hover:underline">{r.invoiceNo}</Link>
          <p className="t-caption max-w-[34ch] truncate text-ink-2">{r.title}</p>
        </div>
      ),
      mobile: 'title',
    },
    ...(showChild ? [{ id: 'student', header: 'Child', cell: (r: InvoiceOut) => r.studentName, mobile: 'sub' as const }] : []),
    { id: 'due', header: 'Due', cell: (r) => <span className={cn(r.overdue && 'font-medium text-danger')}>{fmtDate(r.dueDate)}</span>, mobile: 'detail', label: 'Due date' },
    { id: 'total', header: 'Total', cell: (r) => money(r.totalMinor - r.discountMinor, currency), align: 'right', mobile: 'detail', label: 'Total' },
    { id: 'paid', header: 'Paid', cell: (r) => money(r.paidMinor, currency), align: 'right', mobile: 'detail', label: 'Paid', defaultHidden: false },
    {
      id: 'balance',
      header: 'Due now',
      cell: (r) => (
        <div className="text-right">
          <span className="font-medium">{money(r.amountDueNowMinor, currency)}</span>
          {r.lateFeeMinor > 0 && <p className="t-caption text-danger">incl. {money(r.lateFeeMinor, currency)} late fee</p>}
        </div>
      ),
      align: 'right',
      mobile: 'value',
    },
    {
      id: 'status',
      header: 'Status',
      cell: (r) => (
        <div className="flex flex-col items-start gap-0.5">
          <StatusChip status={r.overdue && r.status !== 'paid' && r.status !== 'void' ? 'overdue' : r.status} />
          {r.overdue && r.daysOverdue > 0 && <span className="t-caption text-ink-2">{plural(r.daysOverdue, 'day')} late</span>}
        </div>
      ),
      mobile: 'status',
    },
    { id: 'action', header: <span className="sr-only">Pay</span>, cell: (r) => <div onClick={(e) => e.stopPropagation()}><PayButton invoice={r} /></div>, align: 'right', hideable: false, mobile: 'hide' },
  ];

  return (
    <DataTable
      id="learner-invoices"
      caption="Fee invoices"
      rows={q.data?.data}
      rowKey={(r) => r.id}
      columns={columns}
      loading={q.isPending}
      error={q.isError && !q.data ? q.error : undefined}
      onRetry={() => void q.refetch()}
      page={page}
      pageSize={pageSize}
      total={q.data?.meta.total}
      onPageChange={setPage}
      onPageSizeChange={(n) => {
        setPageSize(n);
        setPage(1);
      }}
      onRowClick={(r) => router.push(detail(r.id))}
      filters={<Select aria-label="Filter invoices" className="w-44" value={status || 'all'} onValueChange={(v) => set({ status: v === 'all' ? null : v, page: null })} options={INVOICE_FILTERS} />}
      empty={
        status ? (
          <EmptyState illustration="no-results" title="No invoices match" filters={<Badge variant="outline">{INVOICE_FILTERS.find((f) => f.value === status)?.label}</Badge>} action={<Button variant="secondary" size="sm" onClick={() => set({ status: null, page: null })}>Clear filter</Button>} compact />
        ) : (
          <EmptyState illustration="empty-generic" title="No invoices yet" description="When the school issues fees for this academic year they’ll be listed here." compact />
        )
      }
    />
  );
}

// ───────────────────────────── payments table ─────────────────────────────

export function PaymentsTable() {
  const { l, studentId } = useFeeScope();
  const { currency } = useGates();
  const { get, set } = useUrlParams();
  const [page, setPage] = usePageParam('ppage');
  const raw = get('pstatus');
  const status = PAYMENT_FILTERS.some((f) => f.value === raw && f.value !== 'all') ? (raw as string) : '';
  const [pageSize, setPageSize] = React.useState(10);
  const q = useLearnerPayments(studentId, l.isParent, { page, pageSize, status });
  const [receipt, setReceipt] = React.useState<string | null>(null);

  const columns: Column<PaymentOut>[] = [
    {
      id: 'receipt',
      header: 'Receipt',
      cell: (r) => (r.receiptNo ? <span className="font-medium">{r.receiptNo}</span> : <span className="text-ink-3">Not issued</span>),
      mobile: 'title',
    },
    { id: 'invoice', header: 'Invoice', cell: (r) => <Link href={`${l.base}/fees/${r.invoiceId}`} className="underline-offset-4 hover:underline">{r.invoiceNo}</Link>, mobile: 'sub' },
    { id: 'student', header: 'Child', cell: (r) => r.studentName, mobile: 'detail', label: 'Child', defaultHidden: !(l.isParent && l.kids.length > 1) },
    { id: 'method', header: 'Method', cell: (r) => <span>{METHOD[r.method] ?? r.method}{r.reference ? <span className="t-caption block text-ink-2">{r.reference}</span> : null}</span>, mobile: 'detail', label: 'Method' },
    { id: 'date', header: 'Date', cell: (r) => fmtDateTime(r.paidAt ?? r.createdAt), mobile: 'detail', label: 'Date' },
    { id: 'amount', header: 'Amount', cell: (r) => <span className="font-medium">{money(r.amountMinor, currency)}{r.refundedMinor > 0 && <span className="t-caption block font-normal text-ink-2">{money(r.refundedMinor, currency)} refunded</span>}</span>, align: 'right', mobile: 'value' },
    { id: 'status', header: 'Status', cell: (r) => <StatusChip status={r.status} />, mobile: 'status' },
    {
      id: 'action',
      header: <span className="sr-only">Receipt</span>,
      cell: (r) => (r.receiptNo ? <Button variant="ghost" size="sm" onClick={() => setReceipt(r.id)} aria-label={`View receipt ${r.receiptNo}`}>Receipt</Button> : null),
      align: 'right',
      hideable: false,
      mobile: 'hide',
    },
  ];

  return (
    <>
      <DataTable
        id="learner-payments"
        caption="Payment history"
        rows={q.data?.data}
        rowKey={(r) => r.id}
        columns={columns}
        loading={q.isPending}
        error={q.isError && !q.data ? q.error : undefined}
        onRetry={() => void q.refetch()}
        page={page}
        pageSize={pageSize}
        total={q.data?.meta.total}
        onPageChange={setPage}
        onPageSizeChange={(n) => {
          setPageSize(n);
          setPage(1);
        }}
        onRowClick={(r) => r.receiptNo && setReceipt(r.id)}
        filters={<Select aria-label="Filter payments" className="w-48" value={status || 'all'} onValueChange={(v) => set({ pstatus: v === 'all' ? null : v, ppage: null })} options={PAYMENT_FILTERS} />}
        empty={
          status ? (
            <EmptyState illustration="no-results" title="No payments match" filters={<Badge variant="outline">{PAYMENT_FILTERS.find((f) => f.value === status)?.label}</Badge>} action={<Button variant="secondary" size="sm" onClick={() => set({ pstatus: null, ppage: null })}>Clear filter</Button>} compact />
          ) : (
            <EmptyState illustration="empty-generic" title="No payments yet" description="Payments recorded by the school or made online will be listed here with their receipts." compact />
          )
        }
      />
      <ReceiptDialog paymentId={receipt} onClose={() => setReceipt(null)} />
    </>
  );
}

/** Small warning used in the list header when something is overdue. */
export function OverdueHint({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <p className="t-caption flex items-center gap-1.5 text-danger">
      <AlertTriangle className="size-3.5" aria-hidden /> {plural(count, 'invoice')} overdue — late fees apply per day.
    </p>
  );
}
