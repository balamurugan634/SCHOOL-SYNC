import type { Metadata } from 'next';
import { Gate } from '@/components/features/management/shared/gate';
import { RolesScreen } from '@/components/features/management/settings/roles-screen';

export const metadata: Metadata = { title: 'Roles and permissions' };

export default function Page() {
  return (
    <Gate perm="roles:view" min="school">
      <RolesScreen />
    </Gate>
  );
}
