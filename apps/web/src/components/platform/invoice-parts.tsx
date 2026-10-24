'use client';

import * as React from 'react';
import { Check } from 'lucide-react';
import type { PlatformInvoice, PlatformSubscription } from '@school-sync/shared';
import { Button } from '@/components/ui/button';
import { type Column, DataTable } from '@/components/ui/data-table';
import { DatePicker } from '@/components/ui/date-picker';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { toast } from '@/components/ui/toaster';
import { ReasonDialog } from '@/components/features/management/shared/dialogs';
import { fmtDate, money, todayIso } from '@/lib/format';
import { addDaysIso } from '@/lib/platform/dates';
import { useIssueInvoice, usePayInvoice, useVoidInvoice } from '@/lib/platform/queries';
import { InvoiceChip, KIND_LABEL } from './bits';

/** Mark an issued invoice as paid: the day the money arrived and a bank / cheque reference. */
export function PayInvoiceDialog({ invoice, onClose }: { invoice: PlatformInvoice | null; onClose: () => void }) {
  const pay = usePayInvoice();
  const [paidOn, setPaidOn] = React.useState(todayIso());
  const [reference, setReference] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (invoice) {
      setPaidOn(todayIso());
      setReference('');
      setError(null);
    }
  }, [invoice]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invoice) return;
    if (!paidOn) return setError('Pick the day the payment arrived.');
    const r = await pay.run({ id: invoice.id, paidOn, reference: reference.trim() });
    if (r.ok) onClose();
    else setError(r.error instanceof Error ? r.error.message : 'Could not mark it as paid.');
  };
  return (
    <Dialog open={!!invoice} onOpenChange={(o) => !o && !pay.isPending && onClose()}>
      <DialogContent title={invoice ? `Mark ${invoice.number} as paid` : 'Mark as paid'} description={invoice ? `${invoice.tenantName} · ${money(invoice.amountMinor, invoice.currency)}` : undefined}>
        <form onSubmit={submit} className="mt-4 space-y-4" noValidate>
          <Field label="Paid on" htmlFor="paid-on" required error={error && !paidOn ? error : null}>
            <DatePicker id="paid-on" value={paidOn} onChange={setPaidOn} max={todayIso()} />
          </Field>
          <Field label="Reference" htmlFor="paid-ref" hint="Bank transfer id, cheque number or receipt. Optional.">
            <Input id="paid-ref" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} autoComplete="off" />
          </Field>
          {error && paidOn && <p role="alert" className="t-caption text-danger">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose} disabled={pay.isPending}>Cancel</Button>
            <Button type="submit" loading={pay.isPending}><Check /> Mark as paid</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function VoidInvoiceDialog({ invoice, onClose }: { invoice: PlatformInvoice | null; onClose: () => void }) {
  const voidIt = useVoidInvoice();
  return (
    <ReasonDialog
      open={!!invoice}
      onOpenChange={(o) => !o && onClose()}
      title={invoice ? `Void ${invoice.number}?` : 'Void invoice'}
      description={invoice ? `${invoice.tenantName} · ${money(invoice.amountMinor, invoice.currency)}. A void invoice is no longer owed and cannot be paid. Its students become billable again.` : undefined}
      label="Reason"
      placeholder="For example: issued to the wrong school"
      required
      confirmLabel="Void invoice"
      destructive
      onSubmit={async (reason) => (await voidIt.run({ id: invoice!.id, reason })).ok}
    />
  );
}

/** Issue the committed-seats invoice at the start of a year, or a true-up for students above what has been invoiced. */
export function IssueInvoiceDialog({ code, name, subscriptions, open, onOpenChange, initial }: { code: string; name: string; subscriptions: Pick<PlatformSubscription, 'academicYear' | 'licensedStudents' | 'pricePerStudentMinor' | 'currency'>[]; open: boolean; onOpenChange: (o: boolean) => void; initial?: { kind?: 'seats' | 'true_up'; academicYear?: string } }) {
  const issue = useIssueInvoice(code);
  const [kind, setKind] = React.useState<'seats' | 'true_up'>('seats');
  const [year, setYear] = React.useState('');
  const [dueOn, setDueOn] = React.useState('');
  React.useEffect(() => {
    if (open) {
      setKind(initial?.kind ?? 'seats');
      setYear(initial?.academicYear ?? subscriptions[0]?.academicYear ?? '');
      setDueOn(addDaysIso(todayIso(), 14));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const sub = subscriptions.find((s) => s.academicYear === year);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!year) return;
    const r = await issue.run({ kind, academicYear: year, ...(dueOn ? { dueOn } : {}) });
    if (!r.ok) return;
    if (r.data.invoice) toast.success(`${r.data.invoice.number} issued: ${money(r.data.invoice.amountMinor, r.data.invoice.currency)}`);
    else toast.info(r.data.message ?? 'Nothing to invoice.');
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !issue.isPending && onOpenChange(o)}>
      <DialogContent title="Issue an invoice" description={`For ${name}. Per student, per academic year.`}>
        <form onSubmit={submit} className="mt-4 space-y-4" noValidate>
          <Field label="Invoice" htmlFor="inv-kind" required hint={kind === 'seats' ? 'Committed seats × price per student, at the start of the year. Once per subscription.' : 'Students above what has already been invoiced, at the year’s peak.'}>
            <Select id="inv-kind" value={kind} onValueChange={(v) => setKind(v as 'seats' | 'true_up')} options={[{ value: 'seats', label: 'Committed seats' }, { value: 'true_up', label: 'True-up for extra students' }]} />
          </Field>
          <Field label="Academic year" htmlFor="inv-year" required error={subscriptions.length === 0 ? 'This school has no subscription yet. Add one first.' : null}>
            <Select id="inv-year" value={year} onValueChange={setYear} options={subscriptions.map((s) => ({ value: s.academicYear, label: `${s.academicYear} · ${s.licensedStudents === null ? 'no seat limit' : `${s.licensedStudents.toLocaleString()} seats`} at ${money(s.pricePerStudentMinor, s.currency)}` }))} placeholder="Choose a year" />
          </Field>
          <Field label="Due on" htmlFor="inv-due" hint="Optional.">
            <DatePicker id="inv-due" value={dueOn || null} onChange={setDueOn} />
          </Field>
          {kind === 'seats' && sub?.licensedStudents != null && <p className="t-caption text-ink-2">This will bill {sub.licensedStudents.toLocaleString()} seats × {money(sub.pricePerStudentMinor, sub.currency)} = <strong className="text-ink">{money(sub.licensedStudents * sub.pricePerStudentMinor, sub.currency)}</strong>.</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={issue.isPending}>Cancel</Button>
            <Button type="submit" loading={issue.isPending} disabled={!year}>Issue invoice</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Invoices as a table (stacked cards on phones) with Mark paid / Void actions. `memoRows`: every cell depends on its row only. */
export function InvoiceTable({
  id,
  rows,
  showSchool,
  onPay,
  onVoid,
  loading,
  error,
  onRetry,
  empty,
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  filters,
}: {
  id: string;
  rows: PlatformInvoice[] | undefined;
  showSchool?: boolean;
  onPay: (i: PlatformInvoice) => void;
  onVoid: (i: PlatformInvoice) => void;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  empty?: React.ReactNode;
  page?: number;
  pageSize?: number;
  total?: number;
  onPageChange?: (p: number) => void;
  onPageSizeChange?: (s: number) => void;
  filters?: React.ReactNode;
}) {
  const columns: Column<PlatformInvoice>[] = [
    { id: 'number', header: 'Invoice', mobile: 'title', cell: (i) => <span className="block"><span className="font-mono text-[13px]">{i.number}</span>{showSchool && <span className="t-caption block text-ink-2">{i.tenantName}</span>}</span> },
    { id: 'what', header: 'For', label: 'For', mobile: 'sub', cell: (i) => <span>{KIND_LABEL[i.kind] ?? i.kind} · {i.academicYear}<span className="t-caption block text-ink-2">{i.students.toLocaleString()} × {money(i.unitPriceMinor, i.currency)}</span></span> },
    { id: 'amount', header: 'Amount', label: 'Amount', align: 'right', mobile: 'value', cell: (i) => <span className="tnum font-medium">{money(i.amountMinor, i.currency)}</span> },
    { id: 'status', header: 'Status', mobile: 'status', cell: (i) => <InvoiceChip status={i.status} overdue={i.overdue} /> },
    { id: 'due', header: 'Due / paid', label: 'Due / paid', mobile: 'detail', cell: (i) => (i.status === 'paid' ? <span>Paid {fmtDate(i.paidAt)}{i.paymentReference && <span className="t-caption block text-ink-2">{i.paymentReference}</span>}</span> : i.dueOn ? <span className="tnum">{fmtDate(i.dueOn)}</span> : <span className="text-ink-3">No due date</span>) },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      label: 'Actions',
      hideable: false,
      align: 'right',
      mobile: 'detail',
      cell: (i) =>
        i.status === 'issued' || i.status === 'draft' ? (
          <span className="inline-flex gap-1.5">
            {i.status === 'issued' && <Button size="sm" variant="secondary" onClick={() => onPay(i)} aria-label={`Mark ${i.number} as paid`}>Mark paid</Button>}
            <Button size="sm" variant="ghost" onClick={() => onVoid(i)} aria-label={`Void ${i.number}`}>Void</Button>
          </span>
        ) : (
          <span className="text-ink-3">—</span>
        ),
    },
  ];
  return (
    <DataTable<PlatformInvoice>
      memoRows
      id={id}
      caption="Invoices"
      rows={rows}
      rowKey={(i) => i.id}
      columns={columns}
      loading={loading}
      error={error}
      onRetry={onRetry}
      empty={empty}
      page={page}
      pageSize={pageSize}
      total={total}
      onPageChange={onPageChange}
      onPageSizeChange={onPageSizeChange}
      filters={filters}
    />
  );
}
