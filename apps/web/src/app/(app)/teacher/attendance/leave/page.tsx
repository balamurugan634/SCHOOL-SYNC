import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LeaveScreen } from '@/components/features/teacher/attendance/leave';

export const metadata: Metadata = { title: 'Student leave' };

export default function Page() {
  return (
    <Suspense>
      <LeaveScreen />
    </Suspense>
  );
}
