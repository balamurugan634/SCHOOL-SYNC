import type { Metadata } from 'next';
import { Suspense } from 'react';
import { TasksScreen } from '@/components/features/learner/learning/tasks';

export const metadata: Metadata = { title: 'My Tasks' };

export default function Page() {
  return (
    <Suspense>
      <TasksScreen />
    </Suspense>
  );
}
