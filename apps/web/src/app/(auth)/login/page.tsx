import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { LoginForm } from '@/components/auth/login-form';
import { homeFor, isAudience } from '@/lib/experience';
import { getMe, safeNext } from '@/lib/server/session';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : null);
  const me = await getMe();
  const next = safeNext(one('next'));
  if (me && one('reason') !== 'expired') redirect(me.mustChangePassword ? '/change-password' : (next ?? homeFor(me.experience)));
  const as = one('as');
  return <LoginForm initialAudience={isAudience(as) ? as : null} next={next} reason={one('reason')} />;
}
