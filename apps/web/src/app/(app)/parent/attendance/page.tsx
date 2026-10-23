import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ParentAttendanceScreen } from '@/components/features/learner/attendance/screens';

export const metadata: Metadata = { title: 'Attendance' };

export default function Page() {
  return (
    <Suspense>
      <ParentAttendanceScreen />
    </Suspense>
  );
}
