import type { Metadata } from 'next';
import { Suspense } from 'react';
import { StudentTransportScreen } from '@/components/features/learner/profile/more';

export const metadata: Metadata = { title: 'My bus' };

export default function Page() {
  return (
    <Suspense>
      <StudentTransportScreen />
    </Suspense>
  );
}
