import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ExamsScreen } from '@/components/features/teacher/marks/exams-screen';

export const metadata: Metadata = { title: 'Exams' };

export default function Page() {
  return (
    <Suspense>
      <ExamsScreen />
    </Suspense>
  );
}
