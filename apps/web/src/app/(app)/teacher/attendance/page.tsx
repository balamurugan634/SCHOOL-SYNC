import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RollCallScreen } from '@/components/attendance/roll-call';

export const metadata: Metadata = { title: 'Attendance' };

export default function Page() {
  return (
    <Suspense>
      <RollCallScreen />
    </Suspense>
  );
}
