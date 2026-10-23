import type { Metadata } from 'next';
import { Suspense } from 'react';
import { NotificationsScreen } from '@/components/features/teacher/messages/notifications';

export const metadata: Metadata = { title: 'Notifications' };

export default function Page() {
  return (
    <Suspense>
      <NotificationsScreen />
    </Suspense>
  );
}
