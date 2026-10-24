'use client';

import * as React from 'react';
import { Pencil, Plus, Receipt } from 'lucide-react';
import { z } from 'zod';
import type { PlatformSubscription, PlatformTenantDetail } from '@school-sync/shared';
import { Badge } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { FormCheckbox, FormDate, FormInput, FormSelect } from '@/components/ui/form';
import { EmptyState } from '@/components/ui/empty-state';
import { DefList, Panel } from '@/components/features/management/shared/detail';
import { applyApiErrors, useZodForm } from '@/lib/client/use-zod-form';
import { fmtDate, money } from '@/lib/format';
import { useUpsertSubscription } from '@/lib/platform/queries';
import { addYears, currentAcademicYear, LicenseChip, nextYearName } from './bits';

const num = (v: string) => (v.trim() === '' ? NaN : Number(v));
const schema = z
  .object({
    academicYear: z.string(),
    startsOn: z.string().min(1, 'Pick the start date'),
    endsOn: z.string().min(1, 'Pick the end date'),
    price: z.string(),
    seats: z.string(),
    overagePolicy: z.enum(['allow_and_bill', 'block']),
    graceDays: z.string(),
    trial: z.boolean(),
    notes: z.string().max(500),
  })
  .superRefine((v, ctx) => {
    const bad = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
    if (!/^\d{4}-\d{2}$/.test(v.academicYear)) bad('academicYear', 'Use a year like 2026-27');
    else if (Number(v.academicYear.slice(5)) !== (Number(v.academicYear.slice(0, 4)) + 1) % 100) bad('academicYear', 'The second part must be the next year, for example 2026-27');
    if (v.startsOn && v.endsOn && v.endsOn <= v.startsOn) bad('endsOn', 'The period must end after it starts');
    const price = num(v.price);
    if (!Number.isFinite(price) || price < 0) bad('price', 'Enter the price per student, for example 150');
    if (v.seats.trim() !== '' && !(Number.isInteger(num(v.seats)) && num(v.seats) >= 0)) bad('seats', 'Enter a whole number, or leave empty for no limit');
    const grace = num(v.graceDays);
    if (!Number.isInteger(grace) || grace < 0 || grace > 180) bad('graceDays', 'Enter 0 to 180 days');
  });

/** Create the next year's subscription (renew), add the first one, or edit a year's terms. */
export function SubscriptionDialog({ code, currency, mode, base, open, onOpenChange }: { code: string; currency: string; mode: 'renew' | 'edit'; base: PlatformSubscription | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const save = useUpsertSubscription(code);
  const [banner, setBanner] = React.useState<string | null>(null);
  const defaults = React.useMemo(() => {
    if (mode === 'edit' && base) return { academicYear: base.academicYear, startsOn: base.startsOn, endsOn: base.endsOn, price: String(base.pricePerStudentMinor / 100), seats: base.licensedStudents === null ? '' : String(base.licensedStudents), overagePolicy: base.overagePolicy, graceDays: String(base.graceDays), trial: base.status === 'trial', notes: base.notes ?? '' };
    if (base) return { academicYear: nextYearName(base.academicYear), startsOn: addYears(base.startsOn, 1), endsOn: addYears(base.endsOn, 1), price: String(base.pricePerStudentMinor / 100), seats: base.licensedStudents === null ? '' : String(base.licensedStudents), overagePolicy: base.overagePolicy, graceDays: String(base.graceDays), trial: false, notes: '' };
    const y = currentAcademicYear();
    return { academicYear: y.name, startsOn: y.startsOn, endsOn: y.endsOn, price: '', seats: '', overagePolicy: 'allow_and_bill' as const, graceDays: '30', trial: false, notes: '' };
  }, [mode, base]);
  const form = useZodForm(schema, { defaultValues: defaults });
  const { control, handleSubmit, reset, formState } = form;
  React.useEffect(() => {
    if (open) {
      reset(defaults);
      setBanner(null);
    }
  }, [open, defaults, reset]);

  const onSubmit = handleSubmit(async (v) => {
    setBanner(null);
    try {
      await save.mutateAsync({ academicYear: v.academicYear, startsOn: v.startsOn, endsOn: v.endsOn, pricePerStudentMinor: Math.round(Number(v.price) * 100), licensedStudents: v.seats.trim() === '' ? null : Number(v.seats), overagePolicy: v.overagePolicy, graceDays: Number(v.graceDays), trial: v.trial, currency, ...(v.notes.trim() ? { notes: v.notes.trim() } : {}) });
      onOpenChange(false);
    } catch (e) {
      setBanner(applyApiErrors(form, e) ?? 'Please check the highlighted fields.');
    }
  });

  const title = mode === 'edit' ? `Edit ${base?.academicYear}` : base ? 'Renew subscription' : 'Add subscription';
  return (
    <Dialog open={open} onOpenChange={(o) => !formState.isSubmitting && onOpenChange(o)}>
      <DialogContent title={title} description={mode === 'edit' ? 'Changes apply immediately: seat limits and read-only status are re-evaluated.' : 'Saving a year that already exists replaces its terms. Renewing restores write access at once.'} size="lg">
        <form onSubmit={onSubmit} noValidate className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormInput control={control} name="academicYear" label="Academic year" required disabled={mode === 'edit'} placeholder="2026-27" />
            <FormInput control={control} name="price" label={`Price per student (${currency})`} required inputMode="decimal" hint="Major units, for example 150 or 149.50." />
            <FormDate control={control} name="startsOn" label="Starts" required />
            <FormDate control={control} name="endsOn" label="Ends" required />
            <FormInput control={control} name="seats" label="Committed seats" inputMode="numeric" hint="Leave empty for no limit." />
            <FormSelect control={control} name="overagePolicy" label="When seats run out" options={[{ value: 'allow_and_bill', label: 'Keep admitting and bill the extra' }, { value: 'block', label: 'Block new students' }]} />
            <FormInput control={control} name="graceDays" label="Grace days after the period" inputMode="numeric" />
            <FormCheckbox control={control} name="trial" label="This is a trial" className="self-end pb-2" />
          </div>
          <FormInput control={control} name="notes" label="Internal notes" hint="Only operators see these." />
          {banner && <Banner tone="danger" role="alert">{banner}</Banner>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={formState.isSubmitting}>Cancel</Button>
            <Button type="submit" loading={formState.isSubmitting}>{mode === 'edit' ? 'Save changes' : 'Save subscription'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function SubscriptionPanel({ detail, onIssue }: { detail: PlatformTenantDetail; onIssue: () => void }) {
  const { license: l, subscriptions: subs, tenant } = detail;
  const latest = subs[0] ?? null;
  const [dialog, setDialog] = React.useState<{ mode: 'renew' | 'edit'; base: PlatformSubscription | null } | null>(null);
  const live = tenant.status === 'active' || tenant.status === 'suspended';

  const columns: Column<PlatformSubscription>[] = [
    { id: 'year', header: 'Year', mobile: 'title', cell: (s) => <span className="flex items-center gap-2 font-medium">{s.academicYear}{s.academicYear === l.academicYear && <Badge variant="primary">Current</Badge>}{s.status === 'trial' && <Badge variant="info">Trial</Badge>}{s.status === 'cancelled' && <Badge variant="neutral">Cancelled</Badge>}</span> },
    { id: 'period', header: 'Period', label: 'Period', mobile: 'sub', cell: (s) => <span className="tnum">{fmtDate(s.startsOn)} to {fmtDate(s.endsOn)}</span> },
    { id: 'seats', header: 'Seats', label: 'Seats', align: 'right', mobile: 'detail', cell: (s) => (s.licensedStudents === null ? 'No limit' : s.licensedStudents.toLocaleString()) },
    { id: 'price', header: 'Price per student', label: 'Price per student', align: 'right', mobile: 'value', cell: (s) => money(s.pricePerStudentMinor, s.currency) },
    { id: 'policy', header: 'When seats run out', label: 'When seats run out', mobile: 'detail', cell: (s) => (s.overagePolicy === 'block' ? 'Block' : 'Bill the extra') },
    { id: 'grace', header: 'Grace', label: 'Grace', align: 'right', mobile: 'detail', cell: (s) => `${s.graceDays} d` },
    { id: 'edit', header: <span className="sr-only">Edit</span>, label: 'Edit', hideable: false, align: 'right', mobile: 'detail', cell: (s) => <Button size="sm" variant="ghost" onClick={() => setDialog({ mode: 'edit', base: s })} aria-label={`Edit subscription ${s.academicYear}`}><Pencil /> Edit</Button> },
  ];

  return (
    <div className="space-y-6">
      {l.state === 'unlicensed' && <Banner tone="warning" title="No subscription yet">This school is not licensed, so it runs without a seat limit and nothing is billed. Add a subscription to start metering and invoicing.</Banner>}
      {(l.state === 'expired' || l.state === 'cancelled') && <Banner tone="locked" title="Read-only until renewed">The school can still read everything, but every change is refused. Renewing restores write access immediately.</Banner>}
      {l.state === 'grace' && <Banner tone="warning" title="In the grace period">The subscription ended and the school keeps full access until {fmtDate(l.graceEndsOn)}. Renew before then.</Banner>}
      <Panel
        title="Current subscription"
        description={l.academicYear ? `Academic year ${l.academicYear}` : undefined}
        actions={<LicenseChip state={l.state} />}
        bodyClassName="space-y-5"
      >
        {l.academicYear ? (
          <DefList
            cols={2}
            items={[
              { label: 'Period', value: `${fmtDate(l.startsOn)} to ${fmtDate(l.endsOn)}` },
              { label: 'Grace ends', value: fmtDate(l.graceEndsOn) },
              { label: 'Committed seats', value: l.licensedStudents === null ? 'No limit' : l.licensedStudents.toLocaleString() },
              { label: 'Price per student', value: l.pricePerStudentMinor !== null ? money(l.pricePerStudentMinor, l.currency ?? tenant.currency) : null },
              { label: 'Committed value', value: l.licensedStudents !== null && l.pricePerStudentMinor !== null ? money(l.licensedStudents * l.pricePerStudentMinor, l.currency ?? tenant.currency) : null },
              { label: 'When seats run out', value: l.overagePolicy === 'block' ? 'Block new students' : 'Keep admitting and bill the extra' },
            ]}
          />
        ) : (
          <p className="text-sm text-ink-2">Nothing to show until a subscription is added.</p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setDialog({ mode: 'renew', base: latest })} disabled={!live}>
            <Plus /> {latest ? 'Renew for next year' : 'Add subscription'}
          </Button>
          <Button variant="secondary" onClick={onIssue} disabled={!live || subs.length === 0}>
            <Receipt /> Issue invoice
          </Button>
        </div>
      </Panel>

      <section aria-labelledby="sub-history">
        <h2 id="sub-history" className="t-section mb-3">History</h2>
        <DataTable<PlatformSubscription>
          memoRows
          id="platform-subscriptions"
          caption="Subscription history"
          rows={subs}
          rowKey={(s) => s.id}
          columns={columns}
          empty={<EmptyState illustration="empty-generic" title="No subscriptions yet" description="Add the first subscription to license this school for an academic year." compact />}
        />
      </section>

      <SubscriptionDialog code={tenant.code} currency={tenant.currency} mode={dialog?.mode ?? 'renew'} base={dialog?.base ?? null} open={!!dialog} onOpenChange={(o) => !o && setDialog(null)} />
    </div>
  );
}
