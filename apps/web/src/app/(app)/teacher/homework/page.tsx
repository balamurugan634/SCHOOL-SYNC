import type { Metadata } from 'next';
import { Suspense } from 'react';
import { HomeworkListScreen } from '@/components/features/teacher/homework/homework-list';

export const metadata: Metadata = { title: 'Homework' };

export default function Page() {
  return (
    <Suspense>
      <HomeworkListScreen />
    </Suspense>
  );
}
