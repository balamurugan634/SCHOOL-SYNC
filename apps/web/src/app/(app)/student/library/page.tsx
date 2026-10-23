import type { Metadata } from 'next';
import { Suspense } from 'react';
import { StudentLibraryScreen } from '@/components/features/learner/profile/more';

export const metadata: Metadata = { title: 'My books' };

export default function Page() {
  return (
    <Suspense>
      <StudentLibraryScreen />
    </Suspense>
  );
}
