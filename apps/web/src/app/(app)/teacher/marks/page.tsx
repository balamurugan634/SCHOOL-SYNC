import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SheetsScreen } from '@/components/features/teacher/marks/sheets-screen';

export const metadata: Metadata = { title: 'Marks' };

export default function Page() {
  return (
    <Suspense>
      <SheetsScreen />
    </Suspense>
  );
}
