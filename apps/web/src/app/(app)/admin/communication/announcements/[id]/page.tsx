import type { Metadata } from 'next';
import { Suspense } from 'react';
import { gate } from '@/components/features/management/common/gate';
import { AnnouncementDetail } from '@/components/features/management/communication/announcement-detail';

export const metadata: Metadata = { title: 'Announcement' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const denied = await gate({ any: ['announcements:view'] });
  if (denied) return denied;
  const { id } = await params;
  return (
    <Suspense>
      <AnnouncementDetail id={id} />
    </Suspense>
  );
}
