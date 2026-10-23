import type { Metadata } from 'next';
import { SessionsPage } from '@/components/account/sessions-page';

export const metadata: Metadata = { title: 'Sessions & devices' };

export default function Page() {
  return <SessionsPage />;
}
