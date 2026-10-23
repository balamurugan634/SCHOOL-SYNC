import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ClassesScreen } from '@/components/features/management/academics/classes-screen';
import { Gate } from '@/components/features/management/shared/gate';

export const metadata: Metadata = { title: 'Classes & sections' };

export default function Page() {
  return (
    <Gate perm="academics:view">
      <Suspense>
        <ClassesScreen />
      </Suspense>
    </Gate>
  );
}
