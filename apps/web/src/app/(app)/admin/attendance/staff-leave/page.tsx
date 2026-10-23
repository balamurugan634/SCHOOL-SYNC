import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Gate } from '@/components/features/management/shared/gate';
import { StaffLeaveScreen } from '@/components/features/management/attendance/leave-queue';

export const metadata: Metadata = { title: 'Staff leave' };

export default function Page() {
  return (
    <Gate perm="staff_leave:view" min="school">
      <Suspense>
        <StaffLeaveScreen />
      </Suspense>
    </Gate>
  );
}
