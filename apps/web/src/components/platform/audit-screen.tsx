'use client';

import * as React from 'react';
import Link from 'next/link';
import type { PlatformAuditEntry } from '@school-sync/shared';
import { PageHeader } from '@/components/shell/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { ClearFiltersButton, FilterChip, FilterSelect } from '@/components/features/management/shared/controls';
import { useUrlState } from '@/lib/client/url-state';
import { fmtDateTime, money } from '@/lib/format';
import { useAuditLog, useOperators, useTenants } from '@/lib/platform/queries';

const AREAS = [
  { value: 'tenant.', label: 'Schools' },
  { value: 'subscription.', label: 'Subscriptions' },
  { value: 'invoice.', label: 'Invoices' },
  { value: 'usage.', label: 'Metering' },
  { value: 'operator.', label: 'Operators and sign-ins' },
];

const LABEL: Record<string, string> = {
  'tenant.create': 'School created',
  'tenant.update': 'School updated',
  'tenant.suspended': 'School suspended',
  'tenant.active': 'School resumed',
  'tenant.archived': 'School archived',
  'tenant.demo_data': 'Demo data loaded',
  'tenant.demo_data_failed': 'Demo data failed',
  'subscription.upsert': 'Subscription saved',
  'invoice.issue': 'Invoice issued',
  'invoice.paid': 'Invoice marked paid',
  'invoice.void': 'Invoice voided',
  'usage.snapshot': 'School metered',
  'usage.snapshot_all': 'All schools metered',
  'operator.login': 'Signed in',
  'operator.login_failed': 'Failed sign-in',
  'operator.logout': 'Signed out',
  'operator.password_changed': 'Password changed',
  'operator.refresh_reuse': 'Session revoked (token replay)',
  'operator.create': 'Operator added',
  'operator.disable': 'Operator disabled',
  'operator.enable': 'Operator enabled',
  'operator.reset_password': 'Operator password reset',
  'operator.bootstrap': 'First operator created',
};
const humanize = (a: string) => LABEL[a] ?? a.replace(/[._]/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

/** A short plain-language line from the structured detail (the full record is one click away). */
function summarize(e: PlatformAuditEntry): string {
  const d = (e.detail ?? {}) as Record<string, unknown>;
  const bits: string[] = [];
  const str = (k: string) => (typeof d[k] === 'string' || typeof d[k] === 'number' ? String(d[k]) : null);
  if (str('number')) bits.push(str('number')!);
  if (typeof d.amountMinor === 'number' && typeof d.currency === 'string') bits.push(money(d.amountMinor, d.currency));
  for (const k of ['academicYear', 'kind', 'email', 'name', 'paidOn', 'reference', 'reason']) if (str(k)) bits.push(`${k === 'academicYear' ? 'year ' : k === 'paidOn' ? 'paid on ' : k === 'reference' ? 'ref ' : ''}${str(k)}`);
  if (typeof d.billableStudents === 'number') bits.push(`${d.billableStudents} billable students`);
  if (typeof d.from === 'string') bits.push(`from ${d.from}`);
  if (d.after && typeof d.after === 'object') bits.push(`changed ${Object.keys(d.after as object).join(', ')}`);
  if (typeof d.failures === 'number') bits.push(`${d.failures} failed ${d.failures === 1 ? 'attempt' : 'attempts'}${d.locked ? ', locked' : ''}`);
  return bits.join(' · ');
}

const ACTOR_KIND: Record<string, string> = { key: 'Automation key', cli: 'Command line', system: 'System' };

/** Everything operators and automation did: who, what, which school, when. Newest first. */
export function AuditScreen() {
  const [url, setUrl, resetUrl] = useUrlState({ school: '', area: '', actor: '' });
  const ops = useOperators();
  const schools = useTenants({ page: 1, pageSize: 200 });
  const q = useAuditLog({ tenant: url.school || undefined, action: url.area || undefined, actor: url.actor || undefined });
  const rows = React.useMemo(() => q.data?.pages.flatMap((p) => p.data), [q.data]);
  const active = !!(url.school || url.area || url.actor);

  const columns: Column<PlatformAuditEntry>[] = [
    { id: 'what', header: 'What happened', mobile: 'title', className: 'min-w-[12rem]', cell: (e) => <span className="block font-medium">{humanize(e.action)}<span className="t-caption block font-mono font-normal text-ink-3">{e.action}</span></span> },
    { id: 'when', header: 'When', mobile: 'sub', cell: (e) => <span className="tnum whitespace-nowrap text-ink-2">{fmtDateTime(e.at)}</span> },
    { id: 'who', header: 'Who', label: 'Who', mobile: 'detail', cell: (e) => (e.actorKind === 'operator' ? <span>{e.actorName ?? 'Operator'}</span> : <Badge variant="outline">{ACTOR_KIND[e.actorKind] ?? e.actorKind}</Badge>) },
    { id: 'school', header: 'School', label: 'School', mobile: 'detail', cell: (e) => (e.tenantCode ? <Link href={`/platform/schools/${e.tenantCode}`} className="-mx-1 inline-block px-1 py-1 font-mono text-[13px] hover:underline">{e.tenantCode}</Link> : <span className="text-ink-3">—</span>) },
    {
      id: 'detail',
      header: 'Details',
      label: 'Details',
      mobile: 'detail',
      className: 'min-w-[16rem]',
      cell: (e) => (
        <details className="group">
          <summary className="cursor-pointer list-none text-ink-2 marker:hidden [&::-webkit-details-marker]:hidden">
            <span className="line-clamp-2">{summarize(e) || 'Show record'}</span>
          </summary>
          <pre className="mt-2 max-h-56 overflow-auto rounded-md border border-border bg-surface-subtle p-2 font-mono text-[12px] leading-5">{JSON.stringify(e.detail, null, 2)}</pre>
        </details>
      ),
    },
  ];

  const schoolName = schools.data?.data.find((s) => s.code === url.school)?.name ?? url.school;
  const actorName = url.actor === 'platform-api' ? 'Automation key' : (ops.data?.find((o) => o.id === url.actor)?.displayName ?? 'Operator');
  return (
    <>
      <PageHeader title="Audit log" description="Every sign-in, school, subscription and invoice change, with who did it. Records are never edited." />
      <DataTable<PlatformAuditEntry>
        memoRows
        id="platform-audit"
        caption="Platform audit log"
        rows={rows}
        rowKey={(e) => e.id}
        columns={columns}
        loading={q.isPending}
        error={q.isError && !q.data ? q.error : undefined}
        onRetry={() => void q.refetch()}
        filters={
          <>
            <FilterSelect label="Area" value={url.area} onChange={(v) => setUrl({ area: v })} allLabel="Everything" options={AREAS} />
            <FilterSelect label="School" value={url.school} onChange={(v) => setUrl({ school: v })} allLabel="Any school" options={(schools.data?.data ?? []).map((s) => ({ value: s.code, label: `${s.name} (${s.code})` }))} />
            <FilterSelect label="Who" value={url.actor} onChange={(v) => setUrl({ actor: v })} allLabel="Anyone" options={[...(ops.data ?? []).map((o) => ({ value: o.id, label: o.displayName })), { value: 'platform-api', label: 'Automation key' }]} />
          </>
        }
        empty={
          active ? (
            <EmptyState
              illustration="no-results"
              title="Nothing recorded for these filters"
              filters={<>{url.area && <FilterChip label={AREAS.find((a) => a.value === url.area)?.label ?? url.area} onRemove={() => setUrl({ area: '' })} />}{url.school && <FilterChip label={schoolName} onRemove={() => setUrl({ school: '' })} />}{url.actor && <FilterChip label={actorName} onRemove={() => setUrl({ actor: '' })} />}</>}
              action={<ClearFiltersButton onClick={() => resetUrl()} />}
              compact
            />
          ) : (
            <EmptyState illustration="empty-generic" title="Nothing recorded yet" description="Actions in this console show up here as they happen." compact />
          )
        }
      />
      {q.hasNextPage && (
        <div className="mt-4 flex justify-center">
          <Button variant="secondary" onClick={() => void q.fetchNextPage()} loading={q.isFetchingNextPage}>Load older entries</Button>
        </div>
      )}
    </>
  );
}
