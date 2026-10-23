import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ProfileScreen } from '@/components/features/teacher/me/profile';

export const metadata: Metadata = { title: 'My profile' };

export default function Page() {
  return (
    <Suspense>
      <ProfileScreen />
    </Suspense>
  );
}
