import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Gate } from '@/components/features/management/shared/gate';
import { AuditScreen } from '@/components/features/management/settings/audit-screen';

export const metadata: Metadata = { title: 'Audit log' };

export default function Page() {
  return (
    <Gate perm="audit:view" min="school">
      <Suspense>
        <AuditScreen />
      </Suspense>
    </Gate>
  );
}
