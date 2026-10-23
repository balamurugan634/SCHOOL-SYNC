import type { Metadata } from 'next';
import { Suspense } from 'react';
import { StaffAttendanceScreen } from '@/components/features/teacher/me/attendance';

export const metadata: Metadata = { title: 'My attendance' };

export default function Page() {
  return (
    <Suspense>
      <StaffAttendanceScreen />
    </Suspense>
  );
}
