import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LearningScreen } from '@/components/features/learner/learning/learning-screen';

export const metadata: Metadata = { title: 'Academics' };

export default function Page() {
  return (
    <Suspense>
      <LearningScreen />
    </Suspense>
  );
}
