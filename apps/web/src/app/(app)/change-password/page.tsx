import type { Metadata } from 'next';
import { ChangePasswordForm } from '@/components/auth/change-password-form';
import { env } from '@/lib/env';
import { homeFor } from '@/lib/experience';
import { requireMe, safeNext } from '@/lib/server/session';

export const metadata: Metadata = { title: 'Change password' };

export default async function ChangePasswordPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const me = await requireMe();
  // dev only: ?preview=forced shows the first-login variant for a user who has already changed the password
  const forced = me.mustChangePassword || (env.devPreview && sp.preview === 'forced');
  return <ChangePasswordForm forced={forced} next={safeNext(sp.next)} home={homeFor(me.experience)} name={me.displayName} />;
}
