import type { Metadata } from 'next';
import { Suspense } from 'react';
import { StudentProfileScreen } from '@/components/features/learner/profile/screens';

export const metadata: Metadata = { title: 'My profile' };

export default function Page() {
  return (
    <Suspense>
      <StudentProfileScreen />
    </Suspense>
  );
}
