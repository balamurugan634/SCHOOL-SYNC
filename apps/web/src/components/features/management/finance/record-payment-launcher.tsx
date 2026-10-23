'use client';

import * as React from 'react';
import { Loader2, Search } from 'lucide-react';
import type { InvoiceOut } from '@school-sync/shared';
import { useInvoices, useInvoice } from '@/lib/client/hooks';
import { friendlyError, useDebounced } from '@/lib/client/mgmt';
import { fmtDate } from '@/lib/format';
import { RecordPaymentDialog } from '@/components/fees/record-payment-dialog';
import { StatusChip } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { controlBase } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import { useMgmt } from '../common/use-mgmt';

/**
 * "Record a payment" from the payments screen: find the invoice (by invoice number, student name or admission no.),
 * then the existing record-payment form takes over (amount, method, reference, idempotent submit).
 */
export function RecordPaymentLauncher({ open, onClose, onRecorded }: { open: boolean; onClose: () => void; onRecorded?: (receiptNo: string | null) => void }) {
  const { money } = useMgmt();
  const [text, setText] = React.useState('');
  const q = useDebounced(text.trim(), 300);
  const [picked, setPicked] = React.useState<string | null>(null);
  const [paying, setPaying] = React.useState(false);
  const list = useInvoices({ q, page: 1, pageSize: 20 });
  const detail = useInvoice(picked);
  const rows = (list.data?.data ?? []).filter((i) => (i.status === 'unpaid' || i.status === 'partial') && i.amountDueNowMinor > 0);

  React.useEffect(() => {
    if (open) {
      setText('');
      setPicked(null);
      setPaying(false);
    }
  }, [open]);
  React.useEffect(() => {
    if (picked && detail.data && !paying) setPaying(true);
  }, [picked, detail.data, paying]);

  return (
    <>
      <Dialog open={open && !paying} onOpenChange={(o) => !o && onClose()}>
        <DialogContent title="Record a payment" description="First find the invoice being paid." size="lg">
          <div className="mt-4 space-y-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
              <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Invoice number, student name or admission number" aria-label="Find an invoice" className={cn(controlBase, 'h-11 pl-9 sm:h-9')} />
            </div>
            {detail.isError && <Banner tone="danger">{friendlyError(detail.error)}</Banner>}
            <ul className="max-h-80 divide-y divide-border overflow-y-auto rounded-lg border border-border" aria-label="Unpaid invoices" aria-busy={list.isFetching}>
              {list.isPending ? (
                <li className="flex items-center gap-2 px-3 py-6 text-sm text-ink-2">
                  <Loader2 className="size-4 animate-spin" aria-hidden /> Loading invoices…
                </li>
              ) : list.isError ? (
                <li className="px-3 py-6 text-sm text-danger" role="alert">
                  {friendlyError(list.error)}
                </li>
              ) : rows.length === 0 ? (
                <li className="px-3 py-6 text-sm text-ink-2">{q ? 'No unpaid invoice matches. Paid and voided invoices cannot take a payment.' : 'There are no unpaid invoices.'}</li>
              ) : (
                rows.map((i: InvoiceOut) => (
                  <li key={i.id}>
                    <button type="button" disabled={!!picked} onClick={() => setPicked(i.id)} className="tr-colors flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-surface-subtle focus-visible:bg-surface-subtle disabled:opacity-60">
                      <span className="min-w-0">
                        <span className="tnum block text-sm font-medium">{i.invoiceNo}</span>
                        <span className="t-caption block truncate text-ink-2">
                          {i.studentName} · {i.admissionNo} · due {fmtDate(i.dueDate)}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="tnum text-sm font-medium">{money(i.amountDueNowMinor)}</span>
                        <StatusChip status={i.overdue ? 'overdue' : i.status} />
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>
            <div className="flex justify-end">
              <Button variant="secondary" onClick={onClose}>
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {detail.data && (
        <RecordPaymentDialog
          invoice={detail.data}
          open={open && paying}
          onOpenChange={(o) => {
            if (!o) onClose();
          }}
          onRecorded={(r) => {
            onRecorded?.(r);
          }}
        />
      )}
    </>
  );
}
