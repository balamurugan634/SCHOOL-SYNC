'use client';

import * as React from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { bff } from '@/lib/client/fetcher';
import { errorMessage } from '@/lib/problem';
import { Banner } from '../ui/banner';
import { Button } from '../ui/button';
import { Field, Input } from '../ui/input';

const schema = z.object({ identifier: z.string().trim().min(2, 'Enter your username, email or phone number') });

export function ForgotForm() {
  const [sent, setSent] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { identifier: '' } });

  const onSubmit = handleSubmit(async (v) => {
    setError(null);
    try {
      await bff('/auth/forgot-password', { method: 'POST', body: v });
      setSent(v.identifier);
    } catch (e) {
      setError(errorMessage(e));
    }
  });

  if (sent) {
    return (
      <div className="page-in">
        <h1 className="text-xl font-semibold leading-7">Check your email</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          If an account matches <span className="font-medium text-foreground">{sent}</span>, we have sent a link to reset the password. It works for 30 minutes.
        </p>
        <p className="mt-3 text-sm text-muted-foreground">No email? Check your spam folder, or ask the school office to reset it — some accounts have no email on file.</p>
        <Button asChild variant="secondary" className="mt-6 w-full">
          <Link href="/login">Back to sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="page-in">
      <h1 className="text-xl font-semibold leading-7">Reset your password</h1>
      <p className="mt-1 text-sm text-muted-foreground">Enter your username, email or phone. If we find your account, we will email you a reset link.</p>
      <form onSubmit={onSubmit} noValidate className="mt-5 space-y-4">
        <Field label="Username, email or phone" htmlFor="identifier" error={formState.errors.identifier?.message}>
          <Input id="identifier" autoComplete="username" autoCapitalize="none" invalid={!!formState.errors.identifier} {...register('identifier')} />
        </Field>
        {error && <Banner tone="danger">{error}</Banner>}
        <Button type="submit" className="w-full" loading={formState.isSubmitting}>
          Send reset link
        </Button>
        <Button asChild variant="ghost" className="w-full">
          <Link href="/login">Back to sign in</Link>
        </Button>
      </form>
    </div>
  );
}
