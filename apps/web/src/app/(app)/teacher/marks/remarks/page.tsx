import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RemarksScreen } from '@/components/features/teacher/marks/remarks-screen';

export const metadata: Metadata = { title: 'Report-card remarks' };

export default function Page() {
  return (
    <Suspense>
      <RemarksScreen />
    </Suspense>
  );
}
