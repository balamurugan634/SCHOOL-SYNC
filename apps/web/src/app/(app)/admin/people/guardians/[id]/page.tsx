import type { Metadata } from 'next';
import { Gate } from '@/components/features/management/shared/gate';
import { GuardianDetail } from '@/components/features/management/people/guardian-detail';

export const metadata: Metadata = { title: 'Parent' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Gate perm="guardians:view">
      <GuardianDetail id={id} />
    </Gate>
  );
}
