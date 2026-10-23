import type { Metadata } from 'next';
import { Suspense } from 'react';
import { HomeworkDetailScreen } from '@/components/features/teacher/homework/homework-detail';

export const metadata: Metadata = { title: 'Homework' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <HomeworkDetailScreen id={id} />
    </Suspense>
  );
}
