'use client';

import * as React from 'react';
import Link from 'next/link';
import { Plus, Printer, Trash2 } from 'lucide-react';
import { useFieldArray } from 'react-hook-form';
import { z } from 'zod';
import { invoiceCreateBody, type ConcessionOut, type InvoiceDetailOut } from '@school-sync/shared';
import { useConcessions, useCreateInvoice, useFeeCategories, useVoidInvoice } from '@/lib/client/finance';
import { amountText, parseMinor } from '@/lib/client/mgmt';
import { applyApiErrors, useZodForm } from '@/lib/client/use-zod-form';
import { useUnsavedGuard } from '@/lib/client/use-unsaved-guard';
import { fmtDate, money as fmtMoney } from '@/lib/format';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, SheetBody } from '@/components/ui/dialog';
import { FormActions, FormDate, FormInput, FormSection, FormSelect, FormTextarea } from '@/components/ui/form';
import { Field } from '@/components/ui/input';
import { IconButton } from '@/components/ui/icon-button';
import { StatusChip } from '@/components/ui/badge';
import { toast } from '@/components/ui/toaster';
import { ReasonDialog } from '../common/dialogs';
import { GuardedButton } from '../common/guarded';
import { StudentPicker, type PickerOption } from '../common/picker';
import { esc, printHtml } from '../common/print';
import { useMgmt } from '../common/use-mgmt';

// ── create a one-off invoice ────────────────────────────────────────────────────────────────

const itemRow = z.object({ categoryId: z.string(), description: z.string().trim().min(1, 'Describe the charge').max(200), amount: amountText('the amount') });
const createForm = z.object({
  title: z.string().trim().min(2, 'Give the invoice a title (at least 2 characters)').max(150),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a due date'),
  items: z.array(itemRow).min(1, 'Add at least one charge').max(30),
  notes: z.string().trim().max(300),
});
const blankItem = { categoryId: 'none', description: '', amount: '' };

/** A one-off invoice for a student (a trip, a lost book, a late admission fee …). Not tied to a fee plan. */
export function CreateInvoiceDrawer({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated?: (id: string) => void }) {
  const { money } = useMgmt();
  const cats = useFeeCategories(open);
  const create = useCreateInvoice();
  const [student, setStudent] = React.useState<PickerOption | null>(null);
  const [tried, setTried] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const form = useZodForm(createForm, { defaultValues: { title: '', dueDate: '', items: [blankItem], notes: '' } });
  const arr = useFieldArray({ control: form.control, name: 'items' });
  const { guard, dialog } = useUnsavedGuard(form.formState.isDirty || !!student);
  const items = form.watch('items');
  const total = (items ?? []).reduce((t, i) => t + (parseMinor(i?.amount) ?? 0), 0);

  React.useEffect(() => {
    if (open) {
      form.reset({ title: '', dueDate: '', items: [blankItem], notes: '' });
      setStudent(null);
      setTried(false);
      setErr(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = form.handleSubmit(async (v) => {
    setTried(true);
    if (!student) return;
    setErr(null);
    try {
      const body = invoiceCreateBody.parse({
        studentId: student.value,
        title: v.title,
        dueDate: v.dueDate,
        notes: v.notes || null,
        items: v.items.map((i) => ({ categoryId: i.categoryId === 'none' ? null : i.categoryId, description: i.description, amountMinor: parseMinor(i.amount)! })),
      });
      const inv = await create.mutateAsync(body);
      toast.success(`Invoice ${inv.invoiceNo} created`, { description: `${money(inv.totalMinor)} for ${inv.studentName}` });
      form.reset(form.getValues());
      setStudent(null);
      onClose();
      onCreated?.(inv.id);
    } catch (e) {
      setErr(applyApiErrors(form, e));
    }
  });

  return (
    <>
      <Drawer open={open} onOpenChange={(o) => !o && guard(onClose)}>
        <DrawerContent title="New invoice" description="A one-off charge for a single student" showTitle onInteractOutside={(e) => (form.formState.isDirty || student) && e.preventDefault()}>
          <form onSubmit={submit} noValidate className="flex h-full min-h-0 flex-col">
            <SheetBody className="flex-1">
              <FormSection title="Invoice">
                <Field label="Student" required error={tried && !student ? 'Choose a student' : null}>
                  <StudentPicker selected={student} onSelect={setStudent} invalid={tried && !student} />
                </Field>
                <FormInput control={form.control} name="title" label="Title" required placeholder="Annual day costume" maxLength={150} />
                <FormDate control={form.control} name="dueDate" label="Due date" required />
              </FormSection>
              <FormSection title="Charges">
                <div className="space-y-3">
                  {arr.fields.map((f, i) => (
                    <fieldset key={f.id} className="space-y-3 rounded-lg border border-border p-3">
                      <legend className="sr-only">Charge {i + 1}</legend>
                      <FormInput control={form.control} name={`items.${i}.description`} label="Description" required maxLength={200} />
                      <div className="grid gap-3 sm:grid-cols-2">
                        <FormSelect control={form.control} name={`items.${i}.categoryId`} label="Category" options={[{ value: 'none', label: 'No category' }, ...(cats.data?.data ?? []).filter((c) => c.isActive).map((c) => ({ value: c.id, label: c.name }))]} />
                        <FormInput control={form.control} name={`items.${i}.amount`} label="Amount" required inputMode="decimal" autoComplete="off" placeholder="500" />
                      </div>
                      {arr.fields.length > 1 && (
                        <div className="flex justify-end">
                          <IconButton label={`Remove charge ${i + 1}`} type="button" size="icon-sm" onClick={() => arr.remove(i)}>
                            <Trash2 />
                          </IconButton>
                        </div>
                      )}
                    </fieldset>
                  ))}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Button type="button" variant="secondary" size="sm" onClick={() => arr.append(blankItem)} disabled={arr.fields.length >= 30}>
                    <Plus /> Add a charge
                  </Button>
                  <p className="text-sm text-ink-2">
                    Total <span className="figure ml-1 text-[18px] text-ink">{money(total)}</span>
                  </p>
                </div>
              </FormSection>
              <FormTextarea control={form.control} name="notes" label="Notes" rows={2} maxLength={300} hint="Optional. Shown on the invoice." />
              {err && <Banner tone="danger">{err}</Banner>}
            </SheetBody>
            <FormActions>
              <Button variant="secondary" type="button" onClick={() => guard(onClose)}>
                Cancel
              </Button>
              <Button type="submit" loading={create.isPending}>
                Create invoice
              </Button>
            </FormActions>
          </form>
        </DrawerContent>
      </Drawer>
      {dialog}
    </>
  );
}

// ── void ────────────────────────────────────────────────────────────────────────────────────

export function VoidInvoiceButton({ invoice }: { invoice: InvoiceDetailOut }) {
  const { writeBlock, money } = useMgmt();
  const [open, setOpen] = React.useState(false);
  const voidMut = useVoidInvoice();
  if (invoice.status === 'void') return null;
  const base = writeBlock('fees:approve', 'school');
  const hasPayments = invoice.payments.some((p) => p.status === 'succeeded' || p.status === 'partially_refunded' || p.status === 'pending');
  const blocked = base ?? (hasPayments ? 'This invoice has payments. Refund them first, then void it.' : null);
  return (
    <>
      <GuardedButton blocked={blocked} variant="danger" onClick={() => setOpen(true)}>
        Void invoice
      </GuardedButton>
      <ReasonDialog
        open={open}
        onOpenChange={setOpen}
        title={`Void invoice ${invoice.invoiceNo}?`}
        description={
          <>
            {invoice.studentName} will no longer owe {money(invoice.balanceMinor)} on this invoice. A voided invoice cannot be paid or reopened; raise a new invoice if it was voided by mistake. The reason is kept in the audit log.
          </>
        }
        label="Reason for voiding"
        minLength={3}
        confirmLabel="Void invoice"
        destructive
        onConfirm={async (reason) => {
          await voidMut.mutateAsync({ id: invoice.id, reason });
          toast.success(`Invoice ${invoice.invoiceNo} voided`);
        }}
      />
    </>
  );
}

// ── print ───────────────────────────────────────────────────────────────────────────────────

export function PrintInvoiceButton({ invoice }: { invoice: InvoiceDetailOut }) {
  const { site, currency } = useMgmt();
  return (
    <Button
      variant="secondary"
      onClick={() => {
        const m = (n: number) => esc(fmtMoney(n, currency));
        printHtml(
          `Invoice ${invoice.invoiceNo}`,
          `<div class="row"><div><h1>${esc(site?.name ?? 'Invoice')}</h1><p class="muted">Fee invoice</p></div><div style="text-align:right"><p><strong>${esc(invoice.invoiceNo)}</strong></p><p class="muted">Issued ${esc(fmtDate(invoice.issuedAt))}</p><p class="muted">Due ${esc(fmtDate(invoice.dueDate))}</p></div></div>
           <div class="box"><p><strong>${esc(invoice.studentName)}</strong></p><p class="muted">${esc(invoice.admissionNo)}${invoice.gradeName ? ` · ${esc(invoice.gradeName)}${invoice.sectionName ? ` ${esc(invoice.sectionName)}` : ''}` : ''}</p></div>
           <h2>${esc(invoice.title)}</h2>
           <table><thead><tr><th>Item</th><th>Category</th><th class="r">Amount</th><th class="r">Discount</th></tr></thead><tbody>${invoice.items.map((i) => `<tr><td>${esc(i.description)}</td><td>${esc(i.categoryName ?? '')}</td><td class="r">${m(i.amountMinor)}</td><td class="r">${i.discountMinor ? m(i.discountMinor) : ''}</td></tr>`).join('')}</tbody></table>
           <div class="box"><div class="row"><span>Total</span><strong>${m(invoice.totalMinor)}</strong></div><div class="row"><span>Discount</span><span>${m(invoice.discountMinor)}</span></div><div class="row"><span>Paid</span><span>${m(invoice.paidMinor)}</span></div><div class="row"><span><strong>Balance</strong></span><strong>${m(invoice.balanceMinor)}</strong></div>${invoice.lateFeeMinor > 0 ? `<div class="row"><span>Late fee</span><span>${m(invoice.lateFeeMinor)}</span></div>` : ''}</div>
           ${invoice.payments.length ? `<h2>Payments</h2><table><thead><tr><th>Receipt</th><th>Method</th><th>Status</th><th class="r">Amount</th></tr></thead><tbody>${invoice.payments.map((p) => `<tr><td>${esc(p.receiptNo ?? '—')}</td><td>${esc(p.method.replace('_', ' '))}</td><td>${esc(p.status.replace('_', ' '))}</td><td class="r">${m(p.amountMinor)}</td></tr>`).join('')}</tbody></table>` : ''}
           ${invoice.notes ? `<p class="muted" style="margin-top:12px">${esc(invoice.notes)}</p>` : ''}`,
        );
      }}
    >
      <Printer /> Print
    </Button>
  );
}

// ── concession links ────────────────────────────────────────────────────────────────────────

const valueText = (c: ConcessionOut, money: (n: number) => string) => (c.type === 'percent' ? `${(c.value / 100).toFixed(c.value % 100 === 0 ? 0 : 2)}% off` : `${money(c.value)} a year`);

/** The student's concessions, so a discount on an invoice can be traced to where it came from. */
export function InvoiceConcessions({ invoice }: { invoice: InvoiceDetailOut }) {
  const { base, money, can } = useMgmt();
  const q = useConcessions({ studentId: invoice.studentId, pageSize: 20 }, can('fees:view'));
  const list = (q.data?.data ?? []).filter((c) => c.status !== 'rejected');
  if (q.isPending || q.isError || (list.length === 0 && invoice.discountMinor === 0)) return null;
  return (
    <section aria-labelledby="inv-con">
      <h3 id="inv-con" className="t-section mb-2">
        Concessions
      </h3>
      {list.length === 0 ? (
        <p className="text-sm text-ink-2">A discount of {money(invoice.discountMinor)} was applied when this invoice was created.</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {list.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm">{c.name}</p>
                <p className="t-caption text-ink-3">
                  {valueText(c, money)}
                  {c.categoryName ? ` · ${c.categoryName} only` : ''}
                  {c.status === 'approved' ? ` · ${money(c.appliedMinor)} applied so far` : ''}
                </p>
              </div>
              <StatusChip status={c.status} />
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-sm">
        <Link href={`${base}/finance/structures?tab=concessions&student=${invoice.studentId}`} className="font-medium text-brand-ink underline-offset-4 hover:underline">
          Manage this student’s concessions
        </Link>
      </p>
    </section>
  );
}
