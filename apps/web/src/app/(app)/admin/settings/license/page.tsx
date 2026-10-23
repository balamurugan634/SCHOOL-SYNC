import type { Metadata } from 'next';
import { Gate } from '@/components/features/management/shared/gate';
import { LicenseScreen } from '@/components/features/management/settings/license-screen';

export const metadata: Metadata = { title: 'Subscription and seats' };

export default function Page() {
  return (
    <Gate perm="settings:view" min="school">
      <LicenseScreen />
    </Gate>
  );
}
