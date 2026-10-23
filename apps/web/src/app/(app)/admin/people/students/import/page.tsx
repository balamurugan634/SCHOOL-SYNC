import type { Metadata } from 'next';
import { Gate } from '@/components/features/management/shared/gate';
import { StudentImport } from '@/components/features/management/people/student-import';

export const metadata: Metadata = { title: 'Import students' };

export default function Page() {
  return (
    <Gate perm="students:create" min="school">
      <StudentImport />
    </Gate>
  );
}
