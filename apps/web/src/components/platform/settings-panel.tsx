'use client';

import * as React from 'react';
import { Pause, Play } from 'lucide-react';
import { z } from 'zod';
import { hexColor, type PlatformTenantDetail } from '@school-sync/shared';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field, Input } from '@/components/ui/input';
import { FormInput } from '@/components/ui/form';
import { Panel } from '@/components/features/management/shared/detail';
import { ReasonDialog } from '@/components/features/management/shared/dialogs';
import { applyApiErrors, hasDirtyFields, useZodForm } from '@/lib/client/use-zod-form';
import { useSetTenantStatus, useUpdateTenant } from '@/lib/platform/queries';
import { DatabasePanel } from './updates';
import { Controller } from 'react-hook-form';

const FEATURES = [
  { key: 'fees', label: 'Fees', hint: 'Fee structures, invoices and receipts' },
  { key: 'transport', label: 'Transport', hint: 'Bus routes and stops' },
  { key: 'library', label: 'Library', hint: 'Catalogue and lending' },
  { key: 'onlinePayments', label: 'Online payments', hint: 'Parents pay fees through the payment gateway' },
  { key: 'studentLogin', label: 'Student sign-in', hint: 'Students can sign in themselves' },
] as const;
type FeatureKey = (typeof FEATURES)[number]['key'];

const profileSchema = z.object({
  name: z.string().trim().min(2, 'Enter the school’s name').max(120),
  shortName: z.string().trim().max(24, 'At most 24 characters'),
  brandColor: hexColor,
  timezone: z.string().trim().min(3, 'Enter a time zone such as Asia/Kolkata').max(60),
});

export function SettingsPanel({ detail }: { detail: PlatformTenantDetail }) {
  return (
    <div className="space-y-6">
      <ProfileForm detail={detail} />
      <FeaturesForm detail={detail} />
      <DatabasePanel detail={detail} />
      <AccessPanel detail={detail} />
    </div>
  );
}

function ProfileForm({ detail }: { detail: PlatformTenantDetail }) {
  const t = detail.tenant;
  const update = useUpdateTenant(t.code);
  const [banner, setBanner] = React.useState<string | null>(null);
  const values = React.useMemo(() => ({ name: t.name, shortName: t.branding.shortName ?? '', brandColor: t.branding.primaryColor ?? '#0e5a63', timezone: t.timezone }), [t]);
  const form = useZodForm(profileSchema, { defaultValues: values });
  const { control, handleSubmit, reset, formState } = form;
  React.useEffect(() => reset(values), [values, reset]);
  const onSubmit = handleSubmit(async (v) => {
    setBanner(null);
    try {
      await update.mutateAsync({ name: v.name, shortName: v.shortName.trim() === '' ? null : v.shortName.trim(), brandColor: v.brandColor, timezone: v.timezone });
    } catch (e) {
      setBanner(applyApiErrors(form, e) ?? 'Please check the highlighted fields.');
    }
  });
  return (
    <Panel title="School profile" description="What the school's own apps show. The site code cannot be changed.">
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormInput control={control} name="name" label="School name" required />
          <FormInput control={control} name="shortName" label="Short name" hint="Shown in tight places such as the mobile header. Optional." />
          <Controller
            control={control}
            name="brandColor"
            render={({ field, fieldState }) => (
              <Field label="Brand colour" htmlFor="brand-color" error={fieldState.error?.message} required>
                <div className="flex items-center gap-2">
                  <input type="color" aria-label="Pick a colour" value={/^#[0-9a-f]{6}$/i.test(field.value) ? field.value : '#0e5a63'} onChange={(e) => field.onChange(e.target.value)} className="h-11 w-11 shrink-0 cursor-pointer rounded-md border border-border-strong bg-surface p-1 sm:h-9 sm:w-9" />
                  <Input id="brand-color" value={field.value} onChange={(e) => field.onChange(e.target.value)} onBlur={field.onBlur} invalid={!!fieldState.error} className="font-mono" spellCheck={false} autoComplete="off" />
                </div>
              </Field>
            )}
          />
          <FormInput control={control} name="timezone" label="Time zone" required hint="An IANA name, for example Asia/Kolkata." />
        </div>
        {banner && <Banner tone="danger" role="alert">{banner}</Banner>}
        <div className="flex justify-end">
          <Button type="submit" loading={formState.isSubmitting} disabled={!hasDirtyFields(formState)}>Save profile</Button>
        </div>
      </form>
    </Panel>
  );
}

function FeaturesForm({ detail }: { detail: PlatformTenantDetail }) {
  const t = detail.tenant;
  const update = useUpdateTenant(t.code);
  const [draft, setDraft] = React.useState<Record<FeatureKey, boolean>>(t.features);
  React.useEffect(() => setDraft(t.features), [t.features]);
  const changed = FEATURES.filter((f) => draft[f.key] !== t.features[f.key]);
  return (
    <Panel title="Feature switches" description="Turn whole areas on or off for this school. The school's administrators can see the result straight away.">
      <fieldset className="space-y-3">
        <legend className="sr-only">Features</legend>
        {FEATURES.map((f) => (
          <div key={f.key} className="flex items-start gap-2.5">
            <Checkbox id={`feat-${f.key}`} checked={draft[f.key]} onCheckedChange={(v) => setDraft((d) => ({ ...d, [f.key]: v === true }))} className="mt-0.5" />
            <label htmlFor={`feat-${f.key}`} className="text-sm">
              {f.label}
              <span className="t-caption block text-ink-3">{f.hint}</span>
            </label>
          </div>
        ))}
      </fieldset>
      <div className="mt-4 flex items-center justify-end gap-2">
        {changed.length > 0 && <Button variant="ghost" onClick={() => setDraft(t.features)} disabled={update.isPending}>Discard</Button>}
        <Button
          loading={update.isPending}
          disabled={changed.length === 0}
          onClick={() => void update.run({ features: Object.fromEntries(changed.map((f) => [f.key, draft[f.key]])) })}
        >
          Save switches
        </Button>
      </div>
    </Panel>
  );
}

function AccessPanel({ detail }: { detail: PlatformTenantDetail }) {
  const t = detail.tenant;
  const status = useSetTenantStatus(t.code);
  const [suspend, setSuspend] = React.useState(false);
  const [resume, setResume] = React.useState(false);
  const suspended = t.status === 'suspended';
  const canToggle = t.status === 'active' || t.status === 'suspended';
  return (
    <Panel title={suspended ? 'This school is suspended' : 'Suspend access'} description={suspended ? 'Its apps show a suspended notice and nobody can sign in. Data is kept.' : 'Stops everyone at this school from signing in or using the app. Data is kept, and resuming restores access at once.'}>
      {!canToggle && <Banner tone="warning">This school is “{t.status}”, so it cannot be suspended or resumed from here.</Banner>}
      {canToggle && (suspended ? (
        <Button onClick={() => setResume(true)}><Play /> Resume school</Button>
      ) : (
        <Button variant="danger" onClick={() => setSuspend(true)}><Pause /> Suspend school</Button>
      ))}
      <ReasonDialog
        open={suspend}
        onOpenChange={setSuspend}
        title={`Suspend ${t.name}?`}
        description="Teachers, parents, students and administrators will not be able to sign in or use the app until you resume the school."
        label="Reason"
        placeholder="For example: invoice BIL-2026-00012 unpaid"
        confirmLabel="Suspend school"
        destructive
        consequence="The reason is kept in the audit log, not shown to the school."
        onSubmit={async (reason) => (await status.run({ status: 'suspended', ...(reason ? { reason } : {}) })).ok}
      />
      <ConfirmDialog open={resume} onOpenChange={setResume} title={`Resume ${t.name}?`} description="Everyone at this school can sign in and use the app again straight away." confirmLabel="Resume school" loading={status.isPending} onConfirm={async () => { if ((await status.run({ status: 'active' })).ok) setResume(false); }} />
    </Panel>
  );
}
