import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SubjectsScreen } from '@/components/features/management/academics/subjects-screen';
import { Gate } from '@/components/features/management/shared/gate';

export const metadata: Metadata = { title: 'Subjects' };

export default function Page() {
  return (
    <Gate perm="academics:view">
      <Suspense>
        <SubjectsScreen />
      </Suspense>
    </Gate>
  );
}
