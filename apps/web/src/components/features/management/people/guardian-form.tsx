'use client';

import * as React from 'react';
import { guardianCreateBody, guardianUpdateBody, RELATIONSHIPS, type GuardianOut, type IssuedCredential } from '@school-sync/shared';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { FormActions, FormCheckbox, FormInput, FormSection } from '@/components/ui/form';
import { useCreateGuardian, useGuardianActions } from '@/lib/client/people';
import { applyApiErrors, hasDirtyFields } from '@/lib/client/use-zod-form';
import { useFormDrawer } from './form-drawer';
import { AddressFields, anyControl, Disclosure } from './fields';
import { ErrorBanner } from './errors';
import { nullMissing, rootError, usePeopleForm } from './form';
import { RELATIONSHIP_OPTIONS } from './ui';
import { LabelledSelect } from '../shared/controls';
import { ApiError } from '@/lib/problem';

const trimAddress = (a: GuardianOut['address']) => (a ? { line1: a.line1 ?? '', line2: a.line2 ?? '', city: a.city ?? '', state: a.state ?? '', postalCode: a.postalCode ?? '', country: a.country ?? '' } : undefined);

/** Create a parent. With `createLogin` the API returns a temporary password once — `onCreated` receives it. */
export function GuardianCreateForm({ onCreated, withLink, submitLabel = 'Add parent' }: { onCreated: (g: GuardianOut, credential: IssuedCredential | null, link?: { relationship: (typeof RELATIONSHIPS)[number]; isPrimary: boolean; canPickup: boolean; isEmergencyContact: boolean; verified: boolean }) => Promise<void> | void; /** show the relationship + flags (when linking to a student right after) */ withLink?: boolean; submitLabel?: string }) {
  const create = useCreateGuardian();
  const form = usePeopleForm(guardianCreateBody, { defaultValues: { firstName: '', lastName: '', phone: '', email: '', occupation: '', createLogin: true } });
  const [link, setLink] = React.useState({ relationship: 'guardian' as (typeof RELATIONSHIPS)[number], isPrimary: false, canPickup: true, isEmergencyContact: false, verified: false });
  const [error, setError] = React.useState<unknown>(null);
  const [formError, setFormError] = React.useState<string | null>(null);
  const { requestClose } = useFormDrawer(hasDirtyFields(form.formState) && !form.formState.isSubmitSuccessful);

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      noValidate
      onSubmit={form.handleSubmit(
        async (v) => {
          setError(null);
          setFormError(null);
          try {
            const g = await create.mutateAsync(v);
            await onCreated(g, g.credentials, withLink ? link : undefined);
          } catch (e) {
            const msg = applyApiErrors(form, e);
            if (e instanceof ApiError && e.code === 'VALIDATION_ERROR' && msg === null) return;
            setError(e);
          }
        },
        (errs) => setFormError(rootError(errs)),
      )}
    >
      <div className="space-y-6 overflow-y-auto px-5 py-4">
        <FormSection title="Parent">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormInput control={form.control} name="firstName" label="First name" required autoComplete="off" />
            <FormInput control={form.control} name="lastName" label="Last name" autoComplete="off" />
            <FormInput control={form.control} name="phone" label="Mobile number" hint="Becomes the username." inputMode="tel" autoComplete="off" />
            <FormInput control={form.control} name="email" label="Email" type="email" autoComplete="off" />
          </div>
        </FormSection>
        {withLink && (
          <FormSection title="Relationship to the student">
            <LabelledSelect label="Relationship" value={link.relationship} onChange={(v) => setLink((l) => ({ ...l, relationship: v as typeof l.relationship }))} options={RELATIONSHIP_OPTIONS} />
            <LinkFlags value={link} onChange={setLink} />
          </FormSection>
        )}
        <FormSection title="Sign-in">
          <FormCheckbox control={form.control} name="createLogin" label="Create a parent login now" hint="A temporary password is shown once. Parents only see a child after you verify the link." />
        </FormSection>
        <Disclosure label="more details">
          <FormInput control={form.control} name="occupation" label="Occupation" />
          <AddressFields control={anyControl(form.control)} />
        </Disclosure>
        {(formError || form.formState.errors.root?.message) && <Banner tone="danger">{formError ?? form.formState.errors.root?.message}</Banner>}
        <ErrorBanner error={error} />
      </div>
      <FormActions>
        <Button type="button" variant="secondary" onClick={requestClose}>
          Cancel
        </Button>
        <Button type="submit" loading={form.formState.isSubmitting}>
          {submitLabel}
        </Button>
      </FormActions>
    </form>
  );
}

export interface LinkFlagState {
  isPrimary: boolean;
  canPickup: boolean;
  isEmergencyContact: boolean;
  verified?: boolean;
}

/** Primary / pickup / emergency (and optionally "verify now") as checkboxes. */
export function LinkFlags<T extends LinkFlagState>({ value, onChange, showVerified = true }: { value: T; onChange: (v: T) => void; showVerified?: boolean }) {
  const row = (key: keyof LinkFlagState, label: string, hint?: string) => (
    <label key={key} className="flex items-start gap-2.5 text-sm">
      <input type="checkbox" checked={!!value[key]} onChange={(e) => onChange({ ...value, [key]: e.target.checked })} className="mt-0.5 size-[18px] shrink-0 accent-[var(--brand)]" />
      <span>
        {label}
        {hint && <span className="t-caption block text-ink-3">{hint}</span>}
      </span>
    </label>
  );
  return (
    <div className="space-y-2.5">
      {row('isPrimary', 'Primary contact')}
      {row('canPickup', 'May pick the child up')}
      {row('isEmergencyContact', 'Emergency contact')}
      {showVerified && row('verified', 'Verify the relationship now', 'Only tick this when the school has checked it. The parent can see the child immediately and is notified.')}
    </div>
  );
}

/** Edit a parent's details (the login's phone / email follow). */
export function GuardianEditForm({ guardian, onSaved }: { guardian: GuardianOut; onSaved: () => void }) {
  const { update } = useGuardianActions(guardian.id);
  const form = usePeopleForm(guardianUpdateBody, {
    defaultValues: { firstName: guardian.firstName, lastName: guardian.lastName ?? '', phone: guardian.phone ?? '', email: guardian.email ?? '', occupation: guardian.occupation ?? '', address: trimAddress(guardian.address) },
  });
  const [error, setError] = React.useState<unknown>(null);
  const { requestClose } = useFormDrawer(hasDirtyFields(form.formState) && !form.formState.isSubmitSuccessful);
  const restricted = guardian.phone === null && guardian.email === null;
  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      noValidate
      onSubmit={form.handleSubmit(async (v) => {
        setError(null);
        try {
          await update.mutateAsync(nullMissing(v, ['lastName', 'phone', 'email', 'occupation', 'address']));
          onSaved();
        } catch (e) {
          const msg = applyApiErrors(form, e);
          if (e instanceof ApiError && e.code === 'VALIDATION_ERROR' && msg === null) return;
          setError(e);
        }
      })}
    >
      <div className="space-y-6 overflow-y-auto px-5 py-4">
        <FormSection title="Parent">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormInput control={form.control} name="firstName" label="First name" required />
            <FormInput control={form.control} name="lastName" label="Last name" />
            <FormInput control={form.control} name="phone" label="Mobile number" hint={guardian.hasLogin ? 'Changing it also changes the sign-in username.' : undefined} inputMode="tel" />
            <FormInput control={form.control} name="email" label="Email" type="email" />
          </div>
          {restricted && <p className="t-caption text-ink-3">Contact details are hidden for your role. Leaving them empty keeps what is stored only if you do not edit them.</p>}
        </FormSection>
        <Disclosure label="more details">
          <FormInput control={form.control} name="occupation" label="Occupation" />
          <AddressFields control={anyControl(form.control)} />
        </Disclosure>
        <ErrorBanner error={error} />
      </div>
      <FormActions>
        <Button type="button" variant="secondary" onClick={requestClose}>
          Cancel
        </Button>
        <Button type="submit" loading={form.formState.isSubmitting}>
          Save changes
        </Button>
      </FormActions>
    </form>
  );
}

