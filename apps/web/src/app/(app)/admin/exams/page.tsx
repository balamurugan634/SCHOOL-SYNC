import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ExamsList } from '@/components/features/management/exams/exams-list';
import { Gate } from '@/components/features/management/shared/gate';

export const metadata: Metadata = { title: 'Exams' };

export default function Page() {
  return (
    <Gate perm="exams:view">
      <Suspense>
        <ExamsList />
      </Suspense>
    </Gate>
  );
}
