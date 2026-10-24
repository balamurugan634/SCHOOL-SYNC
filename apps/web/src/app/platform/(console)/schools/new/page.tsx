import type { Metadata } from 'next';
import { SchoolWizard } from '@/components/platform/school-wizard';

export const metadata: Metadata = { title: 'Create school' };

export default function Page() {
  return <SchoolWizard />;
}
