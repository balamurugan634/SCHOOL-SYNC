'use client';

import * as React from 'react';
import Link from 'next/link';
import { Download, FilePlus2, FileStack, X } from 'lucide-react';
import type { InvoiceOut } from '@school-sync/shared';
import { bff } from '@/lib/client/fetcher';
import { invoiceQuery, useFinanceSummary, useGrades, useInvoices, type InvoiceFilters, type Paged } from '@/lib/client/hooks';
import { useUrlState } from '@/lib/client/use-url-state';
import { downloadCsv, toCsv } from '@/lib/csv';
import { errorMessage } from '@/lib/problem';
import { fmtDate, money, moneyCompact, percent, plural, todayIso } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Badge, StatusChip } from '../ui/badge';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { DatePicker } from '../ui/date-picker';
import { DataTable, type Column, type SortState } from '../ui/data-table';
import { EmptyState } from '../ui/empty-state';
import { SearchField } from '../ui/input';
import { Select } from '../ui/select';
import { StatTile } from '../ui/stat-tile';
import { toast } from '../ui/toaster';
import { PageHeader } from '../shell/page-header';
import { usePermissions } from '../me-context';
import { InvoiceDrawer } from './invoice-drawer';
import { CreateInvoiceDrawer } from '../features/management/finance/invoice-extras';
import { GuardedButton } from '../features/management/common/guarded';
import { useMgmt } from '../features/management/common/use-mgmt';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'partial', label: 'Part paid' },
  { value: 'paid', label: 'Paid' },
  { value: 'void', label: 'Void' },
];
const STATUS_LABEL: Record<string, string> = { unpaid: 'Unpaid', partial: 'Part paid', paid: 'Paid', void: 'Void' };

const effectiveStatus = (i: InvoiceOut) => (i.overdue && (i.status === 'unpaid' || i.status === 'partial') ? 'overdue' : i.status);

function monthRange(): { from: string; to: string } {
  const d = new Date();
  const iso = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  return { from: iso(new Date(d.getFullYear(), d.getMonth(), 1)), to: iso(new Date(d.getFullYear(), d.getMonth() + 1, 0)) };
}
function lastDays(n: number): { from: string; to: string } {
  const d = new Date();
  const s = new Date(d);
  s.setDate(d.getDate() - n);
  const iso = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  return { from: iso(s), to: iso(d) };
}

/** Fees → Invoices: a work queue for finance. Server-side search / filters / pagination, CSV export, detail drawer, record payment. */
export function InvoicesScreen() {
  const url = useUrlState();
  const { can } = usePermissions();
  const [search, setSearch] = React.useState(url.get('q'));
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [exporting, setExporting] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const { writeBlock, base } = useMgmt();

  // debounce the search box into the URL
  React.useEffect(() => {
    if (search === url.get('q')) return;
    const t = setTimeout(() => url.set({ q: search }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const filters: InvoiceFilters = {
    q: url.get('q'),
    status: url.get('status') || undefined,
    gradeId: url.get('grade') || undefined,
    overdue: url.get('overdue') === '1',
    from: url.get('from') || undefined,
    to: url.get('to') || undefined,
    page: Math.max(1, Number(url.get('page')) || 1),
    pageSize: [10, 25, 50, 100].includes(Number(url.get('size'))) ? Number(url.get('size')) : 25,
  };
  const sortParam = url.get('sort');
  const sort: SortState = sortParam ? { id: sortParam.split(':')[0]!, dir: sortParam.endsWith(':desc') ? 'desc' : 'asc' } : null;

  const q = useInvoices(filters);
  const summary = useFinanceSummary(can('fees:view'));
  const grades = useGrades();
  const rows = q.data?.data;
  const total = q.data?.meta.total ?? 0;
  const activeCount = [filters.q, filters.status, filters.gradeId, filters.overdue, filters.from, filters.to].filter(Boolean).length;
  const openId = url.get('invoice') || null;

  const gradeName = (id: string) => (grades.data ?? []).find((g) => g.id === id)?.name ?? 'Grade';
  const clearAll = () => {
    setSearch('');
    url.set({ q: null, status: null, grade: null, overdue: null, from: null, to: null });
  };

  const columns: Column<InvoiceOut>[] = [
    { id: 'invoice', header: 'Invoice', cell: (r) => (<><span className="tnum font-medium">{r.invoiceNo}</span><span className="t-caption block max-w-[28ch] truncate text-ink-3">{r.title}</span></>), sortable: true, sortValue: (r) => r.invoiceNo, mobile: 'title', hideable: false },
    { id: 'student', header: 'Student', cell: (r) => (<><span className="block">{r.studentName}</span><span className="t-caption block text-ink-3">{r.admissionNo}{r.gradeName ? ` · ${r.gradeName}${r.sectionName ? `-${r.sectionName}` : ''}` : ''}</span></>), sortable: true, sortValue: (r) => r.studentName, mobile: 'sub' },
    { id: 'due', header: 'Due date', cell: (r) => (<><span className="tnum block">{fmtDate(r.dueDate)}</span>{r.overdue && r.status !== 'paid' && r.status !== 'void' && <span className="t-caption block text-danger">{r.daysOverdue} day{r.daysOverdue === 1 ? '' : 's'} late</span>}</>), sortable: true, sortValue: (r) => r.dueDate, mobile: 'detail', label: 'Due date' },
    { id: 'total', header: 'Total', cell: (r) => money(r.totalMinor), align: 'right', sortable: true, sortValue: (r) => r.totalMinor, mobile: 'hide' },
    { id: 'paid', header: 'Paid', cell: (r) => money(r.paidMinor), align: 'right', sortable: true, sortValue: (r) => r.paidMinor, mobile: 'detail', label: 'Paid', defaultHidden: false },
    { id: 'balance', header: 'Balance', cell: (r) => <span className={cn('font-medium', r.balanceMinor > 0 && r.overdue && 'text-danger')}>{money(r.balanceMinor)}</span>, align: 'right', sortable: true, sortValue: (r) => r.balanceMinor, mobile: 'value' },
    { id: 'status', header: 'Status', cell: (r) => <StatusChip status={effectiveStatus(r)} />, sortable: true, sortValue: (r) => effectiveStatus(r), mobile: 'status' },
  ];

  /** CSV of everything matching the current filters (up to 5 000 rows), built in the browser from the paged API. */
  const exportCsv = async (only?: InvoiceOut[]) => {
    setExporting(true);
    const id = toast.loading(only ? 'Preparing CSV…' : 'Preparing CSV of every matching invoice…');
    try {
      let list: InvoiceOut[] = only ?? [];
      if (!only) {
        for (let page = 1; page <= 50; page++) {
          const res = await bff<Paged<InvoiceOut>>('/fees/invoices', { query: invoiceQuery({ ...filters, page, pageSize: 100 }) });
          list = list.concat(res.data);
          if (page >= res.meta.totalPages) break;
        }
      }
      const csv = toCsv(
        ['Invoice no', 'Admission no', 'Student', 'Grade', 'Section', 'Title', 'Due date', 'Status', 'Days overdue', 'Total', 'Discount', 'Paid', 'Balance', 'Late fee'],
        list.map((r) => [r.invoiceNo, r.admissionNo, r.studentName, r.gradeName, r.sectionName, r.title, r.dueDate, effectiveStatus(r), r.overdue ? r.daysOverdue : 0, r.totalMinor / 100, r.discountMinor / 100, r.paidMinor / 100, r.balanceMinor / 100, r.lateFeeMinor / 100]),
      );
      downloadCsv(`invoices-${todayIso()}.csv`, csv);
      toast.success('CSV downloaded', { id, description: plural(list.length, 'invoice') });
    } catch (e) {
      toast.error('Couldn’t prepare the CSV', { id, description: errorMessage(e), duration: 8000 });
    } finally {
      setExporting(false);
    }
  };

  const chips: { key: string; label: string; clear: () => void }[] = [
    filters.q ? { key: 'q', label: `“${filters.q}”`, clear: () => { setSearch(''); url.set({ q: null }); } } : null,
    filters.status ? { key: 'status', label: STATUS_LABEL[filters.status] ?? filters.status, clear: () => url.set({ status: null }) } : null,
    filters.gradeId ? { key: 'grade', label: gradeName(filters.gradeId), clear: () => url.set({ grade: null }) } : null,
    filters.overdue ? { key: 'overdue', label: 'Overdue only', clear: () => url.set({ overdue: null }) } : null,
    filters.from || filters.to ? { key: 'range', label: `Due ${filters.from ? fmtDate(filters.from) : '…'} – ${filters.to ? fmtDate(filters.to) : '…'}`, clear: () => url.set({ from: null, to: null }) } : null,
  ].filter((c): c is { key: string; label: string; clear: () => void } => !!c);

  const chipRow = chips.length > 0 && (
    <>
      {chips.map((c) => (
        <Badge key={c.key} variant="primary" className="h-7 gap-1 pl-2 pr-1 text-[13px]">
          {c.label}
          <button type="button" onClick={c.clear} aria-label={`Remove filter ${c.label}`} className="tr-colors grid size-5 place-items-center rounded-full hover:bg-brand/15">
            <X className="size-3" />
          </button>
        </Badge>
      ))}
      <Button variant="link" size="sm" onClick={clearAll} className="px-1">
        Clear filters
      </Button>
    </>
  );

  return (
    <>
      <PageHeader
        title="Invoices"
        description="Dues raised for students. Open an invoice to see its items and payments, or to record a payment."
        actions={
          <>
            {can('fees:export') && (
              <Button variant="secondary" onClick={() => void exportCsv()} loading={exporting}>
                <Download /> Export CSV
              </Button>
            )}
            {can('fees:create', 'school') && (
              <Button asChild variant="secondary">
                <Link href={`${base}/finance/structures?tab=dues`}>
                  <FileStack /> Generate dues
                </Link>
              </Button>
            )}
            <GuardedButton blocked={writeBlock('fees:create', 'school')} onClick={() => setCreating(true)}>
              <FilePlus2 /> New invoice
            </GuardedButton>
          </>
        }
      />

      {summary.data && (
        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatTile label="Outstanding" value={moneyCompact(summary.data.outstandingMinor, summary.data.currency)} hint="Across all unpaid invoices" />
          <StatTile label="Overdue" value={moneyCompact(summary.data.overdueMinor, summary.data.currency)} hint={<button type="button" onClick={() => url.set({ overdue: '1' })} className="text-brand-ink underline-offset-4 hover:underline">Show overdue</button>} />
          <StatTile label="Collected this year" value={moneyCompact(summary.data.netCollectedMinor, summary.data.currency)} hint={`${fmtDate(summary.data.from)} – ${fmtDate(summary.data.to)}`} />
          <StatTile label="Collection rate" value={percent(summary.data.collectionRatePercent)} hint="Collected of invoiced" />
        </div>
      )}

      <Card className="mb-4 p-4">
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))]">
          <SearchField value={search} onChange={setSearch} placeholder="Search invoice number, student or admission number" aria-label="Search invoices" className="md:col-span-2 lg:col-span-1" />
          <Select aria-label="Status" value={filters.status ?? 'all'} onValueChange={(v) => url.set({ status: v === 'all' ? null : v })} options={STATUS_OPTIONS} />
          <Select aria-label="Grade" value={filters.gradeId ?? 'all'} onValueChange={(v) => url.set({ grade: v === 'all' ? null : v })} options={[{ value: 'all', label: 'All grades' }, ...(grades.data ?? []).map((g) => ({ value: g.id, label: g.name }))]} />
          <button type="button" aria-pressed={filters.overdue} onClick={() => url.set({ overdue: filters.overdue ? null : '1' })} className={cn('tr-colors h-11 rounded-md border px-3 text-left text-sm sm:h-9', filters.overdue ? 'border-brand bg-brand-soft font-medium text-brand-ink' : 'border-border-strong bg-surface text-ink-2 hover:border-ink-3')}>
            {filters.overdue ? 'Showing overdue only' : 'Overdue only'}
          </button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="t-label text-ink-2">Due between</span>
          <div className="w-40"><DatePicker value={filters.from ?? null} onChange={(v) => url.set({ from: v })} max={filters.to} placeholder="From" presets={[{ label: 'This month', value: monthRange().from }]} /></div>
          <span className="text-ink-3" aria-hidden>–</span>
          <div className="w-40"><DatePicker value={filters.to ?? null} onChange={(v) => url.set({ to: v })} min={filters.from} placeholder="To" presets={[{ label: 'End of month', value: monthRange().to }]} /></div>
          <Button variant="ghost" size="sm" onClick={() => url.set({ from: monthRange().from, to: monthRange().to })}>This month</Button>
          <Button variant="ghost" size="sm" onClick={() => url.set({ from: lastDays(30).from, to: lastDays(30).to })}>Last 30 days</Button>
        </div>
      </Card>

      <DataTable
        memoRows
        id="fees-invoices"
        caption="Invoices"
        rows={rows}
        rowKey={(r) => r.id}
        loading={q.isPending}
        error={q.isError ? q.error : undefined}
        onRetry={() => void q.refetch()}
        columns={columns}
        sort={sort}
        onSortChange={(s) => url.set({ sort: s ? `${s.id}:${s.dir}` : null }, { resetPage: false })}
        page={filters.page}
        pageSize={filters.pageSize}
        total={total}
        onPageChange={(p) => url.set({ page: p }, { resetPage: false })}
        onPageSizeChange={(n) => url.set({ size: n })}
        selectable
        selected={selected}
        onSelectedChange={setSelected}
        bulkActions={(sel, clear) => (
          <>
            <Button size="sm" variant="secondary" onClick={() => { void exportCsv(sel); clear(); }}>
              <Download /> Export selected
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                void navigator.clipboard?.writeText(sel.map((r) => r.invoiceNo).join('\n'));
                toast.success('Invoice numbers copied', { description: plural(sel.length, 'number') });
              }}
            >
              Copy numbers
            </Button>
          </>
        )}
        onRowClick={(r) => url.set({ invoice: r.id }, { resetPage: false })}
        activeRowKey={openId}
        filters={chipRow || undefined}
        toolbar={<span className="t-caption hidden text-ink-3 md:inline">{q.isFetching && !q.isPending ? 'Updating…' : sort ? 'Sorted within this page' : ''}</span>}
        empty={
          activeCount > 0 ? (
            <EmptyState illustration="no-results" title="No invoices match these filters" description="Try a different search, or remove a filter." filters={chipRow || undefined} action={<Button variant="secondary" onClick={clearAll}>Clear filters</Button>} />
          ) : (
            <EmptyState illustration="empty-generic" title="No invoices yet" description="Invoices appear here after fees are assigned and dues are generated." />
          )
        }
      />

      <InvoiceDrawer invoiceId={openId} onClose={() => url.set({ invoice: null }, { resetPage: false })} />
      <CreateInvoiceDrawer open={creating} onClose={() => setCreating(false)} onCreated={(id) => url.set({ invoice: id }, { resetPage: false })} />
    </>
  );
}
