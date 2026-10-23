'use client';

import * as React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useFieldArray } from 'react-hook-form';
import { z } from 'zod';
import { myProfileUpdateBody, phoneStr, type MyProfileOut } from '@school-sync/shared';
import { useUpdateProfile } from '@/lib/client/learner-profile';
import { applyApiErrors, useZodForm } from '@/lib/client/use-zod-form';
import { useUnsavedGuard } from '@/lib/client/use-unsaved-guard';
import { ApiError } from '@/lib/problem';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { FormInput, FormSection } from '@/components/ui/form';
import { toast } from '@/components/ui/toaster';
import { useGates } from '../use-learner';

const phoneField = z
  .string()
  .trim()
  .refine((v) => v === '' || phoneStr.safeParse(v).success, 'Enter a valid phone number (digits, optionally with + and spaces)');
const text = (max: number, msg = `Keep it under ${max} characters`) => z.string().trim().max(max, msg);

// ───────────────────────────── my contact details ─────────────────────────────

const detailsForm = z.object({
  phone: phoneField,
  email: z
    .string()
    .trim()
    .max(160, 'Keep it under 160 characters')
    .refine((v) => v === '' || z.email().safeParse(v).success, 'Enter a valid email address'),
  line1: text(120),
  line2: text(120),
  city: text(80),
  state: text(80),
  postalCode: text(20),
  country: text(80),
  currentPassword: z.string(),
});

const addrOf = (p: MyProfileOut) => ({ line1: p.address?.line1 ?? '', line2: p.address?.line2 ?? '', city: p.address?.city ?? '', state: p.address?.state ?? '', postalCode: p.address?.postalCode ?? '', country: p.address?.country ?? '' });

/** Phone, email and address (GET/PATCH /me/profile). Names, birth date and medical details change only through a correction request. */
export function ContactDetailsForm({ profile }: { profile: MyProfileOut }) {
  const { readOnly } = useGates();
  const update = useUpdateProfile();
  const [formError, setFormError] = React.useState<string | null>(null);
  const initial = React.useMemo(() => ({ phone: profile.phone ?? '', email: profile.email ?? '', ...addrOf(profile), currentPassword: '' }), [profile]);
  const form = useZodForm(detailsForm, { defaultValues: initial });
  const { dialog } = useUnsavedGuard(form.formState.isDirty);
  const email = form.watch('email');
  const emailChanged = email.trim() !== (profile.email ?? '');

  React.useEffect(() => form.reset(initial), [initial]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = form.handleSubmit(async (v) => {
    setFormError(null);
    const body: Record<string, unknown> = {};
    if (v.phone !== (profile.phone ?? '')) body.phone = v.phone || null;
    if (emailChanged) {
      if (!v.currentPassword) {
        form.setError('currentPassword', { type: 'required', message: 'Enter your current password to change your email address' });
        return;
      }
      body.email = v.email || null;
      body.currentPassword = v.currentPassword;
    }
    const addr = { line1: v.line1, line2: v.line2, city: v.city, state: v.state, postalCode: v.postalCode, country: v.country };
    if (JSON.stringify(addr) !== JSON.stringify(addrOf(profile))) {
      const filled = Object.fromEntries(Object.entries(addr).filter(([, x]) => x !== ''));
      body.address = Object.keys(filled).length ? filled : null;
    }
    if (Object.keys(body).length === 0) {
      setFormError('Nothing has changed yet.');
      return;
    }
    const parsed = myProfileUpdateBody.safeParse(body);
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? 'Check the form and try again.');
      return;
    }
    try {
      await update.mutateAsync(parsed.data);
      toast.success('Your details were saved');
      form.reset({ ...v, currentPassword: '' });
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'INVALID_CREDENTIALS' || e.code === 'PASSWORD_REQUIRED')) {
        form.setError('currentPassword', { type: 'server', message: e.code === 'PASSWORD_REQUIRED' ? 'Enter your current password to change your email address' : 'That isn’t your current password. Check it and try again.' });
        return;
      }
      setFormError(applyApiErrors(form, e));
    }
  });

  return (
    <Card>
      <CardHeader title="Contact details" description="The school uses these to reach you. Your name and date of birth are changed only by the school." />
      <CardBody>
        <form onSubmit={submit} noValidate className="space-y-6">
          <FormSection title="How to reach you">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormInput control={form.control} name="phone" label="Phone" type="tel" inputMode="tel" autoComplete="tel" />
              <FormInput control={form.control} name="email" label="Email" type="email" autoComplete="email" hint="Used to recover your account." />
            </div>
            {emailChanged && <FormInput control={form.control} name="currentPassword" label="Current password" type="password" autoComplete="current-password" required hint="We ask for it when the email address changes, to keep your account safe." />}
          </FormSection>
          <FormSection title="Address">
            <FormInput control={form.control} name="line1" label="Address line 1" autoComplete="address-line1" />
            <FormInput control={form.control} name="line2" label="Address line 2" autoComplete="address-line2" />
            <div className="grid gap-4 sm:grid-cols-2">
              <FormInput control={form.control} name="city" label="City" autoComplete="address-level2" />
              <FormInput control={form.control} name="state" label="State" autoComplete="address-level1" />
              <FormInput control={form.control} name="postalCode" label="Postal code" autoComplete="postal-code" />
              <FormInput control={form.control} name="country" label="Country" autoComplete="country-name" />
            </div>
          </FormSection>
          {formError && <Banner tone="danger">{formError}</Banner>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" disabled={!form.formState.isDirty} onClick={() => form.reset(initial)}>Reset</Button>
            <Button type="submit" loading={form.formState.isSubmitting || update.isPending} disabled={readOnly || !form.formState.isDirty}>Save changes</Button>
          </div>
        </form>
      </CardBody>
      {dialog}
    </Card>
  );
}

// ───────────────────────────── emergency contacts ─────────────────────────────

const contactsForm = z.object({
  contacts: z
    .array(
      z.object({
        name: z.string().trim().min(1, 'Enter a name').max(120, 'Keep it under 120 characters'),
        relationship: text(40),
        phone: z.string().trim().min(1, 'Enter a phone number').refine((v) => phoneStr.safeParse(v).success, 'Enter a valid phone number'),
        altPhone: phoneField,
      }),
    )
    .max(10, 'You can list up to 10 contacts'),
});

type ContactRow = { name: string; relationship: string; phone: string; altPhone: string };
const toRows = (cs: { name: string; relationship?: string; phone: string; altPhone?: string }[]): ContactRow[] => cs.map((c) => ({ name: c.name, relationship: c.relationship ?? '', phone: c.phone, altPhone: c.altPhone ?? '' }));

/**
 * People the school may call about this child (PATCH /me/profile with `emergencyContacts`; parents also send `studentId`).
 * Saving replaces the whole list.
 */
export function EmergencyContactsForm({ studentId, studentName, contacts, parent }: { studentId: string; studentName: string; contacts: { name: string; relationship?: string; phone: string; altPhone?: string }[]; parent: boolean }) {
  const { readOnly } = useGates();
  const update = useUpdateProfile();
  const [formError, setFormError] = React.useState<string | null>(null);
  const initial = React.useMemo(() => ({ contacts: toRows(contacts) }), [contacts]);
  const form = useZodForm(contactsForm, { defaultValues: initial });
  const arr = useFieldArray({ control: form.control, name: 'contacts' });
  const { dialog } = useUnsavedGuard(form.formState.isDirty);

  React.useEffect(() => form.reset(initial), [initial]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = form.handleSubmit(async (v) => {
    setFormError(null);
    const emergencyContacts = v.contacts.map((c) => ({ name: c.name, phone: c.phone, ...(c.relationship ? { relationship: c.relationship } : {}), ...(c.altPhone ? { altPhone: c.altPhone } : {}) }));
    const parsed = myProfileUpdateBody.safeParse({ emergencyContacts, ...(parent ? { studentId } : {}) });
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? 'Check the form and try again.');
      return;
    }
    try {
      await update.mutateAsync(parsed.data);
      toast.success('Emergency contacts saved');
      form.reset(v);
    } catch (e) {
      setFormError(applyApiErrors(form, e));
    }
  });

  return (
    <Card>
      <CardHeader title={parent ? `Emergency contacts for ${studentName}` : 'Emergency contacts'} description="People the school can call if you can’t be reached. Saving replaces the whole list." />
      <CardBody>
        <form onSubmit={submit} noValidate className="space-y-5">
          {arr.fields.length === 0 && <p className="text-sm text-ink-2">No emergency contacts yet. Add at least one person the school can call.</p>}
          <ul className="space-y-4">
            {arr.fields.map((f, i) => (
              <li key={f.id} className="rounded-lg border border-border p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <p className="t-label">Contact {i + 1}</p>
                  <Button type="button" variant="ghost" size="sm" onClick={() => arr.remove(i)} aria-label={`Remove contact ${i + 1}`}>
                    <Trash2 /> Remove
                  </Button>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormInput control={form.control} name={`contacts.${i}.name`} label="Name" required autoComplete="off" />
                  <FormInput control={form.control} name={`contacts.${i}.relationship`} label="Relationship" hint="For example mother, uncle, neighbour" />
                  <FormInput control={form.control} name={`contacts.${i}.phone`} label="Phone" type="tel" inputMode="tel" required />
                  <FormInput control={form.control} name={`contacts.${i}.altPhone`} label="Alternate phone" type="tel" inputMode="tel" />
                </div>
              </li>
            ))}
          </ul>
          {formError && <Banner tone="danger">{formError}</Banner>}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button type="button" variant="secondary" size="sm" disabled={arr.fields.length >= 10} onClick={() => arr.append({ name: '', relationship: '', phone: '', altPhone: '' })}>
              <Plus /> Add a contact
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="secondary" disabled={!form.formState.isDirty} onClick={() => form.reset(initial)}>Reset</Button>
              <Button type="submit" loading={form.formState.isSubmitting || update.isPending} disabled={readOnly || !form.formState.isDirty}>Save contacts</Button>
            </div>
          </div>
        </form>
      </CardBody>
      {dialog}
    </Card>
  );
}
