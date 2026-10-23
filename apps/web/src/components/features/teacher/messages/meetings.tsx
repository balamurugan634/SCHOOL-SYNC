'use client';

import * as React from 'react';
import { Controller } from 'react-hook-form';
import { CalendarClock, Check, ExternalLink, MapPin, Phone, Video, X } from 'lucide-react';
import { meetingCancelBody, meetingCompleteBody, meetingConfirmBody, meetingDeclineBody, meetingRescheduleBody, MEETING_MODES, MEETING_STATUSES, type MeetingAction, type MeetingItem } from '@school-sync/shared';
import { fmtDateTime, fmtTime, todayIso } from '@/lib/format';
import { applyApiErrors, useZodForm } from '@/lib/client/use-zod-form';
import { commsError } from '@/lib/client/teacher-comms';
import { useMeetingAction, useMeetings, useUpcomingMeetings, type MeetingActionInput } from '@/lib/client/teacher-comms';
import { StatusChip } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, Input } from '@/components/ui/input';
import { StatTile } from '@/components/ui/stat-tile';
import { FormInput, FormSelect, FormTextarea } from '@/components/ui/form';
import { toast } from '@/components/ui/toaster';
import { CardListSkeleton, DateTimeField, ErrorCard, FilterSelect, useUrlState, useWriteGate } from '../common';
import { isPast, Pager } from './fields';

const PAGE_SIZE = 10;
const MODE_LABEL: Record<string, string> = { in_person: 'In person', online: 'Online', phone: 'Phone call' };
const MODE_ICON: Record<string, React.ReactNode> = { in_person: <MapPin aria-hidden />, online: <Video aria-hidden />, phone: <Phone aria-hidden /> };
const STATUS_LABEL: Record<string, string> = { requested: 'Waiting for your answer', confirmed: 'Confirmed', declined: 'Declined', completed: 'Completed', cancelled: 'Cancelled' };
const isUrl = (s: string | null) => !!s && /^https?:\/\//i.test(s);

/** Requests first, then confirmed by time, then the rest newest first (within the page the API returned). */
const rank = (m: MeetingItem) => (m.status === 'requested' ? 0 : m.status === 'confirmed' ? 1 : 2);
const byUrgency = (a: MeetingItem, b: MeetingItem) => rank(a) - rank(b) || (rank(a) === 1 ? (a.scheduledAt ?? '').localeCompare(b.scheduledAt ?? '') : b.updatedAt.localeCompare(a.updatedAt));

export function MeetingsScreen() {
  const url = useUrlState();
  const status = url.get('status');
  const page = url.num('page', 1);
  const list = useMeetings({ status, page, pageSize: PAGE_SIZE });
  const upcoming = useUpcomingMeetings();
  const [act, setAct] = React.useState<{ meeting: MeetingItem; action: MeetingAction } | null>(null);

  const rows = React.useMemo(() => [...(list.data?.data ?? [])].sort(byUrgency), [list.data]);
  const waiting = (upcoming.data ?? []).filter((m) => m.status === 'requested').length;
  const next = (upcoming.data ?? []).find((m) => m.status === 'confirmed' && m.scheduledAt);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatTile label="Waiting for your answer" value={upcoming.isPending ? undefined : waiting} state={upcoming.isPending ? 'loading' : 'ready'} hint={waiting > 0 ? 'Confirm a time or decline with a reason' : 'No requests waiting'} />
        {upcoming.isPending ? (
          <StatTile label="Next meeting" state="loading" />
        ) : (
          <StatTile
            label="Next meeting"
            value={next?.scheduledAt ? new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(next.scheduledAt)) : 'None booked'}
            hint={next?.scheduledAt ? `${fmtTime(next.scheduledAt)} · ${next.student.name}` : 'Confirmed meetings show here'}
          />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect label="Status" value={status} onChange={(v) => url.set({ status: v })} allLabel="All meetings" options={MEETING_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s]! }))} />
      </div>

      {list.isPending ? (
        <CardListSkeleton rows={4} />
      ) : list.isError ? (
        <ErrorCard error={list.error} onRetry={() => void list.refetch()} title="We couldn’t load meetings" />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            illustration="empty-events"
            title={status ? 'No meetings with that status' : 'No parent meetings yet'}
            description={status ? 'Try another status.' : 'When a guardian asks to meet you, the request shows up here for you to confirm.'}
            action={status ? <Button variant="secondary" size="sm" onClick={() => url.set({ status: null })}>Show all meetings</Button> : undefined}
          />
        </Card>
      ) : (
        <>
          <ul className="space-y-3" aria-label="Parent meetings">
            {rows.map((m) => (
              <li key={m.id}>
                <MeetingCard m={m} onAction={(action) => setAct({ meeting: m, action })} />
              </li>
            ))}
          </ul>
          <Pager page={page} pageSize={PAGE_SIZE} total={list.data.meta.total} onPage={(p) => url.set({ page: p }, { keepPage: true })} noun="meetings" />
        </>
      )}

      {act && <MeetingActionDialog key={`${act.meeting.id}-${act.action}`} meeting={act.meeting} action={act.action} onClose={() => setAct(null)} />}
    </div>
  );
}

/* ───────────────────────── card ───────────────────────── */

function MeetingCard({ m, onAction }: { m: MeetingItem; onAction: (a: MeetingAction) => void }) {
  const gate = useWriteGate();
  const has = (a: MeetingAction) => m.availableActions.includes(a);
  const when = m.scheduledAt ? fmtDateTime(m.scheduledAt) : m.proposedAt ? `Proposed ${fmtDateTime(m.proposedAt)}` : 'No time chosen yet';
  const cls = [m.student.grade, m.student.section].filter(Boolean).join(' ');
  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold">{m.student.name}</p>
            <p className="t-caption text-ink-2">
              {cls}
              {cls ? ' · ' : ''}
              {m.student.admissionNo}
              {m.guardian ? ` · with ${m.guardian.name}` : ''}
            </p>
          </div>
          <StatusChip status={m.status} />
        </div>
        <p className="text-sm">{m.topic}</p>
        <dl className="t-caption grid gap-x-6 gap-y-1 text-ink-2 sm:grid-cols-2">
          <div className="flex items-center gap-1.5">
            <dt className="sr-only">When</dt>
            <CalendarClock className="size-3.5 shrink-0" aria-hidden />
            <dd>
              {when}
              {m.scheduledAt ? ` · ${m.durationMin} min` : ''}
            </dd>
          </div>
          {(m.scheduledAt || m.locationOrLink) && (
            <div className="flex items-center gap-1.5">
              <dt className="sr-only">Where</dt>
              <span className="[&_svg]:size-3.5 [&_svg]:shrink-0">{MODE_ICON[m.mode]}</span>
              <dd className="min-w-0 truncate">
                {MODE_LABEL[m.mode]}
                {m.locationOrLink &&
                  (isUrl(m.locationOrLink) ? (
                    <>
                      {' · '}
                      <a href={m.locationOrLink} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-brand-ink underline-offset-2 hover:underline">
                        Join link <ExternalLink className="size-3" aria-hidden />
                      </a>
                    </>
                  ) : (
                    ` · ${m.locationOrLink}`
                  ))}
              </dd>
            </div>
          )}
        </dl>
        {m.outcomeNotes && (
          <p className="rounded-md bg-surface-subtle px-3 py-2 text-sm">
            <span className="t-caption block font-medium text-ink-2">{m.status === 'declined' ? 'Reason' : m.status === 'cancelled' ? 'Note' : 'Outcome'}</span>
            {m.outcomeNotes}
          </p>
        )}
        {m.availableActions.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {has('confirm') && (
              <Button size="sm" onClick={() => onAction('confirm')} disabled={gate.readOnly} title={gate.reason}>
                <Check /> Confirm a time
              </Button>
            )}
            {has('decline') && (
              <Button size="sm" variant="secondary" onClick={() => onAction('decline')} disabled={gate.readOnly} title={gate.reason}>
                Decline
              </Button>
            )}
            {has('complete') && (
              <Button size="sm" onClick={() => onAction('complete')} disabled={gate.readOnly} title={gate.reason}>
                <Check /> Mark as held
              </Button>
            )}
            {has('reschedule') && (
              <Button size="sm" variant="secondary" onClick={() => onAction('reschedule')} disabled={gate.readOnly} title={gate.reason}>
                Reschedule
              </Button>
            )}
            {has('cancel') && (
              <Button size="sm" variant="danger" onClick={() => onAction('cancel')} disabled={gate.readOnly} title={gate.reason}>
                <X /> Cancel
              </Button>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

/* ───────────────────────── action dialogs ───────────────────────── */

const TITLES: Record<MeetingAction, { title: string; description: (m: MeetingItem) => string; ok: (m: MeetingItem) => string }> = {
  confirm: { title: 'Confirm the meeting', description: (m) => `Choose when and how you will meet ${m.guardian?.name ?? 'the guardian'} about ${m.student.name}. They are notified.`, ok: (m) => `Meeting confirmed. ${m.guardian?.name ?? 'The guardian'} has been notified.` },
  reschedule: { title: 'Reschedule the meeting', description: (m) => `Move the meeting about ${m.student.name} to a new time. ${m.guardian?.name ?? 'The guardian'} is notified.`, ok: () => 'Meeting rescheduled. The guardian has been notified.' },
  decline: { title: 'Decline the request', description: (m) => `Tell ${m.guardian?.name ?? 'the guardian'} why you can’t meet about ${m.student.name}. They see this reason.`, ok: () => 'Request declined. The guardian has been notified.' },
  complete: { title: 'Mark the meeting as held', description: (m) => `Record what was discussed with ${m.guardian?.name ?? 'the guardian'} about ${m.student.name}.`, ok: () => 'Meeting recorded as completed.' },
  cancel: { title: 'Cancel the meeting', description: (m) => `The meeting about ${m.student.name} is cancelled and ${m.guardian?.name ?? 'the guardian'} is notified. You can’t undo this.`, ok: () => 'Meeting cancelled. The guardian has been notified.' },
};

function MeetingActionDialog({ meeting, action, onClose }: { meeting: MeetingItem; action: MeetingAction; onClose: () => void }) {
  const run = useMeetingAction();
  const gate = useWriteGate();
  const copy = TITLES[action];
  const [error, setError] = React.useState<string | null>(null);

  const submit = async (input: MeetingActionInput): Promise<boolean> => {
    setError(null);
    try {
      await run.mutateAsync(input);
      toast.success(copy.ok(meeting));
      onClose();
      return true;
    } catch (e) {
      setError(commsError(e));
      return false;
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !run.isPending && onClose()}>
      <DialogContent title={copy.title} description={copy.description(meeting)} size="lg">
        <div className="mt-4 space-y-4">
          {gate.readOnly && <Banner tone="locked">{gate.reason}</Banner>}
          {error && <Banner tone="danger" onDismiss={() => setError(null)}>{error}</Banner>}
          {action === 'confirm' || action === 'reschedule' ? (
            <SlotForm meeting={meeting} action={action} busy={run.isPending || gate.readOnly} onClose={onClose} onSubmit={submit} onError={setError} />
          ) : action === 'decline' ? (
            <ReasonForm kind="decline" busy={run.isPending || gate.readOnly} onClose={onClose} onSubmit={(t) => submit({ id: meeting.id, action: 'decline', body: { reason: t } })} />
          ) : action === 'complete' ? (
            <ReasonForm kind="complete" busy={run.isPending || gate.readOnly} onClose={onClose} onSubmit={(t) => submit({ id: meeting.id, action: 'complete', body: { outcomeNotes: t } })} />
          ) : (
            <ReasonForm kind="cancel" busy={run.isPending || gate.readOnly} onClose={onClose} onSubmit={(t) => submit({ id: meeting.id, action: 'cancel', body: { reason: t || undefined } })} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SlotForm({ meeting, action, busy, onClose, onSubmit, onError }: { meeting: MeetingItem; action: 'confirm' | 'reschedule'; busy: boolean; onClose: () => void; onSubmit: (i: MeetingActionInput) => Promise<boolean>; onError: (m: string | null) => void }) {
  const schema = action === 'confirm' ? meetingConfirmBody : meetingRescheduleBody;
  const form = useZodForm(schema, {
    defaultValues: {
      scheduledAt: meeting.scheduledAt ?? meeting.proposedAt ?? undefined,
      durationMin: meeting.durationMin || 15,
      mode: meeting.mode ?? 'in_person',
      locationOrLink: meeting.locationOrLink ?? '',
    },
  });
  const mode = form.watch('mode') ?? meeting.mode;
  const today = todayIso();

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={form.handleSubmit(
        async (v) => {
          onError(null);
          const link = (v.locationOrLink ?? '').trim();
          if (isPast(v.scheduledAt)) return void form.setError('scheduledAt', { type: 'validate', message: 'Pick a time in the future.' });
          if ((v.mode ?? 'in_person') === 'online' && !link) return void form.setError('locationOrLink', { type: 'validate', message: 'Add the meeting link for an online meeting.' });
          const body = { scheduledAt: v.scheduledAt, durationMin: v.durationMin, mode: v.mode, locationOrLink: link || undefined };
          try {
            await onSubmit({ id: meeting.id, action, body });
          } catch (e) {
            applyApiErrors(form, e);
          }
        },
        () => onError('Some details need fixing. Check the highlighted fields.'),
      )}
    >
      <Controller
        control={form.control}
        name="scheduledAt"
        render={({ field, fieldState }) => (
          <Field label="Date and time" required error={fieldState.error?.message} hint={meeting.proposedAt && action === 'confirm' ? `The guardian suggested ${fmtDateTime(meeting.proposedAt)}.` : undefined}>
            <DateTimeField value={field.value} onChange={(v) => field.onChange(v ?? undefined)} min={today} defaultTime="15:30" invalid={!!fieldState.error} disabled={busy} />
          </Field>
        )}
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Controller
          control={form.control}
          name="durationMin"
          render={({ field, fieldState }) => (
            <Field label="Length (minutes)" required error={fieldState.error?.message} hint="5 to 180">
              <Input type="number" inputMode="numeric" min={5} max={180} step={5} value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value === '' ? undefined : Number(e.target.value))} onBlur={field.onBlur} invalid={!!fieldState.error} />
            </Field>
          )}
        />
        <FormSelect control={form.control} name="mode" label="How" options={MEETING_MODES.map((m) => ({ value: m, label: MODE_LABEL[m]! }))} />
      </div>
      <FormInput
        control={form.control}
        name="locationOrLink"
        label={mode === 'online' ? 'Meeting link' : mode === 'phone' ? 'Number to call (optional)' : 'Room or place'}
        required={mode === 'online'}
        maxLength={300}
        placeholder={mode === 'online' ? 'https://meet.example.org/…' : mode === 'phone' ? 'e.g. the number the guardian gave' : 'e.g. Staff room 2'}
      />
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button type="submit" loading={busy}>{action === 'confirm' ? 'Confirm meeting' : 'Reschedule'}</Button>
      </div>
    </form>
  );
}

function ReasonForm({ kind, busy, onClose, onSubmit }: { kind: 'decline' | 'complete' | 'cancel'; busy: boolean; onClose: () => void; onSubmit: (text: string) => Promise<boolean> }) {
  const schema = kind === 'decline' ? meetingDeclineBody : kind === 'complete' ? meetingCompleteBody : meetingCancelBody;
  const field = kind === 'complete' ? 'outcomeNotes' : 'reason';
  const form = useZodForm(schema, { defaultValues: { [field]: '' } as never });
  const cfg = {
    decline: { label: 'Reason', required: true, hint: 'Shown to the guardian.', submit: 'Decline request', variant: 'primary' as const },
    complete: { label: 'What was discussed', required: true, hint: 'Outcome notes are kept on the meeting.', submit: 'Save as held', variant: 'primary' as const },
    cancel: { label: 'Note for the guardian (optional)', required: false, hint: undefined, submit: 'Cancel meeting', variant: 'danger-solid' as const },
  }[kind];
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={form.handleSubmit(async (v) => {
        const text = String((v as Record<string, unknown>)[field] ?? '').trim();
        await onSubmit(text);
      })}
    >
      <FormTextarea control={form.control} name={field as never} label={cfg.label} required={cfg.required} hint={cfg.hint} rows={4} maxLength={kind === 'complete' ? 3000 : 500} />
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>{kind === 'cancel' ? 'Keep meeting' : 'Close'}</Button>
        <Button type="submit" variant={cfg.variant} loading={busy}>{cfg.submit}</Button>
      </div>
    </form>
  );
}

