import type { Metadata } from 'next';
import { Suspense } from 'react';
import { gate } from '@/components/features/management/common/gate';
import { RouteDetailPage } from '@/components/features/management/operations/route-detail';

export const metadata: Metadata = { title: 'Route' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const denied = await gate({ any: ['transport:view'], min: 'school', feature: 'transport' });
  if (denied) return denied;
  const { id } = await params;
  return (
    <Suspense>
      <RouteDetailPage id={id} />
    </Suspense>
  );
}
