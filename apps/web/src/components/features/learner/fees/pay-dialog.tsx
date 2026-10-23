'use client';

import * as React from 'react';
import Link from 'next/link';
import { CheckCircle2, CreditCard, FileDown, Loader2, RotateCw } from 'lucide-react';
import { z } from 'zod';
import type { InvoiceOut, PayOnlineOut, PaymentOut } from '@school-sync/shared';
import { fetchPayment, mockCompletePayment, receiptPdfHref, syncPayment, useInvalidateFees, useStartOnlinePayment } from '@/lib/client/learner-fees';
import { applyApiErrors, useZodForm } from '@/lib/client/use-zod-form';
import { ApiError, errorMessage } from '@/lib/problem';
import { money } from '@/lib/format';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { FormInput } from '@/components/ui/form';
import { Tooltip } from '@/components/ui/tooltip';
import { useGates, useLearner } from '../use-learner';

type PayInvoice = Pick<InvoiceOut, 'id' | 'invoiceNo' | 'title' | 'status' | 'amountDueNowMinor' | 'studentName'>;

// ───────────────────────────── helpers ─────────────────────────────

const toMinor = (v: string): number => Math.round(parseFloat(v) * 100);
const toMajorString = (minor: number): string => (minor % 100 === 0 ? String(minor / 100) : (minor / 100).toFixed(2));

/** The amount the parent chooses: major units as typed, 0 < amount ≤ what is due now. */
const amountSchema = (maxMinor: number, currency: string) =>
  z.object({
    amount: z
      .string()
      .trim()
      .min(1, 'Enter an amount')
      .refine((v) => /^\d+(\.\d{1,2})?$/.test(v), 'Enter an amount like 1500 or 1500.50')
      .refine((v) => !/^\d+(\.\d{1,2})?$/.test(v) || toMinor(v) > 0, 'The amount must be more than zero')
      .refine((v) => !/^\d+(\.\d{1,2})?$/.test(v) || toMinor(v) <= maxMinor, `That is more than what is due now (${money(maxMinor, currency)})`),
  });

/** Every code the pay endpoints can answer with, in plain words. Nothing is charged unless the payment is later confirmed by the server. */
function payError(e: unknown): string {
  if (e instanceof ApiError) {
    switch (e.code) {
      case 'ONLINE_PAYMENTS_DISABLED':
        return 'Online payment isn’t switched on at this school. Please pay at the school office — you’ll get a receipt there.';
      case 'GATEWAY_NOT_CONFIGURED':
        return 'The school’s payment provider isn’t set up yet, so online payment can’t start. Please pay at the school office for now.';
      case 'ALREADY_PAID':
        return 'This invoice has already been paid in full. Nothing more is due.';
      case 'AMOUNT_EXCEEDS_BALANCE':
        return 'That amount is more than what is due now. Lower it and try again.';
      case 'INVOICE_VOID':
        return 'This invoice was cancelled by the school, so it can’t be paid.';
      case 'GATEWAY_ERROR':
        return 'The payment provider couldn’t start this payment. You haven’t been charged. Please try again in a moment.';
      case 'IDEMPOTENCY_KEY_REUSED':
        return 'That payment attempt was already used for a different amount. Please try again.';
      case 'RATE_LIMITED':
        return 'Too many attempts. Please wait a moment and try again.';
    }
    if (e.status === 404) return 'We couldn’t find that payment. Please close this window and try again.';
    if (e.status === 403) return 'Your account isn’t allowed to pay this invoice online. Please contact the school office.';
  }
  return errorMessage(e);
}

declare global {
  interface Window {
    Razorpay?: new (opts: Record<string, unknown>) => { open: () => void; on: (event: string, cb: (r: unknown) => void) => void };
  }
}

/** Razorpay's checkout script is only fetched when a Razorpay payment is actually started. */
function loadRazorpay(): Promise<NonNullable<Window['Razorpay']>> {
  if (window.Razorpay) return Promise.resolve(window.Razorpay);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.async = true;
    s.onload = () => (window.Razorpay ? resolve(window.Razorpay) : reject(new Error('The payment window didn’t load.')));
    s.onerror = () => reject(new Error('We couldn’t load the payment window. Check your connection and try again.'));
    document.head.appendChild(s);
  });
}

/** Holds the Idempotency-Key of the current attempt: same amount → same key (a retry replays the pending payment), new amount → new key. */
function createAttemptStore() {
  let cur: { amount: number; key: string } | null = null;
  return {
    keyFor(amount: number): string {
      if (!cur || cur.amount !== amount) cur = { amount, key: crypto.randomUUID() };
      return cur.key;
    },
    reset() {
      cur = null;
    },
  };
}
type AttemptStore = ReturnType<typeof createAttemptStore>;

const settled = (p: PaymentOut) => p.status === 'succeeded' || p.status === 'partially_refunded' || p.status === 'refunded';

type Step =
  | { kind: 'amount' }
  | { kind: 'mock'; order: PayOnlineOut }
  | { kind: 'checkout'; order: PayOnlineOut; note?: string }
  | { kind: 'verifying'; order: PayOnlineOut }
  | { kind: 'done'; payment: PaymentOut }
  | { kind: 'failed'; message: string };

// ───────────────────────────── the button ─────────────────────────────

/**
 * “Pay online” for a parent. Renders nothing unless the school switched online payments on and the account may pay;
 * the API makes the final call (403 ONLINE_PAYMENTS_DISABLED is shown in words inside the dialog).
 * One Idempotency-Key per attempt: a retry with the same amount replays the same pending payment instead of creating another.
 */
export function PayButton({ invoice, size = 'sm', variant = 'primary', label = 'Pay online' }: { invoice: PayInvoice; size?: 'sm' | 'md'; variant?: 'primary' | 'secondary'; label?: string }) {
  const l = useLearner();
  const { features, can, readOnly } = useGates();
  const [open, setOpen] = React.useState(false);
  const [attempts] = React.useState(createAttemptStore);
  if (!l.isParent || !features.onlinePayments || !can('payments:create') || invoice.amountDueNowMinor <= 0 || invoice.status === 'paid' || invoice.status === 'void') return null;
  const btn = (
    <Button size={size} variant={variant} disabled={readOnly} onClick={() => setOpen(true)} aria-label={`${label}: ${invoice.invoiceNo}`}>
      <CreditCard /> {label}
    </Button>
  );
  return (
    <>
      {readOnly ? <Tooltip content="This school is in read-only mode"><span>{btn}</span></Tooltip> : btn}
      {open && <PayDialog invoice={invoice} onClose={() => setOpen(false)} attempts={attempts} />}
    </>
  );
}

/** Shown instead of the button when the school has not switched online payment on. */
export function OnlinePayNote({ show }: { show: boolean }) {
  const { features } = useGates();
  const l = useLearner();
  if (features.onlinePayments || !show) return null;
  return <Banner tone="info">{l.isParent ? 'Online payment isn’t switched on at this school. To pay, please visit the school office — you’ll receive a receipt there, and it will appear here too.' : 'Fees are paid by your parent or guardian at the school office. Receipts appear here once a payment is recorded.'}</Banner>;
}

// ───────────────────────────── the dialog ─────────────────────────────

function PayDialog({ invoice, onClose, attempts }: { invoice: PayInvoice; onClose: () => void; attempts: AttemptStore }) {
  const { currency, schoolName } = useGates();
  const l = useLearner();
  const invalidate = useInvalidateFees();
  const start = useStartOnlinePayment();
  const [step, setStep] = React.useState<Step>({ kind: 'amount' });
  const [formError, setFormError] = React.useState<string | null>(null);
  const schema = React.useMemo(() => amountSchema(invoice.amountDueNowMinor, currency), [invoice.amountDueNowMinor, currency]);
  const form = useZodForm(schema, { defaultValues: { amount: toMajorString(invoice.amountDueNowMinor) } });

  const finished = (payment: PaymentOut) => {
    attempts.reset();
    invalidate();
    setStep({ kind: 'done', payment });
  };
  const failed = (message: string) => {
    attempts.reset();
    setStep({ kind: 'failed', message });
  };

  const submit = form.handleSubmit(async (v) => {
    setFormError(null);
    const amountMinor = toMinor(v.amount);
    try {
      const order = await start.mutateAsync({ invoiceId: invoice.id, amountMinor, idempotencyKey: attempts.keyFor(amountMinor) });
      setStep(order.mock ? { kind: 'mock', order } : { kind: 'checkout', order });
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'IDEMPOTENCY_KEY_REUSED' || e.code === 'ALREADY_PAID' || e.code === 'INVOICE_VOID')) {
        attempts.reset();
        invalidate();
      }
      setFormError(e instanceof ApiError && e.code === 'VALIDATION_ERROR' ? applyApiErrors(form, e) : payError(e));
    }
  });

  const busy = step.kind === 'verifying';
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={step.kind === 'done' ? 'Payment received' : `Pay ${invoice.invoiceNo}`} description={step.kind === 'done' ? undefined : `${invoice.title}${l.kids.length > 1 ? ` · ${invoice.studentName}` : ''}`} size="md">
        <div className="mt-4 space-y-4">
          {step.kind === 'amount' && (
            <form onSubmit={submit} noValidate className="space-y-4">
              <FormInput control={form.control} name="amount" label={`Amount to pay (${currency})`} required inputMode="decimal" autoComplete="off" hint={`Due now: ${money(invoice.amountDueNowMinor, currency)}${invoice.amountDueNowMinor > 0 ? ' (includes any late fee). You can pay part of it.' : ''}`} />
              {formError && <Banner tone="danger">{formError}</Banner>}
              <p className="t-caption text-ink-2">You’ll complete the payment securely with the school’s payment provider. We only mark the invoice paid after the provider confirms it.</p>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
                <Button type="submit" loading={form.formState.isSubmitting || start.isPending}>{start.isPending ? 'Starting…' : 'Continue'}</Button>
              </div>
            </form>
          )}

          {step.kind === 'mock' && <MockStep order={step.order} onSettled={finished} onFailed={failed} onVerify={() => setStep({ kind: 'verifying', order: step.order })} />}

          {step.kind === 'checkout' && <CheckoutStep order={step.order} schoolName={schoolName} title={invoice.title} note={step.note} onPaid={() => setStep({ kind: 'verifying', order: step.order })} onFailed={failed} onNote={(note) => setStep({ ...step, note })} />}

          {step.kind === 'verifying' && <VerifyStep order={step.order} onSettled={finished} onFailed={failed} onClose={onClose} />}

          {step.kind === 'done' && (
            <div className="space-y-4 text-center">
              <span className="mx-auto grid size-12 place-items-center rounded-full bg-success-soft text-success"><CheckCircle2 className="size-6" aria-hidden /></span>
              <div>
                <p className="figure text-[28px] leading-9">{money(step.payment.amountMinor, currency)}</p>
                <p className="text-sm text-ink-2">paid for {invoice.invoiceNo}{step.payment.receiptNo ? ` · receipt ${step.payment.receiptNo}` : ''}</p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                <Button asChild variant="secondary"><a href={receiptPdfHref(step.payment.id)} target="_blank" rel="noopener noreferrer"><FileDown /> Receipt (PDF)</a></Button>
                <Button onClick={onClose}>Done</Button>
              </div>
            </div>
          )}

          {step.kind === 'failed' && (
            <div className="space-y-4">
              <Banner tone="danger" title="The payment didn’t go through">{step.message}</Banner>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={onClose}>Close</Button>
                <Button onClick={() => { setFormError(null); setStep({ kind: 'amount' }); }}><RotateCw /> Start again</Button>
              </div>
            </div>
          )}
          {busy && <span className="sr-only" role="status">Waiting for the payment provider to confirm…</span>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Dev / mock gateway: there is no real checkout, so the payer's completion is simulated through the real webhook path. */
function MockStep({ order, onSettled, onFailed, onVerify }: { order: PayOnlineOut; onSettled: (p: PaymentOut) => void; onFailed: (m: string) => void; onVerify: () => void }) {
  const { currency } = useGates();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const complete = async () => {
    setBusy(true);
    setError(null);
    try {
      const p = await mockCompletePayment(order.paymentId);
      if (settled(p)) onSettled(p);
      else if (p.status === 'failed') onFailed('The test payment was declined.');
      else onVerify();
    } catch (e) {
      setError(e instanceof ApiError && e.status === 404 ? 'Test payments are only available in development.' : payError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4">
      <Banner tone="warning" title="Test payment (development only)">
        This school is using the built-in test payment provider, so no real money moves. “Complete test payment” pretends the payer finished checkout for {money(order.amountMinor, currency)}.
      </Banner>
      {error && <Banner tone="danger">{error}</Banner>}
      <div className="flex justify-end">
        <Button loading={busy} onClick={() => void complete()}><CreditCard /> Complete test payment</Button>
      </div>
    </div>
  );
}

/** Razorpay checkout. The client callback is never trusted: it only starts the server-side confirmation check. */
function CheckoutStep({ order, schoolName, title, note, onPaid, onFailed, onNote }: { order: PayOnlineOut; schoolName: string; title: string; note?: string; onPaid: () => void; onFailed: (m: string) => void; onNote: (n: string) => void }) {
  const { currency } = useGates();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const open = async () => {
    setError(null);
    if (!order.keyId) {
      onFailed('The school’s payment provider isn’t fully set up (missing key). Please pay at the school office for now.');
      return;
    }
    setBusy(true);
    try {
      const Razorpay = await loadRazorpay();
      const rz = new Razorpay({
        key: order.keyId,
        order_id: order.orderId,
        amount: order.amountMinor,
        currency: order.currency,
        name: schoolName,
        description: title,
        handler: () => onPaid(),
        modal: { ondismiss: () => onNote('The payment window was closed. If you completed the payment, check its status below.') },
      });
      rz.on('payment.failed', () => onFailed('The payment provider reported that the payment failed. You have not been charged, or any charge will be returned by your bank.'));
      rz.open();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'We couldn’t open the payment window.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-2">Pay {money(order.amountMinor, currency)} securely in the payment provider’s window.</p>
      {note && <Banner tone="info">{note}</Banner>}
      {error && <Banner tone="danger">{error}</Banner>}
      <div className="flex flex-wrap justify-end gap-2">
        {note && <Button variant="secondary" onClick={onPaid}>Check payment status</Button>}
        <Button loading={busy} onClick={() => void open()}><CreditCard /> {note ? 'Open payment window again' : 'Open payment window'}</Button>
      </div>
    </div>
  );
}

/** Polls the server (every 2 s for ~30 s). Only the server's own record of the payment decides the outcome. */
function VerifyStep({ order, onSettled, onFailed, onClose }: { order: PayOnlineOut; onSettled: (p: PaymentOut) => void; onFailed: (m: string) => void; onClose: () => void }) {
  const [seconds, setSeconds] = React.useState(0);
  const [checking, setChecking] = React.useState(false);
  const [note, setNote] = React.useState<string | null>(null);
  const live = React.useRef(true);

  const apply = React.useCallback(
    (p: PaymentOut) => {
      if (!live.current) return;
      if (settled(p)) onSettled(p);
      else if (p.status === 'failed') onFailed('The payment provider reported that this payment failed. You have not been charged.');
    },
    [onSettled, onFailed],
  );

  React.useEffect(() => {
    live.current = true;
    const t0 = Date.now();
    const tick = async () => {
      try {
        apply(await fetchPayment(order.paymentId));
      } catch {
        /* keep trying; the next tick or "Check status" will surface a real problem */
      }
    };
    void tick();
    const id = window.setInterval(() => {
      const s = Math.floor((Date.now() - t0) / 1000);
      setSeconds(s);
      if (s <= 30) void tick();
    }, 2000);
    return () => {
      live.current = false;
      window.clearInterval(id);
    };
  }, [order.paymentId, apply]);

  const check = async () => {
    setChecking(true);
    setNote(null);
    try {
      const p = await syncPayment(order.paymentId);
      if (settled(p) || p.status === 'failed') apply(p);
      else setNote('The provider hasn’t confirmed this payment yet. Give it a minute and check again.');
    } catch (e) {
      setNote(payError(e));
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="space-y-4" role="status" aria-live="polite">
      <div className="flex items-center gap-3">
        <Loader2 className="size-5 animate-spin text-brand motion-reduce:animate-none" aria-hidden />
        <div>
          <p className="text-sm font-medium">{seconds > 30 ? 'Still waiting for confirmation' : 'Confirming your payment…'}</p>
          <p className="t-caption text-ink-2">{seconds > 30 ? 'Bank confirmations can take a few minutes. It’s safe to close this window: the invoice updates by itself once the provider confirms.' : 'This usually takes a few seconds. Please keep this window open.'}</p>
        </div>
      </div>
      {note && <Banner tone="info">{note}</Banner>}
      <div className="flex flex-wrap justify-end gap-2">
        {seconds >= 10 && <Button variant="secondary" loading={checking} onClick={() => void check()}><RotateCw /> Check status</Button>}
        {seconds > 30 && <Button variant="secondary" onClick={onClose}>Close</Button>}
      </div>
    </div>
  );
}

/** Link used by screens that need "back to the invoice list". */
export function BackToFees({ href }: { href: string }) {
  return (
    <Link href={href} className="t-caption inline-flex items-center gap-1 text-brand-ink hover:underline">
      ← Back to fees
    </Link>
  );
}
