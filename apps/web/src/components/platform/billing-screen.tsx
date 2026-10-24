'use client';

import * as React from 'react';
import Link from 'next/link';
import { Gauge, Receipt } from 'lucide-react';
import type { PlatformBillingSchool, PlatformInvoice } from '@school-sync/shared';
import { PageHeader } from '@/components/shell/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { StatTile } from '@/components/ui/stat-tile';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ErrorPanel } from '@/components/features/management/shared/detail';
import { ClearFiltersButton, FilterChip, FilterSelect, SearchBox } from '@/components/features/management/shared/controls';
import { useUrlState } from '@/lib/client/url-state';
import { money, plural } from '@/lib/format';
import { useBillingOverview, useInvoices, useMeterAll } from '@/lib/platform/queries';
import { IssueInvoiceDialog, InvoiceTable, PayInvoiceDialog, VoidInvoiceDialog } from './invoice-parts';
import { LicenseChip, SeatsMeter } from './bits';

const NEEDS = [
  { value: 'action', label: 'Needs action' },
  { value: 'trueup', label: 'True-up due' },
  { value: 'seats', label: 'Seats not invoiced' },
  { value: 'overdue', label: 'Has overdue invoices' },
];
const needsAction = (s: PlatformBillingSchool) => s.trueUpStudents > 0 || (!s.seatsInvoiced && !!s.subscriptionId && (s.licensedStudents ?? 0) > 0 && (s.pricePerStudentMinor ?? 0) > 0) || s.overdueCount > 0;
const matches = (s: PlatformBillingSchool, f: string) => !f || (f === 'action' ? needsAction(s) : f === 'trueup' ? s.trueUpStudents > 0 : f === 'seats' ? !s.seatsInvoiced && !!s.subscriptionId && (s.licensedStudents ?? 0) > 0 : s.overdueCount > 0);

const INVOICE_STATUS = [{ value: 'issued', label: 'Awaiting payment' }, { value: 'paid', label: 'Paid' }, { value: 'void', label: 'Void' }, { value: 'draft', label: 'Draft' }];
const INVOICE_KIND = [{ value: 'seats', label: 'Seats' }, { value: 'true_up', label: 'True-up' }];

/** Billing across schools: seats against committed, true-up due, outstanding invoices, metering, issuing and marking paid. */
export function BillingScreen() {
  const [url, setUrl] = useUrlState({ tab: 'schools' });
  const tab = url.tab === 'invoices' ? 'invoices' : 'schools';
  const meterAll = useMeterAll();
  const overview = useBillingOverview();
  return (
    <>
      <PageHeader
        title="Billing"
        description="Seats against what each school committed to, what to true-up, and what is still owed to us."
        actions={
          <Button variant="secondary" onClick={() => void meterAll.run()} loading={meterAll.isPending}>
            <Gauge /> Meter all schools now
          </Button>
        }
      />
      <Totals overview={overview} />
      <Tabs value={tab} onValueChange={(v) => setUrl({ tab: v })}>
        <TabsList aria-label="Billing sections">
          <TabsTrigger value="schools">Schools</TabsTrigger>
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
        </TabsList>
        <TabsContent value="schools"><SchoolsBilling overview={overview} /></TabsContent>
        <TabsContent value="invoices"><AllInvoices /></TabsContent>
      </Tabs>
    </>
  );
}

function Totals({ overview }: { overview: ReturnType<typeof useBillingOverview> }) {
  if (overview.isError && !overview.data) return <div className="mb-6"><ErrorPanel error={overview.error} onRetry={() => void overview.refetch()} title="We couldn’t load the billing figures" /></div>;
  const totals = overview.data?.totals ?? [];
  if (overview.isPending) return <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <StatTile key={i} label="Loading" state="loading" />)}</div>;
  if (totals.length === 0) return null;
  return (
    <div className="mb-6 space-y-5">
      {totals.map((t) => (
        <section key={t.currency} aria-label={`Totals in ${t.currency}`}>
          {totals.length > 1 && <h2 className="t-label mb-2 text-ink-2">{t.currency}</h2>}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile label="Committed this year" value={money(t.committedMinor, t.currency)} hint="Seats × price, current subscriptions" />
            <StatTile label="Outstanding" value={money(t.outstandingMinor, t.currency)} hint="Issued, not yet paid" />
            <StatTile label="Overdue" value={money(t.overdueMinor, t.currency)} hint={t.overdueMinor > 0 ? 'Past the due date' : 'Nothing overdue'} />
            <StatTile label="True-up due" value={money(t.trueUpDueMinor, t.currency)} hint="Students above what is invoiced" />
          </div>
        </section>
      ))}
    </div>
  );
}

function SchoolsBilling({ overview }: { overview: ReturnType<typeof useBillingOverview> }) {
  const [filter, setFilter] = React.useState('');
  const [q, setQ] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [size, setSize] = React.useState(25);
  const [issue, setIssue] = React.useState<{ s: PlatformBillingSchool; kind: 'seats' | 'true_up' } | null>(null);
  const rows = React.useMemo(() => (overview.data?.schools ?? []).filter((s) => matches(s, filter) && (!q || `${s.name} ${s.code}`.toLowerCase().includes(q.toLowerCase()))), [overview.data, filter, q]);
  const pageRows = rows.slice((page - 1) * size, page * size);
  React.useEffect(() => setPage(1), [filter, q, size]);

  const columns: Column<PlatformBillingSchool>[] = [
    { id: 'school', header: 'School', mobile: 'title', className: 'min-w-[12rem]', cell: (s) => <span className="block min-w-0"><Link href={`/platform/schools/${s.code}`} className="block truncate py-1 font-medium hover:underline">{s.name}</Link><span className="t-caption block font-mono text-ink-2">{s.code}{s.academicYear ? ` · ${s.academicYear}` : ''}</span></span> },
    { id: 'state', header: 'Subscription', label: 'Subscription', mobile: 'status', cell: (s) => <LicenseChip state={s.state} /> },
    {
      id: 'seats',
      header: 'Seats vs committed',
      label: 'Seats vs committed',
      mobile: 'detail',
      cell: (s) => (
        <span className="block">
          <SeatsMeter seats={{ used: s.usedNow, licensed: s.licensedStudents, overBy: s.usedNow !== null && s.licensedStudents !== null ? Math.max(0, s.usedNow - s.licensedStudents) : 0, nearLimit: s.usedNow !== null && s.licensedStudents !== null && s.licensedStudents > 0 && s.usedNow >= s.licensedStudents * 0.9 }} />
          {s.subscriptionId && <span className="t-caption block text-ink-2">peak {s.peakBillable.toLocaleString()} · invoiced {s.invoicedStudents.toLocaleString()}</span>}
        </span>
      ),
    },
    {
      id: 'seatsInvoice',
      header: 'Seats invoice',
      label: 'Seats invoice',
      mobile: 'detail',
      cell: (s) =>
        !s.subscriptionId ? <span className="text-ink-3">—</span> : s.seatsInvoiced ? <Badge variant="success">Invoiced</Badge> : (s.licensedStudents ?? 0) > 0 && (s.pricePerStudentMinor ?? 0) > 0 ? <Button size="sm" variant="secondary" onClick={() => setIssue({ s, kind: 'seats' })} aria-label={`Issue the seats invoice for ${s.name}`}><Receipt /> Issue</Button> : <span className="text-ink-3">Nothing to bill</span>,
    },
    {
      id: 'trueup',
      header: 'True-up due',
      label: 'True-up due',
      align: 'right',
      mobile: 'detail',
      cell: (s) => (s.trueUpStudents > 0 ? <span className="inline-flex flex-col items-end gap-1"><span className="tnum font-medium">{money(s.trueUpMinor, s.currency)}</span><span className="t-caption text-ink-2">{plural(s.trueUpStudents, 'student')}</span><Button size="sm" variant="secondary" onClick={() => setIssue({ s, kind: 'true_up' })} aria-label={`Issue a true-up invoice for ${s.name}`}><Receipt /> Issue</Button></span> : <span className="text-ink-3">—</span>),
    },
    { id: 'owed', header: 'Outstanding', label: 'Outstanding', align: 'right', mobile: 'value', cell: (s) => (s.outstandingCount ? <span className="block tnum">{money(s.outstandingMinor, s.currency)}{s.overdueCount > 0 && <span className="t-caption block text-danger">{s.overdueCount} overdue</span>}</span> : <span className="text-ink-3">—</span>) },
  ];

  const active = !!(filter || q);
  return (
    <>
      <DataTable<PlatformBillingSchool>
        memoRows
        id="platform-billing-schools"
        caption="Billing by school"
        rows={overview.data ? pageRows : undefined}
        rowKey={(s) => s.code}
        columns={columns}
        loading={overview.isPending}
        error={overview.isError && !overview.data ? overview.error : undefined}
        onRetry={() => void overview.refetch()}
        page={page}
        pageSize={size}
        total={rows.length}
        onPageChange={setPage}
        onPageSizeChange={setSize}
        filters={
          <>
            <SearchBox value={q} onChange={setQ} placeholder="Search name or code" className="sm:w-64" />
            <FilterSelect label="Show" value={filter} onChange={setFilter} allLabel="All schools" options={NEEDS} />
          </>
        }
        empty={
          active ? (
            <EmptyState illustration="no-results" title="No schools match" description="Try a different search or filter." filters={<>{q && <FilterChip label={`“${q}”`} onRemove={() => setQ('')} />}{filter && <FilterChip label={NEEDS.find((n) => n.value === filter)?.label ?? filter} onRemove={() => setFilter('')} />}</>} action={<ClearFiltersButton onClick={() => { setQ(''); setFilter(''); }} />} compact />
          ) : (
            <EmptyState illustration="empty-generic" title="No schools to bill yet" description="Once schools exist and have subscriptions, their seats and invoices appear here." compact />
          )
        }
      />
      {issue && (
        <IssueInvoiceDialog
          code={issue.s.code}
          name={issue.s.name}
          subscriptions={[{ academicYear: issue.s.academicYear ?? '', licensedStudents: issue.s.licensedStudents, pricePerStudentMinor: issue.s.pricePerStudentMinor ?? 0, currency: issue.s.currency }]}
          open
          onOpenChange={(o) => !o && setIssue(null)}
          initial={{ kind: issue.kind, academicYear: issue.s.academicYear ?? undefined }}
        />
      )}
    </>
  );
}

function AllInvoices() {
  const [url, setUrl, resetUrl] = useUrlState({ iq: '', istatus: '', ikind: '', iover: false as boolean, ipage: 1, isize: 25 });
  const q = useInvoices({ q: url.iq || undefined, status: url.istatus || undefined, kind: url.ikind || undefined, overdue: url.iover, page: url.ipage, pageSize: url.isize });
  const [pay, setPay] = React.useState<PlatformInvoice | null>(null);
  const [voidInv, setVoidInv] = React.useState<PlatformInvoice | null>(null);
  const active = !!(url.iq || url.istatus || url.ikind || url.iover);
  // this screen's page key is not called `page`, so a changed filter must send the table back to page 1 itself
  const setF = (patch: { iq?: string; istatus?: string; ikind?: string; iover?: boolean }) => setUrl({ ...patch, ipage: 1 });
  return (
    <>
      <InvoiceTable
        id="platform-all-invoices"
        showSchool
        rows={q.data?.data}
        loading={q.isPending}
        error={q.isError && !q.data ? q.error : undefined}
        onRetry={() => void q.refetch()}
        onPay={setPay}
        onVoid={setVoidInv}
        page={url.ipage}
        pageSize={url.isize}
        total={q.data?.meta.total}
        onPageChange={(p) => setUrl({ ipage: p })}
        onPageSizeChange={(s) => setUrl({ isize: s })}
        filters={
          <>
            <SearchBox value={url.iq} onChange={(v) => setF({ iq: v })} placeholder="Search invoice number or school" className="sm:w-72" />
            <FilterSelect label="Invoice status" value={url.istatus} onChange={(v) => setF({ istatus: v })} allLabel="Any status" options={INVOICE_STATUS} />
            <FilterSelect label="Invoice type" value={url.ikind} onChange={(v) => setF({ ikind: v })} allLabel="Any type" options={INVOICE_KIND} />
            <FilterSelect label="Overdue" value={url.iover ? 'yes' : ''} onChange={(v) => setF({ iover: v === 'yes' })} allLabel="Overdue or not" options={[{ value: 'yes', label: 'Overdue only' }]} />
          </>
        }
        empty={
          active ? (
            <EmptyState illustration="no-results" title="No invoices match" description="Try a different search or clear the filters." action={<ClearFiltersButton onClick={() => resetUrl(['iq', 'istatus', 'ikind', 'iover'])} />} compact />
          ) : (
            <EmptyState illustration="empty-generic" title="No invoices yet" description="Invoices appear here once you issue the first seats invoice or true-up from the Schools tab." compact />
          )
        }
      />
      <PayInvoiceDialog invoice={pay} onClose={() => setPay(null)} />
      <VoidInvoiceDialog invoice={voidInv} onClose={() => setVoidInv(null)} />
    </>
  );
}
