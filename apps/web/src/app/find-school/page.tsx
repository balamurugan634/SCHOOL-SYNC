import type { Metadata } from 'next';
import { Suspense } from 'react';
import { FindSchool } from '@/components/auth/find-school';
import { getSiteState } from '@/lib/server/site';

export const metadata: Metadata = { title: 'Find your school' };

export default async function FindSchoolPage() {
  const s = await getSiteState();
  return (
    <Suspense>
      <FindSchool currentCode={s.status === 'ok' ? s.code : null} />
    </Suspense>
  );
}
