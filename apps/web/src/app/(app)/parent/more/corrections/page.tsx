import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ParentCorrectionsScreen } from '@/components/features/learner/profile/screens';

export const metadata: Metadata = { title: 'Record corrections' };

export default function Page() {
  return (
    <Suspense>
      <ParentCorrectionsScreen />
    </Suspense>
  );
}
