import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Gate } from '@/components/features/management/shared/gate';
import { StudentsList } from '@/components/features/management/people/students-list';

export const metadata: Metadata = { title: 'Students' };

export default function Page() {
  return (
    <Gate perm="students:view">
      <Suspense>
        <StudentsList />
      </Suspense>
    </Gate>
  );
}
