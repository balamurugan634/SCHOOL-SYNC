import type { Metadata } from 'next';
import { Suspense } from 'react';
import { StudentFeesScreen } from '@/components/features/learner/fees/screens';

export const metadata: Metadata = { title: 'Fees' };

export default function Page() {
  return (
    <Suspense>
      <StudentFeesScreen />
    </Suspense>
  );
}
