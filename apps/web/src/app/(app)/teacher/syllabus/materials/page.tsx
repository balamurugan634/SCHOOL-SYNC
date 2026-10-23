import type { Metadata } from 'next';
import { Suspense } from 'react';
import { MaterialsScreen } from '@/components/features/teacher/syllabus/materials';

export const metadata: Metadata = { title: 'Study materials' };

export default function Page() {
  return (
    <Suspense>
      <MaterialsScreen />
    </Suspense>
  );
}
