import type { Metadata } from 'next';
import { OperatorsScreen } from '@/components/platform/operators-screen';
import { requireOperator } from '@/lib/platform/session';

export const metadata: Metadata = { title: 'Operators' };

export default async function Page() {
  const me = await requireOperator();
  return <OperatorsScreen meId={me.id} />;
}
