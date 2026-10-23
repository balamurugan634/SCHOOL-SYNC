import type { Metadata } from 'next';
import { Suspense } from 'react';
import { TimetableScreen } from '@/components/features/management/academics/timetable-screen';
import { Gate } from '@/components/features/management/shared/gate';

export const metadata: Metadata = { title: 'Timetable' };

export default function Page() {
  return (
    <Gate perm="timetable:view">
      <Suspense>
        <TimetableScreen />
      </Suspense>
    </Gate>
  );
}
