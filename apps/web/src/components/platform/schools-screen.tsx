'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import type { PlatformTenantSummary } from '@school-sync/shared';
import { PageHeader } from '@/components/shell/page-header';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { StatTile } from '@/components/ui/stat-tile';
import { ClearFiltersButton, FilterChip, FilterSelect, SearchBox } from '@/components/features/management/shared/controls';
import { useUrlState } from '@/lib/client/url-state';
import { money, plural } from '@/lib/format';
import { useTenants } from '@/lib/platform/queries';
import { LicenseChip, PeriodText, SeatsMeter, TenantStatusChip } from './bits';
import { UpdateAllBanner, UpdateChip } from './updates';

const STATUS_LABEL: Record<string, string> = { active: 'Live', suspended: 'Suspended', archived: 'Archived', provisioning: 'Setting up', failed: 'Setup failed' };
const LICENSE_LABEL: Record<string, string> = { active: 'Active', trial: 'Trial', grace: 'Grace period', expired: 'Expired', cancelled: 'Cancelled', unlicensed: 'Not licensed' };

const count = (r: Record<string, number> | undefined, k: string) => r?.[k] ?? 0;

/** All schools: search, filter by status and subscription state, seats used against committed seats. */
export function SchoolsScreen() {
  const router = useRouter();
  const [url, setUrl, resetUrl] = useUrlState({ q: '', status: '', license: '', page: 1, size: 25 });
  const q = useTenants({ q: url.q || undefined, status: url.status || undefined, license: url.license || undefined, page: url.page, pageSize: url.size });
  const facets = q.data?.facets;
  const totalSchools = Object.values(facets?.status ?? {}).reduce((a, b) => a + b, 0);
  const subscribed = count(facets?.license, 'active') + count(facets?.license, 'trial');
  const attention = count(facets?.license, 'grace') + count(facets?.license, 'expired') + count(facets?.license, 'cancelled') + count(facets?.license, 'unlicensed');
  const active = !!(url.q || url.status || url.license);

  const columns: Column<PlatformTenantSummary>[] = [
    {
      id: 'school',
      header: 'School',
      mobile: 'title',
      className: 'min-w-[14rem]',
      cell: (t) => (
        <span className="block min-w-0">
          <Link href={`/platform/schools/${t.code}`} className="block truncate py-1 font-medium hover:underline">{t.name}</Link>
          <span className="t-caption block truncate font-mono text-ink-2">{t.code}</span>
        </span>
      ),
    },
    { id: 'status', header: 'Status', label: 'Status', mobile: 'status', cell: (t) => <span className="flex flex-wrap gap-1">{t.status !== 'active' && <TenantStatusChip status={t.status} />}{t.status === 'active' || t.status === 'suspended' ? <LicenseChip state={t.license.state} /> : null}{(t.status === 'active' || t.status === 'suspended') && !t.schema.upToDate && <UpdateChip />}</span> },
    { id: 'seats', header: 'Seats used', label: 'Seats used', mobile: 'detail', cell: (t) => <SeatsMeter seats={t.seats} /> },
    { id: 'price', header: 'Price per student', label: 'Price per student', align: 'right', mobile: 'detail', cell: (t) => (t.license.pricePerStudentMinor !== null ? <span className="tnum">{money(t.license.pricePerStudentMinor, t.license.currency ?? t.currency)}</span> : <span className="text-ink-3">—</span>) },
    { id: 'period', header: 'Period ends', label: 'Period ends', mobile: 'detail', cell: (t) => <PeriodText endsOn={t.license.endsOn} daysLeft={t.license.daysLeft} state={t.license.state} /> },
    {
      id: 'owed',
      header: 'Outstanding',
      label: 'Outstanding',
      align: 'right',
      mobile: 'detail',
      cell: (t) => (t.billing.outstandingCount ? <span className="block tnum">{money(t.billing.outstandingMinor, t.currency)}{t.billing.overdueCount > 0 && <span className="t-caption block text-danger">{t.billing.overdueCount} overdue</span>}</span> : <span className="text-ink-3">—</span>),
    },
  ];

  return (
    <>
      <PageHeader
        title="Schools"
        description="Every school on SchoolSync with its subscription, seats and what it owes."
        actions={
          <Button asChild>
            <Link href="/platform/schools/new">
              <Plus /> Create school
            </Link>
          </Button>
        }
      />
      <UpdateAllBanner waiting={facets?.updates ?? 0} />
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatTile label="Schools" value={q.data ? totalSchools : null} state={q.isPending ? 'loading' : 'ready'} />
        <StatTile label="Subscribed" value={q.data ? subscribed : null} hint="Active or on trial" state={q.isPending ? 'loading' : 'ready'} />
        <StatTile label="Need attention" value={q.data ? attention : null} hint="Grace, expired, cancelled or not licensed" state={q.isPending ? 'loading' : 'ready'} className="col-span-2 lg:col-span-1" />
      </div>
      <DataTable<PlatformTenantSummary>
        memoRows
        id="platform-schools"
        caption="Schools"
        rows={q.data?.data}
        rowKey={(t) => t.id}
        columns={columns}
        loading={q.isPending}
        error={q.isError && !q.data ? q.error : undefined}
        onRetry={() => void q.refetch()}
        page={url.page}
        pageSize={url.size}
        total={q.data?.meta.total}
        onPageChange={(p) => setUrl({ page: p })}
        onPageSizeChange={(s) => setUrl({ size: s })}
        onRowClick={(t) => router.push(`/platform/schools/${t.code}`)}
        filters={
          <>
            <SearchBox value={url.q} onChange={(v) => setUrl({ q: v })} placeholder="Search name or code" className="sm:w-64" />
            <FilterSelect label="Subscription state" value={url.license} onChange={(v) => setUrl({ license: v })} allLabel="Any subscription" options={Object.entries(LICENSE_LABEL).map(([value, label]) => ({ value, label: facets ? `${label} (${count(facets.license, value)})` : label }))} />
            <FilterSelect label="School status" value={url.status} onChange={(v) => setUrl({ status: v })} allLabel="Any status" options={Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label: facets ? `${label} (${count(facets.status, value)})` : label }))} />
          </>
        }
        empty={
          active ? (
            <EmptyState
              illustration="no-results"
              title="No schools match"
              description="Try a different search or clear the filters."
              filters={<>{url.q && <FilterChip label={`“${url.q}”`} onRemove={() => setUrl({ q: '' })} />}{url.license && <FilterChip label={LICENSE_LABEL[url.license] ?? url.license} onRemove={() => setUrl({ license: '' })} />}{url.status && <FilterChip label={STATUS_LABEL[url.status] ?? url.status} onRemove={() => setUrl({ status: '' })} />}</>}
              action={<ClearFiltersButton onClick={() => resetUrl(['q', 'status', 'license'])} />}
              compact
            />
          ) : (
            <EmptyState
              illustration="empty-generic"
              title="No schools yet"
              description="Create the first school: it gets its own database, a first administrator and, if you like, its subscription."
              action={
                <Button asChild>
                  <Link href="/platform/schools/new"><Plus /> Create school</Link>
                </Button>
              }
              compact
            />
          )
        }
      />
      {q.data && q.data.meta.total > 0 && <p className="t-caption mt-3 text-ink-2" aria-live="polite">{plural(q.data.meta.total, 'school')} shown. Seat counts come from the last metering run; open a school or use “Meter now” in Billing for a fresh count.</p>}
    </>
  );
}
