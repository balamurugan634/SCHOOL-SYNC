import type { Metadata } from 'next';
import { Suspense } from 'react';
import { gate } from '@/components/features/management/common/gate';
import { MeetingsPage } from '@/components/features/management/communication/meetings-page';

export const metadata: Metadata = { title: 'Parent–teacher meetings' };

export default async function Page() {
  const denied = await gate({ any: ['meetings:view'] });
  if (denied) return denied;
  return (
    <Suspense>
      <MeetingsPage />
    </Suspense>
  );
}
