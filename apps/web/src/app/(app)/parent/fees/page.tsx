import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ParentFeesScreen } from '@/components/features/learner/fees/screens';

export const metadata: Metadata = { title: 'Fees' };

export default function Page() {
  return (
    <Suspense>
      <ParentFeesScreen />
    </Suspense>
  );
}
