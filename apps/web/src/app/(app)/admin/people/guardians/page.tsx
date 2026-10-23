import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Gate } from '@/components/features/management/shared/gate';
import { GuardiansList } from '@/components/features/management/people/guardians-list';

export const metadata: Metadata = { title: 'Parents and guardians' };

export default function Page() {
  return (
    <Gate perm="guardians:view">
      <Suspense>
        <GuardiansList />
      </Suspense>
    </Gate>
  );
}
