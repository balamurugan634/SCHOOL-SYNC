'use client';

import * as React from 'react';
import { CheckCircle2, MinusCircle } from 'lucide-react';
import { useGetQuery } from '@/lib/client/mgmt';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useMgmt } from '../common/use-mgmt';

type FeesSettings = { parentsCanPayOnline?: boolean; lateFeePerDayMinor?: number; expenseApprovalThresholdMinor?: number; invoicePrefix?: string; receiptPrefix?: string };

/**
 * Read-only status of online payments: the school flag (public site info) and, for users who may read settings, the
 * fee settings that govern it. Changing any of it happens under Settings; nothing here writes.
 */
export function OnlinePaymentsStatus({ className }: { className?: string }) {
  const { features, can, money } = useMgmt();
  const canSettings = can('settings:view');
  const q = useGetQuery<FeesSettings>(['settings', 'fees'], '/settings/fees', undefined, { enabled: canSettings, staleTime: 60_000 });
  const on = !!features?.onlinePayments;
  const parents = q.data?.parentsCanPayOnline;
  return (
    <Card className={className}>
      <CardHeader title="Online payments" description="Read-only. A school administrator changes this in Settings." />
      <CardBody className="pt-4">
        <dl className="space-y-3 text-sm">
          <Row label="Online payment gateway" value={<Status on={on} yes="Enabled" no="Not enabled" />} />
          <Row
            label="Parents can pay online"
            value={!canSettings ? <span className="text-ink-3">Not visible to your role</span> : q.isPending ? <Skeleton className="h-4 w-16" /> : q.isError ? <span className="text-ink-3">Unavailable</span> : <Status on={!!parents && on} yes="Yes" no={on ? 'No, parents see balances only' : 'No'} />}
          />
          {canSettings && q.data?.lateFeePerDayMinor !== undefined && <Row label="Late fee per day" value={q.data.lateFeePerDayMinor > 0 ? money(q.data.lateFeePerDayMinor) : 'None'} />}
          {canSettings && q.data?.expenseApprovalThresholdMinor !== undefined && <Row label="Expenses need approval above" value={q.data.expenseApprovalThresholdMinor > 0 ? money(q.data.expenseApprovalThresholdMinor) : 'Every expense'} />}
        </dl>
        {!on && <p className="t-caption mt-4 text-ink-2">With online payments off, parents see what they owe and pay at the school office; offline payments are recorded here.</p>}
      </CardBody>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-ink-2">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

function Status({ on, yes, no }: { on: boolean; yes: string; no: string }) {
  return on ? (
    <span className="inline-flex items-center gap-1.5 text-success">
      <CheckCircle2 className="size-4" aria-hidden />
      {yes}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-ink-2">
      <MinusCircle className="size-4" aria-hidden />
      {no}
    </span>
  );
}
