import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Gate } from '@/components/features/management/shared/gate';
import { StudentDetail } from '@/components/features/management/people/student-detail';

export const metadata: Metadata = { title: 'Student' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Gate perm="students:view">
      <Suspense>
        <StudentDetail id={id} />
      </Suspense>
    </Gate>
  );
}
