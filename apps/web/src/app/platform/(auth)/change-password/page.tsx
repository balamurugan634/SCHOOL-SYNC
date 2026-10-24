import type { Metadata } from 'next';
import { ChangePasswordForm } from '@/components/platform/change-password-form';
import { safePlatformNext } from '@/lib/platform/host';
import { requireOperator } from '@/lib/platform/session';

export const metadata: Metadata = { title: 'Change password' };

export default async function PlatformChangePasswordPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const op = await requireOperator();
  const sp = await searchParams;
  return <ChangePasswordForm forced={op.mustChangePassword} next={safePlatformNext(typeof sp.next === 'string' ? sp.next : null)} name={op.displayName} />;
}
