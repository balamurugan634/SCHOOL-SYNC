'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Controller, type Control } from 'react-hook-form';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { FormCheckbox, FormInput, FormSelect, FormActions } from '@/components/ui/form';
import { toast } from '@/components/ui/toaster';
import { useSaveSettingsGroup } from '@/lib/client/settings';
import { applyApiErrors, useZodForm, hasDirtyFields } from '@/lib/client/use-zod-form';
import { useSite } from '@/components/site-context';
import { weekdayName } from '@/lib/client/options';
import { cn } from '@/lib/cn';
import { useAccess } from '../shared/access';
import { Panel } from '../shared/detail';
import { groupSchema, NOTIFICATION_CATEGORIES, toApiBody, toFormValues, type FieldSpec, type GroupSpec } from './groups';

type Values = Record<string, unknown>;

function CheckboxGroup({ control, name, label, hint, options, error }: { control: Control<Values>; name: string; label: string; hint?: string; options: { value: string | number; label: string }[]; error?: string }) {
  const gid = React.useId();
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        const value = (field.value as (string | number)[] | undefined) ?? [];
        const toggle = (v: string | number, on: boolean) => field.onChange(on ? [...value, v] : value.filter((x) => x !== v));
        return (
          <fieldset className="space-y-2">
            <legend className="t-label text-ink">{label}</legend>
            <div className="flex flex-wrap gap-x-5 gap-y-2" role="group" aria-labelledby={gid}>
              <span id={gid} className="sr-only">{label}</span>
              {options.map((o) => {
                const id = `${gid}-${o.value}`;
                return (
                  <div key={o.value} className="flex min-h-9 items-center gap-2">
                    <Checkbox id={id} checked={value.includes(o.value)} onCheckedChange={(c) => toggle(o.value, c === true)} />
                    <label htmlFor={id} className="text-sm">{o.label}</label>
                  </div>
                );
              })}
            </div>
            {(fieldState.error?.message ?? error) ? <p role="alert" className="t-caption text-danger">{fieldState.error?.message ?? error}</p> : hint ? <p className="t-caption text-ink-3">{hint}</p> : null}
          </fieldset>
        );
      }}
    />
  );
}

function FieldView({ spec, control, currency }: { spec: FieldSpec; control: Control<Values>; currency: string }) {
  switch (spec.kind) {
    case 'text':
      return <FormInput control={control} name={spec.name} label={spec.label} hint={spec.hint} placeholder={spec.placeholder} autoComplete="off" />;
    case 'number':
      return <FormInput control={control} name={spec.name} label={spec.unit ? `${spec.label} (${spec.unit})` : spec.label} hint={spec.hint} type="number" inputMode="numeric" min={spec.min} max={spec.max} className="max-w-xs" />;
    case 'money':
      return <FormInput control={control} name={spec.name} label={`${spec.label} (${currency})`} hint={spec.hint} type="number" inputMode="decimal" min={0} step="0.01" className="max-w-xs" />;
    case 'bool':
      return <FormCheckbox control={control} name={spec.name} label={spec.label} hint={spec.hint} />;
    case 'select':
      return <FormSelect control={control} name={spec.name} label={spec.label} hint={spec.hint} options={spec.options} className="max-w-xs" />;
    case 'time':
      return <FormInput control={control} name={spec.name} label={spec.label} hint={spec.hint} type="time" className="max-w-[10rem]" />;
    case 'weekdays':
      return <CheckboxGroup control={control} name={spec.name} label={spec.label} hint={spec.hint} options={[1, 2, 3, 4, 5, 6, 7].map((d) => ({ value: d, label: weekdayName(d) }))} />;
    case 'categories':
      return <CheckboxGroup control={control} name={spec.name} label={spec.label} hint={spec.hint} options={NOTIFICATION_CATEGORIES} />;
  }
}

/** One settings group as a validated form. Saves only the fields that changed (the API takes any subset). */
export function GroupForm({ spec, data, onDirtyChange }: { spec: GroupSpec; data: Values; onDirtyChange?: (dirty: boolean) => void }) {
  const router = useRouter();
  const site = useSite();
  const access = useAccess();
  const save = useSaveSettingsGroup(spec.key);
  const schema = React.useMemo(() => groupSchema(spec.fields), [spec.fields]);
  const defaults = React.useMemo(() => toFormValues(spec.fields, data), [spec.fields, data]);
  const form = useZodForm(schema, { defaultValues: defaults as never });
  const [formError, setFormError] = React.useState<string | null>(null);
  const dirty = hasDirtyFields(form.formState);
  React.useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);
  const editable = access.ok('settings:edit', 'school');
  const hint = access.hint('settings:edit', 'school');
  const featureOff = spec.feature && site && !site.features[spec.feature];

  // a refetch (after saving, or someone else's change) becomes the new baseline
  React.useEffect(() => {
    form.reset(defaults as never);
  }, [defaults, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    const body = toApiBody(spec.fields, values as Values, data);
    if (Object.keys(body).length === 0) {
      toast.message('Nothing to save: no setting was changed.');
      return;
    }
    try {
      await save.mutateAsync(body);
      router.refresh();
    } catch (e) {
      setFormError(applyApiErrors(form, e));
    }
  });

  const control = form.control as unknown as Control<Values>;
  return (
    <form onSubmit={onSubmit} noValidate aria-label={spec.title}>
      <Panel title={spec.title} description={spec.description} bodyClassName="space-y-5 pb-5">
        {featureOff && <Banner tone="info">This feature is switched off for the school, so these settings have no effect until it is switched on under Features.</Banner>}
        {!editable && <Banner tone={access.readOnly ? 'locked' : 'info'}>{hint ?? 'You can view these settings but not change them.'}</Banner>}
        <fieldset disabled={!editable} className={cn('space-y-5 border-0 p-0', !editable && 'opacity-80')}>
          {spec.fields.map((f) => (
            <FieldView key={f.name} spec={f} control={control} currency={site?.currency ?? 'INR'} />
          ))}
        </fieldset>
        {spec.note && <p className="t-caption text-ink-2">{spec.note}</p>}
        {formError && <Banner tone="danger">{formError}</Banner>}
      </Panel>
      {editable && (
        <FormActions className="mt-4 rounded-lg border">
          <span className="t-caption mr-auto text-ink-2" aria-live="polite">{hasDirtyFields(form.formState) ? 'You have unsaved changes.' : 'All changes saved.'}</span>
          <Button type="button" variant="secondary" disabled={!hasDirtyFields(form.formState)} onClick={() => form.reset(defaults as never)}>
            Discard changes
          </Button>
          <Button type="submit" loading={save.isPending} disabled={!hasDirtyFields(form.formState)}>
            Save changes
          </Button>
        </FormActions>
      )}
    </form>
  );
}

