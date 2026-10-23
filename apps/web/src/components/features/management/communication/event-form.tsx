'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Controller } from 'react-hook-form';
import { z } from 'zod';
import { EVENT_KINDS, audienceTargetIn, eventCreateBody, type EventItem } from '@school-sync/shared';
import { useCreateEvent, useEventAction, useUpdateEvent } from '@/lib/client/communication';
import { friendlyError } from '@/lib/client/mgmt';
import { applyApiErrors, useZodForm } from '@/lib/client/use-zod-form';
import { useUnsavedGuard } from '@/lib/client/use-unsaved-guard';
import { todayIn } from '@/lib/zoned';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { FormCheckbox, FormDate, FormInput, FormSection, FormSelect, FormTextarea } from '@/components/ui/form';
import { toast } from '@/components/ui/toaster';
import { FormDateTime } from '../common/date-time-field';
import { GuardedButton } from '../common/guarded';
import { useMgmt } from '../common/use-mgmt';
import { AudiencePicker } from './audience-picker';

export const KIND_LABEL: Record<string, string> = { holiday: 'Holiday', event: 'Event', exam: 'Exam', ptm: 'Parent–teacher meeting', sports: 'Sports', other: 'Other' };

const timeText = z.string().regex(/^(([01]\d|2[0-3]):[0-5]\d)?$/, 'Use a time like 09:30');
const formSchema = z.object({
  title: z.string().trim().min(1, 'Give the event a title').max(200, 'Keep the title under 200 characters'),
  kind: z.enum(EVENT_KINDS),
  description: z.string().trim().max(5000),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick the start date'),
  endDate: z.string(),
  allDay: z.boolean(),
  startTime: timeText,
  endTime: timeText,
  location: z.string().trim().max(200),
  audience: z.array(audienceTargetIn).min(1, 'Choose who the event is for').max(20),
  registrationRequired: z.boolean(),
  consentRequired: z.boolean(),
  consentText: z.string().trim().max(3000),
  registrationDeadline: z.string().nullable(),
  capacity: z.string().regex(/^\d{0,6}$/, 'Whole number of children'),
});

const empty = { title: '', kind: 'event' as const, description: '', startDate: '', endDate: '', allDay: true, startTime: '', endTime: '', location: '', audience: [], registrationRequired: false, consentRequired: false, consentText: '', registrationDeadline: null, capacity: '' };

/** Create or edit an event / holiday. Save a draft, or publish (needs events:publish) to put it on calendars and notify the audience. */
export function EventForm({ event, onSaved }: { event?: EventItem; onSaved?: (e: EventItem) => void }) {
  const router = useRouter();
  const { base, tz, writeBlock, canWrite } = useMgmt();
  const isEdit = !!event;
  const create = useCreateEvent();
  const update = useUpdateEvent();
  const action = useEventAction();
  const [err, setErr] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<'save' | 'publish' | null>(null);
  const form = useZodForm(formSchema, {
    defaultValues: event
      ? { title: event.title, kind: event.kind, description: event.description ?? '', startDate: event.startDate, endDate: event.endDate, allDay: event.allDay, startTime: event.startTime ?? '', endTime: event.endTime ?? '', location: event.location ?? '', audience: event.audience.map((a) => (a.type === 'all' ? { type: a.type } : { type: a.type, id: a.id })), registrationRequired: event.registrationRequired, consentRequired: event.consentRequired, consentText: event.consentText ?? '', registrationDeadline: event.registrationDeadline, capacity: event.capacity ? String(event.capacity) : '' }
      : { ...empty, startDate: todayIn(tz), endDate: '' },
  });
  const { guard, dialog } = useUnsavedGuard(form.formState.isDirty);
  const kind = form.watch('kind');
  const allDay = form.watch('allDay');
  const reg = form.watch('registrationRequired');
  const consent = form.watch('consentRequired');
  const startDate = form.watch('startDate');
  const needsResponse = reg || consent;
  const published = event?.status === 'published';

  const run = (mode: 'save' | 'publish') =>
    form.handleSubmit(
      async (v) => {
        setErr(null);
        if (v.endDate && v.endDate < v.startDate) {
          form.setError('endDate', { message: 'The last day cannot be before the first day.' });
          return;
        }
        if (!v.allDay && !v.startTime) {
          form.setError('startTime', { message: 'Add a start time, or mark it all-day.' });
          return;
        }
        if (v.consentRequired && !v.consentText.trim()) {
          form.setError('consentText', { message: 'Write what parents are agreeing to.' });
          return;
        }
        setBusy(mode);
        try {
          const cap = v.capacity ? Number(v.capacity) : null;
          const body = {
            title: v.title,
            kind: v.kind,
            description: v.description || null,
            startDate: v.startDate,
            endDate: v.endDate || v.startDate,
            startTime: v.allDay ? null : v.startTime || null,
            endTime: v.allDay ? null : v.endTime || null,
            allDay: v.allDay,
            location: v.location || null,
            audience: v.audience,
            registrationRequired: v.registrationRequired,
            consentRequired: v.consentRequired,
            consentText: v.consentRequired ? v.consentText : null,
            registrationDeadline: needsResponse ? v.registrationDeadline : null,
            capacity: needsResponse && cap ? cap : null,
          };
          let saved: EventItem;
          if (isEdit) saved = await update.mutateAsync({ id: event.id, body });
          else saved = await create.mutateAsync(eventCreateBody.parse({ ...body, publish: false }));
          if (mode === 'publish' && saved.status === 'draft') saved = await action.mutateAsync({ id: saved.id, action: 'publish' });
          form.reset(form.getValues());
          toast.success(mode === 'publish' ? 'Event published' : isEdit ? 'Changes saved' : 'Draft saved', { description: mode === 'publish' ? 'It is on the calendar and the audience has been notified.' : published ? 'Changes to the date, time or place notify the audience.' : undefined });
          if (onSaved) onSaved(saved);
          else router.push(`${base}/communication/events/${saved.id}`);
        } catch (e) {
          setErr(applyApiErrors(form, e) ?? friendlyError(e));
        } finally {
          setBusy(null);
        }
      },
      () => setErr('Please fix the highlighted fields.'),
    )();

  return (
    <>
      <form onSubmit={(e) => e.preventDefault()} noValidate className="space-y-8">
        <FormSection title="What">
          <FormInput control={form.control} name="title" label="Title" required maxLength={200} placeholder="Annual Sports Day" />
          <div className="grid gap-4 sm:grid-cols-2">
            <FormSelect control={form.control} name="kind" label="Kind" options={EVENT_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] ?? k }))} />
            <FormInput control={form.control} name="location" label="Place" maxLength={200} placeholder="Main ground" />
          </div>
          {kind === 'holiday' && <p className="t-caption text-ink-2">Holidays show on every calendar for the people in the audience. Attendance is not expected on those days.</p>}
          <FormTextarea control={form.control} name="description" label="Details" rows={4} maxLength={5000} hint="What people should know or bring." />
        </FormSection>

        <FormSection title="When">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormDate control={form.control} name="startDate" label="First day" required />
            <FormDate control={form.control} name="endDate" label="Last day" min={startDate || undefined} hint="Leave empty for a single day." />
          </div>
          <FormCheckbox control={form.control} name="allDay" label="All day" />
          {!allDay && (
            <div className="grid gap-4 sm:grid-cols-2">
              <FormInput control={form.control} name="startTime" label="Starts at" type="time" required />
              <FormInput control={form.control} name="endTime" label="Ends at" type="time" />
            </div>
          )}
        </FormSection>

        <FormSection title="Who it is for">
          <Controller control={form.control} name="audience" render={({ field, fieldState }) => <AudiencePicker value={field.value ?? []} onChange={field.onChange} perm="events:create" initialLabels={event?.audience} error={fieldState.error?.message ?? (form.formState.errors.audience as { message?: string } | undefined)?.message ?? null} />} />
        </FormSection>

        <FormSection title="Registration and consent" description="Optional. Parents answer per child.">
          <FormCheckbox control={form.control} name="registrationRequired" label="Ask for registration" hint="Parents or students say whether each child is going." />
          <FormCheckbox control={form.control} name="consentRequired" label="Ask for parental consent" hint="Parents give or refuse permission for each child (a trip, a photo release)." />
          {consent && <FormTextarea control={form.control} name="consentText" label="What parents are agreeing to" required rows={4} maxLength={3000} />}
          {needsResponse && (
            <div className="grid gap-4 sm:grid-cols-2">
              <FormDateTime control={form.control} name="registrationDeadline" label="Answer by" tz={tz} hint="Optional. Must be on or before the last day." />
              <FormInput control={form.control} name="capacity" label="Places available" inputMode="numeric" maxLength={6} hint="Optional. Leave empty for no limit." />
            </div>
          )}
        </FormSection>

        {err && <Banner tone="danger">{err}</Banner>}
        {event?.status === 'published' && <Banner tone="info">This event is published. Changing the date, time or place notifies the audience.</Banner>}

        <div className="sticky bottom-0 -mx-1 flex flex-wrap items-center justify-end gap-2 border-t border-border bg-bg/95 px-1 py-3 backdrop-blur">
          <Button
            type="button"
            variant="ghost"
            onClick={() =>
              guard(() => {
                if (isEdit) form.reset();
                else router.push(`${base}/communication/events`);
              })
            }
          >
            {isEdit ? 'Discard changes' : 'Cancel'}
          </Button>
          <Button type="button" variant="secondary" loading={busy === 'save'} disabled={!!busy && busy !== 'save'} onClick={() => void run('save')}>
            {isEdit ? 'Save changes' : 'Save draft'}
          </Button>
          {(!isEdit || event.status === 'draft') && (
            <GuardedButton blocked={writeBlock('events:publish')} type="button" loading={busy === 'publish'} disabled={!!busy && busy !== 'publish'} onClick={() => void run('publish')}>
              Publish
            </GuardedButton>
          )}
        </div>
        {!canWrite('events:publish') && <p className="t-caption text-right text-ink-3">Your role can create events but not publish them.</p>}
      </form>
      {dialog}
    </>
  );
}
