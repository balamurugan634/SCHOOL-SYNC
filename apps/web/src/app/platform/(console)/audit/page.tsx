import type { Metadata } from 'next';
import { AuditScreen } from '@/components/platform/audit-screen';

export const metadata: Metadata = { title: 'Audit log' };

export default function Page() {
  return <AuditScreen />;
}
