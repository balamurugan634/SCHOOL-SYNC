import type { Metadata } from 'next';
import { Suspense } from 'react';
import { StudentHomeScreen } from '@/components/features/learner/learning/home';

export const metadata: Metadata = { title: 'Home' };

export default function Page() {
  return (
    <Suspense>
      <StudentHomeScreen />
    </Suspense>
  );
}
