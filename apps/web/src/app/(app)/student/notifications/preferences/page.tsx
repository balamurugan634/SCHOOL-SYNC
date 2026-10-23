import type { Metadata } from 'next';
import { Suspense } from 'react';
import { StudentPreferencesScreen } from '@/components/features/learner/comms/screens';

export const metadata: Metadata = { title: 'Notification settings' };

export default function Page() {
  return (
    <Suspense>
      <StudentPreferencesScreen />
    </Suspense>
  );
}
