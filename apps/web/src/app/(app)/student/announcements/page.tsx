import type { Metadata } from 'next';
import { Suspense } from 'react';
import { StudentAnnouncementsScreen } from '@/components/features/learner/comms/screens';

export const metadata: Metadata = { title: 'Announcements' };

export default function Page() {
  return (
    <Suspense>
      <StudentAnnouncementsScreen />
    </Suspense>
  );
}
