import { redirect } from 'next/navigation';
import { currentUrl, requireMe } from '@/lib/server/session';
import { requireSite } from '@/lib/server/site';

/** Everything below here needs a signed-in user. First-login users are held on the password-change screen. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireSite();
  const me = await requireMe();
  const url = await currentUrl();
  if (me.mustChangePassword && !url.startsWith('/change-password')) redirect(`/change-password?next=${encodeURIComponent(url)}`);
  return children;
}
