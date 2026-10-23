import type { Metadata } from 'next';
import { Gate } from '@/components/features/management/shared/gate';
import { RoleEditor } from '@/components/features/management/settings/role-editor';

export const metadata: Metadata = { title: 'Edit role' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Gate perm="roles:view" min="school">
      <RoleEditor id={id} />
    </Gate>
  );
}
