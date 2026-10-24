import type { Metadata } from 'next';
import { SchoolsScreen } from '@/components/platform/schools-screen';

export const metadata: Metadata = { title: 'Schools' };

export default function Page() {
  return <SchoolsScreen />;
}
