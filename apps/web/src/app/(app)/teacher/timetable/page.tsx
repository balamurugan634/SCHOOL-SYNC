import type { Metadata } from 'next';
import { Suspense } from 'react';
import { TimetableScreen } from '@/components/features/teacher/timetable/timetable';

export const metadata: Metadata = { title: 'Timetable' };

export default function Page() {
  return (
    <Suspense>
      <TimetableScreen />
    </Suspense>
  );
}
