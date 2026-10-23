'use client';

import * as React from 'react';
import { z } from 'zod';
import { libraryPolicyUpdateBody } from '@school-sync/shared';
import { useLibraryPolicy, useSavePolicy } from '@/lib/client/operations';
import { amountText, minorToText, parseMinor } from '@/lib/client/mgmt';
import { applyApiErrors, useZodForm } from '@/lib/client/use-zod-form';
import { useUnsavedGuard } from '@/lib/client/use-unsaved-guard';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { FormInput, FormSection } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toaster';
import { GuardedButton } from '../common/guarded';
import { ErrorPanel } from '../common/states';
import { useMgmt } from '../common/use-mgmt';

const days = (what: string) => z.string().regex(/^[1-9]\d{0,2}$/, `${what}: whole days, 1 to 365`).refine((v) => Number(v) <= 365, `${what}: at most 365 days`);
const limit = (what: string) => z.string().regex(/^[1-9]\d?$/, `${what}: 1 to 50`).refine((v) => Number(v) <= 50, `${what}: at most 50`);
const form = z.object({ loanDays: days('Student loan period'), staffLoanDays: days('Staff loan period'), finePerDay: amountText('the fine', { allowZero: true }), maxLoansPerStudent: limit('Student limit'), maxLoansPerStaff: limit('Staff limit') });

/** Loan period, fine per day and borrowing limits. Everyone with library access can read them; changing needs library edit rights. */
export function PolicyTab() {
  const { writeBlock, money } = useMgmt();
  const q = useLibraryPolicy();
  const save = useSavePolicy();
  const block = writeBlock('library:edit', 'school');
  const f = useZodForm(form, { defaultValues: { loanDays: '', staffLoanDays: '', finePerDay: '', maxLoansPerStudent: '', maxLoansPerStaff: '' } });
  const [err, setErr] = React.useState<string | null>(null);
  const { dialog } = useUnsavedGuard(f.formState.isDirty);
  const p = q.data;
  React.useEffect(() => {
    if (p) f.reset({ loanDays: String(p.loanDays), staffLoanDays: String(p.staffLoanDays), finePerDay: minorToText(p.finePerDayMinor) || '0', maxLoansPerStudent: String(p.maxLoansPerStudent), maxLoansPerStaff: String(p.maxLoansPerStaff) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p]);
  const fine = parseMinor(f.watch('finePerDay'));

  if (q.isPending) return <Skeleton className="h-72 max-w-xl" aria-busy />;
  if (q.isError || !p) return <ErrorPanel error={q.error} onRetry={() => void q.refetch()} title="We couldn’t load the library policy" />;

  const submit = f.handleSubmit(async (v) => {
    setErr(null);
    try {
      const body = libraryPolicyUpdateBody.parse({ loanDays: Number(v.loanDays), staffLoanDays: Number(v.staffLoanDays), finePerDayMinor: parseMinor(v.finePerDay)!, maxLoansPerStudent: Number(v.maxLoansPerStudent), maxLoansPerStaff: Number(v.maxLoansPerStaff) });
      await save.mutateAsync(body);
      toast.success('Library policy saved', { description: 'It applies to books issued from now on.' });
      f.reset(f.getValues());
    } catch (e) {
      setErr(applyApiErrors(f, e, { finePerDayMinor: 'finePerDay' }));
    }
  });

  return (
    <>
      <Card className="max-w-2xl">
        <CardBody>
          <form onSubmit={submit} noValidate className="space-y-6">
            {block && <Banner tone="info">You can read the policy. Changing it needs library edit rights.</Banner>}
            <fieldset disabled={!!block} className="space-y-6 border-0 p-0">
              <FormSection title="Loan periods">
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormInput control={f.control} name="loanDays" label="Students may keep a book for (days)" required inputMode="numeric" maxLength={3} />
                  <FormInput control={f.control} name="staffLoanDays" label="Staff may keep a book for (days)" required inputMode="numeric" maxLength={3} />
                </div>
              </FormSection>
              <FormSection title="Fines">
                <FormInput control={f.control} name="finePerDay" label="Fine per day late" required inputMode="decimal" hint={fine !== null ? (fine === 0 ? 'No fines are charged.' : `${money(fine)} for each day a book is late.`) : undefined} />
              </FormSection>
              <FormSection title="Limits">
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormInput control={f.control} name="maxLoansPerStudent" label="Books a student may borrow at once" required inputMode="numeric" maxLength={2} />
                  <FormInput control={f.control} name="maxLoansPerStaff" label="Books a staff member may borrow at once" required inputMode="numeric" maxLength={2} />
                </div>
              </FormSection>
            </fieldset>
            {err && <Banner tone="danger">{err}</Banner>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" disabled={!f.formState.isDirty} onClick={() => f.reset()}>
                Discard changes
              </Button>
              <GuardedButton blocked={block} type="submit" loading={save.isPending} disabled={!f.formState.isDirty}>
                Save policy
              </GuardedButton>
            </div>
          </form>
        </CardBody>
      </Card>
      {dialog}
    </>
  );
}
