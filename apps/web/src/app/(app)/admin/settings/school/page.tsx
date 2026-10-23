import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Gate } from '@/components/features/management/shared/gate';
import { SchoolSettings } from '@/components/features/management/settings/school-settings';

export const metadata: Metadata = { title: 'School profile and settings' };

export default function Page() {
  return (
    <Gate perm="settings:view" min="school">
      <Suspense>
        <SchoolSettings />
      </Suspense>
    </Gate>
  );
}
