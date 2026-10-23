import type { Metadata } from 'next';
import { Suspense } from 'react';
import { InvoiceScreen } from '@/components/features/learner/fees/screens';

export const metadata: Metadata = { title: 'Invoice' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <InvoiceScreen id={id} />
    </Suspense>
  );
}
