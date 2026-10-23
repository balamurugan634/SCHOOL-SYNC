import type { Metadata } from 'next';
import { Suspense } from 'react';
import { YearsScreen } from '@/components/features/management/academics/years-screen';
import { Gate } from '@/components/features/management/shared/gate';

export const metadata: Metadata = { title: 'Academic years & terms' };

export default function Page() {
  return (
    <Gate perm="academics:view">
      <Suspense>
        <YearsScreen />
      </Suspense>
    </Gate>
  );
}
