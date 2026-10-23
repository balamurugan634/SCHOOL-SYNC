import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ResultDetailScreen } from '@/components/features/learner/learning/results';

export const metadata: Metadata = { title: 'Results' };

export default async function Page({ params }: { params: Promise<{ examId: string }> }) {
  const { examId } = await params;
  return (
    <Suspense>
      <ResultDetailScreen examId={examId} />
    </Suspense>
  );
}
