import type { Metadata } from 'next';
import { Suspense } from 'react';
import { gate } from '@/components/features/management/common/gate';
import { TransportPage } from '@/components/features/management/operations/transport-page';

export const metadata: Metadata = { title: 'Transport' };

export default async function Page() {
  const denied = await gate({ any: ['transport:view'], min: 'school', feature: 'transport' });
  if (denied) return denied;
  return (
    <Suspense>
      <TransportPage />
    </Suspense>
  );
}
