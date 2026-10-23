import type { Metadata } from 'next';
import { ManagementDashboard } from '@/components/dashboard/management-dashboard';

export const metadata: Metadata = { title: 'Dashboard' };

export default function Page() {
  return <ManagementDashboard />;
}
