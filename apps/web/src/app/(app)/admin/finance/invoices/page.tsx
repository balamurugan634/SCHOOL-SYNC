import type { Metadata } from 'next';
import { Suspense } from 'react';
import { NoAccess } from '@/components/dashboard/coming-online';
import { InvoicesScreen } from '@/components/fees/invoices-screen';
import { can } from '@/lib/permissions';
import { requireMe } from '@/lib/server/session';
import { requireSite } from '@/lib/server/site';

export const metadata: Metadata = { title: 'Invoices' };

export default async function Page() {
  const [me, site] = await Promise.all([requireMe(), requireSite()]);
  if (!site.features.fees || !can(me.permissions, 'fees:view', 'school')) return <NoAccess />;
  return (
    <Suspense>
      <InvoicesScreen />
    </Suspense>
  );
}
