import type { Metadata } from 'next';
import { Gate } from '@/components/features/management/shared/gate';
import { StudentCreate } from '@/components/features/management/people/student-create';

export const metadata: Metadata = { title: 'Add student' };

export default function Page() {
  return (
    <Gate perm="students:create" min="school">
      <StudentCreate />
    </Gate>
  );
}
