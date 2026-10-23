'use client';

import * as React from 'react';
import { Receipt } from 'lucide-react';
import { useLearnerInvoice } from '@/lib/client/learner-fees';
import { fmtDate, fmtDateTime, money, plural } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { StatusChip } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/shell/page-header';
import { ErrorState } from '../states';
import { useGates, useLearner } from '../use-learner';
import { OnlinePayNote, PayButton } from './pay-dialog';
import { ReceiptDialog } from './receipt-dialog';

const METHOD: Record<string, string> = { cash: 'Cash', cheque: 'Cheque', bank_transfer: 'Bank transfer', upi: 'UPI', card: 'Card', online: 'Online' };

/** One invoice: figures, items, payments with receipts, refunds — and the Pay action for parents. */
export function InvoiceDetail({ id }: { id: string }) {
  const l = useLearner();
  const { currency } = useGates();
  const q = useLearnerInvoice(id);
  const [receipt, setReceipt] = React.useState<string | null>(null);
  const crumbs = [{ label: 'Home', href: l.base || '/' }, { label: 'Fees', href: `${l.base}/fees` }, { label: q.data?.invoiceNo ?? 'Invoice' }];

  if (q.isPending) {
    return (
      <>
        <PageHeader title="Invoice" crumbs={crumbs} />
        <div className="space-y-6" aria-busy="true">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-56 w-full" />
        </div>
      </>
    );
  }
  if (q.isError || !q.data) {
    return (
      <>
        <PageHeader title="Invoice" crumbs={crumbs} />
        <Card>
          <ErrorState error={q.error} onRetry={() => void q.refetch()} title="We couldn’t load this invoice" />
        </Card>
      </>
    );
  }
  const inv = q.data;
  const open = (inv.status === 'unpaid' || inv.status === 'partial') && inv.amountDueNowMinor > 0;
  const shownStatus = inv.overdue && inv.status !== 'paid' && inv.status !== 'void' ? 'overdue' : inv.status;

  return (
    <>
      <PageHeader title={inv.invoiceNo} description={inv.title} crumbs={crumbs} actions={<PayButton invoice={inv} size="md" />} />
      <div className="space-y-6">
        {inv.status === 'void' && <Banner tone="warning" title="This invoice was cancelled by the school">{inv.voidReason ?? 'No payment is needed.'}</Banner>}
        {open && l.isParent && <OnlinePayNote show />}
        {open && !l.isParent && <Banner tone="info">Fees are paid by your parent or guardian. You can follow the balance and receipts here.</Banner>}

        <Card>
          <CardBody className="grid gap-5 sm:grid-cols-[1fr_auto] sm:items-end">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
              <div><dt className="t-caption text-ink-2">Student</dt><dd className="text-sm font-medium">{inv.studentName}</dd><dd className="t-caption text-ink-2">{[inv.gradeName, inv.sectionName].filter(Boolean).join(' · ')}</dd></div>
              <div><dt className="t-caption text-ink-2">Status</dt><dd className="mt-0.5"><StatusChip status={shownStatus} /></dd></div>
              <div><dt className="t-caption text-ink-2">Due date</dt><dd className={cn('text-sm font-medium', inv.overdue && 'text-danger')}>{fmtDate(inv.dueDate)}</dd>{inv.overdue && <dd className="t-caption text-danger">{plural(inv.daysOverdue, 'day')} overdue</dd>}</div>
              <div><dt className="t-caption text-ink-2">Issued</dt><dd className="text-sm font-medium">{fmtDate(inv.issuedAt.slice(0, 10))}</dd></div>
            </dl>
            <div className="sm:text-right">
              <p className="t-caption text-ink-2">{open ? 'Due now' : 'Balance'}</p>
              <p className={cn('figure text-[36px] leading-10', inv.overdue && open && 'text-danger')}>{money(open ? inv.amountDueNowMinor : inv.balanceMinor, currency)}</p>
            </div>
          </CardBody>
          <dl className="grid grid-cols-2 gap-px border-t border-border bg-border text-sm sm:grid-cols-4">
            {[
              ['Total', money(inv.totalMinor, currency)],
              ['Discount', inv.discountMinor > 0 ? `− ${money(inv.discountMinor, currency)}` : money(0, currency)],
              ['Paid', money(inv.paidMinor, currency)],
              ['Late fee', money(inv.lateFeeMinor, currency)],
            ].map(([k, v]) => (
              <div key={k} className="bg-surface px-5 py-3 max-sm:px-4">
                <dt className="t-caption text-ink-2">{k}</dt>
                <dd className="tnum font-medium">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader title="What this invoice covers" className="pb-3" />
          <div className="overflow-x-auto border-t border-border">
            <table className="t-table w-full min-w-[420px]">
              <caption className="sr-only">Invoice items</caption>
              <thead>
                <tr className="text-left text-ink-2">
                  <th scope="col" className="t-colhead h-9 bg-surface-subtle px-5 max-sm:px-4">Item</th>
                  <th scope="col" className="t-colhead h-9 bg-surface-subtle px-3 text-right">Amount</th>
                  <th scope="col" className="t-colhead h-9 bg-surface-subtle px-3 text-right">Discount</th>
                  <th scope="col" className="t-colhead h-9 bg-surface-subtle px-5 text-right max-sm:px-4">Net</th>
                </tr>
              </thead>
              <tbody>
                {inv.items.map((it) => (
                  <tr key={it.id} className="border-t border-border">
                    <td className="h-11 px-5 max-sm:px-4"><span className="font-medium">{it.description}</span>{it.categoryName && <span className="t-caption block text-ink-2">{it.categoryName}</span>}</td>
                    <td className="tnum px-3 text-right">{money(it.amountMinor, currency)}</td>
                    <td className="tnum px-3 text-right">{it.discountMinor > 0 ? `− ${money(it.discountMinor, currency)}` : '—'}</td>
                    <td className="tnum px-5 text-right font-medium max-sm:px-4">{money(it.amountMinor - it.discountMinor, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader title="Payments" description={inv.payments.length === 0 ? undefined : `${plural(inv.payments.length, 'payment')} on this invoice`} className="pb-3" />
          {inv.payments.length === 0 ? (
            <p className="border-t border-border px-5 py-5 text-sm text-ink-2 max-sm:px-4">No payment has been recorded for this invoice yet.</p>
          ) : (
            <ul className="divide-y divide-border border-t border-border">
              {inv.payments.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 max-sm:px-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{money(p.amountMinor, currency)} <span className="font-normal text-ink-2">· {METHOD[p.method] ?? p.method}{p.reference ? ` · ${p.reference}` : ''}</span></p>
                    <p className="t-caption text-ink-2">{p.paidAt ? fmtDateTime(p.paidAt) : `Started ${fmtDateTime(p.createdAt)}`}{p.receiptNo ? ` · ${p.receiptNo}` : ''}{p.refundedMinor > 0 ? ` · ${money(p.refundedMinor, currency)} refunded` : ''}</p>
                  </div>
                  <StatusChip status={p.status} />
                  {p.receiptNo && <Button variant="secondary" size="sm" onClick={() => setReceipt(p.id)}><Receipt /> Receipt</Button>}
                </li>
              ))}
            </ul>
          )}
        </Card>

        {inv.refunds.length > 0 && (
          <Card className="overflow-hidden">
            <CardHeader title="Refunds" className="pb-3" />
            <ul className="divide-y divide-border border-t border-border">
              {inv.refunds.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 max-sm:px-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{money(r.amountMinor, currency)} <span className="font-normal text-ink-2">· {r.reason}</span></p>
                    <p className="t-caption text-ink-2">Requested {fmtDateTime(r.createdAt)}{r.processedAt ? ` · processed ${fmtDateTime(r.processedAt)}` : ''}</p>
                  </div>
                  <StatusChip status={r.status === 'processed' ? 'completed' : r.status} label={r.status === 'processed' ? 'Refunded' : undefined} />
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
      <ReceiptDialog paymentId={receipt} onClose={() => setReceipt(null)} />
    </>
  );
}
