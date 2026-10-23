import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ReviewScreen } from '@/components/features/management/exams/review-screen';
import { Gate } from '@/components/features/management/shared/gate';

export const metadata: Metadata = { title: 'Mark sheet review' };

export default function Page() {
  return (
    <Gate perm="marks:view" min="assigned">
      <Suspense>
        <ReviewScreen />
      </Suspense>
    </Gate>
  );
}
