import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ReportCardsScreen } from '@/components/features/management/exams/report-cards-screen';
import { Gate } from '@/components/features/management/shared/gate';

export const metadata: Metadata = { title: 'Report cards' };

export default function Page() {
  return (
    <Gate perm="report_cards:view" min="assigned">
      <Suspense>
        <ReportCardsScreen />
      </Suspense>
    </Gate>
  );
}
