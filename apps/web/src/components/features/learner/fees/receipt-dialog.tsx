'use client';

import * as React from 'react';
import { FileDown } from 'lucide-react';
import { receiptPdfHref, useReceipt } from '@/lib/client/learner-fees';
import { fmtDate, fmtDateTime, money } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '../states';

const METHOD: Record<string, string> = { cash: 'Cash', cheque: 'Cheque', bank_transfer: 'Bank transfer', upi: 'UPI', card: 'Card', online: 'Online' };

/** A receipt as a dialog (data from GET /payments/:id/receipt) with the PDF one tap away. */
export function ReceiptDialog({ paymentId, onClose }: { paymentId: string | null; onClose: () => void }) {
  const q = useReceipt(paymentId);
  const r = q.data;
  return (
    <Dialog open={!!paymentId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={r ? `Receipt ${r.receiptNo}` : 'Receipt'} description={r ? `${r.school.name}` : undefined} size="md">
        <div className="mt-4">
          {q.isPending ? (
            <div className="space-y-3" aria-busy="true">
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : q.isError || !r ? (
            <ErrorState error={q.error} onRetry={() => void q.refetch()} compact title="We couldn’t load this receipt" />
          ) : (
            <div className="space-y-4 text-sm">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                <div><dt className="t-caption text-ink-2">Student</dt><dd className="font-medium">{r.student.name}</dd><dd className="t-caption text-ink-2">{[r.student.grade, r.student.section].filter(Boolean).join(' · ')} · {r.student.admissionNo}</dd></div>
                <div><dt className="t-caption text-ink-2">Paid on</dt><dd className="font-medium">{fmtDateTime(r.paidAt)}</dd><dd className="t-caption text-ink-2">{METHOD[r.payment.method] ?? r.payment.method}{r.payment.reference ? ` · ${r.payment.reference}` : ''}</dd></div>
                <div><dt className="t-caption text-ink-2">Invoice</dt><dd className="font-medium">{r.invoice.invoiceNo}</dd><dd className="t-caption text-ink-2">{r.invoice.title} · due {fmtDate(r.invoice.dueDate)}</dd></div>
                <div><dt className="t-caption text-ink-2">Received by</dt><dd className="font-medium">{r.receivedBy ?? 'Online payment'}</dd></div>
              </dl>
              <div className="overflow-hidden rounded-md border border-border">
                <table className="t-table w-full">
                  <caption className="sr-only">Items on this invoice</caption>
                  <tbody>
                    {r.items.map((it) => (
                      <tr key={it.id} className="border-b border-border last:border-b-0">
                        <td className="px-3 py-2">{it.description}</td>
                        <td className="tnum px-3 py-2 text-right">{money(it.amountMinor - it.discountMinor, r.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <dl className="space-y-1 rounded-md bg-surface-subtle px-3 py-2.5">
                <div className="flex justify-between"><dt className="text-ink-2">Amount received</dt><dd className="figure text-[20px] leading-7">{money(r.payment.amountMinor, r.currency)}</dd></div>
                {r.payment.refundedMinor > 0 && <div className="flex justify-between"><dt className="text-ink-2">Refunded</dt><dd className="tnum">{money(r.payment.refundedMinor, r.currency)}</dd></div>}
                <div className="flex justify-between"><dt className="text-ink-2">Invoice balance after this payment</dt><dd className="tnum font-medium">{money(r.invoice.balanceMinor, r.currency)}</dd></div>
              </dl>
              <div className="flex justify-end">
                <Button asChild variant="secondary"><a href={receiptPdfHref(r.paymentId)} target="_blank" rel="noopener noreferrer"><FileDown /> Download PDF</a></Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
