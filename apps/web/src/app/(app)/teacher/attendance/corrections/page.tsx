import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CorrectionsScreen } from '@/components/features/teacher/attendance/corrections';

export const metadata: Metadata = { title: 'Attendance corrections' };

export default function Page() {
  return (
    <Suspense>
      <CorrectionsScreen />
    </Suspense>
  );
}
