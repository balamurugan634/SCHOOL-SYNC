import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Gate } from '@/components/features/management/shared/gate';
import { StaffList } from '@/components/features/management/people/staff-list';

export const metadata: Metadata = { title: 'Staff' };

export default function Page() {
  return (
    <Gate perm="staff:view">
      <Suspense>
        <StaffList />
      </Suspense>
    </Gate>
  );
}
