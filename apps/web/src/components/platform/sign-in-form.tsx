'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { platformLoginBody } from '@school-sync/shared';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Field, Input, PasswordInput } from '@/components/ui/input';
import { useZodForm } from '@/lib/client/use-zod-form';
import { ApiError } from '@/lib/problem';
import { platformError } from '@/lib/platform/client';

const nowMs = () => Date.now();
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function useCountdown(until: number | null) {
  const [now, setNow] = React.useState(nowMs);
  React.useEffect(() => {
    if (!until) return;
    setNow(nowMs());
    const t = setInterval(() => setNow(nowMs()), 500);
    return () => clearInterval(t);
  }, [until]);
  return until ? Math.max(0, Math.ceil((until - now) / 1000)) : 0;
}

export function SignInForm({ next, reason }: { next: string | null; reason: string | null }) {
  const router = useRouter();
  const [error, setError] = React.useState<ApiError | null>(null);
  const [lockUntil, setLockUntil] = React.useState<number | null>(null);
  const [done, setDone] = React.useState(false);
  const left = useCountdown(lockUntil);
  const locked = left > 0;
  const form = useZodForm(platformLoginBody, { defaultValues: { email: '', password: '' } });
  const { register, handleSubmit, formState, setFocus } = form;
  React.useEffect(() => setFocus('email'), [setFocus]);

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      const res = await fetch('/api/platform/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...values, next: next ?? undefined }), credentials: 'same-origin' });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw ApiError.fromProblem(res.status, body);
      setDone(true);
      router.replace(body.redirectTo as string);
      router.refresh();
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError({ status: 0, code: 'API_UNREACHABLE' });
      setError(err);
      if (err.code === 'ACCOUNT_LOCKED' && err.retryAfterSeconds) setLockUntil(nowMs() + err.retryAfterSeconds * 1000);
    }
  });

  return (
    <div className="page-in">
      <h1 className="text-xl font-semibold leading-7">Operator sign-in</h1>
      <p className="mt-1 text-sm text-ink-2">The SchoolSync console for onboarding schools and billing. This is not a school sign-in.</p>
      <div className="mt-5 space-y-3">
        {reason === 'expired' && <Banner tone="warning" title="Your session ended">For your security you were signed out. Please sign in again.</Banner>}
        {reason === 'signed-out' && <Banner tone="success">You have been signed out.</Banner>}
        {reason === 'password-changed' && <Banner tone="success" title="Password updated">Sign in with your new password.</Banner>}
      </div>
      <form onSubmit={onSubmit} noValidate className="mt-5 space-y-4">
        <Field label="Email" htmlFor="email" error={formState.errors.email?.message}>
          <Input id="email" type="email" autoComplete="username" autoCapitalize="none" spellCheck={false} invalid={!!formState.errors.email} {...register('email')} />
        </Field>
        <Field label="Password" htmlFor="password" error={formState.errors.password?.message}>
          <PasswordInput id="password" autoComplete="current-password" invalid={!!formState.errors.password} {...register('password')} />
        </Field>
        {error && !locked && error.code !== 'ACCOUNT_LOCKED' && (
          <Banner tone="danger" role="alert" title={error.code === 'INVALID_CREDENTIALS' ? 'We couldn’t sign you in' : undefined}>
            {platformError(error)}
          </Banner>
        )}
        {locked && (
          <Banner tone="warning" role="alert" title={`Too many attempts. Try again in ${mmss(left)}.`}>
            To protect the account, sign-in is paused for a short time. Another operator can reset your password.
          </Banner>
        )}
        <Button type="submit" className="w-full" loading={formState.isSubmitting || done} disabled={locked}>
          {locked ? `Try again in ${mmss(left)}` : 'Sign in'}
        </Button>
      </form>
    </div>
  );
}
