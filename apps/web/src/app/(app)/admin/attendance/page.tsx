import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Gate } from '@/components/features/management/shared/gate';
import { SchoolSummaryScreen } from '@/components/features/management/attendance/school-summary';

export const metadata: Metadata = { title: 'Attendance' };

export default function Page() {
  return (
    <Gate perm="attendance:view" min="school">
      <Suspense>
        <SchoolSummaryScreen />
      </Suspense>
    </Gate>
  );
}
