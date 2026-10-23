import type { Metadata } from 'next';
import { Suspense } from 'react';
import { MeetingsScreen } from '@/components/features/teacher/messages/meetings';

export const metadata: Metadata = { title: 'Meetings' };

export default function Page() {
  return (
    <Suspense>
      <MeetingsScreen />
    </Suspense>
  );
}
