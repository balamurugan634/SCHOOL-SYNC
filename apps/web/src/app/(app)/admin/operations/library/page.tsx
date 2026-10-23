import type { Metadata } from 'next';
import { Suspense } from 'react';
import { gate } from '@/components/features/management/common/gate';
import { LibraryPage } from '@/components/features/management/operations/library-page';

export const metadata: Metadata = { title: 'Library' };

export default async function Page() {
  const denied = await gate({ any: ['library:view'], min: 'school', feature: 'library' });
  if (denied) return denied;
  return (
    <Suspense>
      <LibraryPage />
    </Suspense>
  );
}
