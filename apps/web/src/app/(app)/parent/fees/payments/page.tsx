import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ParentPaymentsScreen } from '@/components/features/learner/fees/screens';

export const metadata: Metadata = { title: 'Payment history' };

export default function Page() {
  return (
    <Suspense>
      <ParentPaymentsScreen />
    </Suspense>
  );
}
