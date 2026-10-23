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
import { PasswordChecklist, StrengthMeter } from './password-policy';

const schema = z
  .object({ newPassword: passwordPolicy, confirm: z.string().min(1, 'Re-enter the new password') })
  .refine((v) => v.newPassword === v.confirm, { path: ['confirm'], message: 'The two passwords don’t match' });
type Values = z.infer<typeof schema>;

export function ResetForm({ token }: { token: string | null }) {
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);
  const [invalid, setInvalid] = React.useState(!token);
  const [done, setDone] = React.useState(false);
  const { register, handleSubmit, control, formState } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { newPassword: '', confirm: '' }, mode: 'onChange' });
  const pw = useWatch({ control, name: 'newPassword' });

  const onSubmit = handleSubmit(async (v) => {
    setError(null);
    try {
      await bff('/auth/reset-password', { method: 'POST', body: { token, newPassword: v.newPassword } });
      setDone(true);
      setTimeout(() => router.replace('/login?reason=password-reset'), 1200);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'INVALID_RESET_TOKEN') setInvalid(true);
      else setError(errorMessage(e));
    }
  });

  if (invalid) {
    return (
      <div className="page-in">
        <h1 className="text-xl font-semibold leading-7">This reset link is not valid</h1>
        <p className="mt-2 text-sm text-muted-foreground">It may have expired (links last 30 minutes) or already been used. Request a new one and try again.</p>
        <div className="mt-6 space-y-2">
          <Button asChild className="w-full">
            <Link href="/forgot-password">Send a new link</Link>
          </Button>
          <Button asChild variant="ghost" className="w-full">
            <Link href="/login">Back to sign in</Link>
          </Button>
        </div>
      </div>
    );
  }
  if (done) {
    return (
      <div className="page-in">
        <h1 className="text-xl font-semibold leading-7">Password updated</h1>
        <p className="mt-2 text-sm text-muted-foreground">Taking you to sign in…</p>
      </div>
    );
  }

  return (
    <div className="page-in">
      <h1 className="text-xl font-semibold leading-7">Choose a new password</h1>
      <p className="mt-1 text-sm text-muted-foreground">You will be signed out everywhere and asked to sign in with the new password.</p>
      <form onSubmit={onSubmit} noValidate className="mt-5 space-y-4">
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
        <Button type="submit" className="w-full" loading={formState.isSubmitting} disabled={!formState.isValid}>
          Update password
        </Button>
      </form>
    </div>
  );
}
