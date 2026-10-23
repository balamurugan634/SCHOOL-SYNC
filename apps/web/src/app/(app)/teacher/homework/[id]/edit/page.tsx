import type { Metadata } from 'next';
import { Suspense } from 'react';
import { EditHomeworkScreen } from '@/components/features/teacher/homework/homework-form';

export const metadata: Metadata = { title: 'Edit homework' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <EditHomeworkScreen id={id} />
    </Suspense>
  );
}
