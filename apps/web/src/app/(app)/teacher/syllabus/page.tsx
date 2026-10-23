import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SyllabusProgressScreen } from '@/components/features/teacher/syllabus/syllabus-progress';

export const metadata: Metadata = { title: 'Syllabus progress' };

export default function Page() {
  return (
    <Suspense>
      <SyllabusProgressScreen />
    </Suspense>
  );
}
