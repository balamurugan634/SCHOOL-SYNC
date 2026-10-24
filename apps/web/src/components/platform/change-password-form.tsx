'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useWatch } from 'react-hook-form';
import { z } from 'zod';
import { passwordPolicy } from '@school-sync/shared';
import { PasswordChecklist, StrengthMeter } from '@/components/auth/password-policy';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Field, PasswordInput } from '@/components/ui/input';
import { toast } from '@/components/ui/toaster';
import { useZodForm } from '@/lib/client/use-zod-form';
import { ApiError } from '@/lib/problem';
import { pbff, platformError } from '@/lib/platform/client';
import { signOutOperator } from './shell';

const schema = z
  .object({ currentPassword: z.string().min(1, 'Enter your current password'), newPassword: passwordPolicy, confirm: z.string().min(1, 'Re-enter the new password') })
  .refine((v) => v.newPassword === v.confirm, { path: ['confirm'], message: 'The two passwords don’t match' })
  .refine((v) => v.newPassword !== v.currentPassword, { path: ['newPassword'], message: 'Choose a password you haven’t used here before' });

export function ChangePasswordForm({ forced, next, name }: { forced: boolean; next: string | null; name: string }) {
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);
  const form = useZodForm(schema, { defaultValues: { currentPassword: '', newPassword: '', confirm: '' }, mode: 'onChange' });
  const { register, handleSubmit, control, setError: setFieldError, formState } = form;
  const pw = useWatch({ control, name: 'newPassword' });

  const onSubmit = handleSubmit(async (v) => {
    setError(null);
    try {
      await pbff('/auth/change-password', { method: 'POST', body: { currentPassword: v.currentPassword, newPassword: v.newPassword } });
      setDone(true);
      toast.success('Password updated', { description: 'Your other sessions have been signed out.' });
      router.replace(next ?? '/platform/schools');
      router.refresh();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'INVALID_CREDENTIALS') setFieldError('currentPassword', { message: 'That isn’t your current password' });
      else if (e instanceof ApiError && e.code === 'PASSWORD_REUSED') setFieldError('newPassword', { message: 'Choose a different password' });
      else setError(platformError(e));
    }
  });

  return (
    <div className="page-in">
      <h1 className="text-xl font-semibold leading-7">{forced ? 'Choose a new password' : 'Change password'}</h1>
      <p className="mt-1 text-sm text-ink-2">{forced ? `Welcome, ${name.split(' ')[0]}. The password you were given is temporary. Choose one only you know before you continue.` : 'Your other sessions will be signed out when you change it.'}</p>
      <form onSubmit={onSubmit} noValidate className="mt-5 space-y-4">
        <Field label={forced ? 'Temporary password' : 'Current password'} htmlFor="currentPassword" error={formState.touchedFields.currentPassword ? formState.errors.currentPassword?.message : undefined}>
          <PasswordInput id="currentPassword" autoComplete="current-password" invalid={!!formState.errors.currentPassword && !!formState.touchedFields.currentPassword} {...register('currentPassword')} />
        </Field>
        <Field label="New password" htmlFor="newPassword" error={formState.touchedFields.newPassword ? formState.errors.newPassword?.message : undefined}>
          <PasswordInput id="newPassword" autoComplete="new-password" invalid={!!formState.errors.newPassword && !!formState.touchedFields.newPassword} {...register('newPassword')} />
        </Field>
        <div className="space-y-3 rounded-md border border-border bg-surface-2 p-3">
          <StrengthMeter value={pw} />
          <PasswordChecklist value={pw} />
        </div>
        <Field label="Confirm new password" htmlFor="confirm" error={formState.touchedFields.confirm ? formState.errors.confirm?.message : undefined}>
          <PasswordInput id="confirm" autoComplete="new-password" invalid={!!formState.errors.confirm && !!formState.touchedFields.confirm} {...register('confirm')} />
        </Field>
        {error && <Banner tone="danger">{error}</Banner>}
        <Button type="submit" className="w-full" loading={formState.isSubmitting || done} disabled={!formState.isValid}>
          {forced ? 'Save and continue' : 'Update password'}
        </Button>
        {forced ? (
          <Button type="button" variant="ghost" className="w-full" onClick={() => void signOutOperator()}>
            Sign out
          </Button>
        ) : (
          <Button asChild variant="ghost" className="w-full">
            <Link href={next ?? '/platform/schools'}>Cancel</Link>
          </Button>
        )}
      </form>
    </div>
  );
}
