'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Camera, KeyRound, MonitorSmartphone, Plus, Trash2, UserRound } from 'lucide-react';
import type { MyProfileOut } from '@school-sync/shared';
import { myProfileUpdateBody } from '@school-sync/shared';
import { ApiError } from '@/lib/problem';
import { assetUrl } from '@/lib/assets';
import { applyApiErrors, useZodForm } from '@/lib/client/use-zod-form';
import { useUnsavedGuard } from '@/lib/client/use-unsaved-guard';
import { commsError } from '@/lib/client/teacher-comms';
import { AVATAR_MAX_MB, AVATAR_TYPES, useAvatar, useMyProfile, useUpdateProfile, type ProfileUpdate } from '@/lib/client/teacher-me';
import { usePermissions } from '@/components/me-context';
import { Avatar } from '@/components/ui/avatar';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { FormInput, FormSection } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toaster';
import { ErrorCard, Meta, useWriteGate } from '../common';
import { NullableInput } from '../messages/fields';

export function ProfileScreen() {
  const q = useMyProfile();
  if (q.isPending)
    return (
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_minmax(0,1fr)]" aria-busy>
        <Skeleton className="h-80 w-full" />
        <Skeleton className="h-[28rem] w-full" />
      </div>
    );
  if (q.isError || !q.data) return <ErrorCard error={q.error} onRetry={() => void q.refetch()} title="We couldn’t load your profile" />;
  return <ProfileView profile={q.data} />;
}

function ProfileView({ profile }: { profile: MyProfileOut }) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_minmax(0,1fr)] lg:items-start">
      <div className="space-y-6">
        <IdentityCard profile={profile} />
        <AccountLinks />
      </div>
      <ContactForm key={`${profile.email}|${profile.phone}|${JSON.stringify(profile.address)}|${JSON.stringify(profile.staff?.emergencyContact)}`} profile={profile} />
    </div>
  );
}

/* ───────────────────────── identity + avatar ───────────────────────── */

function IdentityCard({ profile }: { profile: MyProfileOut }) {
  const router = useRouter();
  const gate = useWriteGate();
  const { upload, remove } = useAvatar();
  const input = React.useRef<HTMLInputElement>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [removing, setRemoving] = React.useState(false);
  const src = assetUrl(profile.avatarUrl);

  const pick = (file: File | undefined) => {
    if (input.current) input.current.value = '';
    if (!file) return;
    setError(null);
    if (!AVATAR_TYPES.includes(file.type)) return setError('Choose a JPEG, PNG or WebP picture.');
    if (file.size > AVATAR_MAX_MB * 1024 * 1024) return setError(`That picture is larger than ${AVATAR_MAX_MB} MB. Choose a smaller one.`);
    upload.mutate(file, {
      onSuccess: () => {
        toast.success('Profile picture updated');
        router.refresh();
      },
      onError: (e) => setError(commsError(e)),
    });
  };

  return (
    <Card>
      <CardBody className="space-y-5">
        <div className="flex items-center gap-4">
          <Avatar name={profile.displayName} src={src} size="xl" ring role="teacher" />
          <div className="min-w-0">
            <p className="text-base font-semibold">{profile.displayName}</p>
            <p className="t-caption text-ink-2">{profile.staff?.designation ?? 'Teacher'}</p>
          </div>
        </div>
        {error && <Banner tone="danger" onDismiss={() => setError(null)}>{error}</Banner>}
        <div className="flex flex-wrap gap-2">
          <input ref={input} type="file" accept={AVATAR_TYPES.join(',')} className="sr-only" tabIndex={-1} aria-label="Choose a profile picture" onChange={(e) => pick(e.target.files?.[0])} />
          <Button variant="secondary" size="sm" loading={upload.isPending} disabled={gate.readOnly} title={gate.reason} onClick={() => input.current?.click()}>
            <Camera /> {src ? 'Change picture' : 'Add a picture'}
          </Button>
          {src && (
            <Button variant="ghost" size="sm" disabled={gate.readOnly || remove.isPending} onClick={() => setRemoving(true)}>
              <Trash2 /> Remove
            </Button>
          )}
        </div>
        <p className="t-caption text-ink-3">JPEG, PNG or WebP, up to {AVATAR_MAX_MB} MB.</p>

        <div className="border-t border-border pt-4">
          <h2 className="t-section mb-1">Set by the school office</h2>
          <p className="t-caption mb-3 text-ink-2">These can’t be edited here. Ask the office if something is wrong.</p>
          <Meta
            cols={1}
            items={[
              { label: 'Name', value: profile.displayName },
              { label: 'Username', value: profile.username },
              { label: 'Employee ID', value: profile.staff?.employeeId },
              { label: 'Designation', value: profile.staff?.designation },
              { label: 'Department', value: profile.staff?.department },
            ]}
          />
        </div>
      </CardBody>
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title="Remove your picture?"
        description="Your initials are shown instead. You can add a picture again at any time."
        confirmLabel="Remove picture"
        destructive
        loading={remove.isPending}
        onConfirm={() =>
          remove.mutate(undefined, {
            onSuccess: () => {
              toast.success('Profile picture removed');
              setRemoving(false);
              router.refresh();
            },
            onError: (e) => {
              setRemoving(false);
              setError(commsError(e));
            },
          })
        }
      />
    </Card>
  );
}

function AccountLinks() {
  return (
    <Card>
      <CardHeader title="Account and security" />
      <CardBody className="space-y-2 pt-3">
        {[
          { href: '/account', label: 'Account details', icon: UserRound },
          { href: '/account/sessions', label: 'Signed-in devices', icon: MonitorSmartphone },
          { href: '/change-password', label: 'Change password', icon: KeyRound },
        ].map((l) => (
          <Button key={l.href} asChild variant="secondary" className="w-full justify-start">
            <Link href={l.href}>
              <l.icon /> {l.label}
            </Link>
          </Button>
        ))}
      </CardBody>
    </Card>
  );
}

/* ───────────────────────── contact form ───────────────────────── */

const strip = <T extends Record<string, string | undefined | null>>(o: T): Partial<T> | null => {
  const out = Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '').map(([k, v]) => [k, String(v).trim()])) as Partial<T>;
  return Object.keys(out).length ? out : null;
};

function ContactForm({ profile }: { profile: MyProfileOut }) {
  const { can } = usePermissions();
  const gate = useWriteGate();
  const update = useUpdateProfile();
  const a = profile.address;
  const form = useZodForm(myProfileUpdateBody, {
    defaultValues: {
      phone: profile.phone ?? null,
      email: profile.email ?? null,
      address: { line1: a?.line1 ?? '', line2: a?.line2 ?? '', city: a?.city ?? '', state: a?.state ?? '', postalCode: a?.postalCode ?? '', country: a?.country ?? '' },
      emergencyContact: profile.staff?.emergencyContact ?? null,
      currentPassword: undefined,
    },
  });
  const [error, setError] = React.useState<string | null>(null);
  const dirty = form.formState.isDirty;
  const { dialog } = useUnsavedGuard(dirty);
  const email = form.watch('email');
  const emailChanged = (email ?? '') !== (profile.email ?? '');
  const ec = form.watch('emergencyContact');
  const readOnlyAll = gate.readOnly;

  const submit = form.handleSubmit(
    async (v) => {
      setError(null);
      if (emailChanged && !v.currentPassword) {
        form.setError('currentPassword', { type: 'validate', message: 'Enter your current password to change your email address.' });
        return;
      }
      const body: ProfileUpdate = {
        phone: v.phone ?? null,
        address: v.address ? strip(v.address) : null,
        emergencyContact: v.emergencyContact ? { name: v.emergencyContact.name, phone: v.emergencyContact.phone, ...(v.emergencyContact.relationship ? { relationship: v.emergencyContact.relationship } : {}), ...(v.emergencyContact.altPhone ? { altPhone: v.emergencyContact.altPhone } : {}) } : null,
        ...(emailChanged ? { email: v.email ?? null, currentPassword: v.currentPassword } : {}),
      };
      try {
        await update.mutateAsync(body);
        toast.success('Profile saved');
        form.reset({ ...v, currentPassword: undefined });
      } catch (e) {
        if (e instanceof ApiError && (e.code === 'INVALID_CREDENTIALS' || e.code === 'PASSWORD_REQUIRED')) {
          form.setError('currentPassword', { type: 'server', message: e.code === 'PASSWORD_REQUIRED' ? 'Enter your current password to change your email address.' : 'That password isn’t right. Check it and try again.' });
          return;
        }
        const m = applyApiErrors(form, e);
        setError(m === null ? 'Some details need fixing. Check the highlighted fields.' : commsError(e));
      }
    },
    () => setError('Some details need fixing. Check the highlighted fields.'),
  );

  return (
    <form onSubmit={submit} noValidate>
      <Card>
        <CardHeader title="Contact details" description="The school uses these to reach you. Parents never see them." />
        <CardBody className="space-y-6 pt-4">
          {readOnlyAll && <Banner tone="locked">{gate.reason}</Banner>}
          {error && <Banner tone="danger" onDismiss={() => setError(null)}>{error}</Banner>}
          {!can('staff:view') && <Banner tone="warning">Your role can’t view staff records, so some details may be missing.</Banner>}

          <FormSection title="Phone and email">
            <NullableInput control={form.control} name="phone" label="Phone" type="tel" inputMode="tel" autoComplete="tel" maxLength={20} placeholder="e.g. +91 98765 43210" />
            <NullableInput control={form.control} name="email" label="Email" type="email" inputMode="email" autoComplete="email" maxLength={160} hint="This is also where password reset links are sent." />
            {emailChanged && (
              <NullableInput control={form.control} name="currentPassword" label="Current password" type="password" autoComplete="current-password" empty="undefined" required hint="Needed once to confirm the new email address." />
            )}
          </FormSection>

          <FormSection title="Address">
            <FormInput control={form.control} name="address.line1" label="Address line 1" autoComplete="address-line1" maxLength={120} />
            <FormInput control={form.control} name="address.line2" label="Address line 2" autoComplete="address-line2" maxLength={120} />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormInput control={form.control} name="address.city" label="City" autoComplete="address-level2" maxLength={80} />
              <FormInput control={form.control} name="address.state" label="State" autoComplete="address-level1" maxLength={80} />
              <FormInput control={form.control} name="address.postalCode" label="Postal code" autoComplete="postal-code" maxLength={20} />
              <FormInput control={form.control} name="address.country" label="Country" autoComplete="country-name" maxLength={80} />
            </div>
          </FormSection>

          <FormSection title="Emergency contact" description="Someone the school can call if it can’t reach you.">
            {ec ? (
              <div className="space-y-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <FormInput control={form.control} name="emergencyContact.name" label="Name" required maxLength={120} />
                  <NullableInput control={form.control} name="emergencyContact.relationship" label="Relationship" empty="undefined" maxLength={40} placeholder="e.g. Spouse" />
                  <FormInput control={form.control} name="emergencyContact.phone" label="Phone" required type="tel" inputMode="tel" maxLength={20} />
                  <NullableInput control={form.control} name="emergencyContact.altPhone" label="Other phone" empty="undefined" type="tel" inputMode="tel" maxLength={20} />
                </div>
                <Button type="button" variant="ghost" size="sm" onClick={() => form.setValue('emergencyContact', null, { shouldDirty: true })} disabled={readOnlyAll}>
                  <Trash2 /> Remove emergency contact
                </Button>
              </div>
            ) : (
              <Button type="button" variant="secondary" size="sm" onClick={() => form.setValue('emergencyContact', { name: '', phone: '' }, { shouldDirty: true })} disabled={readOnlyAll}>
                <Plus /> Add an emergency contact
              </Button>
            )}
          </FormSection>
        </CardBody>
        <div className="sticky bottom-14 flex flex-wrap items-center justify-end gap-2 rounded-b-lg border-t border-border bg-surface-raised px-5 py-3 md:bottom-0">
          <span className="t-caption mr-auto text-ink-2">{dirty ? 'You have unsaved changes' : 'Everything is saved'}</span>
          <Button type="button" variant="secondary" disabled={!dirty || update.isPending} onClick={() => { form.reset(); setError(null); }}>
            Reset
          </Button>
          <Button type="submit" loading={update.isPending} disabled={!dirty || readOnlyAll}>
            Save changes
          </Button>
        </div>
      </Card>
      {dialog}
    </form>
  );
}
