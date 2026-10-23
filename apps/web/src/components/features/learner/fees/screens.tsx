'use client';

import * as React from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/shell/page-header';
import { Button } from '@/components/ui/button';
import { MoreNav } from '../more-nav';
import { FeatureGate } from '../gate';
import { ChildContext, NeedsLearner } from '../states';
import { useGates, useLearner } from '../use-learner';
import { UrlTabs, useTabParam } from '../url-state';
import { ChildScopeSelect, FeeSummaryTiles, InvoicesTable, PaymentsTable } from './invoices';
import { InvoiceDetail } from './invoice-detail';
import { OnlinePayNote } from './pay-dialog';

const TABS = ['invoices', 'payments'] as const;

function FeesBody() {
  const l = useLearner();
  const { can } = useGates();
  const [tab, setTab] = useTabParam(TABS, 'invoices');
  const showPayments = can('payments:view');
  const active = tab === 'payments' && showPayments ? 'payments' : 'invoices';
  return (
    <div className="space-y-6">
      <FeeSummaryTiles />
      <OnlinePayNote show />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ChildScopeSelect />
      </div>
      {showPayments && (
        <UrlTabs
          label="Fees sections"
          tab={active}
          onTab={setTab}
          tabs={[
            { value: 'invoices', label: 'Invoices' },
            { value: 'payments', label: 'Payments & receipts' },
          ]}
        />
      )}
      <div role="tabpanel" aria-label={active} key={`${active}-${l.studentId}`} className={showPayments ? '-mt-2' : undefined}>
        {active === 'invoices' ? <InvoicesTable /> : <PaymentsTable />}
      </div>
    </div>
  );
}

export function StudentFeesScreen() {
  return (
    <>
      <PageHeader title="Fees" description="Your invoices, balance and receipts. Fees are paid by your parent or guardian." />
      <MoreNav />
      <FeatureGate feature="fees" perm="fees:view" what="Fees">
        <NeedsLearner>
          <FeesBody />
        </NeedsLearner>
      </FeatureGate>
    </>
  );
}

export function ParentFeesScreen() {
  const l = useLearner();
  return (
    <>
      <PageHeader title="Fees" description="Dues, late fees, payments and receipts." actions={l.ready ? <Button asChild variant="secondary" size="sm"><Link href={`${l.base}/fees/payments`}>Payment history</Link></Button> : undefined} />
      <ChildContext />
      <FeatureGate feature="fees" perm="fees:view" what="Fees">
        <NeedsLearner>
          <FeesBody />
        </NeedsLearner>
      </FeatureGate>
    </>
  );
}

/** /parent/fees/payments — the payment history on its own page (also a tab on the fees screen). */
export function ParentPaymentsScreen() {
  const l = useLearner();
  return (
    <>
      <PageHeader title="Payment history" description="Every payment recorded for your children, with receipts." crumbs={[{ label: 'Home', href: l.base || '/' }, { label: 'Fees', href: `${l.base}/fees` }, { label: 'Payment history' }]} />
      <ChildContext />
      <FeatureGate feature="fees" perm="payments:view" what="Payment history">
        <NeedsLearner>
          <div className="space-y-4">
            <ChildScopeSelect />
            <PaymentsTable />
          </div>
        </NeedsLearner>
      </FeatureGate>
    </>
  );
}

export function InvoiceScreen({ id }: { id: string }) {
  return (
    <FeatureGate feature="fees" perm="fees:view" what="Fees">
      <NeedsLearner>
        <InvoiceDetail id={id} />
      </NeedsLearner>
    </FeatureGate>
  );
}
