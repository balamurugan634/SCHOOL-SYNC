import type { Metadata } from 'next';
import { Suspense } from 'react';
import { gate } from '@/components/features/management/common/gate';
import { NewAnnouncement } from '@/components/features/management/communication/new-pages';

export const metadata: Metadata = { title: 'New announcement' };

export default async function Page() {
  const denied = await gate({ any: ['announcements:create'] });
  if (denied) return denied;
  return (
    <Suspense>
      <NewAnnouncement />
    </Suspense>
  );
}
