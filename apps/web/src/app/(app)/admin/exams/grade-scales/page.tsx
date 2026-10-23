import type { Metadata } from 'next';
import { Suspense } from 'react';
import { GradeScalesScreen } from '@/components/features/management/exams/grade-scales';
import { Gate } from '@/components/features/management/shared/gate';

export const metadata: Metadata = { title: 'Grade scales' };

export default function Page() {
  return (
    <Gate perm="exams:view">
      <Suspense>
        <GradeScalesScreen />
      </Suspense>
    </Gate>
  );
}
