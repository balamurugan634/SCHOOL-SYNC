import type { Metadata } from 'next';
import { Suspense } from 'react';
import { gate } from '@/components/features/management/common/gate';
import { FinanceSetupPage } from '@/components/features/management/finance/setup-page';

export const metadata: Metadata = { title: 'Fee setup' };

export default async function Page() {
  const denied = await gate({ any: ['fees:view'], min: 'school', feature: 'fees' });
  if (denied) return denied;
  return (
    <Suspense>
      <FinanceSetupPage />
    </Suspense>
  );
}
