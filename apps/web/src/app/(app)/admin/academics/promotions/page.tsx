import type { Metadata } from 'next';
import { Gate } from '@/components/features/management/shared/gate';
import { PromotionsScreen } from '@/components/features/management/academics/promotions-screen';

export const metadata: Metadata = { title: 'Year-end promotion' };

export default function Page() {
  return (
    <Gate perm="promotions:view">
      <PromotionsScreen />
    </Gate>
  );
}
