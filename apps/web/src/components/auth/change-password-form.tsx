'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { passwordPolicy } from '@school-sync/shared';
import { bff } from '@/lib/client/fetcher';
import { ApiError, errorMessage } from '@/lib/problem';
import { Banner } from '../ui/banner';
import { Button } from '../ui/button';
import { Field, PasswordInput } from '../ui/input';
import { toast } from '../ui/toaster';
import { AuthShell } from './auth-shell';
import { useSite } from '../site-context';
import { signOut } from '../shell/user-menu';
import { PasswordChecklist, StrengthMeter } from './password-policy';

const schema = z
  .object({ currentPassword: z.string().min(1, 'Enter your current password'), newPassword: passwordPolicy, confirm: z.string().min(1, 'Re-enter the new password') })
  .refine((v) => v.newPassword === v.confirm, { path: ['confirm'], message: 'The two passwords don’t match' })
  .refine((v) => v.newPassword !== v.currentPassword, { path: ['newPassword'], message: 'Choose a password you haven’t used here before' });
type Values = z.infer<typeof schema>;

export function ChangePasswordForm({ forced, next, home, name }: { forced: boolean; next: string | null; home: string; name: string }) {
  const router = useRouter();
  const site = useSite();
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);
  const { register, handleSubmit, control, setError: setFieldError, formState } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { currentPassword: '', newPassword: '', confirm: '' }, mode: 'onChange' });
  const pw = useWatch({ control, name: 'newPassword' });

  const onSubmit = handleSubmit(async (v) => {
    setError(null);
    try {
      await bff('/auth/change-password', { method: 'POST', body: { currentPassword: v.currentPassword, newPassword: v.newPassword } });
      setDone(true);
      toast.success('Password updated', { description: 'Other devices have been signed out for your security.' });
      router.replace(next ?? home);
      router.refresh();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'INVALID_CREDENTIALS') setFieldError('currentPassword', { message: 'That isn’t your current password' });
      else if (e instanceof ApiError && e.code === 'PASSWORD_REUSED') setFieldError('newPassword', { message: 'Choose a different password' });
      else setError(errorMessage(e));
    }
  });

  return (
    <AuthShell
      site={site}
      footer={
        forced ? (
          <button type="button" onClick={() => void signOut()} className="text-primary-ink underline-offset-2 hover:underline">
            Sign out
          </button>
        ) : undefined
      }
    >
      <div className="page-in">
        <h1 className="text-xl font-semibold leading-7">{forced ? 'Choose a new password' : 'Change password'}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {forced ? `Welcome, ${name.split(' ')[0]}. The password the school gave you was temporary — choose one only you know before you continue.` : 'Other devices will be signed out when you change it.'}
        </p>
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
          {!forced && (
            <Button asChild variant="ghost" className="w-full">
              <Link href={next ?? home}>Cancel</Link>
            </Button>
          )}
        </form>
      </div>
    </AuthShell>
  );
}
