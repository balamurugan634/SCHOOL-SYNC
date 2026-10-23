'use client';

import * as React from 'react';
import { CalendarClock, Link2, MapPin, Phone, Plus, Users, Video } from 'lucide-react';
import { z } from 'zod';
import { meetingRequestBody, MEETING_STATUSES, type MeetingItem } from '@school-sync/shared';
import { cn } from '@/lib/cn';
import { applyApiErrors, useZodForm } from '@/lib/client/use-zod-form';
import { useUnsavedGuard } from '@/lib/client/use-unsaved-guard';
import { errorMessage } from '@/lib/problem';
import { todayIso } from '@/lib/format';
import { useCancelMeeting, useMeetings, useMeetingTeachers, useRequestMeeting, useUpcomingMeetings } from '@/lib/client/learner-comms';
import { Badge, StatusChip } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { FormDate, FormInput, FormSection, FormSelect, FormTextarea } from '@/components/ui/form';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toaster';
import { ErrorState, SkeletonRows } from '../states';
import { useGates, useLearner } from '../use-learner';
import { usePageParam, useUrlParams } from '../url-state';
import { fmtWhen, Pager } from './common';

const PAGE_SIZE = 10;
const MODE = { in_person: { label: 'In person', icon: MapPin }, online: { label: 'Online', icon: Video }, phone: { label: 'Phone call', icon: Phone } } as const;
const NOTE_LABEL: Partial<Record<MeetingItem['status'], string>> = { declined: 'Reason', cancelled: 'Note', completed: 'Outcome' };
const STATUS_OPTIONS = [{ value: 'all', label: 'All statuses' }, ...MEETING_STATUSES.map((s) => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) }))];

const isUrl = (s: string | null): s is string => !!s && /^https?:\/\//i.test(s);

function whenLabel(m: MeetingItem): string {
  if (m.scheduledAt) return `${fmtWhen(m.scheduledAt)} · ${m.durationMin} min`;
  if (m.proposedAt) return `Preferred time: ${fmtWhen(m.proposedAt)}`;
  return 'Waiting for the teacher to propose a time';
}

function MeetingRow({ m, onCancel, showChild, disabled }: { m: MeetingItem; onCancel?: (m: MeetingItem) => void; showChild: boolean; disabled?: boolean }) {
  const mode = MODE[m.mode];
  const note = m.outcomeNotes && NOTE_LABEL[m.status];
  return (
    <div className="flex items-start gap-3 px-5 py-4 max-sm:px-4">
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="text-sm font-semibold">{m.topic}</p>
          <StatusChip status={m.status} />
        </div>
        <p className="t-caption text-ink-2">
          With {m.teacher.name}
          {m.teacher.designation ? ` · ${m.teacher.designation}` : ''}
          {showChild ? ` · about ${m.student.name}` : ''}
        </p>
        <p className="t-caption flex flex-wrap items-center gap-x-3 gap-y-0.5 text-ink-2">
          <span className="inline-flex items-center gap-1">
            <CalendarClock className="size-3.5" aria-hidden /> {whenLabel(m)}
          </span>
          {m.scheduledAt && (
            <span className="inline-flex items-center gap-1">
              <mode.icon className="size-3.5" aria-hidden /> {mode.label}
              {m.locationOrLink && !isUrl(m.locationOrLink) ? ` · ${m.locationOrLink}` : ''}
            </span>
          )}
          {isUrl(m.locationOrLink) && (
            <a href={m.locationOrLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-brand-ink underline-offset-4 hover:underline">
              <Link2 className="size-3.5" aria-hidden /> Join link
            </a>
          )}
        </p>
        {note && (
          <p className="t-caption rounded-md bg-surface-subtle px-3 py-2 text-ink-2">
            <span className="font-medium text-ink">{NOTE_LABEL[m.status]}: </span>
            {m.outcomeNotes}
          </p>
        )}
      </div>
      {onCancel && m.availableActions.includes('cancel') && (
        <Button variant="secondary" size="sm" onClick={() => onCancel(m)} disabled={disabled} className="shrink-0">
          Cancel
        </Button>
      )}
    </div>
  );
}

/** Parent–teacher meetings: the next ones at a glance, the full list, a request dialog and cancel. */
export function MeetingsPanel() {
  const l = useLearner();
  const { can, readOnly } = useGates();
  const { get, set } = useUrlParams();
  const [page, setPage] = usePageParam('mpage');
  const status = get('mstatus') ?? 'all';
  const [requestOpen, setRequestOpen] = React.useState(false);
  const [cancelling, setCancelling] = React.useState<MeetingItem | null>(null);
  const cancel = useCancelMeeting();
  const q = useMeetings({ page, pageSize: PAGE_SIZE, status: status === 'all' ? undefined : status, studentId: l.isParent ? l.studentId : null });
  const up = useUpcomingMeetings(l.studentId);
  const canRequest = l.isParent && can('meetings:create');
  const upcoming = (up.data ?? []).filter((m) => !l.isParent || m.student.id === l.studentId).slice(0, 3);

  const doCancel = async () => {
    if (!cancelling) return;
    try {
      await cancel.mutateAsync({ id: cancelling.id });
      toast.success('The meeting request was cancelled');
      setCancelling(null);
    } catch (e) {
      toast.error(errorMessage(e), { duration: 8000 });
      setCancelling(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Select aria-label="Status" className="w-44" value={status} onValueChange={(v) => set({ mstatus: v === 'all' ? null : v, mpage: null })} options={STATUS_OPTIONS} />
        {canRequest && (
          <Button className="ml-auto" onClick={() => setRequestOpen(true)} disabled={readOnly}>
            <Plus /> Request a meeting
          </Button>
        )}
      </div>

      <Card>
        <CardHeader title="Coming up" description="Confirmed meetings and requests still waiting for the teacher" />
        <CardBody className="pt-3">
          {up.isPending ? (
            <Skeleton className="h-16 w-full" />
          ) : up.isError ? (
            <ErrorState error={up.error} onRetry={() => void up.refetch()} compact />
          ) : upcoming.length === 0 ? (
            <p className="flex items-start gap-3 text-sm text-ink-2">
              <Users className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden /> No meetings are planned.{canRequest ? ' Use “Request a meeting” to ask a teacher for a time.' : ''}
            </p>
          ) : (
            <ul className="-mx-5 divide-y divide-border max-sm:-mx-4">
              {upcoming.map((m) => (
                <li key={m.id}>
                  <MeetingRow m={m} showChild={l.isParent && l.kids.length > 1} onCancel={setCancelling} disabled={readOnly} />
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader title="All meetings" className="pb-3" />
        {q.isPending ? (
          <SkeletonRows rows={4} />
        ) : q.isError && !q.data ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : q.data && q.data.data.length === 0 ? (
          status !== 'all' ? (
            <EmptyState illustration="no-results" title="No meetings with that status" filters={<Badge variant="outline">{STATUS_OPTIONS.find((o) => o.value === status)?.label}</Badge>} action={<Button variant="secondary" size="sm" onClick={() => set({ mstatus: null, mpage: null })}>Clear filters</Button>} />
          ) : (
            <EmptyState illustration="empty-events" title="No meetings yet" description={canRequest ? 'Ask a teacher for a meeting about progress, behaviour or anything else.' : 'Meetings with teachers will be listed here.'} action={canRequest ? <Button size="sm" onClick={() => setRequestOpen(true)} disabled={readOnly}><Plus /> Request a meeting</Button> : undefined} />
          )
        ) : (
          <>
            <ul className={cn('divide-y divide-border border-t border-border')} aria-busy={q.isFetching || undefined}>
              {q.data?.data.map((m) => (
                <li key={m.id}>
                  <MeetingRow m={m} showChild={l.isParent && l.kids.length > 1} onCancel={setCancelling} disabled={readOnly} />
                </li>
              ))}
            </ul>
            <Pager page={page} totalPages={q.data?.meta.totalPages ?? 1} total={q.data?.meta.total ?? 0} onPage={setPage} noun="meetings" />
          </>
        )}
      </Card>

      {canRequest && <MeetingRequestDialog open={requestOpen} onOpenChange={setRequestOpen} />}
      <ConfirmDialog
        open={!!cancelling}
        onOpenChange={(o) => !o && setCancelling(null)}
        title="Cancel this meeting?"
        description={cancelling ? `Your ${cancelling.status === 'confirmed' ? 'confirmed meeting' : 'request'} with ${cancelling.teacher.name} about “${cancelling.topic}” will be cancelled and the teacher will be told.` : ''}
        confirmLabel="Cancel meeting"
        cancelLabel="Keep it"
        destructive
        loading={cancel.isPending}
        onConfirm={() => void doCancel()}
      />
    </div>
  );
}

// ───────────────────────────── request dialog ─────────────────────────────

/** The shared request body, with friendlier messages and the optional preferred date / time that is folded into `proposedAt`. */
const requestForm = meetingRequestBody
  .omit({ proposedAt: true })
  .extend({
    studentId: z.string().min(1, 'Choose a child'),
    staffId: z.string().min(1, 'Choose a teacher'),
    topic: z.string().trim().min(3, 'Tell the teacher what you would like to discuss (at least 3 characters)').max(300, 'Keep it under 300 characters'),
    prefDate: z.string().optional(),
    prefTime: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.prefTime && !v.prefDate) ctx.addIssue({ code: 'custom', path: ['prefDate'], message: 'Pick a date for the time you chose' });
    if (v.prefDate && new Date(`${v.prefDate}T${v.prefTime || '09:00'}:00`).getTime() < Date.now()) ctx.addIssue({ code: 'custom', path: ['prefDate'], message: 'Choose a time in the future' });
  });

function MeetingRequestDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const l = useLearner();
  const request = useRequestMeeting();
  const [formError, setFormError] = React.useState<string | null>(null);
  const form = useZodForm(requestForm, { defaultValues: { studentId: l.studentId ?? '', staffId: '', topic: '', prefDate: '', prefTime: '' } });
  const { guard, dialog } = useUnsavedGuard(form.formState.isDirty && open);
  const studentId = form.watch('studentId');
  const teachers = useMeetingTeachers(studentId || null);

  // a teacher belongs to one child's class: picking another child clears the teacher
  React.useEffect(() => {
    form.setValue('staffId', '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId]);

  React.useEffect(() => {
    if (open) {
      form.reset({ studentId: l.studentId ?? '', staffId: '', topic: '', prefDate: '', prefTime: '' });
      setFormError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const teacherOptions = (teachers.data ?? []).map((t) => ({ value: t.staffId, label: `${t.name}${t.isClassTeacher ? ' · Class teacher' : ''}${t.subjects.length ? ` · ${t.subjects.join(', ')}` : ''}` }));

  const submit = form.handleSubmit(async (v) => {
    setFormError(null);
    const proposedAt = v.prefDate ? new Date(`${v.prefDate}T${v.prefTime || '09:00'}:00`).toISOString() : undefined;
    const body = meetingRequestBody.safeParse({ studentId: v.studentId, staffId: v.staffId, topic: v.topic, proposedAt });
    if (!body.success) {
      setFormError(body.error.issues[0]?.message ?? 'Check the form and try again.');
      return;
    }
    try {
      await request.mutateAsync(body.data);
      const who = teachers.data?.find((t) => t.staffId === v.staffId)?.name;
      toast.success(who ? `Meeting requested with ${who}` : 'Meeting requested');
      form.reset();
      onOpenChange(false);
    } catch (e) {
      setFormError(applyApiErrors(form, e));
    }
  });

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : guard(() => onOpenChange(false)))}>
        <DialogContent title="Request a meeting" description="The teacher will confirm a time, or suggest another." size="md">
          <form onSubmit={submit} noValidate className="mt-4 space-y-5">
            <FormSection title="Who">
              {l.kids.length > 1 && (
                <FormSelect
                  control={form.control}
                  name="studentId"
                  label="About which child?"
                  required
                  options={l.kids.map((k) => ({ value: k.studentId, label: `${k.name}${k.grade ? ` · ${[k.grade, k.section].filter(Boolean).join(' ')}` : ''}` }))}
                />
              )}
              <FormSelect control={form.control} name="staffId" label="Teacher" required placeholder={teachers.isPending && !!studentId ? 'Loading teachers…' : 'Choose a teacher'} options={teacherOptions} hint={teachers.isError ? 'We couldn’t load the teachers — close this and try again.' : 'Class teacher and subject teachers of your child'} />
            </FormSection>
            <FormSection title="What">
              <FormTextarea control={form.control} name="topic" label="What would you like to discuss?" required rows={3} maxLength={300} hint="For example: progress in Mathematics before the mid-term" />
            </FormSection>
            <FormSection title="When (optional)" description="Suggest a time. The teacher may propose another.">
              <div className="grid gap-4 sm:grid-cols-2">
                <FormDate control={form.control} name="prefDate" label="Preferred date" min={todayIso()} />
                <FormInput control={form.control} name="prefTime" label="Preferred time" type="time" />
              </div>
            </FormSection>
            {formError && <Banner tone="danger">{formError}</Banner>}
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="secondary" onClick={() => guard(() => onOpenChange(false))}>
                Cancel
              </Button>
              <Button type="submit" loading={form.formState.isSubmitting || request.isPending}>
                Send request
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      {dialog}
    </>
  );
}
