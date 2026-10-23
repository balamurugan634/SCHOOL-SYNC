import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Gate } from '@/components/features/management/shared/gate';
import { AdmissionsBoard } from '@/components/features/management/people/admissions-board';

export const metadata: Metadata = { title: 'Admissions' };

export default function Page() {
  return (
    <Gate perm="admissions:view" min="school">
      <Suspense>
        <AdmissionsBoard />
      </Suspense>
    </Gate>
  );
}
