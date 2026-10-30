'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { EVENT_KINDS, EVENT_STATUSES, type EventItem } from '@school-sync/shared';
import { useEventList } from '@/lib/client/communication';
import { fmtClock, fmtDate } from '@/lib/format';
import { PageHeader } from '@/components/shell/page-header';
import { Badge, StatusChip } from '@/components/ui/badge';
import { DataTable } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { JoinFor } from '../../online-meeting/online-meeting';
import { ClearFilters, FilterBar, FilterChips, FilterDate, FilterSelect, SearchBox } from '../common/filters';
import { GuardedButton } from '../common/guarded';
import { useListState, useTabParam } from '../common/url-state';
import { useMgmt } from '../common/use-mgmt';
import { CalendarView } from './calendar-view';
import { KIND_LABEL } from './event-form';

export const eventWhen = (e: Pick<EventItem, 'startDate' | 'endDate' | 'startTime' | 'endTime' | 'allDay'>) => {
  const days = e.endDate !== e.startDate ? `${fmtDate(e.startDate)} – ${fmtDate(e.endDate)}` : fmtDate(e.startDate);
  const time = !e.allDay && e.startTime ? ` · ${fmtClock(e.startTime)}${e.endTime ? ` – ${fmtClock(e.endTime)}` : ''}` : '';
  return days + time;
};

export function EventsPage() {
  const router = useRouter();
  const { base, writeBlock } = useMgmt();
  const [tab, setTab] = useTabParam(['calendar', 'list']);
  return (
    <>
      <PageHeader
        title="Events and calendar"
        description="The school calendar: events, holidays, parent–teacher meetings, exams and homework deadlines, with registration and consent."
        actions={
          <GuardedButton blocked={writeBlock('events:create')} onClick={() => router.push(`${base}/communication/events/new`)}>
            <Plus /> New event
          </GuardedButton>
        }
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label="Calendar views">
          <TabsTrigger value="calendar">Calendar</TabsTrigger>
          <TabsTrigger value="list">Manage events</TabsTrigger>
        </TabsList>
        <TabsContent value="calendar">
          <CalendarView />
        </TabsContent>
        <TabsContent value="list">
          <EventList />
        </TabsContent>
      </Tabs>
    </>
  );
}

function EventList() {
  const router = useRouter();
  const { base, writeBlock } = useMgmt();
  const ls = useListState({ pageSize: 25 });
  const kind = ls.get('kind');
  const status = ls.get('status');
  const from = ls.get('from');
  const to = ls.get('to');
  const q = useEventList({ page: ls.page, pageSize: ls.pageSize, q: ls.q || undefined, kind: kind || undefined, status: status || undefined, from: from || undefined, to: to || undefined });
  const filtered = ls.hasFilters(['kind', 'status', 'from', 'to']);

  return (
    <DataTable<EventItem>
      id="comm-events"
      caption="Events"
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
      onRowClick={(r) => router.push(`${base}/communication/events/${r.id}`)}
      filters={
        <FilterBar>
          <SearchBox value={ls.qInput} onChange={ls.setQInput} placeholder="Search events" />
          <FilterSelect label="Kind" value={kind} onChange={(v) => ls.set({ kind: v })} options={EVENT_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] ?? k }))} />
          <FilterSelect label="Status" value={status} onChange={(v) => ls.set({ status: v })} options={EVENT_STATUSES.map((s) => ({ value: s, label: s[0]!.toUpperCase() + s.slice(1) }))} />
          <FilterDate label="From" value={from} onChange={(v) => ls.set({ from: v })} max={to || undefined} />
          <FilterDate label="To" value={to} onChange={(v) => ls.set({ to: v })} min={from || undefined} />
        </FilterBar>
      }
      empty={
        filtered ? (
          <EmptyState illustration="no-results" title="No events match" filters={<FilterChips chips={[...(ls.q ? [{ label: 'Search', value: ls.q }] : []), ...(kind ? [{ label: 'Kind', value: KIND_LABEL[kind] ?? kind }] : []), ...(status ? [{ label: 'Status', value: status }] : []), ...(from ? [{ label: 'From', value: fmtDate(from) }] : []), ...(to ? [{ label: 'To', value: fmtDate(to) }] : [])]} />} action={<ClearFilters onClear={() => ls.clear()} />} />
        ) : (
          <EmptyState illustration="empty-events" title="No events yet" description="Create an event, a holiday or a parent–teacher meeting day." action={<GuardedButton blocked={writeBlock('events:create')} onClick={() => router.push(`${base}/communication/events/new`)}>New event</GuardedButton>} />
        )
      }
      columns={[
        {
          id: 'title',
          header: 'Event',
          cell: (r) => (
            <div className="min-w-0">
              <Link href={`${base}/communication/events/${r.id}`} onClick={(e) => e.stopPropagation()} className="block max-w-[40ch] truncate font-medium hover:underline">
                {r.title}
              </Link>
              <p className="t-caption max-w-[40ch] truncate text-ink-3">{r.audience.map((a) => a.label).join(', ')}</p>
            </div>
          ),
          mobile: 'title',
        },
        { id: 'kind', header: 'Kind', cell: (r) => <Badge variant="outline">{KIND_LABEL[r.kind] ?? r.kind}</Badge>, mobile: 'detail', label: 'Kind' },
        { id: 'when', header: 'When', cell: (r) => eventWhen(r), sortable: true, sortValue: (r) => r.startDate, mobile: 'sub' },
        { id: 'where', header: 'Place', cell: (r) => r.location ?? '—', defaultHidden: true, mobile: 'hide' },
        {
          id: 'online',
          header: 'Online',
          // depends on the row alone; a failed meeting is flagged for the people who can fix it
          cell: (r) => (r.onlineMeeting?.status === 'scheduled' && r.status === 'published' ? <JoinFor meeting={r.onlineMeeting} /> : r.canManage && r.onlineMeeting?.status === 'failed' ? <Badge variant="danger">Needs attention</Badge> : <span className="text-ink-3">—</span>),
          mobile: 'detail',
          label: 'Online',
        },
        { id: 'resp', header: 'Answers', cell: (r) => (r.registrationRequired ? 'Registration' : r.consentRequired ? 'Consent' : <span className="text-ink-3">None</span>), mobile: 'hide' },
        { id: 'status', header: 'Status', cell: (r) => <StatusChip status={r.status} />, mobile: 'status' },
      ]}
    />
  );
}
