import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ResultsScreen } from '@/components/features/teacher/marks/results-screen';

export const metadata: Metadata = { title: 'Results' };

export default function Page() {
  return (
    <Suspense>
      <ResultsScreen />
    </Suspense>
  );
}
