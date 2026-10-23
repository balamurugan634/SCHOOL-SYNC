import type { Metadata } from 'next';
import { Suspense } from 'react';
import { gate } from '@/components/features/management/common/gate';
import { ExpensesPage } from '@/components/features/management/finance/expenses-page';

export const metadata: Metadata = { title: 'Expenses' };

export default async function Page() {
  const denied = await gate({ any: ['expenses:view'], min: 'school', feature: 'fees' });
  if (denied) return denied;
  return (
    <Suspense>
      <ExpensesPage />
    </Suspense>
  );
}
