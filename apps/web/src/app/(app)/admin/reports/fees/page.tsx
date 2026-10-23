import type { Metadata } from 'next';
import { Suspense } from 'react';
import { gate } from '@/components/features/management/common/gate';
import { FeeReportsPage } from '@/components/features/management/reports/fee-reports';

export const metadata: Metadata = { title: 'Fee reports' };

export default async function Page() {
  const denied = await gate({ any: ['fees:view', 'payments:view'], min: 'school', feature: 'fees' });
  if (denied) return denied;
  return (
    <Suspense>
      <FeeReportsPage />
    </Suspense>
  );
}
