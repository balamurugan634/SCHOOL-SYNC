import type { Metadata } from 'next';
import { Suspense } from 'react';
import { gate } from '@/components/features/management/common/gate';
import { PaymentsPage } from '@/components/features/management/finance/payments-page';

export const metadata: Metadata = { title: 'Payments and receipts' };

export default async function Page() {
  const denied = await gate({ any: ['payments:view'], min: 'school', feature: 'fees' });
  if (denied) return denied;
  return (
    <Suspense>
      <PaymentsPage />
    </Suspense>
  );
}
