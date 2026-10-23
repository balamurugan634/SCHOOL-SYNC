import type { Metadata } from 'next';
import { Suspense } from 'react';
import { StudentNotificationsScreen } from '@/components/features/learner/comms/screens';

export const metadata: Metadata = { title: 'Notifications' };

export default function Page() {
  return (
    <Suspense>
      <StudentNotificationsScreen />
    </Suspense>
  );
}
