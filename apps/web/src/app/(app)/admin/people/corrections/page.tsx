import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Gate } from '@/components/features/management/shared/gate';
import { CorrectionsQueue } from '@/components/features/management/people/corrections-queue';

export const metadata: Metadata = { title: 'Record corrections' };

export default function Page() {
  return (
    <Gate perm="students:edit" min="school">
      <Suspense>
        <CorrectionsQueue />
      </Suspense>
    </Gate>
  );
}
