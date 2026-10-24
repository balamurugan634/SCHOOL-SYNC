'use client';

import * as React from 'react';
import { Gauge } from 'lucide-react';
import type { PlatformTenantDetail } from '@school-sync/shared';
import { LineSeries } from '@/components/charts/series-charts';
import { Button } from '@/components/ui/button';
import { ChartCard } from '@/components/ui/chart';
import { Select } from '@/components/ui/select';
import { fmtDate } from '@/lib/format';
import { useMeterTenant, useTenantUsage } from '@/lib/platform/queries';

const RANGES = [
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: '180', label: 'Last 6 months' },
  { value: '365', label: 'Last year' },
  { value: '800', label: 'All time' },
];

/** Billable students over time: the number the true-up invoice is based on is the highest point on this line. */
export function UsagePanel({ detail }: { detail: PlatformTenantDetail }) {
  const [days, setDays] = React.useState('180');
  const q = useTenantUsage(detail.tenant.code, Number(days));
  const meter = useMeterTenant(detail.tenant.code);
  const live = detail.tenant.status === 'active' || detail.tenant.status === 'suspended';
  const data = q.data?.data ?? [];
  const peak = q.data?.peakBillable ?? 0;
  const licensed = detail.license.licensedStudents;
  const last = data.at(-1);
  const shortDate = (v: string | number) => fmtDate(String(v), { day: 'numeric', month: 'short' });
  const summary = last
    ? `${last.billableStudents.toLocaleString()} billable students on ${fmtDate(last.date)}. The peak in ${q.data?.academicYear ?? 'the subscription year'} is ${peak.toLocaleString()}${licensed !== null ? ` against ${licensed.toLocaleString()} committed seats` : ' (no seat limit)'}.`
    : undefined;
  return (
    <ChartCard
      title="Billable students"
      description="A daily count of students enrolled in the subscription year, taken when the school is metered (every 6 hours, or on demand)."
      summary={summary}
      height={280}
      loading={q.isPending}
      error={q.isError ? q.error : undefined}
      onRetry={() => void q.refetch()}
      empty={data.length === 0}
      emptyText="No usage recorded yet. Meter the school to take the first reading."
      table={{ columns: [{ key: 'date', label: 'Date', format: (v) => fmtDate(String(v)) }, { key: 'billableStudents', label: 'Billable', align: 'right' }, { key: 'activeStudents', label: 'Active students', align: 'right' }, { key: 'staff', label: 'Staff', align: 'right' }, { key: 'parents', label: 'Parents', align: 'right' }], rows: [...data].reverse() as unknown as Record<string, unknown>[] }}
      actions={
        <div className="flex items-center gap-2">
          <Select aria-label="Range" className="!h-8 w-[150px]" value={days} onValueChange={setDays} options={RANGES} />
          <Button size="sm" variant="secondary" onClick={() => void meter.run()} loading={meter.isPending} disabled={!live}>
            <Gauge /> Meter now
          </Button>
        </div>
      }
    >
      <LineSeries data={data as unknown as Record<string, unknown>[]} xKey="date" yKey="billableStudents" label="Billable students" height={280} xFormat={shortDate} tooltipLabel={(v) => fmtDate(String(v))} />
    </ChartCard>
  );
}
