import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ExamDetail } from '@/components/features/management/exams/exam-detail';
import { Gate } from '@/components/features/management/shared/gate';

export const metadata: Metadata = { title: 'Exam' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Gate perm="exams:view">
      <Suspense>
        <ExamDetail id={id} />
      </Suspense>
    </Gate>
  );
}
