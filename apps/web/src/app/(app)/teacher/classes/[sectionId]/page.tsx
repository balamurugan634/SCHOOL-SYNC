import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ClassDetailScreen } from '@/components/features/teacher/classes/class-detail';

export const metadata: Metadata = { title: 'Class' };

export default async function Page({ params }: { params: Promise<{ sectionId: string }> }) {
  const { sectionId } = await params;
  return (
    <Suspense>
      <ClassDetailScreen sectionId={sectionId} />
    </Suspense>
  );
}
