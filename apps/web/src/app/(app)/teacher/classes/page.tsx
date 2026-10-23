import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ClassesScreen } from '@/components/features/teacher/classes/classes-list';

export const metadata: Metadata = { title: 'My classes' };

export default function Page() {
  return (
    <Suspense>
      <ClassesScreen />
    </Suspense>
  );
}
