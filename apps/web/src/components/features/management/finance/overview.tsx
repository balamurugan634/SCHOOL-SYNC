'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { useFinanceOverview } from '@/lib/client/finance';
import { useUrlState } from '@/lib/client/use-url-state';
import { fmtMonth, fmtMonthShort, percent, plural } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ChartCard } from '@/components/ui/chart';
import { ProgressRing } from '@/components/ui/progress';
import { StatTile } from '@/components/ui/stat-tile';
import { PageHeader } from '@/components/shell/page-header';
import { CHART, MultiBarSeries } from '../common/charts';
import { ErrorPanel } from '../common/states';
import { FilterBar, FilterDate } from '../common/filters';
import { useMgmt } from '../common/use-mgmt';
import { OnlinePaymentsStatus } from './online-status';

export function FinanceOverview() {
  const { base, can, money, moneyCompact } = useMgmt();
  const url = useUrlState();
  const from = url.get('from');
  const to = url.get('to');
  const q = useFinanceOverview({ from: from || undefined, to: to || undefined });
  const d = q.data;
  const hasExpenses = !!d && d.expensesMinor !== null;

  const months = (d?.byMonth ?? []).map((m) => ({ month: m.month, collected: m.collectedMinor, expenses: m.expensesMinor ?? 0 }));
  const best = months.length ? months.reduce((a, b) => (b.collected > a.collected ? b : a)) : null;
  const series = [{ key: 'collected', label: 'Collected', color: CHART[0] }, ...(hasExpenses ? [{ key: 'expenses', label: 'Expenses', color: CHART[1] }] : [])];
  const rate = d?.collectionRatePercent ?? null;
  const approvals = d
    ? [
        { key: 'concessions', label: 'Fee concessions', n: d.pending.concessions, href: `${base}/finance/structures?tab=concessions&status=pending`, needs: 'fees:approve' as const },
        { key: 'refunds', label: 'Refund requests', n: d.pending.refunds, href: `${base}/finance/payments?tab=refunds&status=requested`, needs: 'payments:approve' as const },
        ...(d.pending.expenses !== null ? [{ key: 'expenses', label: 'Expenses to approve', n: d.pending.expenses, href: `${base}/finance/expenses?tab=approvals`, needs: 'expenses:approve' as const }] : []),
      ]
    : [];

  return (
    <>
      <PageHeader
        title="Finance overview"
        description={d ? `Fees collected, spent and still to collect, ${new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${d.from}T00:00:00`))} to ${new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${d.to}T00:00:00`))}.` : 'Fees collected, spent and still to collect.'}
        actions={
          <>
            <Button asChild variant="secondary">
              <Link href={`${base}/finance/invoices`}>Dues and invoices</Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href={`${base}/reports/fees`}>Fee reports</Link>
            </Button>
          </>
        }
      />

      <div className="space-y-6">
        <FilterBar>
          <FilterDate label="From" value={from} onChange={(v) => url.set({ from: v })} max={to || undefined} />
          <FilterDate label="To" value={to} onChange={(v) => url.set({ to: v })} min={from || undefined} />
          {(from || to) && (
            <Button variant="ghost" size="sm" onClick={() => url.set({ from: null, to: null })}>
              Reset period
            </Button>
          )}
        </FilterBar>

        {q.isError && !d ? (
          <Card>
            <ErrorPanel error={q.error} onRetry={() => void q.refetch()} title="We couldn’t load the finance summary" compact={false} />
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <StatTile label="Collected (net of refunds)" value={d ? moneyCompact(d.netCollectedMinor) : undefined} hint={d ? `of ${moneyCompact(d.invoicedMinor)} invoiced` : undefined} state={q.isPending ? 'loading' : 'ready'} />
              <StatTile label="Outstanding" value={d ? moneyCompact(d.outstandingMinor) : undefined} hint="across open invoices" state={q.isPending ? 'loading' : 'ready'} />
              <StatTile label="Overdue" value={d ? moneyCompact(d.overdueMinor) : undefined} hint={d && d.outstandingMinor > 0 ? `${percent((d.overdueMinor / d.outstandingMinor) * 100, 0)} of outstanding` : undefined} state={q.isPending ? 'loading' : 'ready'} />
              <StatTile label="Collection rate" value={d ? percent(d.collectionRatePercent) : undefined} hint="collected / invoiced" state={q.isPending ? 'loading' : 'ready'} />
            </div>
            {(q.isPending || hasExpenses) && (
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <StatTile label="Expenses (approved)" value={d?.expensesMinor != null ? moneyCompact(d.expensesMinor) : undefined} state={q.isPending ? 'loading' : 'ready'} />
                <StatTile label="Net position" value={d?.netPositionMinor != null ? moneyCompact(d.netPositionMinor) : undefined} hint="collected minus expenses" state={q.isPending ? 'loading' : 'ready'} />
                <StatTile label="Refunded" value={d ? moneyCompact(d.refundedMinor) : undefined} state={q.isPending ? 'loading' : 'ready'} />
              </div>
            )}

            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
              <div className="space-y-6">
                <ChartCard
                  title={hasExpenses ? 'Collection and expenses by month' : 'Collection by month'}
                  description="Net amount received each month"
                  height={260}
                  loading={q.isPending}
                  error={q.isError ? q.error : undefined}
                  onRetry={() => void q.refetch()}
                  empty={!!d && months.length === 0}
                  legend={Object.fromEntries(series.map((s) => [s.key, { label: s.label, color: s.color }]))}
                  summary={d && best ? `${hasExpenses ? `${money(d.netCollectedMinor)} collected against ${money(d.expensesMinor ?? 0)} of expenses.` : `${money(d.netCollectedMinor)} collected.`} ${fmtMonth(best.month)} was the strongest month at ${money(best.collected)}.` : undefined}
                  table={{
                    columns: [{ key: 'month', label: 'Month' }, { key: 'collected', label: 'Collected', align: 'right', format: (v) => money(Number(v)) }, ...(hasExpenses ? [{ key: 'expenses', label: 'Expenses', align: 'right' as const, format: (v: unknown) => money(Number(v)) }] : [])],
                    rows: months.map((m) => ({ ...m, month: fmtMonth(m.month) })),
                  }}
                >
                  <MultiBarSeries data={months} xKey="month" series={series} height={260} label="Collection and expenses by month" xFormat={(v) => fmtMonthShort(String(v))} tooltipLabel={(v) => fmtMonth(String(v))} yFormat={(v) => moneyCompact(v)} valueFormat={(v) => money(v)} />
                </ChartCard>

                <ChartCard
                  title="Collection rate"
                  description="Share of everything invoiced that has been received"
                  height={150}
                  loading={q.isPending}
                  error={q.isError ? q.error : undefined}
                  onRetry={() => void q.refetch()}
                  empty={!!d && rate === null}
                  emptyText="Nothing has been invoiced in this period."
                  summary={d && rate !== null ? `${percent(rate)} of ${money(d.invoicedMinor)} invoiced has been collected; ${money(d.outstandingMinor)} is outstanding, ${money(d.overdueMinor)} of it overdue.` : undefined}
                  table={{
                    columns: [{ key: 'metric', label: 'Measure' }, { key: 'value', label: 'Amount', align: 'right' }],
                    rows: d ? [{ metric: 'Invoiced', value: money(d.invoicedMinor) }, { metric: 'Collected', value: money(d.collectedMinor) }, { metric: 'Refunded', value: money(d.refundedMinor) }, { metric: 'Outstanding', value: money(d.outstandingMinor) }, { metric: 'Overdue', value: money(d.overdueMinor) }, { metric: 'Collection rate', value: percent(rate) }] : [],
                  }}
                >
                  <div className="flex flex-wrap items-center gap-8" style={{ minHeight: 150 }}>
                    <ProgressRing value={(rate ?? 0) / 100} size={120} stroke={10} label={`Collection rate ${percent(rate)}`} tone={rate !== null && rate < 60 ? 'warning' : 'brand'}>
                      <span className="figure text-[26px] leading-8">{percent(rate, 0)}</span>
                    </ProgressRing>
                    <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
                      <div>
                        <dt className="t-caption text-ink-2">Invoiced</dt>
                        <dd className="tnum font-medium">{d ? money(d.invoicedMinor) : '—'}</dd>
                      </div>
                      <div>
                        <dt className="t-caption text-ink-2">Collected</dt>
                        <dd className="tnum font-medium">{d ? money(d.collectedMinor) : '—'}</dd>
                      </div>
                      <div>
                        <dt className="t-caption text-ink-2">Outstanding</dt>
                        <dd className="tnum font-medium">{d ? money(d.outstandingMinor) : '—'}</dd>
                      </div>
                      <div>
                        <dt className="t-caption text-ink-2">Overdue</dt>
                        <dd className="tnum font-medium text-danger">{d ? money(d.overdueMinor) : '—'}</dd>
                      </div>
                    </dl>
                  </div>
                </ChartCard>
              </div>

              <div className="space-y-6">
                <Card>
                  <CardHeader title="Needs approval" description="Waiting for a decision" />
                  <CardBody className="pt-3">
                    {q.isPending ? (
                      <div className="space-y-3" aria-busy>
                        {[0, 1, 2].map((i) => (
                          <div key={i} className="skeleton h-9 rounded-md" />
                        ))}
                      </div>
                    ) : approvals.every((a) => a.n === 0) ? (
                      <p className="text-sm text-ink-2">Nothing is waiting for approval.</p>
                    ) : (
                      <ul className="divide-y divide-border">
                        {approvals.map((a) => (
                          <li key={a.key} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                            <span className="text-sm">
                              <span className="figure mr-2 text-[20px]">{a.n}</span>
                              {a.label}
                            </span>
                            {a.n > 0 && (
                              <Link href={a.href} className="tr-colors inline-flex items-center gap-1 text-[13px] font-medium text-brand-ink hover:underline">
                                {can(a.needs, 'school') ? 'Review' : 'View'} <ArrowRight className="size-3.5" aria-hidden />
                              </Link>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    {d && !can('fees:approve', 'school') && <p className="t-caption mt-3 text-ink-3">Decisions are made by the accounts team; you can see what is waiting.</p>}
                  </CardBody>
                </Card>
                <OnlinePaymentsStatus />
                {d && <p className="t-caption text-ink-3">{plural(d.byMonth.length, 'month')} of activity in this period.</p>}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
