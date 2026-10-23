import type { Metadata } from 'next';
import { Suspense } from 'react';
import { StudentProfileScreen } from '@/components/features/teacher/classes/student-profile';

export const metadata: Metadata = { title: 'Student' };

export default async function Page({ params }: { params: Promise<{ sectionId: string; studentId: string }> }) {
  const { sectionId, studentId } = await params;
  return (
    <Suspense>
      <StudentProfileScreen sectionId={sectionId} studentId={studentId} />
    </Suspense>
  );
}
