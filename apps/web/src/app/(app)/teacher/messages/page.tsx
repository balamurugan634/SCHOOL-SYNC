import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AnnouncementsScreen } from '@/components/features/teacher/messages/announcements';

export const metadata: Metadata = { title: 'Announcements' };

export default function Page() {
  return (
    <Suspense>
      <AnnouncementsScreen />
    </Suspense>
  );
}
