import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ParentCommunicationScreen } from '@/components/features/learner/comms/screens';

export const metadata: Metadata = { title: 'Communication' };

export default function Page() {
  return (
    <Suspense>
      <ParentCommunicationScreen />
    </Suspense>
  );
}
