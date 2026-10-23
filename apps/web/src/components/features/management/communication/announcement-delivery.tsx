'use client';

import * as React from 'react';
import { Download } from 'lucide-react';
import type { AnnouncementItem } from '@school-sync/shared';
import { useAnnouncementRecipients, useAnnouncementStats, type AnnouncementRecipient } from '@/lib/client/communication';
import { bff } from '@/lib/client/fetcher';
import { friendlyError, type Paged } from '@/lib/client/mgmt';
import { downloadCsv, toCsv } from '@/lib/csv';
import { fmtDateTime, percent, todayIso } from '@/lib/format';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { ChartCard } from '@/components/ui/chart';
import { DataTable } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { StatTile } from '@/components/ui/stat-tile';
import { toast } from '@/components/ui/toaster';
import { CHART, MultiBarSeries } from '../common/charts';
import { ChoicePills, FilterBar, SearchBox } from '../common/filters';
import { ErrorPanel } from '../common/states';
import { useListState } from '../common/url-state';

const TYPE_LABEL: Record<string, string> = { student: 'Students', parent: 'Parents', staff: 'Staff' };

/** Who it reached: audience size, read and acknowledged (overall, by user type, by section) and the people still to chase. */
export function AnnouncementDelivery({ a }: { a: AnnouncementItem }) {
  const draft = a.state === 'draft' || a.state === 'scheduled';
  const stats = useAnnouncementStats(a.id);
  const s = stats.data;
  const ls = useListState({ pageSize: 25 });
  const status = (ls.get('who') || 'all') as 'all' | 'unread' | 'unacknowledged';
  const rq = { page: ls.page, pageSize: ls.pageSize, q: ls.q || undefined, status };
  const recipients = useAnnouncementRecipients(a.id, rq, !draft);
  const [exporting, setExporting] = React.useState(false);

  const byType = (s?.byUserType ?? []).map((t) => ({ label: TYPE_LABEL[t.userType] ?? t.userType, audience: t.audience, read: t.read, acked: t.acked }));
  const bySection = (s?.bySection ?? []).map((x) => ({ label: `${x.gradeName} ${x.sectionName}`, read: x.read, unread: Math.max(0, x.audience - x.read), audience: x.audience, acked: x.acked }));
  const readPct = s && s.audienceSize > 0 ? (s.readCount / s.audienceSize) * 100 : null;
  const ackPct = s && s.audienceSize > 0 ? (s.ackCount / s.audienceSize) * 100 : null;

  const exportList = async () => {
    setExporting(true);
    const id = toast.loading('Preparing the list…');
    try {
      let all: AnnouncementRecipient[] = [];
      for (let page = 1; page <= 50; page++) {
        const r = await bff<Paged<AnnouncementRecipient>>(`/announcements/${a.id}/recipients`, { query: { page, pageSize: 100, status, q: ls.q || undefined } });
        all = all.concat(r.data);
        if (page >= r.meta.totalPages) break;
      }
      downloadCsv(`announcement-${status}-${todayIso()}.csv`, toCsv(['Name', 'Type', 'Read at', 'Acknowledged at'], all.map((r) => [r.name, r.userType, r.readAt ?? '', r.ackedAt ?? ''])));
      toast.success('List downloaded', { id, description: `${all.length.toLocaleString()} people` });
    } catch (e) {
      toast.error('Couldn’t prepare the list', { id, description: friendlyError(e), duration: 8000 });
    } finally {
      setExporting(false);
    }
  };

  if (stats.isError && !s) return <ErrorPanel error={stats.error} onRetry={() => void stats.refetch()} title="We couldn’t load the delivery numbers" />;

  return (
    <div className="space-y-6">
      {draft && <Banner tone="info">{a.state === 'scheduled' ? 'This announcement has not been published yet.' : 'This is still a draft.'} Reads and acknowledgements appear once it goes out; the audience size below is who it would reach today.</Banner>}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Audience" value={s?.audienceSize} hint="people it reaches" state={stats.isPending ? 'loading' : 'ready'} />
        <StatTile label="Read" value={s?.readCount} hint={readPct !== null && !draft ? `${percent(readPct, 0)} of the audience` : undefined} state={stats.isPending ? 'loading' : 'ready'} />
        {a.requiresAck ? <StatTile label="Acknowledged" value={s?.ackCount} hint={ackPct !== null && !draft ? `${percent(ackPct, 0)} of the audience` : undefined} state={stats.isPending ? 'loading' : 'ready'} /> : <StatTile label="Unread" value={s?.unreadCount} state={stats.isPending ? 'loading' : 'ready'} />}
        {a.requiresAck && <StatTile label="Still to acknowledge" value={s?.pendingAckCount} state={stats.isPending ? 'loading' : 'ready'} />}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard
          title="By group"
          description="Audience, readers and acknowledgements"
          height={Math.max(180, byType.length * 64)}
          loading={stats.isPending}
          error={stats.isError ? stats.error : undefined}
          onRetry={() => void stats.refetch()}
          empty={!!s && byType.length === 0}
          legend={{ audience: { label: 'Audience', color: CHART[2] }, read: { label: 'Read', color: CHART[0] }, ...(a.requiresAck ? { acked: { label: 'Acknowledged', color: CHART[5] } } : {}) }}
          summary={s ? `${s.readCount} of ${s.audienceSize} have read it${a.requiresAck ? ` and ${s.ackCount} have acknowledged it` : ''}.` : undefined}
          table={{ columns: [{ key: 'label', label: 'Group' }, { key: 'audience', label: 'Audience', align: 'right' }, { key: 'read', label: 'Read', align: 'right' }, ...(a.requiresAck ? [{ key: 'acked', label: 'Acknowledged', align: 'right' as const }] : [])], rows: byType }}
        >
          <MultiBarSeries data={byType} xKey="label" horizontal height={Math.max(180, byType.length * 64)} label="Delivery by group" series={[{ key: 'audience', label: 'Audience', color: CHART[2] }, { key: 'read', label: 'Read', color: CHART[0] }, ...(a.requiresAck ? [{ key: 'acked', label: 'Acknowledged', color: CHART[5] }] : [])]} yWidth={72} />
        </ChartCard>
        <ChartCard
          title="By class"
          description="Who has read it, class by class"
          height={Math.max(220, bySection.length * 34)}
          loading={stats.isPending}
          error={stats.isError ? stats.error : undefined}
          onRetry={() => void stats.refetch()}
          empty={!!s && bySection.length === 0}
          emptyText="This announcement does not reach any class."
          legend={{ read: { label: 'Read', color: CHART[0] }, unread: { label: 'Not read yet', color: CHART[3] } }}
          summary={bySection.length ? `Lowest readership: ${(() => { const w = bySection.filter((x) => x.audience > 0).sort((x, y) => x.read / x.audience - y.read / y.audience)[0]; return w ? `${w.label} (${w.read} of ${w.audience})` : 'none'; })()}.` : undefined}
          table={{ columns: [{ key: 'label', label: 'Class' }, { key: 'audience', label: 'Audience', align: 'right' }, { key: 'read', label: 'Read', align: 'right' }, ...(a.requiresAck ? [{ key: 'acked', label: 'Acknowledged', align: 'right' as const }] : [])], rows: bySection }}
        >
          <MultiBarSeries data={bySection} xKey="label" stacked horizontal height={Math.max(220, bySection.length * 34)} label="Delivery by class" series={[{ key: 'read', label: 'Read', color: CHART[0] }, { key: 'unread', label: 'Not read yet', color: CHART[3] }]} yWidth={72} />
        </ChartCard>
      </div>

      {!draft && (
        <section aria-labelledby="recipients-h" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="recipients-h" className="t-section">
              People
            </h2>
            <Button variant="secondary" size="sm" loading={exporting} onClick={() => void exportList()}>
              <Download /> Download this list
            </Button>
          </div>
          <DataTable<AnnouncementRecipient>
            id="comm-recipients"
            caption="Recipients"
            rows={recipients.data?.data}
            rowKey={(r) => r.userId}
            loading={recipients.isPending}
            error={recipients.error}
            onRetry={() => void recipients.refetch()}
            page={ls.page}
            pageSize={ls.pageSize}
            total={recipients.data?.meta.total}
            onPageChange={ls.setPage}
            onPageSizeChange={ls.setPageSize}
            filters={
              <FilterBar>
                <ChoicePills
                  label="Recipient filter"
                  value={status === 'all' ? '' : status}
                  onChange={(v) => ls.set({ who: v || null })}
                  options={[{ value: '', label: 'Everyone' }, { value: 'unread', label: 'Not read yet' }, ...(a.requiresAck ? [{ value: 'unacknowledged' as const, label: 'Not acknowledged' }] : [])]}
                />
                <SearchBox value={ls.qInput} onChange={ls.setQInput} placeholder="Search by name" />
              </FilterBar>
            }
            empty={<EmptyState illustration={status === 'all' ? 'empty-generic' : 'success'} compact title={status === 'unread' ? 'Everyone has read it' : status === 'unacknowledged' ? 'Everyone has acknowledged it' : 'No recipients match'} />}
            columns={[
              { id: 'name', header: 'Name', cell: (r) => <span className="font-medium">{r.name}</span>, mobile: 'title' },
              { id: 'type', header: 'Type', cell: (r) => TYPE_LABEL[r.userType] ?? r.userType, mobile: 'sub' },
              { id: 'read', header: 'Read', cell: (r) => (r.readAt ? fmtDateTime(r.readAt) : <span className="text-ink-3">Not yet</span>), mobile: 'detail', label: 'Read' },
              ...(a.requiresAck ? [{ id: 'ack', header: 'Acknowledged', cell: (r: AnnouncementRecipient) => (r.ackedAt ? fmtDateTime(r.ackedAt) : <span className="text-warning">Waiting</span>), mobile: 'detail' as const, label: 'Acknowledged' }] : []),
            ]}
          />
        </section>
      )}
    </div>
  );
}
