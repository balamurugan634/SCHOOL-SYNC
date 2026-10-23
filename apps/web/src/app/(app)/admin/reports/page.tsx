import type { Metadata } from 'next';
import { gate } from '@/components/features/management/common/gate';
import { ReportsHub } from '@/components/features/management/reports/reports-hub';

export const metadata: Metadata = { title: 'Reports' };

export default async function Page() {
  const denied = await gate({ any: ['reports:view', 'fees:view', 'payments:view', 'expenses:view'] });
  if (denied) return denied;
  return <ReportsHub />;
}
