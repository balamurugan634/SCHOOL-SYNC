import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Gate } from '@/components/features/management/shared/gate';
import { UsersScreen } from '@/components/features/management/settings/users-screen';

export const metadata: Metadata = { title: 'Users' };

export default function Page() {
  return (
    <Gate perm="users:view" min="school">
      <Suspense>
        <UsersScreen />
      </Suspense>
    </Gate>
  );
}
