'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ImageUp, Trash2 } from 'lucide-react';
import { z } from 'zod';
import { hexColor, type BrandingOut } from '@school-sync/shared';
import { SchoolMark } from '@/components/brand/school-mark';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { FormActions, FormInput } from '@/components/ui/form';
import { Field, Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toaster';
import { Controller } from 'react-hook-form';
import { uploadFile } from '@/lib/client/transfer';
import { useSaveBranding } from '@/lib/client/settings';
import { applyApiErrors, useZodForm, hasDirtyFields } from '@/lib/client/use-zod-form';
import { errorMessage } from '@/lib/problem';
import { normalizeHex } from '@/lib/color';
import { useAccess } from '../shared/access';
import { Panel } from '../shared/detail';
import { BrandPreview } from './brand-preview';

const schema = z.object({
  name: z.string().trim().min(2, 'Enter the school name').max(120, 'Use at most 120 characters'),
  shortName: z.string().trim().max(24, 'Use at most 24 characters'),
  primaryColor: hexColor,
  accentColor: z.union([z.literal(''), hexColor]),
});

const LOGO_TYPES = 'image/png,image/jpeg,image/webp,image/gif';
const MAX_LOGO_MB = 5;

function ColorField({ control, name, label, hint, optional }: { control: ReturnType<typeof useZodForm<typeof schema>>['control']; name: 'primaryColor' | 'accentColor'; label: string; hint?: string; optional?: boolean }) {
  const id = React.useId();
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        const valid = normalizeHex(field.value as string);
        return (
          <Field label={label} htmlFor={id} hint={hint} error={fieldState.error?.message} required={!optional}>
            <div className="flex items-center gap-2">
              <input
                type="color"
                aria-label={`${label}, colour picker`}
                value={valid ?? '#000000'}
                onChange={(e) => field.onChange(e.target.value)}
                className="h-11 w-12 shrink-0 cursor-pointer rounded-md border border-border-strong bg-surface p-1 sm:h-9"
              />
              <Input id={id} value={(field.value as string) ?? ''} onChange={(e) => field.onChange(e.target.value)} onBlur={field.onBlur} placeholder="#1b6b4f" invalid={!!fieldState.error} className="max-w-[10rem] font-mono" maxLength={7} autoComplete="off" spellCheck={false} />
              {optional && field.value ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => field.onChange('')}>
                  Clear
                </Button>
              ) : null}
            </div>
          </Field>
        );
      }}
    />
  );
}

/** Logo: upload (POST /files purpose=other) then attach it with the branding endpoint; shown straight away in the shell after a refresh. */
function LogoPanel({ data, canEdit, hint }: { data: BrandingOut; canEdit: boolean; hint?: string }) {
  const router = useRouter();
  const save = useSaveBranding();
  const input = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = React.useState(false);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (file.size > MAX_LOGO_MB * 1024 * 1024) {
      setError(`That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. Use an image up to ${MAX_LOGO_MB} MB.`);
      return;
    }
    setBusy(true);
    try {
      const up = await uploadFile(file, 'other');
      await save.mutateAsync({ logoFileId: up.id });
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };
  const src = data.logoUrl ? `${data.logoUrl}${data.logoUrl.includes('?') ? '&' : '?'}v=${data.logoFileId ?? ''}` : null;

  return (
    <Panel title="Logo" description="Shown on the sign-in page, in the app header, on report cards and in the mobile app.">
      <div className="flex flex-wrap items-center gap-4">
        <SchoolMark name={data.name} logoUrl={src} size="lg" className="!size-20 !rounded-xl !text-2xl" />
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => input.current?.click()} loading={busy} disabled={!canEdit} title={hint}>
              <ImageUp /> {data.logoFileId ? 'Replace logo' : 'Upload logo'}
            </Button>
            {data.logoFileId && (
              <Button variant="danger" onClick={() => setConfirmRemove(true)} disabled={!canEdit || busy} title={hint}>
                <Trash2 /> Remove
              </Button>
            )}
          </div>
          <p className="t-caption text-ink-3">PNG, JPEG, WebP or GIF, up to {MAX_LOGO_MB} MB. A square image on a plain background works best.</p>
        </div>
        <input ref={input} type="file" accept={LOGO_TYPES} className="sr-only" tabIndex={-1} aria-label="Choose a logo image" onChange={(e) => void pick(e.target.files?.[0])} />
      </div>
      {error && <Banner tone="danger" className="mt-4">{error}</Banner>}
      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title="Remove the school logo?"
        description="The sign-in page, the app header and report cards go back to the school’s initials until you upload another logo."
        confirmLabel="Remove logo"
        destructive
        loading={save.isPending}
        onConfirm={async () => {
          const r = await save.run({ logoFileId: null });
          if (r.ok) {
            setConfirmRemove(false);
            router.refresh();
          }
        }}
      />
    </Panel>
  );
}

export function BrandingForm({ data, onDirtyChange }: { data: BrandingOut; onDirtyChange?: (d: boolean) => void }) {
  const router = useRouter();
  const access = useAccess();
  const save = useSaveBranding();
  const editable = access.ok('settings:edit', 'school');
  const hint = access.hint('settings:edit', 'school');
  const defaults = React.useMemo(() => ({ name: data.name, shortName: data.shortName ?? '', primaryColor: data.primaryColor, accentColor: data.accentColor ?? '' }), [data]);
  const form = useZodForm(schema, { defaultValues: defaults });
  const [formError, setFormError] = React.useState<string | null>(null);
  const dirty = hasDirtyFields(form.formState);
  React.useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);
  React.useEffect(() => {
    form.reset(defaults);
  }, [defaults, form]);
  const primary = form.watch('primaryColor');

  const onSubmit = form.handleSubmit(async (v) => {
    setFormError(null);
    const body: Record<string, unknown> = {};
    if (v.name !== data.name) body.name = v.name;
    if ((v.shortName || null) !== data.shortName) body.shortName = v.shortName || null;
    if (v.primaryColor.toLowerCase() !== data.primaryColor.toLowerCase()) body.primaryColor = v.primaryColor;
    if ((v.accentColor || null) !== data.accentColor) body.accentColor = v.accentColor || null;
    if (Object.keys(body).length === 0) {
      toast.message('Nothing to save: no detail was changed.');
      return;
    }
    try {
      await save.mutateAsync(body);
      router.refresh();
    } catch (e) {
      setFormError(applyApiErrors(form, e));
    }
  });

  return (
    <div className="space-y-6">
      {!editable && <Banner tone={access.readOnly ? 'locked' : 'info'}>{hint ?? 'You can view the school profile but not change it.'}</Banner>}
      <LogoPanel data={data} canEdit={editable} hint={hint} />
      <form onSubmit={onSubmit} noValidate aria-label="School profile and colours" className="space-y-4">
        <Panel title="Name and colours" description="Changes appear for everyone as soon as they reload." bodyClassName="space-y-5 pb-5">
          <fieldset disabled={!editable} className="space-y-5 border-0 p-0">
            <div className="grid gap-5 sm:grid-cols-2">
              <FormInput control={form.control} name="name" label="School name" required autoComplete="organization" />
              <FormInput control={form.control} name="shortName" label="Short name" hint="Used where space is tight, such as the mobile app and the browser tab." />
            </div>
            <ColorField control={form.control} name="primaryColor" label="School colour" hint="Any colour works: the app softens and darkens it so text always stays readable." />
            <BrandPreview value={primary ?? ''} />
            <ColorField control={form.control} name="accentColor" label="Secondary colour" hint="Optional. Saved with the profile; the apps keep their own highlight colour for now." optional />
          </fieldset>
          <dl className="t-caption grid gap-x-6 gap-y-1 text-ink-2 sm:grid-cols-3">
            <div><dt className="inline text-ink-3">Timezone: </dt><dd className="inline">{data.timezone}</dd></div>
            <div><dt className="inline text-ink-3">Language: </dt><dd className="inline">{data.locale}</dd></div>
            <div><dt className="inline text-ink-3">Currency: </dt><dd className="inline">{data.currency}</dd></div>
          </dl>
          {formError && <Banner tone="danger">{formError}</Banner>}
        </Panel>
        {editable && (
          <FormActions className="rounded-lg border">
            <span className="t-caption mr-auto text-ink-2" aria-live="polite">{dirty ? 'You have unsaved changes.' : 'All changes saved.'}</span>
            <Button type="button" variant="secondary" disabled={!dirty} onClick={() => form.reset(defaults)}>
              Discard changes
            </Button>
            <Button type="submit" loading={save.isPending} disabled={!dirty}>
              Save changes
            </Button>
          </FormActions>
        )}
      </form>
    </div>
  );
}
