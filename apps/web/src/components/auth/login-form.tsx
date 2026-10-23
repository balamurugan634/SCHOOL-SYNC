'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ApiError, errorMessage } from '@/lib/problem';
import { AUDIENCES, type Audience } from '@/lib/experience';
import { cn } from '@/lib/cn';
import { Banner } from '../ui/banner';
import { Button } from '../ui/button';
import { Field, Input, PasswordInput } from '../ui/input';
import { useSite } from '../site-context';

const schema = z.object({
  identifier: z.string().trim().min(2, 'Enter your username, email or phone number'),
  password: z.string().min(1, 'Enter your password'),
});
type Values = z.infer<typeof schema>;

const AUD: Record<Audience, { label: string; field: string; placeholder: string; hint: string }> = {
  student: { label: 'Student', field: 'Admission number or username', placeholder: 'e.g. 20260001', hint: 'Your school gave you this when you joined.' },
  parent: { label: 'Parent', field: 'Mobile number or email', placeholder: 'e.g. 98765 43210', hint: 'The number or email you gave the school.' },
  teacher: { label: 'Teacher', field: 'Employee ID or email', placeholder: 'e.g. t001', hint: 'Your employee ID from the school office.' },
  staff: { label: 'Staff', field: 'Username or email', placeholder: 'e.g. you@yourschool.edu', hint: 'The account your administrator created.' },
};

const nowMs = () => Date.now();

function useCountdown(until: number | null) {
  const [now, setNow] = React.useState(() => nowMs());
  React.useEffect(() => {
    if (!until) return;
    setNow(nowMs());
    const t = setInterval(() => setNow(nowMs()), 500);
    return () => clearInterval(t);
  }, [until]);
  return until ? Math.max(0, Math.ceil((until - now) / 1000)) : 0;
}
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function LoginForm({ initialAudience, next, reason }: { initialAudience: Audience | null; next: string | null; reason: string | null }) {
  const router = useRouter();
  const site = useSite();
  const [audience, setAudience] = React.useState<Audience | null>(initialAudience);
  const [error, setError] = React.useState<ApiError | null>(null);
  const [lockUntil, setLockUntil] = React.useState<number | null>(null);
  const [done, setDone] = React.useState(false);
  const left = useCountdown(lockUntil);
  const locked = left > 0;

  const { register, handleSubmit, formState, setFocus } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { identifier: '', password: '' } });
  const copy = audience ? AUD[audience] : null;

  React.useEffect(() => setFocus('identifier'), [setFocus]);

  const pickAudience = (a: Audience) => {
    setAudience(a);
    const url = new URL(window.location.href);
    url.searchParams.set('as', a);
    window.history.replaceState(null, '', url);
  };

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...values, next: next ?? undefined }), credentials: 'same-origin' });
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
      <h1 className="text-xl font-semibold leading-7">Sign in to {site?.name ?? 'your school'}</h1>
      <p className="mt-1 text-sm text-muted-foreground">Use the account your school created for you.</p>

      <div className="mt-5 space-y-3">
        {reason === 'expired' && <Banner tone="warning" title="Your session ended">For your security you were signed out. Please sign in again.</Banner>}
        {reason === 'signed-out' && <Banner tone="success">You have been signed out.</Banner>}
        {reason === 'password-reset' && <Banner tone="success" title="Password updated">Sign in with your new password.</Banner>}
        {site?.readOnly && (
          <Banner tone="locked" title="This school is in read-only mode">
            You can sign in and view records. Changes are disabled until the school’s subscription is renewed.
          </Banner>
        )}
      </div>

      <div role="radiogroup" aria-label="I am signing in as" className="mt-5 grid grid-cols-4 gap-0.5 rounded-md border border-border bg-surface-2 p-0.5">
        {AUDIENCES.map((a) => {
          const active = audience === a;
          const off = a === 'student' && !!site && !site.features.studentLogin;
          return (
            <button
              key={a}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={off}
              onClick={() => pickAudience(a)}
              title={off ? 'Student sign-in is not enabled at this school' : undefined}
              className={cn('h-9 rounded-[5px] text-[13px] font-medium transition-colors disabled:opacity-40 sm:h-8', active ? 'bg-surface text-foreground shadow-[0_0_0_1px_var(--border)]' : 'text-muted-foreground hover:text-foreground')}
            >
              {AUD[a].label}
            </button>
          );
        })}
      </div>

      <form onSubmit={onSubmit} noValidate className="mt-5 space-y-4">
        <Field label={copy?.field ?? 'Username, email or phone'} htmlFor="identifier" error={formState.errors.identifier?.message} hint={copy?.hint}>
          <Input id="identifier" autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder={copy?.placeholder} invalid={!!formState.errors.identifier} aria-describedby={formState.errors.identifier ? 'identifier-error' : undefined} {...register('identifier')} />
        </Field>
        <Field
          label="Password"
          htmlFor="password"
          error={formState.errors.password?.message}
          action={
            <Link href="/forgot-password" className="text-[13px] text-primary-ink underline-offset-2 hover:underline">
              Forgot password?
            </Link>
          }
        >
          <PasswordInput id="password" autoComplete="current-password" invalid={!!formState.errors.password} {...register('password')} />
        </Field>

        {error && !locked && error.code !== 'ACCOUNT_LOCKED' && (
          <Banner tone="danger" role="alert" title={error.code === 'INVALID_CREDENTIALS' ? 'We couldn’t sign you in' : undefined}>
            {errorMessage(error)}
          </Banner>
        )}
        {locked && (
          <Banner tone="warning" role="alert" title={`Too many attempts. Try again in ${mmss(left)}.`}>
            To protect your account, sign-in is paused for a short time. You can also reset your password.
          </Banner>
        )}

        <Button type="submit" className="w-full" loading={formState.isSubmitting || done} disabled={locked}>
          {locked ? `Try again in ${mmss(left)}` : 'Sign in'}
        </Button>
      </form>
    </div>
  );
}
