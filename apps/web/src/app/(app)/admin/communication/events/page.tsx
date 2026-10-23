import type { Metadata } from 'next';
import { Suspense } from 'react';
import { gate } from '@/components/features/management/common/gate';
import { EventsPage } from '@/components/features/management/communication/events-page';

export const metadata: Metadata = { title: 'Events and calendar' };

export default async function Page() {
  const denied = await gate({ any: ['events:view'] });
  if (denied) return denied;
  return (
    <Suspense>
      <EventsPage />
    </Suspense>
  );
}
