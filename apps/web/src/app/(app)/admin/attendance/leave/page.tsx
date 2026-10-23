import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Gate } from '@/components/features/management/shared/gate';
import { StudentLeaveScreen } from '@/components/features/management/attendance/leave-queue';

export const metadata: Metadata = { title: 'Student leave' };

export default function Page() {
  return (
    <Gate perm="leave:view">
      <Suspense>
        <StudentLeaveScreen />
      </Suspense>
    </Gate>
  );
}
