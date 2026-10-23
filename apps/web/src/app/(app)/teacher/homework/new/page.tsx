import type { Metadata } from 'next';
import { Suspense } from 'react';
import { NewHomeworkScreen } from '@/components/features/teacher/homework/homework-form';

export const metadata: Metadata = { title: 'New homework' };

export default function Page() {
  return (
    <Suspense>
      <NewHomeworkScreen />
    </Suspense>
  );
}
