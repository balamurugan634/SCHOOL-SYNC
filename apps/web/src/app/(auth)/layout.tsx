import Link from 'next/link';
import { AuthShell } from '@/components/auth/auth-shell';
import { requireSite } from '@/lib/server/site';

/** Sign-in, forgot- and reset-password share one quiet centred card. */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const site = await requireSite();
  return (
    <AuthShell
      site={site}
      illustration="sign-in"
      illustrationPaths={['/', '/login']}
      footer={
        <>
          Not your school?{' '}
          <Link href="/find-school" className="text-primary-ink underline-offset-2 hover:underline">
            Find your school
          </Link>
        </>
      }
    >
      {children}
    </AuthShell>
  );
}
