import type { Metadata } from 'next';
import { Gate } from '@/components/features/management/shared/gate';
import { StaffCreate } from '@/components/features/management/people/staff-create';

export const metadata: Metadata = { title: 'Add staff' };

export default function Page() {
  return (
    <Gate perm="staff:create" min="school">
      <StaffCreate />
    </Gate>
  );
}
