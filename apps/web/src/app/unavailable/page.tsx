import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthShell } from '@/components/auth/auth-shell';
import { Button } from '@/components/ui/button';
import { getSiteState } from '@/lib/server/site';

export const metadata: Metadata = { title: 'School unavailable' };

export default async function UnavailablePage({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const { reason } = await searchParams;
  const s = await getSiteState();
  const suspended = reason === 'suspended' || s.status === 'suspended';
  return (
    <AuthShell site={s.status === 'ok' ? s.info : null}>
      <h1 className="text-xl font-semibold leading-7">{suspended ? 'This school site is paused' : 'We can’t reach the school server'}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {suspended ? 'Access to this school’s SchoolSync site has been suspended. Please contact the school office.' : 'This is usually temporary. Check your internet connection and try again in a minute.'}
      </p>
      <Button asChild className="mt-6 w-full" variant={suspended ? 'secondary' : 'primary'}>
        <Link href={suspended ? '/find-school' : '/'}>{suspended ? 'Find another school' : 'Try again'}</Link>
      </Button>
    </AuthShell>
  );
}
