import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AssignmentsScreen } from '@/components/features/management/academics/assignments-screen';
import { Gate } from '@/components/features/management/shared/gate';

export const metadata: Metadata = { title: 'Teaching assignments' };

export default function Page() {
  return (
    <Gate perm="academics:view">
      <Suspense>
        <AssignmentsScreen />
      </Suspense>
    </Gate>
  );
}
