import type { Metadata } from 'next';
import { Suspense } from 'react';
import { gate } from '@/components/features/management/common/gate';
import { NotificationPreferencesPage } from '@/components/features/management/communication/notification-preferences';

export const metadata: Metadata = { title: 'My notifications' };

export default async function Page() {
  const denied = await gate({ any: ['notifications:view'] });
  if (denied) return denied;
  return (
    <Suspense>
      <NotificationPreferencesPage />
    </Suspense>
  );
}
