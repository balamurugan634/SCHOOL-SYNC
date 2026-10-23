import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Gate } from '@/components/features/management/shared/gate';
import { CorrectionsScreen } from '@/components/features/management/attendance/corrections-queue';

export const metadata: Metadata = { title: 'Attendance corrections' };

export default function Page() {
  return (
    <Gate perm="attendance:approve">
      <Suspense>
        <CorrectionsScreen />
      </Suspense>
    </Gate>
  );
}
