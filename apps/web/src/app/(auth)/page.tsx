import { redirect } from 'next/navigation';
import { LoginForm } from '@/components/auth/login-form';
import { homeFor, isAudience } from '@/lib/experience';
import { getMe } from '@/lib/server/session';

/** The signed-out landing page IS the sign-in page (design.md). Signed-in visitors go to their home. */
export default async function HomePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const me = await getMe();
  if (me) redirect(me.mustChangePassword ? '/change-password' : homeFor(me.experience));
  const as = typeof sp.as === 'string' ? sp.as : null;
  return <LoginForm initialAudience={isAudience(as) ? as : null} next={null} reason={typeof sp.reason === 'string' ? sp.reason : null} />;
}
