import type { Metadata } from 'next';
import { Suspense } from 'react';
import { gate } from '@/components/features/management/common/gate';
import { NewEvent } from '@/components/features/management/communication/new-pages';

export const metadata: Metadata = { title: 'New event' };

export default async function Page() {
  const denied = await gate({ any: ['events:create'] });
  if (denied) return denied;
  return (
    <Suspense>
      <NewEvent />
    </Suspense>
  );
}
