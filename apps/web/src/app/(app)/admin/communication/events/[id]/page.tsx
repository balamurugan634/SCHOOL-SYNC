import type { Metadata } from 'next';
import { Suspense } from 'react';
import { gate } from '@/components/features/management/common/gate';
import { EventDetail } from '@/components/features/management/communication/event-detail';

export const metadata: Metadata = { title: 'Event' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const denied = await gate({ any: ['events:view'] });
  if (denied) return denied;
  const { id } = await params;
  return (
    <Suspense>
      <EventDetail id={id} />
    </Suspense>
  );
}
