import type { Metadata } from 'next';
import { Suspense } from 'react';
import { StudentEventsScreen } from '@/components/features/learner/comms/screens';

export const metadata: Metadata = { title: 'Events' };

export default function Page() {
  return (
    <Suspense>
      <StudentEventsScreen />
    </Suspense>
  );
}
