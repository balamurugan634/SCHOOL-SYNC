import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ParentPreferencesScreen } from '@/components/features/learner/comms/screens';

export const metadata: Metadata = { title: 'Notification settings' };

export default function Page() {
  return (
    <Suspense>
      <ParentPreferencesScreen />
    </Suspense>
  );
}
