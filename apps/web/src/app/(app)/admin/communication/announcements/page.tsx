import type { Metadata } from 'next';
import { Suspense } from 'react';
import { gate } from '@/components/features/management/common/gate';
import { AnnouncementsPage } from '@/components/features/management/communication/announcements-page';

export const metadata: Metadata = { title: 'Announcements' };

export default async function Page() {
  const denied = await gate({ any: ['announcements:view'] });
  if (denied) return denied;
  return (
    <Suspense>
      <AnnouncementsPage />
    </Suspense>
  );
}
