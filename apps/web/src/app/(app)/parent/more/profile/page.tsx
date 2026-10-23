import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ParentProfileScreen } from '@/components/features/learner/profile/screens';

export const metadata: Metadata = { title: 'Profile & contacts' };

export default function Page() {
  return (
    <Suspense>
      <ParentProfileScreen />
    </Suspense>
  );
}
