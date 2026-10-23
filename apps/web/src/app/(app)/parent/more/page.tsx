import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ParentMoreScreen } from '@/components/features/learner/profile/more';

export const metadata: Metadata = { title: 'More' };

export default function Page() {
  return (
    <Suspense>
      <ParentMoreScreen />
    </Suspense>
  );
}
