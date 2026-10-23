import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Gate } from '@/components/features/management/shared/gate';
import { ClassViewScreen } from '@/components/features/management/attendance/class-view';

export const metadata: Metadata = { title: 'Class attendance' };

export default function Page() {
  return (
    <Gate perm="attendance:view">
      <Suspense>
        <ClassViewScreen />
      </Suspense>
    </Gate>
  );
}
