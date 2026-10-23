'use client';

import * as React from 'react';
import { FileText, ReceiptText } from 'lucide-react';
import Link from 'next/link';
import type { InvoiceDetailOut } from '@school-sync/shared';
import { useInvoice } from '@/lib/client/hooks';
import { errorMessage } from '@/lib/problem';
import { fmtDate, money } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Banner } from '../ui/banner';
import { Button } from '../ui/button';
import { Drawer, DrawerContent, SheetBody, SheetFooter } from '../ui/dialog';
import { EmptyState } from '../ui/empty-state';
import { Skeleton } from '../ui/skeleton';
import { StatusChip } from '../ui/badge';
import { Timeline, type TimelineItem } from '../ui/timeline';
import { useMeContext, usePermissions } from '../me-context';
import { RecordPaymentDialog } from './record-payment-dialog';
import { InvoiceConcessions, PrintInvoiceButton, VoidInvoiceButton } from '../features/management/finance/invoice-extras';

const METHOD: Record<string, string> = { cash: 'Cash', cheque: 'Cheque', bank_transfer: 'Bank transfer', upi: 'UPI', card: 'Card', online: 'Online' };
const isOverdue = (i: Pick<InvoiceDetailOut, 'overdue' | 'status'>) => i.overdue && (i.status === 'unpaid' || i.status === 'partial');

/** Invoice detail: figures, items, and the payment / refund history. "Record payment" for finance users. */
export function InvoiceDrawer({ invoiceId, onClose }: { invoiceId: string | null; onClose: () => void }) {
  const q = useInvoice(invoiceId);
  const [paying, setPaying] = React.useState(false);
  // the id is already cleared from the URL by the time the drawer reports it closed — remember the row to refocus
  const lastId = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (invoiceId) lastId.current = invoiceId;
  }, [invoiceId]);
  const { can } = usePermissions();
  const { base } = useMeContext();
  const inv = q.data;
  const canPay = !!inv && can('payments:create') && (inv.status === 'unpaid' || inv.status === 'partial') && inv.amountDueNowMinor > 0;

  return (
    <>
      <Drawer open={!!invoiceId} onOpenChange={(o) => !o && onClose()}>
        <DrawerContent
          title={inv ? `Invoice ${inv.invoiceNo}` : 'Invoice'}
          description={inv?.title}
          showTitle
          onCloseAutoFocus={(e) => {
            // no trigger element: hand focus back to the table row that opened the drawer
            e.preventDefault();
            if (lastId.current) document.querySelector<HTMLElement>(`[data-row-key="${lastId.current}"]`)?.focus();
          }}
        >
          {q.isPending ? (
            <SheetBody aria-busy>
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-32 w-full" />
            </SheetBody>
          ) : q.isError || !inv ? (
            <EmptyState illustration="error-offline" title="We couldn’t load this invoice" description={errorMessage(q.error)} action={<Button variant="secondary" onClick={() => void q.refetch()}>Try again</Button>} />
          ) : (
            <>
              <SheetBody>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{inv.studentName}</p>
                    <p className="t-caption text-ink-2">
                      {inv.admissionNo} · {[inv.gradeName, inv.sectionName].filter(Boolean).join(' ')}
                    </p>
                  </div>
                  <StatusChip status={isOverdue(inv) ? 'overdue' : inv.status} />
                </div>

                {isOverdue(inv) && (
                  <Banner tone="warning">
                    {inv.daysOverdue} day{inv.daysOverdue === 1 ? '' : 's'} overdue{inv.lateFeeMinor > 0 ? ` — a late fee of ${money(inv.lateFeeMinor)} applies` : ''}.
                  </Banner>
                )}

                <dl className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-lg border border-border p-4">
                  <Figure label="Total" value={money(inv.totalMinor)} />
                  <Figure label="Discount" value={money(inv.discountMinor)} />
                  <Figure label="Paid" value={money(inv.paidMinor)} />
                  <Figure label="Balance" value={money(inv.balanceMinor)} strong />
                  {inv.lateFeeMinor > 0 && <Figure label="Late fee" value={money(inv.lateFeeMinor)} />}
                  <Figure label="Due now" value={money(inv.amountDueNowMinor)} strong={inv.amountDueNowMinor > 0} />
                  <Figure label="Due date" value={fmtDate(inv.dueDate)} />
                  <Figure label="Issued" value={fmtDate(inv.issuedAt)} />
                </dl>

                <section aria-labelledby="inv-items">
                  <h3 id="inv-items" className="t-section mb-2">
                    Items
                  </h3>
                  <ul className="divide-y divide-border rounded-lg border border-border">
                    {inv.items.map((it) => (
                      <li key={it.id} className="flex items-start justify-between gap-3 px-3 py-2.5">
                        <div className="min-w-0">
                          <p className="text-sm">{it.description}</p>
                          {it.categoryName && <p className="t-caption text-ink-3">{it.categoryName}</p>}
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="tnum text-sm">{money(it.amountMinor)}</p>
                          {it.discountMinor > 0 && <p className="t-caption tnum text-success">− {money(it.discountMinor)}</p>}
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>

                <section aria-labelledby="inv-pay">
                  <h3 id="inv-pay" className="t-section mb-3">
                    Payments
                  </h3>
                  {inv.payments.length === 0 && inv.refunds.length === 0 ? (
                    <p className="text-sm text-ink-2">No payments have been recorded for this invoice.</p>
                  ) : (
                    <Timeline items={history(inv)} />
                  )}
                  {inv.payments.some((p) => p.receiptNo) && (
                    <ul className="mt-3 flex flex-wrap gap-2">
                      {inv.payments
                        .filter((p) => p.receiptNo && (p.status === 'succeeded' || p.status === 'partially_refunded'))
                        .map((p) => (
                          <li key={p.id}>
                            <Button asChild variant="secondary" size="sm">
                              <a href={`/api/bff/payments/${p.id}/receipt/pdf`} target="_blank" rel="noreferrer">
                                <FileText /> Receipt {p.receiptNo} (PDF)
                              </a>
                            </Button>
                            <Button asChild variant="ghost" size="sm">
                              <Link href={`${base}/finance/payments?payment=${p.id}`}>
                                <ReceiptText /> Open
                              </Link>
                            </Button>
                          </li>
                        ))}
                    </ul>
                  )}
                </section>

                <InvoiceConcessions invoice={inv} />

                {inv.notes && <p className="rounded-md bg-surface-subtle p-3 text-sm text-ink-2">{inv.notes}</p>}
                {inv.status === 'void' && inv.voidReason && <Banner tone="info" title="Voided">{inv.voidReason}</Banner>}
              </SheetBody>
              <SheetFooter>
                <Button variant="secondary" onClick={onClose}>
                  Close
                </Button>
                <PrintInvoiceButton invoice={inv} />
                {can('fees:approve') && <VoidInvoiceButton invoice={inv} />}
                {canPay && <Button onClick={() => setPaying(true)}>Record payment</Button>}
              </SheetFooter>
            </>
          )}
        </DrawerContent>
      </Drawer>
      {inv && <RecordPaymentDialog invoice={inv} open={paying} onOpenChange={setPaying} />}
    </>
  );
}

function Figure({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <dt className="t-caption text-ink-2">{label}</dt>
      <dd className={cn('tnum mt-0.5 text-sm', strong && 'figure text-[20px] leading-7')}>{value}</dd>
    </div>
  );
}

function history(inv: InvoiceDetailOut): TimelineItem[] {
  const out: TimelineItem[] = [];
  for (const p of inv.payments) {
    out.push({
      id: `p-${p.id}`,
      title: `${money(p.amountMinor)} · ${METHOD[p.method] ?? p.method}`,
      detail: [p.status !== 'succeeded' ? p.status.replace(/_/g, ' ') : null, p.receiptNo ? `Receipt ${p.receiptNo}` : null, p.reference ? `Ref ${p.reference}` : null, p.receivedByName ? `by ${p.receivedByName}` : null].filter(Boolean).join(' · '),
      at: p.paidAt ?? p.createdAt,
      tone: p.status === 'succeeded' ? 'success' : p.status === 'failed' ? 'danger' : p.status === 'pending' ? 'warning' : 'neutral',
    });
  }
  for (const r of inv.refunds) out.push({ id: `r-${r.id}`, title: `Refund ${money(r.amountMinor)} (${r.status})`, detail: r.reason, at: r.processedAt ?? r.createdAt, tone: r.status === 'rejected' ? 'danger' : 'warning' });
  return out.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}
