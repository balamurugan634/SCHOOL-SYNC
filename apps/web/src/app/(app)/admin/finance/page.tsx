import type { Metadata } from 'next';
import { Suspense } from 'react';
import { gate } from '@/components/features/management/common/gate';
import { FinanceOverview } from '@/components/features/management/finance/overview';

export const metadata: Metadata = { title: 'Finance overview' };

export default async function Page() {
  const denied = await gate({ all: ['fees:view', 'payments:view'], min: 'school', feature: 'fees' });
  if (denied) return denied;
  return (
    <Suspense>
      <FinanceOverview />
    </Suspense>
  );
}
