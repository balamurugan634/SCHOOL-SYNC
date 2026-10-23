'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Download } from 'lucide-react';
import { EVENT_RESPONSES, type EventItem } from '@school-sync/shared';
import { useDeleteEvent, useEvent, useEventAction, useEventResponses, type EventResponseRow } from '@/lib/client/communication';
import { bff } from '@/lib/client/fetcher';
import { friendlyError, useSectionList, type Paged } from '@/lib/client/mgmt';
import { downloadCsv, toCsv } from '@/lib/csv';
import { fmtDateTime, todayIso } from '@/lib/format';
import { BarSeries } from '@/components/charts/series-charts';
import { PageHeader } from '@/components/shell/page-header';
import { Badge, StatusChip } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { ChartCard } from '@/components/ui/chart';
import { DataTable } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { StatTile } from '@/components/ui/stat-tile';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toaster';
import { AsyncConfirm } from '../common/dialogs';
import { FilterBar, FilterSelect, SearchBox } from '../common/filters';
import { GuardedButton } from '../common/guarded';
import { ErrorPanel } from '../common/states';
import { useListState, useTabParam } from '../common/url-state';
import { useMgmt } from '../common/use-mgmt';
import { EventForm, KIND_LABEL } from './event-form';
import { eventWhen } from './events-page';

const RESP_LABEL: Record<string, string> = { going: 'Going', not_going: 'Not going', consent_given: 'Consent given', consent_denied: 'Consent refused', pending: 'No answer yet' };

export function EventDetail({ id }: { id: string }) {
  const router = useRouter();
  const { base, writeBlock } = useMgmt();
  const q = useEvent(id);
  const ev = q.data;
  const responses = !!ev && (ev.registrationRequired || ev.consentRequired);
  const [tab, setTab] = useTabParam(responses ? ['details', 'responses'] : ['details']);
  const action = useEventAction();
  const del = useDeleteEvent();
  const [dlg, setDlg] = React.useState<'publish' | 'cancel' | 'delete' | null>(null);
  const editable = !!ev && ev.canManage && ev.status !== 'cancelled';

  return (
    <>
      <PageHeader
        title={ev?.title ?? 'Event'}
        description={ev ? `${KIND_LABEL[ev.kind] ?? ev.kind} · ${eventWhen(ev)}${ev.location ? ` · ${ev.location}` : ''}` : undefined}
        crumbs={[{ label: 'Events and calendar', href: `${base}/communication/events` }, { label: ev?.title ?? '…' }]}
        actions={
          ev && (
            <>
              <StatusChip status={ev.status} />
              {ev.canManage && ev.status === 'draft' && (
                <GuardedButton blocked={writeBlock('events:publish')} onClick={() => setDlg('publish')}>
                  Publish
                </GuardedButton>
              )}
              {ev.canManage && ev.status === 'published' && (
                <GuardedButton blocked={writeBlock('events:edit')} variant="danger" onClick={() => setDlg('cancel')}>
                  Cancel event
                </GuardedButton>
              )}
              {ev.canManage && ev.status !== 'cancelled' && (
                <GuardedButton blocked={writeBlock(['events:delete', 'events:edit'])} variant="ghost" onClick={() => setDlg('delete')}>
                  Delete
                </GuardedButton>
              )}
            </>
          )
        }
      />
      {q.isPending ? (
        <div className="space-y-4" aria-busy>
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : q.isError || !ev ? (
        <Card>
          <ErrorPanel error={q.error} onRetry={() => void q.refetch()} title="We couldn’t load this event" compact={false} />
        </Card>
      ) : (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList aria-label="Event sections">
            <TabsTrigger value="details">{editable ? 'Edit' : 'Details'}</TabsTrigger>
            {responses && <TabsTrigger value="responses">Responses</TabsTrigger>}
          </TabsList>
          <TabsContent value="details">
            {ev.status === 'cancelled' && <Banner tone="warning" className="mb-6">This event was cancelled. It stays on the calendar marked as cancelled, and its audience was told.</Banner>}
            {editable ? (
              <div className="max-w-3xl">
                <EventForm event={ev} onSaved={() => void q.refetch()} />
              </div>
            ) : (
              <ReadOnly ev={ev} />
            )}
          </TabsContent>
          {responses && (
            <TabsContent value="responses">
              <Responses ev={ev} />
            </TabsContent>
          )}
        </Tabs>
      )}
      <AsyncConfirm
        open={dlg === 'publish'}
        onOpenChange={(o) => !o && setDlg(null)}
        title={`Publish “${ev?.title ?? ''}”?`}
        description={`It goes on the calendar and ${ev?.audience.map((a) => a.label).join(', ') || 'the audience'} are notified. You can still edit it afterwards; changes to the date, time or place notify them again.`}
        confirmLabel="Publish event"
        onConfirm={async () => {
          await action.mutateAsync({ id, action: 'publish' });
          toast.success('Event published');
        }}
      />
      <AsyncConfirm
        open={dlg === 'cancel'}
        onOpenChange={(o) => !o && setDlg(null)}
        title={`Cancel “${ev?.title ?? ''}”?`}
        description="It stays on the calendar marked as cancelled, registrations are closed and the audience is notified. This cannot be undone."
        confirmLabel="Cancel the event"
        destructive
        onConfirm={async () => {
          await action.mutateAsync({ id, action: 'cancel' });
          toast.success('Event cancelled');
        }}
      />
      <AsyncConfirm
        open={dlg === 'delete'}
        onOpenChange={(o) => !o && setDlg(null)}
        title={`Delete “${ev?.title ?? ''}”?`}
        description="A draft is removed completely. A published event can only be deleted while nobody has responded; otherwise cancel it instead."
        confirmLabel="Delete event"
        destructive
        onConfirm={async () => {
          await del.mutateAsync({ id });
          toast.success('Event deleted');
          router.push(`${base}/communication/events`);
        }}
      />
      <p className="mt-6">
        <Button asChild variant="link">
          <Link href={`${base}/communication/events`}>Back to events and calendar</Link>
        </Button>
      </p>
    </>
  );
}

function ReadOnly({ ev }: { ev: EventItem }) {
  return (
    <Card className="max-w-3xl">
      <CardBody className="space-y-4">
        {ev.description && <p className="whitespace-pre-wrap text-sm leading-6">{ev.description}</p>}
        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="t-caption text-ink-2">When</dt>
            <dd>{eventWhen(ev)}</dd>
          </div>
          <div>
            <dt className="t-caption text-ink-2">Place</dt>
            <dd>{ev.location ?? '—'}</dd>
          </div>
          <div>
            <dt className="t-caption text-ink-2">Audience</dt>
            <dd>{ev.audience.map((a) => a.label).join(', ') || '—'}</dd>
          </div>
          <div>
            <dt className="t-caption text-ink-2">Answers</dt>
            <dd>{ev.registrationRequired ? 'Registration' : ev.consentRequired ? 'Parental consent' : 'None needed'}</dd>
          </div>
        </dl>
        {ev.consentText && <p className="rounded-md bg-surface-subtle p-3 text-sm text-ink-2">{ev.consentText}</p>}
      </CardBody>
    </Card>
  );
}

function Responses({ ev }: { ev: EventItem }) {
  const consent = ev.consentRequired;
  const c = ev.counts;
  const ls = useListState({ pageSize: 25 });
  const response = ls.get('answer') as '' | (typeof EVENT_RESPONSES)[number] | 'pending';
  const sectionId = ls.get('section');
  const sections = useSectionList();
  const query = { page: ls.page, pageSize: ls.pageSize, q: ls.q || undefined, response: response || undefined, sectionId: sectionId || undefined };
  const q = useEventResponses(ev.id, query);
  const [exporting, setExporting] = React.useState(false);

  const chart = c ? (consent ? [{ answer: 'Consent given', n: c.consentGiven }, { answer: 'Consent refused', n: c.consentDenied }, { answer: 'No answer yet', n: c.pending }] : [{ answer: 'Going', n: c.going }, { answer: 'Not going', n: c.notGoing }, { answer: 'No answer yet', n: c.pending }]) : [];
  const yes = c ? (consent ? c.consentGiven : c.going) : 0;
  const options = (consent ? ['consent_given', 'consent_denied'] : ['going', 'not_going']).concat('pending');

  const exportCsv = async () => {
    setExporting(true);
    const id = toast.loading('Preparing the list…');
    try {
      let all: EventResponseRow[] = [];
      for (let page = 1; page <= 50; page++) {
        const r = await bff<Paged<EventResponseRow>>(`/events/${ev.id}/responses`, { query: { ...query, page, pageSize: 100 } });
        all = all.concat(r.data);
        if (page >= r.meta.totalPages) break;
      }
      downloadCsv(`responses-${todayIso()}.csv`, toCsv(['Admission no', 'Student', 'Grade', 'Section', 'Response', 'Note', 'Answered by', 'Answered at'], all.map((r) => [r.admissionNo, r.studentName, r.grade, r.section, r.response ? (RESP_LABEL[r.response] ?? r.response) : 'No answer yet', r.note, r.respondedBy, r.respondedAt ?? ''])));
      toast.success('List downloaded', { id, description: `${all.length.toLocaleString()} children` });
    } catch (e) {
      toast.error('Couldn’t prepare the list', { id, description: friendlyError(e), duration: 8000 });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      {ev.status === 'draft' && <Banner tone="info">Answers open once the event is published.</Banner>}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Children invited" value={c?.eligible} />
        <StatTile label={consent ? 'Consent given' : 'Going'} value={c ? yes : undefined} hint={c && c.eligible ? `${Math.round((yes / c.eligible) * 100)}% of invited` : undefined} />
        <StatTile label={consent ? 'Consent refused' : 'Not going'} value={c ? (consent ? c.consentDenied : c.notGoing) : undefined} />
        <StatTile label="No answer yet" value={c?.pending} hint={c?.capacity ? `${c.seatsLeft ?? 0} of ${c.capacity} places left` : undefined} />
      </div>
      <ChartCard
        title="Answers so far"
        height={170}
        empty={!c || c.eligible === 0}
        emptyText="Nobody is invited yet."
        summary={c ? `${yes} of ${c.eligible} children ${consent ? 'have consent' : 'are going'}; ${c.pending} have not answered.` : undefined}
        table={{ columns: [{ key: 'answer', label: 'Answer' }, { key: 'n', label: 'Children', align: 'right' }], rows: chart }}
      >
        <BarSeries data={chart} xKey="answer" yKey="n" label="Children" horizontal height={170} />
      </ChartCard>
      <section aria-labelledby="resp-h" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="resp-h" className="t-section">
            Children
          </h2>
          <Button variant="secondary" size="sm" loading={exporting} onClick={() => void exportCsv()}>
            <Download /> Download this list
          </Button>
        </div>
        <DataTable<EventResponseRow>
          id="comm-event-responses"
          caption="Responses"
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
              <SearchBox value={ls.qInput} onChange={ls.setQInput} placeholder="Search child" />
              <FilterSelect label="Answer" value={response} onChange={(v) => ls.set({ answer: v })} options={options.map((o) => ({ value: o, label: RESP_LABEL[o] ?? o }))} />
              <FilterSelect label="Class" value={sectionId} onChange={(v) => ls.set({ section: v })} options={(sections.data ?? []).map((s) => ({ value: s.id, label: `${s.gradeName} ${s.name}` }))} />
            </FilterBar>
          }
          empty={<EmptyState illustration="no-results" compact title="No children match" />}
          columns={[
            { id: 'name', header: 'Child', cell: (r) => (<><span className="block font-medium">{r.studentName}</span><span className="t-caption block text-ink-3">{r.admissionNo}</span></>), mobile: 'title' },
            { id: 'class', header: 'Class', cell: (r) => [r.grade, r.section].filter(Boolean).join(' ') || '—', mobile: 'sub' },
            { id: 'resp', header: 'Answer', cell: (r) => (r.response ? <Badge variant={r.response === 'going' || r.response === 'consent_given' ? 'success' : 'neutral'}>{RESP_LABEL[r.response] ?? r.response}</Badge> : <Badge variant="warning">No answer yet</Badge>), mobile: 'status' },
            { id: 'note', header: 'Note', cell: (r) => r.note ?? '—', mobile: 'detail', label: 'Note' },
            { id: 'by', header: 'Answered by', cell: (r) => r.respondedBy ?? '—', defaultHidden: true, mobile: 'hide' },
            { id: 'at', header: 'When', cell: (r) => (r.respondedAt ? fmtDateTime(r.respondedAt) : '—'), mobile: 'hide' },
          ]}
        />
      </section>
    </div>
  );
}
