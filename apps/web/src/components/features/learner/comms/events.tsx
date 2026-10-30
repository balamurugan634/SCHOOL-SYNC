'use client';

import * as React from 'react';
import { Check, Clock3, MapPin, Users } from 'lucide-react';
import { eventRespondBody, type EventChildResponse, type EventItem, type EventResponse } from '@school-sync/shared';
import { cn } from '@/lib/cn';
import { errorMessage } from '@/lib/problem';
import { fmtClock, todayIso } from '@/lib/format';
import { useEvent, useEvents, useRespondEvent } from '@/lib/client/learner-comms';
import { Badge } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Drawer, DrawerContent, SheetBody } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toaster';
import { JoinCard, JoinFor } from '../../online-meeting/online-meeting';
import { ErrorState, SkeletonRows } from '../states';
import { useGates, useLearner } from '../use-learner';
import { usePageParam, useUrlParams } from '../url-state';
import { fmtSpan, fmtWhen, isoDate, Pager, Segmented } from './common';
import { EVENT_KIND_OPTIONS, kindMeta } from './kinds';

const PAGE_SIZE = 10;

const RESPONSE_LABEL: Record<EventResponse, string> = { going: 'Going', not_going: 'Not going', consent_given: 'Consent given', consent_denied: 'Consent declined' };

const yesterday = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return isoDate(d);
};

const timeRange = (e: Pick<EventItem, 'allDay' | 'startTime' | 'endTime'>): string | null => (e.allDay || !e.startTime ? (e.allDay ? 'All day' : null) : e.endTime ? `${fmtClock(e.startTime)} – ${fmtClock(e.endTime)}` : fmtClock(e.startTime));

/** What the family still has to do for an event, as a list chip. */
function ResponseChip({ e }: { e: EventItem }) {
  if (e.status === 'cancelled') return <Badge variant="neutral">Cancelled</Badge>;
  if (e.children.length === 0) return null;
  const answered = e.children.filter((c) => c.response);
  if (answered.length === 0) return e.responseOpen ? <Badge variant="warning" icon={<Clock3 aria-hidden />}>{e.consentRequired ? 'Consent needed' : 'Reply needed'}</Badge> : <Badge variant="neutral">No reply</Badge>;
  if (answered.length < e.children.length) return <Badge variant="warning">{answered.length} of {e.children.length} answered</Badge>;
  const first = answered[0]!.response as EventResponse;
  return <Badge variant={first === 'going' || first === 'consent_given' ? 'success' : 'neutral'} icon={<Check aria-hidden />}>{e.children.length > 1 ? 'All answered' : RESPONSE_LABEL[first]}</Badge>;
}

/** Events list (GET /events): upcoming or past, by kind; the detail and the reply live in a drawer (`?open=<id>`). */
export function EventsPanel() {
  const { get, set } = useUrlParams();
  const [page, setPage] = usePageParam();
  const when = get('when') === 'past' ? 'past' : 'upcoming';
  const kind = get('kind') ?? 'all';
  const open = get('open');
  const q = useEvents({ page, pageSize: PAGE_SIZE, kind: kind === 'all' ? undefined : kind, when, pastTo: yesterday() });
  const filtered = kind !== 'all';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented label="When" value={when} onChange={(v) => set({ when: v === 'past' ? 'past' : null, page: null })} options={[{ value: 'upcoming', label: 'Upcoming' }, { value: 'past', label: 'Past' }]} />
        <Select aria-label="Kind of event" className="w-52" value={kind} onValueChange={(v) => set({ kind: v === 'all' ? null : v, page: null })} options={EVENT_KIND_OPTIONS} />
      </div>
      <Card className="overflow-hidden">
        {q.isPending ? (
          <SkeletonRows rows={5} />
        ) : q.isError && !q.data ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : q.data && q.data.data.length === 0 ? (
          filtered ? (
            <EmptyState illustration="no-results" title="No events match" filters={<Badge variant="outline">{EVENT_KIND_OPTIONS.find((o) => o.value === kind)?.label}</Badge>} action={<Button variant="secondary" size="sm" onClick={() => set({ kind: null, page: null })}>Clear filters</Button>} />
          ) : (
            <EmptyState illustration="empty-events" title={when === 'past' ? 'No past events' : 'No upcoming events'} description={when === 'past' ? 'Events that have finished will be listed here.' : 'When the school plans an event, holiday or trip it will appear here.'} />
          )
        ) : (
          <>
            <ul className="divide-y divide-border" aria-busy={q.isFetching || undefined}>
              {q.data?.data.map((e) => {
                const k = kindMeta(e.kind);
                const d = new Date(`${e.startDate}T00:00:00`);
                return (
                  <li key={e.id}>
                    <button type="button" onClick={() => set({ open: e.id }, { push: true })} className="tr-colors flex w-full items-start gap-4 px-5 py-4 text-left hover:bg-surface-subtle max-sm:px-4">
                      <span className="grid w-12 shrink-0 place-items-center rounded-md border border-border bg-surface-subtle py-1.5 text-center" aria-hidden>
                        <span className="t-caption text-ink-2">{new Intl.DateTimeFormat(undefined, { month: 'short' }).format(d)}</span>
                        <span className="figure text-xl leading-6">{d.getDate()}</span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className={cn('text-sm font-semibold', e.status === 'cancelled' && 'text-ink-2 line-through')}>{e.title}</span>
                          <Badge className={k.chip} icon={<k.icon aria-hidden />}>{k.label}</Badge>
                          <ResponseChip e={e} />
                        </span>
                        <span className="t-caption mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-ink-2">
                          <span>{fmtSpan(e.startDate, e.endDate)}</span>
                          {timeRange(e) && <span>{timeRange(e)}</span>}
                          {e.location && (
                            <span className="inline-flex items-center gap-1">
                              <MapPin className="size-3" aria-hidden /> {e.location}
                            </span>
                          )}
                        </span>
                      </span>
                    </button>
                    {e.status === 'published' && e.onlineMeeting?.status === 'scheduled' && (
                      <div className="pb-3.5 pl-[5.25rem] pr-5 max-sm:pl-20 max-sm:pr-4">
                        <JoinFor meeting={e.onlineMeeting} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            <Pager page={page} totalPages={q.data?.meta.totalPages ?? 1} total={q.data?.meta.total ?? 0} onPage={setPage} noun="events" />
          </>
        )}
      </Card>
      <EventDetailDrawer id={open} onClose={() => set({ open: null })} />
    </div>
  );
}

/** Shared by the events list and the calendar. */
export function EventDetailDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  return (
    <Drawer open={!!id} onOpenChange={(o) => !o && onClose()}>
      {id && <EventDrawerBody key={id} id={id} />}
    </Drawer>
  );
}

function closedReason(e: EventItem): string {
  if (e.status === 'cancelled') return 'This event was cancelled, so no reply is needed.';
  if (e.registrationDeadline && new Date(e.registrationDeadline).getTime() < Date.now()) return `The deadline to reply passed on ${fmtWhen(e.registrationDeadline)}.`;
  if (e.endDate < todayIso()) return 'This event is over.';
  return 'Replies are closed for this event.';
}

function EventDrawerBody({ id }: { id: string }) {
  const q = useEvent(id);
  const e = q.data;
  const k = e ? kindMeta(e.kind) : null;
  return (
    <DrawerContent title={e?.title ?? 'Event'} description={e ? `${fmtSpan(e.startDate, e.endDate)}${timeRange(e) ? ` · ${timeRange(e)}` : ''}` : 'Loading event'} showTitle>
      {q.isPending ? (
        <SheetBody>
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-32 w-full" />
        </SheetBody>
      ) : q.isError || !e || !k ? (
        <SheetBody>
          <ErrorState error={q.error} onRetry={() => void q.refetch()} compact />
        </SheetBody>
      ) : (
        <SheetBody>
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={k.chip} icon={<k.icon aria-hidden />}>{k.label}</Badge>
            {e.status === 'cancelled' && <Badge variant="neutral">Cancelled</Badge>}
          </div>
          {e.status === 'cancelled' && <Banner tone="warning">This event has been cancelled. It stays on the calendar so you can see what changed.</Banner>}
          <dl className="grid gap-x-4 gap-y-3 text-sm sm:grid-cols-[7rem_1fr]">
            <dt className="text-ink-2">When</dt>
            <dd>
              {fmtSpan(e.startDate, e.endDate)}
              {timeRange(e) ? <span className="text-ink-2"> · {timeRange(e)}</span> : null}
            </dd>
            {e.location && (
              <>
                <dt className="text-ink-2">Where</dt>
                <dd>{e.location}</dd>
              </>
            )}
            {e.registrationDeadline && (
              <>
                <dt className="text-ink-2">Reply by</dt>
                <dd>{fmtWhen(e.registrationDeadline)}</dd>
              </>
            )}
            {e.capacity !== null && (
              <>
                <dt className="text-ink-2">Places</dt>
                <dd className="inline-flex items-center gap-1.5">
                  <Users className="size-4 text-ink-3" aria-hidden /> Limited to {e.capacity.toLocaleString()}
                </dd>
              </>
            )}
          </dl>
          {e.onlineMeeting && e.status !== 'cancelled' && <JoinCard meeting={e.onlineMeeting} canEdit={false} />}
          {e.description && <p className="max-w-[68ch] whitespace-pre-wrap text-sm leading-6">{e.description}</p>}
          {e.consentRequired && e.consentText && (
            <section aria-label="Consent wording" className="rounded-lg border border-border bg-surface-subtle p-4">
              <h3 className="t-label mb-1.5">What a parent is agreeing to</h3>
              <p className="whitespace-pre-wrap text-sm leading-6 text-ink-2">{e.consentText}</p>
            </section>
          )}
          {(e.registrationRequired || e.consentRequired) && <ResponseSection e={e} />}
        </SheetBody>
      )}
    </DrawerContent>
  );
}

function ResponseSection({ e }: { e: EventItem }) {
  const l = useLearner();
  const consent = e.consentRequired;
  return (
    <section aria-label={consent ? 'Consent' : 'Registration'} className="space-y-3">
      <h3 className="t-section">{consent ? 'Permission' : 'Registration'}</h3>
      {!e.responseOpen && <Banner tone="info">{closedReason(e)}</Banner>}
      {consent && !l.isParent && (
        <Banner tone="info" title="A parent or guardian has to give permission">
          Students can’t answer permission slips themselves. Ask your parent to open this event in the parent app and respond; their answer shows here.
        </Banner>
      )}
      {e.children.length === 0 ? (
        <p className="text-sm text-ink-2">{l.isParent ? 'None of your linked children is invited to this event.' : 'You have not been asked to reply to this event.'}</p>
      ) : (
        <ul className="space-y-3">
          {e.children.map((c) => (
            <li key={c.studentId}>
              <ChildReply e={e} child={c} showName={l.isParent && e.children.length > 0} readOnlyForStudent={consent && !l.isParent} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ChildReply({ e, child, showName, readOnlyForStudent }: { e: EventItem; child: EventChildResponse; showName: boolean; readOnlyForStudent: boolean }) {
  const respond = useRespondEvent(e.id);
  const { readOnly } = useGates();
  const [note, setNote] = React.useState(child.note ?? '');
  const [noteError, setNoteError] = React.useState<string | null>(null);
  const options: { value: EventResponse; label: string }[] = e.consentRequired
    ? [{ value: 'consent_given', label: 'Give permission' }, { value: 'consent_denied', label: 'Do not allow' }]
    : [{ value: 'going', label: 'Going' }, { value: 'not_going', label: 'Not going' }];
  const canAnswer = e.responseOpen && !readOnly && !readOnlyForStudent;

  const send = async (response: EventResponse) => {
    const parsed = eventRespondBody.safeParse({ studentId: child.studentId, response, note: note.trim() || undefined });
    if (!parsed.success) {
      setNoteError(parsed.error.issues[0]?.message ?? 'Check the note and try again.');
      return;
    }
    setNoteError(null);
    try {
      await respond.mutateAsync(parsed.data);
      toast.success(response === 'going' ? 'You’re registered' : response === 'not_going' ? 'Reply saved — not going' : response === 'consent_given' ? 'Permission given' : 'Permission declined');
    } catch (err) {
      toast.error(errorMessage(err), { duration: 8000 });
    }
  };

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">{showName ? child.studentName : 'Your reply'}</p>
        {child.response ? <Badge variant={child.response === 'going' || child.response === 'consent_given' ? 'success' : 'neutral'} icon={<Check aria-hidden />}>{RESPONSE_LABEL[child.response]}</Badge> : <Badge variant="warning" icon={<Clock3 aria-hidden />}>{readOnlyForStudent ? 'Waiting for your parent' : 'Not answered yet'}</Badge>}
      </div>
      {child.respondedAt && <p className="t-caption mt-1 text-ink-3">Answered {fmtWhen(child.respondedAt)}</p>}
      {child.note && !canAnswer && <p className="t-caption mt-1 text-ink-2">Note: {child.note}</p>}
      {!readOnlyForStudent && (
        <>
          <div role="group" aria-label={`Reply for ${child.studentName}`} className="mt-3 flex flex-wrap gap-2">
            {options.map((o) => (
              <Button key={o.value} type="button" variant={child.response === o.value ? 'primary' : 'secondary'} aria-pressed={child.response === o.value} disabled={!canAnswer || respond.isPending} onClick={() => (child.response !== o.value || note.trim() !== (child.note ?? '')) && void send(o.value)} className="max-sm:flex-1">
                {child.response === o.value && <Check />} {o.label}
              </Button>
            ))}
          </div>
          {canAnswer && (
            <Field label="Note for the school (optional)" htmlFor={`note-${child.studentId}`} error={noteError} className="mt-3" hint={`Sent with your answer — tap it again to update the note. ${note.length}/500`}>
              <Textarea id={`note-${child.studentId}`} value={note} maxLength={500} rows={2} onChange={(ev) => setNote(ev.target.value)} className="min-h-16" />
            </Field>
          )}
          {readOnly && <p className="t-caption mt-2 text-ink-2">The school is in read-only mode, so replies are switched off for now.</p>}
        </>
      )}
    </div>
  );
}
