import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Gate } from '@/components/features/management/shared/gate';
import { StaffDetail } from '@/components/features/management/people/staff-detail';

export const metadata: Metadata = { title: 'Staff member' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Gate perm="staff:view">
      <Suspense>
        <StaffDetail id={id} />
      </Suspense>
    </Gate>
  );
}
