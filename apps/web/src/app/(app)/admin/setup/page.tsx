import type { Metadata } from 'next';
import { NoAccess } from '@/components/dashboard/coming-online';
import { SetupWizard } from '@/components/setup/setup-wizard';
import { isSetupAdmin } from '@/lib/permissions';
import { requireMe } from '@/lib/server/session';

export const metadata: Metadata = { title: 'Get your school ready' };

export default async function SetupPage() {
  const me = await requireMe();
  if (!isSetupAdmin(me)) return <NoAccess />;
  return <SetupWizard />;
}
