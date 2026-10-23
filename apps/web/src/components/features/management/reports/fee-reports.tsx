'use client';

import * as React from 'react';
import Link from 'next/link';
import { Phone } from 'lucide-react';
import { useCollectionReport, useDefaulters, useOutstandingReport, type DefaulterRow, type OutstandingReport } from '@/lib/client/finance';
import { useGradeList, useSectionList } from '@/lib/client/mgmt';
import { useUrlState } from '@/lib/client/use-url-state';
import { fmtDate, fmtDay, fmtMonth, fmtMonthShort, percent } from '@/lib/format';
import { PageHeader } from '@/components/shell/page-header';
import { BarSeries } from '@/components/charts/series-charts';
import { Badge } from '@/components/ui/badge';
import { ChartCard } from '@/components/ui/chart';
import { DataTable } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { StatTile } from '@/components/ui/stat-tile';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { ErrorPanel } from '../common/states';
import { ExportButton } from '../common/exports';
import { ClearFilters, FilterBar, FilterChips, FilterDate, FilterSelect, SearchBox } from '../common/filters';
import { useListState, useTabParam } from '../common/url-state';
import { useMgmt } from '../common/use-mgmt';
import { METHOD_LABEL } from '../finance/payments-page';

export function FeeReportsPage() {
  const { base } = useMgmt();
  const tabs = [
    { value: 'outstanding', label: 'Outstanding and aging' },
    { value: 'defaulters', label: 'Defaulters' },
    { value: 'collection', label: 'Collection' },
  ];
  const [tab, setTab] = useTabParam(tabs.map((t) => t.value));
  return (
    <>
      <PageHeader title="Fee reports" description="Who owes what, how overdue it is, and how collection is going." crumbs={[{ label: 'Reports', href: `${base}/reports` }, { label: 'Fees' }]} />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label="Fee reports">
          {tabs.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="outstanding">
          <OutstandingReportView />
        </TabsContent>
        <TabsContent value="defaulters">
          <DefaultersView />
        </TabsContent>
        <TabsContent value="collection">
          <CollectionView />
        </TabsContent>
      </Tabs>
    </>
  );
}

// ── outstanding & aging ─────────────────────────────────────────────────────────────────────

const BUCKETS = [
  { key: 'notDue', label: 'Not yet due' },
  { key: 'd1to30', label: '1–30 days' },
  { key: 'd31to60', label: '31–60 days' },
  { key: 'd61to90', label: '61–90 days' },
  { key: 'd90plus', label: 'Over 90 days' },
] as const;

function OutstandingReportView() {
  const { money, moneyCompact } = useMgmt();
  const url = useUrlState();
  const asOf = url.get('asof');
  const groupBy = (url.get('group') || 'grade') as 'none' | 'grade' | 'section';
  const gradeId = url.get('grade');
  const grades = useGradeList();
  const query = { asOf: asOf || undefined, groupBy, gradeId: gradeId || undefined };
  const q = useOutstandingReport(query);
  const d: OutstandingReport | undefined = q.data;
  const chart = d ? BUCKETS.map((b) => ({ bucket: b.label, amountMinor: d.buckets[b.key] })) : [];
  const overduePct = d && d.outstandingMinor > 0 ? (d.overdueMinor / d.outstandingMinor) * 100 : null;
  const worst = d ? chart.slice(1).reduce((a, b) => (b.amountMinor > a.amountMinor ? b : a), chart[1]!) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <FilterBar>
          <FilterDate label="As of" value={asOf} onChange={(v) => url.set({ asof: v })} />
          <FilterSelect label="Group by" allLabel={null} value={groupBy} onChange={(v) => url.set({ group: v || 'grade' })} options={[{ value: 'none', label: 'No grouping' }, { value: 'grade', label: 'Grade' }, { value: 'section', label: 'Class' }]} />
          <FilterSelect label="Grade" value={gradeId} onChange={(v) => url.set({ grade: v })} options={(grades.data ?? []).map((g) => ({ value: g.id, label: g.name }))} />
        </FilterBar>
        <ExportButton path="/fees/reports/outstanding/export" query={query} filename="outstanding-fees.csv" perm="fees:export" />
      </div>

      {q.isError && !d ? (
        <ErrorPanel error={q.error} onRetry={() => void q.refetch()} title="We couldn’t load the outstanding report" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile label="Outstanding" value={d ? moneyCompact(d.outstandingMinor) : undefined} hint={d ? `as of ${fmtDate(d.asOf)}` : undefined} state={q.isPending ? 'loading' : 'ready'} />
            <StatTile label="Overdue" value={d ? moneyCompact(d.overdueMinor) : undefined} hint={overduePct !== null ? `${percent(overduePct, 0)} of outstanding` : undefined} state={q.isPending ? 'loading' : 'ready'} />
            <StatTile label="Open invoices" value={d?.invoices} state={q.isPending ? 'loading' : 'ready'} />
          </div>
          <ChartCard
            title="Aging of outstanding fees"
            description="How long unpaid balances have been past their due date"
            height={260}
            loading={q.isPending}
            error={q.isError ? q.error : undefined}
            onRetry={() => void q.refetch()}
            empty={!!d && d.outstandingMinor === 0}
            emptyText="Nothing is outstanding."
            summary={d && worst && d.outstandingMinor > 0 ? `${money(d.outstandingMinor)} is outstanding; ${money(d.overdueMinor)} is overdue, most of it in the ${worst.bucket.toLowerCase()} bucket (${money(worst.amountMinor)}).` : undefined}
            table={{ columns: [{ key: 'bucket', label: 'Age' }, { key: 'amountMinor', label: 'Outstanding', align: 'right', format: (v) => money(Number(v)) }], rows: chart }}
          >
            <BarSeries data={chart} xKey="bucket" yKey="amountMinor" label="Outstanding" height={260} yFormat={(v) => moneyCompact(v)} valueFormat={(v) => money(v)} />
          </ChartCard>

          {groupBy !== 'none' && (
            <DataTable<OutstandingReport['rows'][number]>
              id="report-outstanding"
              caption={`Outstanding by ${groupBy === 'grade' ? 'grade' : 'class'}`}
              rows={d?.rows}
              rowKey={(r) => r.id ?? r.name}
              loading={q.isPending}
              error={q.isError ? q.error : undefined}
              onRetry={() => void q.refetch()}
              empty={<EmptyState illustration="empty-generic" compact title="No outstanding fees in this selection" />}
              columns={[
                { id: 'name', header: groupBy === 'grade' ? 'Grade' : 'Class', cell: (r) => <span className="font-medium">{r.name}</span>, sortable: true, sortValue: (r) => r.name, mobile: 'title' },
                { id: 'inv', header: 'Invoices', cell: (r) => r.invoices.toLocaleString(), align: 'right', sortable: true, sortValue: (r) => r.invoices, mobile: 'detail', label: 'Invoices' },
                { id: 'out', header: 'Outstanding', cell: (r) => money(r.outstandingMinor), align: 'right', sortable: true, sortValue: (r) => r.outstandingMinor, mobile: 'value' },
                { id: 'over', header: 'Overdue', cell: (r) => <span className={r.overdueMinor > 0 ? 'text-danger' : ''}>{money(r.overdueMinor)}</span>, align: 'right', sortable: true, sortValue: (r) => r.overdueMinor, mobile: 'detail', label: 'Overdue' },
                ...BUCKETS.map((b) => ({ id: b.key, header: b.label, cell: (r: OutstandingReport['rows'][number]) => (r.buckets[b.key] ? money(r.buckets[b.key]) : '—'), align: 'right' as const, defaultHidden: b.key === 'd61to90', mobile: 'hide' as const })),
              ]}
            />
          )}
        </>
      )}
    </div>
  );
}

// ── defaulters ──────────────────────────────────────────────────────────────────────────────

function DefaultersView() {
  const { money, base } = useMgmt();
  const ls = useListState({ pageSize: 25 });
  const gradeId = ls.get('grade');
  const sectionId = ls.get('section');
  const min = ls.get('days') || '1';
  const grades = useGradeList();
  const sections = useSectionList(gradeId || null);
  const query = { page: ls.page, pageSize: ls.pageSize, q: ls.q || undefined, gradeId: gradeId || undefined, sectionId: sectionId || undefined, minOverdueDays: min };
  const q = useDefaulters(query);
  const filtered = ls.hasFilters(['grade', 'section']) || min !== '1';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[62ch] text-sm text-ink-2">Students with overdue balances, worst first, with the main guardian’s phone number so the office can follow up.</p>
        <ExportButton path="/fees/reports/defaulters/export" query={{ gradeId: query.gradeId, sectionId: query.sectionId, minOverdueDays: min, q: query.q }} filename="defaulters.csv" perm="fees:export" />
      </div>
      <DataTable<DefaulterRow>
        id="report-defaulters"
        caption="Fee defaulters"
        rows={q.data?.data}
        rowKey={(r) => r.studentId}
        loading={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
        page={ls.page}
        pageSize={ls.pageSize}
        total={q.data?.meta.total}
        onPageChange={ls.setPage}
        onPageSizeChange={ls.setPageSize}
        filters={
          <FilterBar>
            <SearchBox value={ls.qInput} onChange={ls.setQInput} placeholder="Search student" />
            <FilterSelect label="Grade" value={gradeId} onChange={(v) => ls.set({ grade: v, section: null })} options={(grades.data ?? []).map((g) => ({ value: g.id, label: g.name }))} />
            <FilterSelect label="Class" value={sectionId} onChange={(v) => ls.set({ section: v })} options={(sections.data ?? []).map((s) => ({ value: s.id, label: `${s.gradeName} ${s.name}` }))} />
            <FilterSelect label="Overdue by" allLabel={null} value={min} onChange={(v) => ls.set({ days: v === '1' ? null : v })} options={[{ value: '1', label: 'Any time' }, { value: '30', label: '30+ days' }, { value: '60', label: '60+ days' }, { value: '90', label: '90+ days' }]} />
          </FilterBar>
        }
        empty={
          filtered || ls.q ? (
            <EmptyState illustration="no-results" title="No defaulters match" filters={<FilterChips chips={[...(ls.q ? [{ label: 'Search', value: ls.q }] : []), ...(min !== '1' ? [{ label: 'Overdue by', value: `${min}+ days` }] : [])]} />} action={<ClearFilters onClear={() => ls.clear()} />} />
          ) : (
            <EmptyState illustration="success" title="No student has an overdue balance" description="Everyone who owes fees is within their due dates." />
          )
        }
        columns={[
          { id: 'student', header: 'Student', cell: (r) => (<><Link href={`${base}/finance/invoices?q=${encodeURIComponent(r.admissionNo)}&overdue=1`} className="font-medium text-brand-ink underline-offset-4 hover:underline">{r.studentName}</Link><span className="t-caption block text-ink-3">{r.admissionNo}</span></>), mobile: 'title' },
          { id: 'class', header: 'Class', cell: (r) => [r.gradeName, r.sectionName].filter(Boolean).join(' ') || '—', mobile: 'sub' },
          { id: 'overdue', header: 'Overdue', cell: (r) => <span className="font-medium text-danger">{money(r.overdueMinor)}</span>, align: 'right', sortable: true, sortValue: (r) => r.overdueMinor, mobile: 'value' },
          { id: 'inv', header: 'Invoices', cell: (r) => r.overdueInvoices, align: 'right', mobile: 'detail', label: 'Overdue invoices' },
          { id: 'days', header: 'Days overdue', cell: (r) => <Badge variant={r.maxDaysOverdue > 60 ? 'danger' : 'warning'}>{r.maxDaysOverdue} days</Badge>, align: 'right', sortable: true, sortValue: (r) => r.maxDaysOverdue, mobile: 'status', label: 'Days overdue' },
          { id: 'oldest', header: 'Oldest due', cell: (r) => fmtDate(r.oldestDueDate), mobile: 'hide' },
          { id: 'guardian', header: 'Guardian', cell: (r) => r.guardianName ?? '—', mobile: 'detail', label: 'Guardian' },
          {
            id: 'phone',
            header: 'Phone',
            cell: (r) =>
              r.guardianPhone ? (
                <a href={`tel:${r.guardianPhone}`} className="tnum inline-flex items-center gap-1.5 text-brand-ink underline-offset-4 hover:underline">
                  <Phone className="size-3.5" aria-hidden />
                  {r.guardianPhone}
                </a>
              ) : (
                <span className="text-ink-3">No number on file</span>
              ),
            mobile: 'detail',
            label: 'Phone',
          },
        ]}
      />
    </div>
  );
}

// ── collection ──────────────────────────────────────────────────────────────────────────────

function CollectionView() {
  const { money, moneyCompact } = useMgmt();
  const url = useUrlState();
  const from = url.get('from');
  const to = url.get('to');
  const groupBy = (url.get('by') || 'month') as 'day' | 'month';
  const query = { from: from || undefined, to: to || undefined, groupBy };
  const q = useCollectionReport(query);
  const d = q.data;
  const series = (d?.series ?? []).map((s) => ({ ...s }));
  const methods = (d?.byMethod ?? []).map((m) => ({ label: METHOD_LABEL[m.method] ?? m.method, collectedMinor: m.collectedMinor, count: m.count }));
  const cats = (d?.byCategory ?? []).map((c) => ({ label: c.category, collectedMinor: c.collectedMinor }));
  const fmtPeriod = (p: string | number) => (groupBy === 'month' ? fmtMonthShort(String(p)) : fmtDay(String(p)));
  const fullPeriod = (p: string | number) => (groupBy === 'month' ? fmtMonth(String(p)) : fmtDate(String(p)));
  const bestMethod = methods.length ? methods.reduce((a, b) => (b.collectedMinor > a.collectedMinor ? b : a)) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <FilterBar>
          <FilterDate label="From" value={from} onChange={(v) => url.set({ from: v })} max={to || undefined} />
          <FilterDate label="To" value={to} onChange={(v) => url.set({ to: v })} min={from || undefined} />
          <FilterSelect label="Group by" allLabel={null} value={groupBy} onChange={(v) => url.set({ by: v === 'month' ? null : v })} options={[{ value: 'month', label: 'Month' }, { value: 'day', label: 'Day' }]} />
          {(from || to) && (
            <Button variant="ghost" size="sm" onClick={() => url.set({ from: null, to: null })}>
              Reset period
            </Button>
          )}
        </FilterBar>
        <ExportButton path="/fees/reports/collection/export" query={query} filename="collection.csv" perm="fees:export" />
      </div>
      {q.isError && !d ? (
        <ErrorPanel error={q.error} onRetry={() => void q.refetch()} title="We couldn’t load the collection report" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile label="Collected" value={d ? moneyCompact(d.collectedMinor) : undefined} hint={d ? `${fmtDate(d.from)} – ${fmtDate(d.to)}` : undefined} state={q.isPending ? 'loading' : 'ready'} />
            <StatTile label="Refunded" value={d ? moneyCompact(d.refundedMinor) : undefined} state={q.isPending ? 'loading' : 'ready'} />
            <StatTile label="Net collection" value={d ? moneyCompact(d.netMinor) : undefined} state={q.isPending ? 'loading' : 'ready'} />
            <StatTile label="Payments" value={d?.count} state={q.isPending ? 'loading' : 'ready'} />
          </div>
          <ChartCard
            title={groupBy === 'month' ? 'Collection by month' : 'Collection by day'}
            description="Amount received in each period"
            height={260}
            loading={q.isPending}
            error={q.isError ? q.error : undefined}
            onRetry={() => void q.refetch()}
            empty={!!d && series.length === 0}
            summary={d && series.length ? `${money(d.collectedMinor)} collected over ${series.length} ${groupBy === 'month' ? 'month' : 'day'}${series.length === 1 ? '' : 's'}; the best was ${fullPeriod(series.reduce((a, b) => (b.collectedMinor > a.collectedMinor ? b : a)).period)}.` : undefined}
            table={{ columns: [{ key: 'period', label: groupBy === 'month' ? 'Month' : 'Day' }, { key: 'count', label: 'Payments', align: 'right' }, { key: 'collectedMinor', label: 'Collected', align: 'right', format: (v) => money(Number(v)) }, { key: 'refundedMinor', label: 'Refunded', align: 'right', format: (v) => money(Number(v)) }], rows: series.map((s) => ({ ...s, period: fullPeriod(s.period) })) }}
          >
            <BarSeries data={series} xKey="period" yKey="collectedMinor" label="Collected" height={260} xFormat={fmtPeriod} tooltipLabel={fullPeriod} yFormat={(v) => moneyCompact(v)} valueFormat={(v) => money(v)} />
          </ChartCard>
          <div className="grid gap-6 lg:grid-cols-2">
            <ChartCard
              title="By payment method"
              height={Math.max(200, methods.length * 40)}
              loading={q.isPending}
              error={q.isError ? q.error : undefined}
              onRetry={() => void q.refetch()}
              empty={!!d && methods.length === 0}
              summary={bestMethod && d ? `${bestMethod.label} brought in the most: ${money(bestMethod.collectedMinor)} (${percent(d.collectedMinor ? (bestMethod.collectedMinor / d.collectedMinor) * 100 : 0, 0)}).` : undefined}
              table={{ columns: [{ key: 'label', label: 'Method' }, { key: 'count', label: 'Payments', align: 'right' }, { key: 'collectedMinor', label: 'Collected', align: 'right', format: (v) => money(Number(v)) }], rows: methods }}
            >
              <BarSeries data={methods} xKey="label" yKey="collectedMinor" label="Collected" horizontal height={Math.max(200, methods.length * 40)} yFormat={(v) => moneyCompact(v)} valueFormat={(v) => money(v)} />
            </ChartCard>
            <ChartCard
              title="By fee category"
              height={Math.max(200, cats.length * 40)}
              loading={q.isPending}
              error={q.isError ? q.error : undefined}
              onRetry={() => void q.refetch()}
              empty={!!d && cats.length === 0}
              summary={cats[0] ? `${cats[0].label} is the largest category at ${money(cats[0].collectedMinor)}.` : undefined}
              table={{ columns: [{ key: 'label', label: 'Category' }, { key: 'collectedMinor', label: 'Collected', align: 'right', format: (v) => money(Number(v)) }], rows: cats }}
            >
              <BarSeries data={cats} xKey="label" yKey="collectedMinor" label="Collected" horizontal height={Math.max(200, cats.length * 40)} yFormat={(v) => moneyCompact(v)} valueFormat={(v) => money(v)} />
            </ChartCard>
          </div>
        </>
      )}
    </div>
  );
}
