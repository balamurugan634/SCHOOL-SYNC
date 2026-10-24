import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { SignInForm } from '@/components/platform/sign-in-form';
import { safePlatformNext } from '@/lib/platform/host';
import { getOperator } from '@/lib/platform/session';

export const metadata: Metadata = { title: 'Sign in' };

export default async function PlatformSignInPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : null);
  const reason = one('reason');
  const next = safePlatformNext(one('next'));
  const op = reason ? null : await getOperator();
  if (op) redirect(op.mustChangePassword ? `/platform/change-password${next ? `?next=${encodeURIComponent(next)}` : ''}` : (next ?? '/platform/schools'));
  return <SignInForm next={next} reason={reason} />;
}
