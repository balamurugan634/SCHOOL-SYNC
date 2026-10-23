import type { Metadata } from 'next';
import { Suspense } from 'react';
import { StudentCalendarScreen } from '@/components/features/learner/comms/screens';

export const metadata: Metadata = { title: 'Calendar' };

export default function Page() {
  return (
    <Suspense>
      <StudentCalendarScreen />
    </Suspense>
  );
}
