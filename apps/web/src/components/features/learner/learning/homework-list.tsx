'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Paperclip } from 'lucide-react';
import { HOMEWORK_LEARNER_STATUSES, type HomeworkItem, type HomeworkLearnerStatus } from '@school-sync/shared';
import { useHomeworkList } from '@/lib/client/learner-learning';
import { dueLabel, fmtDateTime } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { DataTable, type SortState } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { SearchField } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useLearner } from '../use-learner';
import { useUrlParams } from '../url-state';
import { HOMEWORK_STATUS_OPTIONS, HomeworkStatusChip, marksText } from './common';

const PAGE_SIZES = [10, 25, 50];

/** Homework for the student (or the selected child). Filters, sort and page live in the URL. */
export function HomeworkList() {
  const l = useLearner();
  const router = useRouter();
  const { get, set } = useUrlParams();
  const page = Math.max(1, Number(get('page')) || 1);
  const pageSize = PAGE_SIZES.includes(Number(get('size'))) ? Number(get('size')) : 10;
  const statusRaw = get('status');
  const status = (HOMEWORK_LEARNER_STATUSES as readonly string[]).includes(statusRaw ?? '') ? (statusRaw as HomeworkLearnerStatus) : undefined;
  const sortParam = get('sort');
  const sort = sortParam === 'dueAsc' ? 'dueAsc' : 'dueDesc';
  const urlQ = get('q') ?? '';
  const [q, setQ] = React.useState(urlQ);
  React.useEffect(() => setQ(urlQ), [urlQ]);
  React.useEffect(() => {
    if (q === urlQ) return;
    const t = setTimeout(() => set({ q: q || null, page: null }), 300);
    return () => clearTimeout(t);
  }, [q, urlQ, set]);

  const query = useHomeworkList(l.studentId, l.isParent, { page, pageSize, q: urlQ, learnerStatus: status, sort });
  // default (newest due first) shows no indicator; clicking cycles ascending → descending → default
  const tableSort: SortState = sortParam === 'dueAsc' ? { id: 'due', dir: 'asc' } : sortParam === 'dueDesc' ? { id: 'due', dir: 'desc' } : null;
  const open = (h: HomeworkItem) => router.push(`${l.base}/${l.isParent ? 'academics' : 'learning'}/homework/${h.id}`);
  const filtered = !!status || !!urlQ;
  const clear = () => {
    setQ('');
    set({ status: null, q: null, page: null });
  };

  return (
    <DataTable
      id={`homework-${l.role}`}
      caption="Homework"
      rows={query.data?.data}
      rowKey={(h) => h.id}
      loading={query.isPending}
      error={query.isError && !query.data ? query.error : undefined}
      onRetry={() => void query.refetch()}
      onRowClick={open}
      sort={tableSort}
      onSortChange={(s) => set({ sort: s ? (s.dir === 'asc' ? 'dueAsc' : 'dueDesc') : null, page: null })}
      page={page}
      pageSize={pageSize}
      total={query.data?.meta.total}
      onPageChange={(p) => set({ page: p <= 1 ? null : p })}
      onPageSizeChange={(n) => set({ size: n === 10 ? null : n, page: null })}
      pageSizeOptions={PAGE_SIZES}
      filters={
        <>
          <SearchField value={q} onChange={setQ} placeholder="Search homework" className="w-full sm:w-64" hint={null} />
          <Select aria-label="Filter by status" className="w-44" value={status ?? 'all'} onValueChange={(v) => set({ status: v === 'all' ? null : v, page: null })} options={HOMEWORK_STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} />
        </>
      }
      empty={
        filtered ? (
          <EmptyState
            illustration="no-results"
            title="No homework matches"
            description="Try a different status or search."
            filters={
              <>
                {status && <span className="rounded-full bg-surface-sunken px-2.5 py-1 text-xs">{HOMEWORK_STATUS_OPTIONS.find((o) => o.value === status)?.label}</span>}
                {urlQ && <span className="rounded-full bg-surface-sunken px-2.5 py-1 text-xs">“{urlQ}”</span>}
              </>
            }
            action={<Button variant="secondary" size="sm" onClick={clear}>Clear filters</Button>}
          />
        ) : (
          <EmptyState illustration="empty-homework" title="No homework yet" description={l.isParent ? `Homework set for ${l.name} appears here.` : 'When a teacher sets homework it appears here.'} />
        )
      }
      columns={[
        {
          id: 'title',
          header: 'Homework',
          mobile: 'title',
          cell: (h) => (
            <span className="block min-w-0">
              <span className="flex items-center gap-1.5 font-medium">
                <span className="truncate">{h.title}</span>
                {h.attachments.length > 0 && (
                  <>
                    <Paperclip className="size-3.5 shrink-0 text-ink-3" aria-hidden />
                    <span className="sr-only">Has attachments</span>
                  </>
                )}
              </span>
              <span className="t-caption block truncate text-ink-2">{[h.subjectName, h.teacherName].filter(Boolean).join(' · ')}</span>
            </span>
          ),
        },
        { id: 'subject', header: 'Subject', label: 'Subject', mobile: 'hide', defaultHidden: true, cell: (h) => h.subjectName },
        {
          id: 'due',
          header: 'Due',
          sortable: true,
          mobile: 'sub',
          cell: (h) => {
            const d = dueLabel(h.dueAt);
            const late = d.overdue && !['submitted', 'late', 'reviewed'].includes(h.learner?.status ?? '');
            return (
              <span className={cn('whitespace-nowrap', late && 'font-medium text-danger')} title={fmtDateTime(h.dueAt)}>
                {d.text}
              </span>
            );
          },
        },
        { id: 'marks', header: 'Marks', align: 'right', mobile: 'detail', cell: (h) => (h.maxMarks ? marksText(h.learner?.submission?.marks ?? null, h.maxMarks) : '—') },
        {
          id: 'status',
          header: 'Status',
          mobile: 'status',
          cell: (h) => {
            const s = h.learner?.status ?? 'pending';
            return <HomeworkStatusChip status={s} />;
          },
        },
      ]}
    />
  );
}
