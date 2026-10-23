'use client';

import * as React from 'react';
import { Ban, CalendarDays, CheckCircle2, MapPin, Pencil, Plus, Send, Trash2, Users } from 'lucide-react';
import { Controller } from 'react-hook-form';
import { eventCreateBody, EVENT_KINDS, type CalendarItem, type EventCreateBody, type EventItem, type EventUpdateBody } from '@school-sync/shared';
import { cn } from '@/lib/cn';
import { fmtClock, fmtDate, fmtDateTime, todayIso } from '@/lib/format';
import { applyApiErrors, useZodForm } from '@/lib/client/use-zod-form';
import { useUnsavedGuard } from '@/lib/client/use-unsaved-guard';
import { commsError } from '@/lib/client/teacher-comms';
import { isOutOfScope } from '@/lib/client/teacher-errors';
import { useCalendar, useDeleteEvent, useEvent, useEventAction, useEventResponses, useEvents, useSaveEvent } from '@/lib/client/teacher-comms';
import { usePermissions } from '@/components/me-context';
import { Badge, StatusChip } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Drawer, DrawerContent, SheetBody, SheetFooter } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, Input } from '@/components/ui/input';
import { ProgressBar } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { FormCheckbox, FormDate, FormInput, FormSection, FormSelect } from '@/components/ui/form';
import { toast } from '@/components/ui/toaster';
import { CardListSkeleton, ErrorCard, FilterSelect, Meta, useUrlState, useWriteGate } from '../common';
import { AudiencePicker, ClearableDateTime, DrawerSection, NullableInput, NullableTextarea, Pager } from './fields';

/* ───────────────────────── helpers ───────────────────────── */

const KIND_LABEL: Record<string, string> = { holiday: 'Holiday', event: 'Event', exam: 'Exam', ptm: 'Parent meeting day', sports: 'Sports', other: 'Other' };
/** Teachers organise class events; holidays and exam schedules are the office's. */
const TEACHER_KINDS = EVENT_KINDS.filter((k) => k === 'event' || k === 'sports' || k === 'ptm' || k === 'other');
const RESPONSE_LABEL: Record<string, string> = { going: 'Going', not_going: 'Not going', consent_given: 'Consent given', consent_denied: 'Consent denied', pending: 'No answer yet' };
const RESPONSE_VARIANT: Record<string, React.ComponentProps<typeof Badge>['variant']> = { going: 'success', consent_given: 'success', not_going: 'neutral', consent_denied: 'danger' };

const isoPlus = (iso: string, days: number): string => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const monthBounds = (iso: string): { from: string; to: string } => {
  const [y, m] = iso.split('-').map(Number) as [number, number];
  const last = new Date(y, m, 0).getDate();
  return { from: `${iso.slice(0, 7)}-01`, to: `${iso.slice(0, 7)}-${String(last).padStart(2, '0')}` };
};

const dateSpan = (e: Pick<EventItem, 'startDate' | 'endDate'>) =>
  e.endDate !== e.startDate ? `${fmtDate(e.startDate, { day: 'numeric', month: 'short' })} – ${fmtDate(e.endDate, { day: 'numeric', month: 'short', year: 'numeric' })}` : fmtDate(e.startDate, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const timeText = (e: Pick<EventItem, 'allDay' | 'startTime' | 'endTime'>) => (e.allDay ? 'All day' : [e.startTime && fmtClock(e.startTime), e.endTime && fmtClock(e.endTime)].filter(Boolean).join(' – ') || 'Time to be confirmed');

const RANGES = [
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'month', label: 'This month' },
  { value: 'past', label: 'Past events' },
];

/* ───────────────────────── screen ───────────────────────── */

const PAGE_SIZE = 20;

export function EventsScreen() {
  const url = useUrlState();
  const { can } = usePermissions();
  const gate = useWriteGate();
  const range = url.get('range', 'upcoming');
  const kind = url.get('kind');
  const page = url.num('page', 1);
  const viewId = url.get('view') || null;
  const edit = url.get('edit') || null;
  const today = todayIso();
  const [dirty, setDirty] = React.useState(false);
  const { guard, dialog } = useUnsavedGuard(dirty, { title: 'Discard this event?', description: 'You have changes that have not been saved. If you close now they will be lost.', confirmLabel: 'Discard changes' });

  const bounds = range === 'month' ? monthBounds(today) : range === 'past' ? { from: isoPlus(today, -365), to: isoPlus(today, -1) } : { from: today, to: undefined };
  const list = useEvents({ from: bounds.from, to: bounds.to, kind, page, pageSize: PAGE_SIZE });
  const canCreate = can('events:create');

  const groups = React.useMemo(() => {
    const rows = [...(list.data?.data ?? [])].sort((a, b) => (range === 'past' ? -1 : 1) * (`${a.startDate}${a.startTime ?? ''}`.localeCompare(`${b.startDate}${b.startTime ?? ''}`)));
    const m = new Map<string, EventItem[]>();
    for (const e of rows) m.set(e.startDate, [...(m.get(e.startDate) ?? []), e]);
    return [...m.entries()];
  }, [list.data, range]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <FilterSelect label="Period" value={range === 'upcoming' ? '' : range} onChange={(v) => url.set({ range: v || null })} allLabel="Upcoming" options={RANGES.filter((r) => r.value !== 'upcoming')} />
          <FilterSelect label="Kind" value={kind} onChange={(v) => url.set({ kind: v })} allLabel="All kinds" options={EVENT_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k]! }))} />
        </div>
        {canCreate && (
          <Button onClick={() => url.set({ edit: 'new', view: null }, { keepPage: true })} disabled={gate.readOnly} title={gate.reason}>
            <Plus /> New event
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          {list.isPending ? (
            <CardListSkeleton rows={4} />
          ) : list.isError ? (
            <ErrorCard error={list.error} onRetry={() => void list.refetch()} title="We couldn’t load events" />
          ) : groups.length === 0 ? (
            <Card>
              <EmptyState
                illustration="empty-events"
                title={kind ? 'No events of that kind' : range === 'past' ? 'No past events' : 'Nothing on the calendar'}
                description={kind ? 'Try another kind or period.' : range === 'past' ? 'Events from the last year appear here.' : 'Upcoming events and holidays for your classes will show here.'}
                action={
                  kind ? (
                    <Button variant="secondary" size="sm" onClick={() => url.set({ kind: null })}>Clear filter</Button>
                  ) : canCreate ? (
                    <Button onClick={() => url.set({ edit: 'new' }, { keepPage: true })}><Plus /> New event</Button>
                  ) : undefined
                }
              />
            </Card>
          ) : (
            <>
              <div className="space-y-5">
                {groups.map(([date, items]) => (
                  <section key={date} aria-labelledby={`d-${date}`}>
                    <h2 id={`d-${date}`} className={cn('t-label mb-2 flex items-center gap-2', date === today ? 'text-accent-ink' : 'text-ink-2')}>
                      {fmtDate(date, { weekday: 'long', day: 'numeric', month: 'long' })}
                      {date === today && <Badge variant="accent">Today</Badge>}
                    </h2>
                    <ul className="space-y-2">
                      {items.map((e) => (
                        <li key={e.id}>
                          <EventRow e={e} onOpen={() => url.set({ view: e.id }, { keepPage: true })} />
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
              <Pager page={page} pageSize={PAGE_SIZE} total={list.data.meta.total} onPage={(p) => url.set({ page: p }, { keepPage: true })} noun="events" />
            </>
          )}
        </div>
        <aside aria-label="Coming up in your classes">
          <ClassWork />
        </aside>
      </div>

      <Drawer open={!!viewId && !edit} onOpenChange={(o) => !o && url.set({ view: null }, { keepPage: true })}>
        <DrawerContent title="Event" description="Details, responses and actions" showTitle>
          {viewId && <EventDetail key={viewId} id={viewId} onEdit={() => url.set({ edit: viewId, view: null }, { keepPage: true })} onGone={() => url.set({ view: null }, { keepPage: true })} />}
        </DrawerContent>
      </Drawer>

      <Drawer open={!!edit} onOpenChange={(o) => !o && guard(() => { setDirty(false); url.set({ edit: null }, { keepPage: true }); })}>
        <DrawerContent title={edit === 'new' ? 'New event' : 'Edit event'} description="An event for the classes you teach or lead" showTitle onInteractOutside={(e) => dirty && e.preventDefault()}>
          {edit && (
            <EventFormLoader
              key={edit}
              id={edit === 'new' ? null : edit}
              onDirtyChange={setDirty}
              onCancel={() => guard(() => { setDirty(false); url.set({ edit: null, view: edit === 'new' ? null : edit }, { keepPage: true }); })}
              onDone={(id) => {
                setDirty(false);
                url.set({ edit: null, view: id }, { keepPage: true });
              }}
            />
          )}
        </DrawerContent>
      </Drawer>
      {dialog}
    </div>
  );
}

function EventRow({ e, onOpen }: { e: EventItem; onOpen: () => void }) {
  return (
    <Card interactive className={cn(e.status === 'cancelled' && 'opacity-70')}>
      <button type="button" onClick={onOpen} className="flex w-full items-start gap-3 rounded-lg p-4 text-left max-sm:p-3">
        <div className="w-[88px] shrink-0 text-[13px] text-ink-2 tnum">{timeText(e)}</div>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="flex flex-wrap items-center gap-2">
            <span className={cn('text-sm font-medium', e.status === 'cancelled' && 'line-through')}>{e.title}</span>
            <Badge variant="outline">{KIND_LABEL[e.kind] ?? e.kind}</Badge>
            {e.status !== 'published' && <StatusChip status={e.status} />}
            {e.consentRequired && <Badge variant="neutral">Permission slip</Badge>}
            {e.registrationRequired && <Badge variant="neutral">Registration</Badge>}
          </p>
          {(e.location || e.endDate !== e.startDate) && (
            <p className="t-caption flex flex-wrap items-center gap-x-3 gap-y-0.5 text-ink-2">
              {e.endDate !== e.startDate && <span>{dateSpan(e)}</span>}
              {e.location && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-3.5" aria-hidden /> {e.location}
                </span>
              )}
            </p>
          )}
        </div>
      </button>
    </Card>
  );
}

/** Homework due dates and exam papers for my classes over the next 30 days (events themselves are the list on the left). */
function ClassWork() {
  const today = todayIso();
  const cal = useCalendar(today, isoPlus(today, 30));
  const items = (cal.data ?? []).filter((c: CalendarItem) => c.kind === 'homework_due' || c.kind === 'exam_paper');
  const shown = items.slice(0, 8);
  return (
    <Card>
      <CardHeader title="Due and exam days" description="Next 30 days, from your calendar" />
      <CardBody className="pt-3">
        {cal.isPending ? (
          <div className="space-y-3" aria-busy>
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : cal.isError ? (
          <ErrorCard error={cal.error} onRetry={() => void cal.refetch()} title="We couldn’t load the calendar" className="border-0 shadow-none" />
        ) : shown.length === 0 ? (
          <p className="text-sm text-ink-2">No homework deadlines or exam papers in the next 30 days.</p>
        ) : (
          <ul className="divide-y divide-border">
            {shown.map((c) => (
              <li key={c.id} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
                <CalendarDays className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{c.title}</p>
                  <p className="t-caption text-ink-2">
                    {fmtDate(c.date, { weekday: 'short', day: 'numeric', month: 'short' })}
                    {c.startTime ? `, ${fmtClock(c.startTime)}` : ''}
                    {c.subtitle ? ` · ${c.subtitle}` : ''}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
        {items.length > shown.length && <p className="t-caption mt-3 text-ink-3">+ {items.length - shown.length} more</p>}
      </CardBody>
    </Card>
  );
}

/* ───────────────────────── detail ───────────────────────── */

function EventDetail({ id, onEdit, onGone }: { id: string; onEdit: () => void; onGone: () => void }) {
  const q = useEvent(id);
  const e = q.data;
  const { can } = usePermissions();
  const gate = useWriteGate();
  const act = useEventAction();
  const del = useDeleteEvent();
  const [confirm, setConfirm] = React.useState<'publish' | 'cancel' | 'delete' | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  if (q.isPending)
    return (
      <SheetBody>
        <Skeleton className="h-7 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-32 w-full" />
      </SheetBody>
    );
  if (q.isError || !e)
    return (
      <SheetBody>
        <ErrorCard error={q.error} onRetry={isOutOfScope(q.error) ? undefined : () => void q.refetch()} title={isOutOfScope(q.error) ? 'This event isn’t available to you' : 'We couldn’t open this event'} />
        <Button variant="secondary" onClick={onGone}>Close</Button>
      </SheetBody>
    );

  const run = async (fn: () => Promise<unknown>, ok: string): Promise<boolean> => {
    setErr(null);
    try {
      await fn();
      toast.success(ok);
      setConfirm(null);
      return true;
    } catch (x) {
      const m = commsError(x);
      setErr(m);
      setConfirm(null);
      toast.error(m, { duration: 8000 });
      return false;
    }
  };
  const busy = act.isPending || del.isPending;
  const disabled = gate.readOnly || busy;
  const cancelled = e.status === 'cancelled';
  const canEdit = e.canManage && !cancelled && can('events:edit');
  const canPublish = e.canManage && e.status === 'draft' && can('events:publish');
  const canCancel = e.canManage && e.status === 'published' && can('events:edit');
  const canDelete = e.canManage && e.status === 'draft';
  const c = e.counts;
  const answered = c ? c.going + c.notGoing + c.consentGiven + c.consentDenied : 0;
  const asks = e.registrationRequired || e.consentRequired;

  return (
    <>
      <SheetBody>
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{KIND_LABEL[e.kind] ?? e.kind}</Badge>
            <StatusChip status={e.status} />
            {e.consentRequired && <Badge variant="neutral">Permission slip</Badge>}
            {e.registrationRequired && <Badge variant="neutral">Registration</Badge>}
          </div>
          <h2 className={cn('font-display text-xl leading-7', cancelled && 'line-through')}>{e.title}</h2>
        </div>
        {err && <Banner tone="danger" onDismiss={() => setErr(null)}>{err}</Banner>}
        {cancelled && <Banner tone="warning" title="This event was cancelled">It stays on the calendar as cancelled, and its audience has been told.</Banner>}
        {gate.readOnly && e.canManage && <Banner tone="locked">{gate.reason}</Banner>}

        <Meta
          items={[
            { label: 'When', value: <>{dateSpan(e)}<br />{timeText(e)}</> },
            { label: 'Where', value: e.location ?? 'Not set' },
            { label: 'Answer by', value: e.registrationDeadline ? fmtDateTime(e.registrationDeadline) : null, hidden: !asks },
            { label: 'Places', value: e.capacity ? `${e.capacity}` : 'No limit', hidden: !asks },
            { label: 'For', value: e.audience.length ? e.audience.map((a) => a.label).join(', ') : 'Everyone it is addressed to', hidden: !e.canManage },
          ]}
        />
        {e.description && <p className="whitespace-pre-wrap text-sm leading-6">{e.description}</p>}
        {e.consentText && (
          <div className="rounded-lg border border-border bg-surface-subtle p-3">
            <p className="t-caption mb-1 font-medium text-ink-2">Permission wording parents agree to</p>
            <p className="whitespace-pre-wrap text-sm">{e.consentText}</p>
          </div>
        )}

        {e.canManage && c && asks && (
          <DrawerSection title="Responses">
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                ['Eligible', c.eligible],
                ['Answered', answered],
                ['Waiting', c.pending],
              ].map(([l, v]) => (
                <div key={l as string} className="rounded-lg border border-border bg-surface p-2.5">
                  <p className="figure text-2xl leading-8">{v}</p>
                  <p className="t-caption text-ink-2">{l}</p>
                </div>
              ))}
            </div>
            <ProgressBar value={answered} max={Math.max(c.eligible, 1)} label="Share of students whose family has answered" />
            <p className="t-caption text-ink-2">
              {e.registrationRequired && `${c.going} going · ${c.notGoing} not going`}
              {e.registrationRequired && e.consentRequired && ' · '}
              {e.consentRequired && `${c.consentGiven} consent given · ${c.consentDenied} denied`}
              {c.seatsLeft !== null && ` · ${c.seatsLeft} places left`}
            </p>
            <Responses id={e.id} registration={e.registrationRequired} consent={e.consentRequired} />
          </DrawerSection>
        )}
        {e.canManage && c && !asks && (
          <p className="t-caption flex items-center gap-1.5 text-ink-2">
            <Users className="size-3.5" aria-hidden /> This event reaches {c.eligible} students. It does not ask for a response.
          </p>
        )}
      </SheetBody>

      {e.canManage && (
        <SheetFooter>
          {canDelete && (
            <Button variant="danger" onClick={() => setConfirm('delete')} disabled={disabled}>
              <Trash2 /> Delete
            </Button>
          )}
          <span className="flex-1" />
          {canCancel && (
            <Button variant="secondary" onClick={() => setConfirm('cancel')} disabled={disabled}>
              <Ban /> Cancel event
            </Button>
          )}
          {canEdit && (
            <Button variant="secondary" onClick={onEdit} disabled={disabled}>
              <Pencil /> Edit
            </Button>
          )}
          {canPublish && (
            <Button onClick={() => setConfirm('publish')} disabled={disabled}>
              <Send /> Publish
            </Button>
          )}
        </SheetFooter>
      )}

      {confirm === 'publish' && (
        <ConfirmDialog open onOpenChange={(o) => !o && setConfirm(null)} title="Publish this event?" description={<>“{e.title}” is shown on the calendar of {e.audience.map((a) => a.label).join(', ') || 'the selected classes'}, and their students and guardians are notified.</>} confirmLabel="Publish event" loading={busy} onConfirm={() => void run(() => act.mutateAsync({ id: e.id, action: 'publish' }), 'Event published')} />
      )}
      {confirm === 'cancel' && (
        <ConfirmDialog open onOpenChange={(o) => !o && setConfirm(null)} title="Cancel this event?" description={<>“{e.title}” stays on the calendar marked as cancelled, and its audience is notified. You can’t undo this.</>} confirmLabel="Cancel event" cancelLabel="Keep event" destructive loading={busy} onConfirm={() => void run(() => act.mutateAsync({ id: e.id, action: 'cancel' }), 'Event cancelled')} />
      )}
      {confirm === 'delete' && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setConfirm(null)}
          title="Delete this draft?"
          description={<>“{e.title}” has not been published. Deleting it can’t be undone.</>}
          confirmLabel="Delete draft"
          destructive
          loading={busy}
          onConfirm={() => void run(() => del.mutateAsync(e.id), 'Draft deleted').then((ok) => ok && onGone())}
        />
      )}
    </>
  );
}

function Responses({ id, registration, consent }: { id: string; registration: boolean; consent: boolean }) {
  const [response, setResponse] = React.useState('');
  const [page, setPage] = React.useState(1);
  const r = useEventResponses(id, { response, page, pageSize: 8 }, true);
  const opts = [
    { value: 'pending', label: RESPONSE_LABEL.pending! },
    ...(registration ? [{ value: 'going', label: 'Going' }, { value: 'not_going', label: 'Not going' }] : []),
    ...(consent ? [{ value: 'consent_given', label: 'Consent given' }, { value: 'consent_denied', label: 'Consent denied' }] : []),
  ];
  return (
    <div className="space-y-3">
      <FilterSelect label="Show students" value={response} onChange={(v) => { setResponse(v); setPage(1); }} allLabel="All students" options={opts} />
      {r.isPending ? (
        <CardListSkeleton rows={3} />
      ) : r.isError ? (
        <ErrorCard error={r.error} onRetry={() => void r.refetch()} title="We couldn’t load responses" />
      ) : r.data.data.length === 0 ? (
        <p className="rounded-md border border-border bg-surface-subtle px-3 py-4 text-center text-sm text-ink-2">No students match.</p>
      ) : (
        <>
          <ul className="divide-y divide-border rounded-md border border-border" aria-label="Responses">
            {r.data.data.map((s) => (
              <li key={s.studentId} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{s.studentName}</p>
                  <p className="t-caption truncate text-ink-3">{[s.grade, s.section].filter(Boolean).join(' ')} · {s.admissionNo}</p>
                  {s.note && <p className="t-caption mt-0.5 text-ink-2">“{s.note}”</p>}
                </div>
                <div className="shrink-0 text-right">
                  {s.response ? <Badge variant={RESPONSE_VARIANT[s.response] ?? 'neutral'}>{RESPONSE_LABEL[s.response]}</Badge> : <Badge variant="warning-outline">No answer</Badge>}
                  {s.respondedAt && <p className="t-caption mt-0.5 text-ink-3">{fmtDateTime(s.respondedAt)}</p>}
                </div>
              </li>
            ))}
          </ul>
          <Pager page={page} pageSize={8} total={r.data.meta.total} onPage={setPage} noun="students" />
        </>
      )}
    </div>
  );
}

/* ───────────────────────── form ───────────────────────── */

function EventFormLoader({ id, onDone, onCancel, onDirtyChange }: { id: string | null; onDone: (id: string) => void; onCancel: () => void; onDirtyChange: (d: boolean) => void }) {
  const q = useEvent(id);
  const { can } = usePermissions();
  if (!id && !can('events:create'))
    return (
      <SheetBody>
        <Banner tone="warning" title="You can’t create events">Your role doesn’t include organising events. Ask the school office if that looks wrong.</Banner>
        <Button variant="secondary" onClick={onCancel}>Back</Button>
      </SheetBody>
    );
  if (id && q.isPending)
    return (
      <SheetBody>
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-40 w-full" />
      </SheetBody>
    );
  if (id && (q.isError || !q.data))
    return (
      <SheetBody>
        <ErrorCard error={q.error} onRetry={isOutOfScope(q.error) ? undefined : () => void q.refetch()} title={isOutOfScope(q.error) ? 'This event isn’t available to you' : 'We couldn’t open this event'} />
      </SheetBody>
    );
  if (id && q.data && (!q.data.canManage || q.data.status === 'cancelled'))
    return (
      <SheetBody>
        <Banner tone="warning" title="This event can’t be edited">{q.data.status === 'cancelled' ? 'A cancelled event can’t be edited.' : 'Only its organiser (or the school office) can edit it.'}</Banner>
        <Button variant="secondary" onClick={onCancel}>Back</Button>
      </SheetBody>
    );
  return <EventForm initial={q.data ?? null} onDone={onDone} onCancel={onCancel} onDirtyChange={onDirtyChange} />;
}

const sameAudience = (a: { type: string; id?: string | null }[], b: { type: string; id?: string | null }[]) => {
  const k = (x: { type: string; id?: string | null }[]) => x.map((i) => `${i.type}:${i.id ?? ''}`).sort().join('|');
  return k(a) === k(b);
};

function EventForm({ initial, onDone, onCancel, onDirtyChange }: { initial: EventItem | null; onDone: (id: string) => void; onCancel: () => void; onDirtyChange: (d: boolean) => void }) {
  const { can } = usePermissions();
  const gate = useWriteGate();
  const save = useSaveEvent();
  const today = todayIso();
  const initAudience = React.useMemo(() => initial?.audience.map((a) => ({ type: a.type, id: a.id })) ?? [], [initial]);
  const form = useZodForm(eventCreateBody, {
    defaultValues: {
      title: initial?.title ?? '',
      description: initial?.description ?? null,
      kind: initial?.kind ?? 'event',
      startDate: initial?.startDate ?? today,
      endDate: initial?.endDate ?? today,
      startTime: initial?.startTime ?? null,
      endTime: initial?.endTime ?? null,
      allDay: initial?.allDay ?? true,
      location: initial?.location ?? null,
      audience: initAudience,
      registrationRequired: initial?.registrationRequired ?? false,
      consentRequired: initial?.consentRequired ?? false,
      consentText: initial?.consentText ?? null,
      registrationDeadline: initial?.registrationDeadline ?? null,
      capacity: initial?.capacity ?? null,
      publish: false,
    },
  });
  const [formError, setFormError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [more, setMore] = React.useState(!!(initial?.registrationRequired || initial?.consentRequired));
  const dirty = form.formState.isDirty;
  React.useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  React.useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  const allDay = form.watch('allDay');
  const consent = form.watch('consentRequired');
  const registration = form.watch('registrationRequired');
  const asks = !!consent || !!registration;
  const canPublish = can('events:publish');
  const disabled = busy || gate.readOnly;
  const kinds = initial && !TEACHER_KINDS.includes(initial.kind as (typeof TEACHER_KINDS)[number]) ? EVENT_KINDS : TEACHER_KINDS;

  const persist = async (v: EventCreateBody, publish: boolean) => {
    setFormError(null);
    let bad = false;
    const err = (name: Parameters<typeof form.setError>[0], message: string) => {
      form.setError(name, { type: 'validate', message });
      bad = true;
    };
    const end = v.endDate ?? v.startDate;
    if (end < v.startDate) err('endDate', 'The end date can’t be before the start date.');
    if (!v.allDay && !v.startTime) err('startTime', 'Add a start time, or mark it as an all-day event.');
    if (!v.allDay && v.startTime && v.endTime && end === v.startDate && v.endTime <= v.startTime) err('endTime', 'The end time must be after the start time.');
    if (v.consentRequired && !v.consentText?.trim()) err('consentText', 'Write what parents are agreeing to.');
    if (!asks && (v.capacity != null || v.registrationDeadline)) err('capacity', 'Places and deadline only apply when you ask for registration or consent.');
    if (v.audience.length === 0) bad = true; // the picker shows its own message
    if (bad) {
      setFormError('Some details need fixing. Check the highlighted fields.');
      return;
    }
    setBusy(true);
    try {
      const body = {
        title: v.title,
        description: v.description?.trim() || null,
        kind: v.kind,
        startDate: v.startDate,
        endDate: end,
        allDay: v.allDay,
        startTime: v.allDay ? null : v.startTime,
        endTime: v.allDay ? null : v.endTime,
        location: v.location?.trim() || null,
        registrationRequired: v.registrationRequired,
        consentRequired: v.consentRequired,
        consentText: v.consentRequired ? v.consentText : null,
        registrationDeadline: asks ? v.registrationDeadline ?? null : null,
        capacity: asks ? v.capacity ?? null : null,
      };
      let r: EventItem;
      if (initial) {
        const patch: EventUpdateBody = { ...body, ...(sameAudience(v.audience, initAudience) ? {} : { audience: v.audience }) };
        r = await save.mutateAsync({ id: initial.id, body: patch });
      } else {
        r = await save.mutateAsync({ body: { ...body, audience: v.audience, publish } satisfies EventCreateBody });
      }
      toast.success(publish ? 'Event published' : initial ? 'Event updated' : 'Draft saved', { description: publish ? 'The students and guardians of your classes were notified.' : undefined });
      form.reset(v);
      onDone(r.id);
    } catch (e) {
      const m = applyApiErrors(form, e);
      setFormError(m === null ? 'Some details need fixing. Check the highlighted fields.' : commsError(e));
    } finally {
      setBusy(false);
    }
  };

  const invalid = () => setFormError('Some details need fixing. Check the highlighted fields.');
  const audienceError = form.formState.errors.audience ? 'Choose at least one class.' : null;

  return (
    <form noValidate onSubmit={(e) => e.preventDefault()}>
      <SheetBody>
        {gate.readOnly && <Banner tone="locked">{gate.reason}</Banner>}
        {formError && <Banner tone="danger" onDismiss={() => setFormError(null)}>{formError}</Banner>}
        {initial?.status === 'published' && <Banner tone="info">Changing the date, time or place of a published event notifies its audience.</Banner>}

        <FormSection title="Event">
          <FormInput control={form.control} name="title" label="Title" required maxLength={200} placeholder="e.g. Grade 6 science fair" />
          <FormSelect control={form.control} name="kind" label="Kind" options={kinds.map((k) => ({ value: k, label: KIND_LABEL[k]! }))} />
          <NullableTextarea control={form.control} name="description" label="Details" rows={4} maxLength={5000} hint="What happens, what to bring." />
          <NullableInput control={form.control} name="location" label="Where" maxLength={200} placeholder="e.g. School hall" />
        </FormSection>

        <FormSection title="When">
          <div className="grid grid-cols-2 gap-3">
            <FormDate control={form.control} name="startDate" label="Starts" required />
            <FormDate control={form.control} name="endDate" label="Ends" required />
          </div>
          <FormCheckbox control={form.control} name="allDay" label="All day" />
          {!allDay && (
            <div className="grid grid-cols-2 gap-3">
              <NullableInput control={form.control} name="startTime" label="From" type="time" required />
              <NullableInput control={form.control} name="endTime" label="Until" type="time" />
            </div>
          )}
        </FormSection>

        <Controller control={form.control} name="audience" render={({ field }) => <AudiencePicker value={field.value ?? []} onChange={field.onChange} known={initial?.audience} error={audienceError} disabled={disabled} />} />

        <div>
          <button type="button" onClick={() => setMore((m) => !m)} aria-expanded={more} className="tr-colors rounded-sm text-[13px] font-medium text-brand-ink underline-offset-4 hover:underline">
            {more ? 'Hide registration and permission options' : 'Ask for registration or permission'}
          </button>
          {more && (
            <div className="mt-3 space-y-4">
              <FormCheckbox control={form.control} name="registrationRequired" label="Families register (going or not going)" />
              <FormCheckbox control={form.control} name="consentRequired" label="Guardians give permission (a permission slip)" />
              {consent && <NullableTextarea control={form.control} name="consentText" label="Permission wording" required rows={4} maxLength={3000} hint="Guardians read and agree to this text." />}
              {asks && (
                <>
                  <Controller
                    control={form.control}
                    name="registrationDeadline"
                    render={({ field, fieldState }) => (
                      <Field label="Answer by" hint="Optional. Must be on or before the last day." error={fieldState.error?.message}>
                        <ClearableDateTime value={field.value} onChange={field.onChange} min={today} defaultTime="17:00" invalid={!!fieldState.error} disabled={disabled} clearLabel="Remove deadline" />
                      </Field>
                    )}
                  />
                  <Controller
                    control={form.control}
                    name="capacity"
                    render={({ field, fieldState }) => (
                      <Field label="Places" hint="Optional. Leave empty for no limit." error={fieldState.error?.message}>
                        <Input type="number" inputMode="numeric" min={1} max={100000} value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value === '' ? null : Number(e.target.value))} onBlur={field.onBlur} invalid={!!fieldState.error} />
                      </Field>
                    )}
                  />
                </>
              )}
            </div>
          )}
        </div>
      </SheetBody>
      <SheetFooter>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
        <span className="flex-1" />
        <Button type="button" variant={!initial && canPublish ? 'secondary' : 'primary'} loading={busy} disabled={disabled} onClick={form.handleSubmit((v) => persist(v, false), invalid)}>
          {initial ? 'Save changes' : 'Save draft'}
        </Button>
        {!initial && canPublish && (
          <Button type="button" disabled={disabled} onClick={form.handleSubmit((v) => persist(v, true), invalid)}>
            <CheckCircle2 /> Save & publish
          </Button>
        )}
      </SheetFooter>
    </form>
  );
}
