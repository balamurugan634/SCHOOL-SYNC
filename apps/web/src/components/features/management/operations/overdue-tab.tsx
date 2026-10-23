'use client';

import * as React from 'react';
import { BookDown } from 'lucide-react';
import type { LibraryIssue } from '@school-sync/shared';
import { useOverdue } from '@/lib/client/operations';
import { fmtDate } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { DataTable } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { StatTile } from '@/components/ui/stat-tile';
import { GuardedButton } from '../common/guarded';
import { useListState } from '../common/url-state';
import { useMgmt } from '../common/use-mgmt';
import { ReturnDialog } from './loans-tab';

export function OverdueTab() {
  const { money, writeBlock } = useMgmt();
  const ls = useListState({ pageSize: 25 });
  const q = useOverdue({ page: ls.page, pageSize: ls.pageSize });
  const [ret, setRet] = React.useState<LibraryIssue | null>(null);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Overdue loans" value={q.data?.totals.count} state={q.isPending ? 'loading' : 'ready'} />
        <StatTile label="Fines so far" value={q.data ? money(q.data.totals.fineMinor) : undefined} hint="accrued on overdue loans" state={q.isPending ? 'loading' : 'ready'} />
      </div>
      <DataTable<LibraryIssue>
        id="ops-overdue"
        caption="Overdue loans"
        rows={q.data?.data}
        rowKey={(r) => r.id}
        loading={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
        page={ls.page}
        pageSize={ls.pageSize}
        total={q.data?.meta.total}
        onPageChange={ls.setPage}
        onPageSizeChange={ls.setPageSize}
        empty={<EmptyState illustration="success" title="Nothing is overdue" description="Every borrowed book is within its due date." />}
        columns={[
          { id: 'book', header: 'Book', cell: (r) => (<><span className="block max-w-[34ch] truncate font-medium">{r.book.title}</span><span className="t-caption block text-ink-3">{r.book.accessionNo}</span></>), mobile: 'title' },
          { id: 'who', header: 'Borrower', cell: (r) => (<><span className="block">{r.borrower.name}</span><span className="t-caption block text-ink-3">{r.borrower.type === 'staff' ? 'Staff' : [r.borrower.grade, r.borrower.section].filter(Boolean).join(' ')} · {r.borrower.code}</span></>), mobile: 'sub' },
          { id: 'due', header: 'Was due', cell: (r) => fmtDate(r.dueOn), sortable: true, sortValue: (r) => r.dueOn, mobile: 'detail', label: 'Was due' },
          { id: 'late', header: 'Days late', cell: (r) => <Badge variant="danger">{r.daysOverdue} days</Badge>, align: 'right', sortable: true, sortValue: (r) => r.daysOverdue, mobile: 'status' },
          { id: 'fine', header: 'Fine so far', cell: (r) => <span className="font-medium">{money(r.fineMinor)}</span>, align: 'right', sortable: true, sortValue: (r) => r.fineMinor, mobile: 'value' },
          {
            id: 'actions',
            header: <span className="sr-only">Return</span>,
            label: 'Return',
            hideable: false,
            align: 'right',
            mobile: 'hide',
            cell: (r) => (
              <GuardedButton blocked={writeBlock('library:edit', 'school')} size="sm" variant="secondary" onClick={() => setRet(r)}>
                <BookDown /> Return
              </GuardedButton>
            ),
          },
        ]}
      />
      <ReturnDialog loan={ret} onClose={() => setRet(null)} />
    </div>
  );
}
