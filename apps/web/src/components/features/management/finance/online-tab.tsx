'use client';

import * as React from 'react';
import { RefreshCw } from 'lucide-react';
import type { PaymentOut } from '@school-sync/shared';
import { usePayments, useSyncPayment } from '@/lib/client/finance';
import { friendlyError } from '@/lib/client/mgmt';
import { fmtDateTime } from '@/lib/format';
import { StatusChip } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { DataTable } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { toast } from '@/components/ui/toaster';
import { ChoicePills, FilterBar } from '../common/filters';
import { GuardedButton } from '../common/guarded';
import { useListState } from '../common/url-state';
import { useMgmt } from '../common/use-mgmt';
import { OnlinePaymentsStatus } from './online-status';

const STATUS = [
  { value: '' as const, label: 'All' },
  { value: 'pending' as const, label: 'Pending' },
  { value: 'succeeded' as const, label: 'Succeeded' },
  { value: 'failed' as const, label: 'Failed' },
];

/** Gateway status (read-only) and the online payments that came through it. Pending ones can be re-checked with the gateway. */
export function OnlineTab() {
  const { money, features, writeBlock } = useMgmt();
  const ls = useListState({ pageSize: 25 });
  const status = ls.get('ostatus') as '' | 'pending' | 'succeeded' | 'failed';
  const q = usePayments({ page: ls.page, pageSize: ls.pageSize, method: 'online', status: status || undefined });
  const sync = useSyncPayment();
  const [busy, setBusy] = React.useState<string | null>(null);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-4">
        {!features?.onlinePayments && <Banner tone="info">Online payments are not switched on for this school, so parents pay at the school office. Past online payments, if any, still show here.</Banner>}
        <DataTable<PaymentOut>
          id="fees-online"
          rows={q.data?.data}
          rowKey={(r) => r.id}
          loading={q.isPending}
          error={q.error}
          onRetry={() => void q.refetch()}
          caption="Online payments"
          page={ls.page}
          pageSize={ls.pageSize}
          total={q.data?.meta.total}
          onPageChange={ls.setPage}
          onPageSizeChange={ls.setPageSize}
          filters={
            <FilterBar>
              <ChoicePills label="Online payment status" value={status} onChange={(v) => ls.set({ ostatus: v })} options={STATUS} />
            </FilterBar>
          }
          empty={<EmptyState illustration="empty-generic" title={status ? 'No online payments with this status' : 'No online payments yet'} description="When a parent pays through the gateway it will appear here with its status." />}
          columns={[
            { id: 'student', header: 'Student', cell: (r) => (<><span className="block font-medium">{r.studentName}</span><span className="t-caption block text-ink-3">{r.invoiceNo}</span></>), mobile: 'title' },
            { id: 'amount', header: 'Amount', cell: (r) => money(r.amountMinor), align: 'right', mobile: 'value' },
            { id: 'gateway', header: 'Gateway', cell: (r) => r.gateway ?? '—', mobile: 'detail', label: 'Gateway' },
            { id: 'ref', header: 'Reference', cell: (r) => r.reference ?? '—', defaultHidden: true, mobile: 'hide' },
            { id: 'status', header: 'Status', cell: (r) => <StatusChip status={r.status} />, mobile: 'status' },
            { id: 'when', header: 'When', cell: (r) => fmtDateTime(r.paidAt ?? r.createdAt), mobile: 'sub' },
            {
              id: 'sync',
              header: <span className="sr-only">Check with gateway</span>,
              label: 'Check with gateway',
              hideable: false,
              align: 'right',
              mobile: 'hide',
              cell: (r) =>
                r.status === 'pending' ? (
                  <GuardedButton
                    blocked={writeBlock('payments:view')}
                    size="sm"
                    variant="secondary"
                    loading={busy === r.id}
                    onClick={async () => {
                      setBusy(r.id);
                      try {
                        const p = await sync.mutateAsync({ id: r.id });
                        toast.message(p.status === 'succeeded' ? 'The gateway confirmed this payment' : p.status === 'failed' ? 'The gateway reports this payment failed' : 'Still pending at the gateway');
                      } catch (e) {
                        toast.error(friendlyError(e), { duration: 8000 });
                      } finally {
                        setBusy(null);
                      }
                    }}
                  >
                    <RefreshCw /> Check status
                  </GuardedButton>
                ) : null,
            },
          ]}
        />
      </div>
      <OnlinePaymentsStatus className="self-start" />
    </div>
  );
}
