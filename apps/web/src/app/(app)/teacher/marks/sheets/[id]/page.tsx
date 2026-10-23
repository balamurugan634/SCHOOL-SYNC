import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SheetEntryScreen } from '@/components/features/teacher/marks/sheet-entry';

export const metadata: Metadata = { title: 'Enter marks' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <SheetEntryScreen id={id} />
    </Suspense>
  );
}
