'use client';

import * as React from 'react';
import { FilePenLine } from 'lucide-react';
import { z } from 'zod';
import { CORRECTION_FIELDS, GENDERS, correctionCreateBody, type CorrectionField, type CorrectionOut, type StudentDetailOut } from '@school-sync/shared';
import { useCancelCorrection, useCorrections, useCreateCorrection, useStudentRecord } from '@/lib/client/learner-profile';
import { applyApiErrors, useZodForm } from '@/lib/client/use-zod-form';
import { useUnsavedGuard } from '@/lib/client/use-unsaved-guard';
import { errorMessage } from '@/lib/problem';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { StatusChip } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Drawer, DrawerContent, SheetBody, SheetFooter } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { FormDate, FormInput, FormSection, FormSelect, FormTextarea } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toaster';
import { Pager } from '../comms/common';
import { ErrorState, SkeletonRows } from '../states';
import { useGates, useLearner } from '../use-learner';
import { usePageParam } from '../url-state';

const FIELD_LABEL: Record<CorrectionField, string> = {
  firstName: 'First name',
  lastName: 'Last name',
  dob: 'Date of birth',
  gender: 'Gender',
  bloodGroup: 'Blood group',
  nationality: 'Nationality',
  religion: 'Religion',
  category: 'Category',
  address: 'Home address',
  medicalNotes: 'Medical notes',
};
const GENDER_LABEL: Record<string, string> = { male: 'Male', female: 'Female', other: 'Other' };

type Addr = Record<string, string | undefined> | null | undefined;
const addrText = (a: Addr): string => (a ? [a.line1, a.line2, a.city, a.state, a.postalCode, a.country].filter(Boolean).join(', ') : '');

/** How a stored value reads to a person. */
function show(field: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return 'Not set';
  if (field === 'address' && typeof v === 'object') return addrText(v as Addr) || 'Not set';
  if (field === 'dob' && typeof v === 'string') return fmtDate(v);
  if (field === 'gender' && typeof v === 'string') return GENDER_LABEL[v] ?? v;
  return String(v);
}

function currentOf(rec: StudentDetailOut | undefined, f: CorrectionField): unknown {
  return rec ? (rec as unknown as Record<string, unknown>)[f] : undefined;
}

// ───────────────────────────── list ─────────────────────────────

/** Correction requests filed for this student (their own, or the child's for a parent), with a request button. */
export function CorrectionsPanel({ studentId, studentName }: { studentId: string; studentName: string }) {
  const l = useLearner();
  const { readOnly } = useGates();
  const [page, setPage] = usePageParam('cpage');
  const q = useCorrections(studentId, { page, pageSize: 10 });
  const cancel = useCancelCorrection();
  const [open, setOpen] = React.useState(false);
  const [cancelling, setCancelling] = React.useState<CorrectionOut | null>(null);

  const doCancel = async () => {
    if (!cancelling) return;
    try {
      await cancel.mutateAsync(cancelling.id);
      toast.success('Request withdrawn');
    } catch (e) {
      toast.error(errorMessage(e), { duration: 8000 });
    } finally {
      setCancelling(null);
    }
  };

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Record corrections"
        description={`Ask the school to fix an official detail${l.isParent ? ` for ${studentName}` : ''} — name, date of birth, address and so on. Nothing changes until the school approves it.`}
        action={
          <Button size="sm" onClick={() => setOpen(true)} disabled={readOnly}>
            <FilePenLine /> Request a correction
          </Button>
        }
        className="pb-4"
      />
      {q.isPending ? (
        <SkeletonRows rows={2} />
      ) : q.isError && !q.data ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} compact />
      ) : q.data && q.data.data.length === 0 ? (
        <div className="border-t border-border">
          <EmptyState compact icon={<FilePenLine />} title="No correction requests" description="If something on the official record is wrong, request a correction and the school will review it." />
        </div>
      ) : (
        <>
          <ul className="divide-y divide-border border-t border-border" aria-busy={q.isFetching || undefined}>
            {q.data?.data.map((r) => (
              <li key={r.id} className="space-y-2 px-5 py-4 max-sm:px-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="text-sm font-medium">{Object.keys(r.changes).map((k) => FIELD_LABEL[k as CorrectionField] ?? k).join(', ')}</p>
                  <StatusChip status={r.status} />
                </div>
                <ul className="space-y-0.5">
                  {Object.entries(r.changes).map(([k, v]) => (
                    <li key={k} className="t-caption text-ink-2">
                      <span className="font-medium text-ink">{FIELD_LABEL[k as CorrectionField] ?? k}:</span> {show(k, r.original[k])} <span aria-hidden>→</span> <span className="sr-only">changed to</span> <span className="text-ink">{show(k, v)}</span>
                    </li>
                  ))}
                </ul>
                {r.reason && <p className="t-caption text-ink-2">Reason: {r.reason}</p>}
                {r.decisionNote && <p className="t-caption rounded-md bg-surface-subtle px-2.5 py-1.5 text-ink-2">School’s note: {r.decisionNote}</p>}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="t-caption text-ink-3">Sent {fmtDateTime(r.createdAt)}{r.decidedAt ? ` · decided ${fmtDateTime(r.decidedAt)}` : ''}</p>
                  {r.status === 'pending' && (
                    <Button variant="ghost" size="sm" disabled={readOnly} onClick={() => setCancelling(r)}>
                      Withdraw
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <Pager page={page} totalPages={q.data?.meta.totalPages ?? 1} total={q.data?.meta.total ?? 0} onPage={setPage} noun="requests" />
        </>
      )}
      <CorrectionDrawer open={open} onOpenChange={setOpen} studentId={studentId} studentName={studentName} />
      <ConfirmDialog
        open={!!cancelling}
        onOpenChange={(o) => !o && setCancelling(null)}
        title="Withdraw this request?"
        description="The school will no longer review it. You can send a new request at any time."
        confirmLabel="Withdraw request"
        cancelLabel="Keep it"
        destructive
        loading={cancel.isPending}
        onConfirm={() => void doCancel()}
      />
    </Card>
  );
}

// ───────────────────────────── request form ─────────────────────────────

const text = (max: number) => z.string().trim().max(max, `Keep it under ${max} characters`);
const formSchema = z.object({
  fields: z.array(z.enum(CORRECTION_FIELDS)).min(1, 'Tick at least one detail you want corrected'),
  reason: z.string().trim().min(3, 'Tell the school why (at least 3 characters)').max(500, 'Keep it under 500 characters'),
  firstName: text(80),
  lastName: text(80),
  dob: z.string(),
  gender: z.string(),
  bloodGroup: text(5),
  nationality: text(60),
  religion: text(60),
  category: text(60),
  medicalNotes: text(2000),
  line1: text(120),
  line2: text(120),
  city: text(80),
  state: text(80),
  postalCode: text(20),
  country: text(80),
});
type FormValues = z.input<typeof formSchema>;

const blank = (): FormValues => ({ fields: [], reason: '', firstName: '', lastName: '', dob: '', gender: '', bloodGroup: '', nationality: '', religion: '', category: '', medicalNotes: '', line1: '', line2: '', city: '', state: '', postalCode: '', country: '' });

function CorrectionDrawer({ open, onOpenChange, studentId, studentName }: { open: boolean; onOpenChange: (o: boolean) => void; studentId: string; studentName: string }) {
  const rec = useStudentRecord(open ? studentId : null);
  const create = useCreateCorrection(studentId);
  const [formError, setFormError] = React.useState<string | null>(null);
  const form = useZodForm(formSchema, { defaultValues: blank() });
  const { guard, dialog } = useUnsavedGuard(form.formState.isDirty && open);
  const selected = form.watch('fields') as CorrectionField[];

  React.useEffect(() => {
    if (open) {
      form.reset(blank());
      setFormError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /** Ticking a detail pre-fills its input with the value on record, so the person edits instead of retyping. */
  const toggle = (f: CorrectionField, on: boolean) => {
    const cur = new Set(selected);
    if (on) {
      cur.add(f);
      const r = rec.data;
      if (r) {
        if (f === 'address') {
          form.setValue('line1', r.address?.line1 ?? '');
          form.setValue('line2', r.address?.line2 ?? '');
          form.setValue('city', r.address?.city ?? '');
          form.setValue('state', r.address?.state ?? '');
          form.setValue('postalCode', r.address?.postalCode ?? '');
          form.setValue('country', r.address?.country ?? '');
        } else {
          form.setValue(f, String(currentOf(r, f) ?? ''));
        }
      }
    } else cur.delete(f);
    form.setValue('fields', CORRECTION_FIELDS.filter((x) => cur.has(x)), { shouldDirty: true, shouldValidate: true });
  };

  const submit = form.handleSubmit(async (v) => {
    setFormError(null);
    const r = rec.data;
    const changes: Record<string, unknown> = {};
    const same: string[] = [];
    for (const f of v.fields) {
      let next: unknown;
      if (f === 'address') {
        const a = Object.fromEntries(Object.entries({ line1: v.line1, line2: v.line2, city: v.city, state: v.state, postalCode: v.postalCode, country: v.country }).filter(([, x]) => x !== ''));
        next = Object.keys(a).length ? a : null;
        if (JSON.stringify(next) === JSON.stringify(r?.address ?? null)) same.push(FIELD_LABEL[f]);
      } else if (f === 'firstName') {
        if (!v.firstName) {
          form.setError('firstName', { type: 'required', message: 'The first name can’t be empty' });
          return;
        }
        next = v.firstName;
        if (next === r?.firstName) same.push(FIELD_LABEL[f]);
      } else {
        const raw = v[f as 'lastName'] as string;
        next = raw === '' ? null : raw;
        if ((next ?? null) === ((currentOf(r, f) as string | null | undefined) ?? null)) same.push(FIELD_LABEL[f]);
      }
      changes[f] = next;
    }
    if (same.length > 0) {
      setFormError(`${same.join(', ')} ${same.length === 1 ? 'is' : 'are'} the same as what the school already has. Change the value, or untick it.`);
      return;
    }
    const body = correctionCreateBody.safeParse({ changes, reason: v.reason });
    if (!body.success) {
      setFormError(body.error.issues[0]?.message ?? 'Check the form and try again.');
      return;
    }
    try {
      await create.mutateAsync(body.data);
      toast.success('Request sent to the school', { description: 'You’ll be told when it’s reviewed.' });
      form.reset(blank());
      onOpenChange(false);
    } catch (e) {
      setFormError(applyApiErrors(form, e));
    }
  });

  const cur = (f: CorrectionField) => (rec.data ? show(f, currentOf(rec.data, f)) : '…');

  return (
    <>
      <Drawer open={open} onOpenChange={(o) => (o ? onOpenChange(true) : guard(() => onOpenChange(false)))}>
        <DrawerContent title="Request a record correction" description={`For ${studentName}. The school reviews every request.`} showTitle onInteractOutside={(e) => form.formState.isDirty && (e.preventDefault(), guard(() => onOpenChange(false)))}>
          <form onSubmit={submit} noValidate className="flex h-full flex-col">
            <SheetBody className="flex-1">
              {rec.isError && <Banner tone="warning">We couldn’t load the current details, so they aren’t shown below. You can still describe the correction. <button type="button" className="font-medium underline" onClick={() => void rec.refetch()}>Retry</button></Banner>}
              <FormSection title="What needs correcting?" description="Tick each detail that is wrong, then enter the right value.">
                {rec.isPending ? (
                  <div className="space-y-3" aria-busy="true"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
                ) : (
                  <ul className="space-y-3">
                    {CORRECTION_FIELDS.map((f) => {
                      const on = selected.includes(f);
                      const id = `corr-${f}`;
                      return (
                        <li key={f} className="rounded-lg border border-border p-3">
                          <div className="flex items-start gap-2.5">
                            <Checkbox id={id} checked={on} onCheckedChange={(c) => toggle(f, c === true)} className="mt-0.5" />
                            <label htmlFor={id} className="min-w-0 flex-1 text-sm">
                              <span className="font-medium">{FIELD_LABEL[f]}</span>
                              <span className="t-caption block text-ink-2">On record: {cur(f)}</span>
                            </label>
                          </div>
                          {on && (
                            <div className="mt-3 space-y-3 pl-7">
                              {f === 'dob' ? (
                                <FormDate control={form.control} name="dob" label="Correct date of birth" max={new Date().toISOString().slice(0, 10)} />
                              ) : f === 'gender' ? (
                                <FormSelect control={form.control} name="gender" label="Correct gender" options={GENDERS.map((g) => ({ value: g, label: GENDER_LABEL[g] ?? g }))} />
                              ) : f === 'medicalNotes' ? (
                                <FormTextarea control={form.control} name="medicalNotes" label="Correct medical notes" rows={3} maxLength={2000} hint="Leave empty to clear the notes." />
                              ) : f === 'address' ? (
                                <>
                                  <FormInput control={form.control} name="line1" label="Address line 1" />
                                  <FormInput control={form.control} name="line2" label="Address line 2" />
                                  <div className="grid gap-3 sm:grid-cols-2">
                                    <FormInput control={form.control} name="city" label="City" />
                                    <FormInput control={form.control} name="state" label="State" />
                                    <FormInput control={form.control} name="postalCode" label="Postal code" />
                                    <FormInput control={form.control} name="country" label="Country" />
                                  </div>
                                </>
                              ) : (
                                <FormInput control={form.control} name={f} label={`Correct ${FIELD_LABEL[f].toLowerCase()}`} maxLength={f === 'bloodGroup' ? 5 : 80} required={f === 'firstName'} hint={f === 'firstName' ? undefined : 'Leave empty to clear it.'} />
                              )}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
                {form.formState.errors.fields?.message && <p role="alert" className="t-caption text-danger">{String(form.formState.errors.fields.message)}</p>}
              </FormSection>
              <FormSection title="Why?">
                <FormTextarea control={form.control} name="reason" label="Reason for the correction" required rows={3} maxLength={500} hint="For example: the birth certificate spells the name differently." />
              </FormSection>
              {formError && <Banner tone="danger">{formError}</Banner>}
              <p className="t-caption text-ink-2">The school may ask to see a document before approving. You’ll get a notification either way.</p>
            </SheetBody>
            <SheetFooter>
              <Button type="button" variant="secondary" onClick={() => guard(() => onOpenChange(false))}>Cancel</Button>
              <Button type="submit" loading={form.formState.isSubmitting || create.isPending} disabled={rec.isPending}>Send request</Button>
            </SheetFooter>
          </form>
        </DrawerContent>
      </Drawer>
      {dialog}
    </>
  );
}
