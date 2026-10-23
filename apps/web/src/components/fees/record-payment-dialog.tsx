'use client';

import * as React from 'react';
import { z } from 'zod';
import { OFFLINE_METHODS, paymentCreateBody, type InvoiceDetailOut } from '@school-sync/shared';
import { useRecordPayment } from '@/lib/client/hooks';
import { applyApiErrors, useZodForm } from '@/lib/client/use-zod-form';
import { ApiError } from '@/lib/problem';
import { money } from '@/lib/format';
import { Banner } from '../ui/banner';
import { Button } from '../ui/button';
import { Dialog, DialogContent } from '../ui/dialog';
import { FormActions, FormInput, FormSelect, FormTextarea } from '../ui/form';
import { toast } from '../ui/toaster';

const METHOD_LABEL: Record<(typeof OFFLINE_METHODS)[number], string> = { cash: 'Cash', cheque: 'Cheque', bank_transfer: 'Bank transfer', upi: 'UPI', card: 'Card (POS)' };

/** The API takes integer minor units; people type "1560.50". */
const amountText = z
  .string()
  .trim()
  .min(1, 'Enter the amount received')
  .regex(/^\d+(\.\d{1,2})?$/, 'Enter a valid amount, like 1560 or 1560.50')
  .refine((v) => Number(v) > 0, 'The amount must be more than zero');

const form = paymentCreateBody.pick({ method: true, reference: true, notes: true }).extend({ amount: amountText });
const toMinor = (v: string) => Math.round(Number(v) * 100);

/** One Idempotency-Key per distinct payment attempt, kept outside React so a retry re-sends the same key. */
const attempts = new Map<string, { key: string; sig: string }>();
function keyFor(invoiceId: string, sig: string): string {
  const a = attempts.get(invoiceId);
  if (a && a.sig === sig) return a.key;
  const key = crypto.randomUUID();
  attempts.set(invoiceId, { key, sig });
  return key;
}

/**
 * Record an offline payment (cash / cheque / bank transfer / UPI / card): POST /payments with an Idempotency-Key.
 * The key is created once per distinct payment: a retry after a network error re-sends the SAME key, so the server
 * replays the original payment instead of recording it twice; changing any field starts a new key.
 */
export function RecordPaymentDialog({ invoice, open, onOpenChange, onRecorded }: { invoice: InvoiceDetailOut; open: boolean; onOpenChange: (o: boolean) => void; onRecorded?: (receiptNo: string | null) => void }) {
  const pay = useRecordPayment();
  const f = useZodForm(form, { defaultValues: { amount: (invoice.amountDueNowMinor / 100).toFixed(2), method: 'cash', reference: '', notes: '' } });
  const [formError, setFormError] = React.useState<string | null>(null);
  const cur = 'INR';

  React.useEffect(() => {
    if (open) {
      f.reset({ amount: (invoice.amountDueNowMinor / 100).toFixed(2), method: 'cash', reference: '', notes: '' });
      setFormError(null);
      attempts.delete(invoice.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, invoice.id]);

  const onSubmit = f.handleSubmit(async (v) => {
    setFormError(null);
    const minor = toMinor(v.amount);
    if (minor > invoice.amountDueNowMinor) {
      f.setError('amount', { message: `That is more than is due (${money(invoice.amountDueNowMinor, cur)})` });
      return;
    }
    const body = { invoiceId: invoice.id, amountMinor: minor, method: v.method, reference: v.reference?.trim() || undefined, notes: v.notes?.trim() || undefined };
    const sig = JSON.stringify(body);
    const idempotencyKey = keyFor(invoice.id, sig);
    try {
      const res = await pay.mutateAsync({ body: paymentCreateBody.parse(body), idempotencyKey });
      toast.success('Payment recorded', { description: `${money(res.amountMinor, cur)} for ${invoice.invoiceNo}${res.receiptNo ? ` · receipt ${res.receiptNo}` : ''}` });
      attempts.delete(invoice.id);
      onOpenChange(false);
      onRecorded?.(res.receiptNo);
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.code === 'AMOUNT_EXCEEDS_BALANCE') f.setError('amount', { message: 'That is more than is currently due. Check the invoice and try again.' });
        else if (e.code === 'ALREADY_PAID') setFormError('This invoice has already been paid in full.');
        else if (e.code === 'INVOICE_VOID') setFormError('This invoice has been voided, so payments can’t be recorded.');
        else if (e.code === 'SUBSCRIPTION_EXPIRED') setFormError('The school is in read-only mode, so payments can’t be recorded until the subscription is renewed.');
        else if (e.code === 'IDEMPOTENCY_KEY_REUSED') {
          attempts.delete(invoice.id);
          setFormError('That attempt clashed with an earlier one. Please press Record payment again.');
        } else setFormError(applyApiErrors(f, e, { amountMinor: 'amount' }));
      } else setFormError('We could not reach the school server. Nothing was recorded — you can safely try again.');
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Record a payment" description={`${invoice.invoiceNo} · ${invoice.studentName} · ${money(invoice.amountDueNowMinor, cur)} due now`} onInteractOutside={(e) => f.formState.isDirty && e.preventDefault()}>
        <form onSubmit={onSubmit} noValidate className="mt-4 space-y-4">
          <FormInput control={f.control} name="amount" label="Amount received" required inputMode="decimal" autoComplete="off" hint={`Up to ${money(invoice.amountDueNowMinor, cur)}${invoice.lateFeeMinor > 0 ? `, including a ${money(invoice.lateFeeMinor, cur)} late fee` : ''}.`} />
          <FormSelect control={f.control} name="method" label="Payment method" required options={OFFLINE_METHODS.map((m) => ({ value: m, label: METHOD_LABEL[m] }))} />
          <FormInput control={f.control} name="reference" label="Reference" hint="Cheque number, bank or UPI transaction ID (optional)." maxLength={100} />
          <FormTextarea control={f.control} name="notes" label="Notes" rows={2} maxLength={300} />
          {formError && <Banner tone="danger">{formError}</Banner>}
          <FormActions className="-mx-5 -mb-5 mt-2 border-t px-5">
            <Button variant="secondary" type="button" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={pay.isPending || f.formState.isSubmitting}>
              Record payment
            </Button>
          </FormActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}
