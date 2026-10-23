import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AttendanceHistoryScreen } from '@/components/features/teacher/attendance/history';

export const metadata: Metadata = { title: 'Attendance history' };

export default function Page() {
  return (
    <Suspense>
      <AttendanceHistoryScreen />
    </Suspense>
  );
}
