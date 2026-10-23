import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ResetForm } from '@/components/auth/reset-form';
import { env } from '@/lib/env';
import { getSiteState } from '@/lib/server/site';

export const metadata: Metadata = { title: 'Reset password' };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const token = typeof sp.token === 'string' ? sp.token : null;
  const site = typeof sp.site === 'string' ? sp.site.toLowerCase() : null;
  const s = await getSiteState();
  // emailed links carry ?site=<code>; if this host serves a different school, hop to the right one
  if (token && site && s.status === 'ok' && s.code !== site && /^[a-z][a-z0-9-]{1,40}$/.test(site) && s.source !== 'host') {
    const proto = env.secureCookies ? 'https' : 'http';
    redirect(`${proto}://${site}.${env.publicBase}/reset-password?token=${encodeURIComponent(token)}`);
  }
  return <ResetForm token={token} />;
}
