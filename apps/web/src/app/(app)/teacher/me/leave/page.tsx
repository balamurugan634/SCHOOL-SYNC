import type { Metadata } from 'next';
import { Suspense } from 'react';
import { StaffLeaveScreen } from '@/components/features/teacher/me/leave';

export const metadata: Metadata = { title: 'My leave' };

export default function Page() {
  return (
    <Suspense>
      <StaffLeaveScreen />
    </Suspense>
  );
}
