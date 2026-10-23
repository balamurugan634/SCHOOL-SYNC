'use client';

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Controller } from 'react-hook-form';
import { z } from 'zod';
import { submissionReturnBody, submissionReviewBody, type HomeworkItem, type SubmissionItem } from '@school-sync/shared';
import { ApiError } from '@/lib/problem';
import { fmtDateTime } from '@/lib/format';
import { teacherError } from '@/lib/client/teacher-errors';
import { useReturnSubmission, useReviewSubmission, useSubmission, useSubmissions, type SubmissionFilters } from '@/lib/client/teacher-homework';
import { applyApiErrors, useZodForm } from '@/lib/client/use-zod-form';
import { useUnsavedGuard } from '@/lib/client/use-unsaved-guard';
import { Banner } from '@/components/ui/banner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DataTable } from '@/components/ui/data-table';
import { Drawer, DrawerContent, SheetBody, SheetFooter } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, Input, Textarea } from '@/components/ui/input';
import { IconButton } from '@/components/ui/icon-button';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toaster';
import { AttachmentLinks, FilterSelect, useUrlState, useWriteGate } from '../common';
import { FilterChip, WorkStatusChip, marksText, toReviewCount } from './shared';

/** Which submission is open in the drawer, and the ids it can step through (previous / next). */
export interface DrawerState {
  id: string;
  ids: string[];
}

const STATUS_OPTIONS = [
  { value: 'submitted', label: 'Submitted' },
  { value: 'late', label: 'Late' },
  { value: 'reviewed', label: 'Reviewed' },
  { value: 'returned', label: 'Returned for rework' },
];

/* ───────────────────────── the "Review" tab ───────────────────────── */

export function ReviewTab({ homework, canReview, onOpen }: { homework: HomeworkItem; canReview: boolean; onOpen: (s: DrawerState) => void }) {
  const u = useUrlState();
  const status = (['submitted', 'late', 'reviewed', 'returned'] as const).find((s) => s === u.get('status')) ?? '';
  const f: SubmissionFilters = { status, page: u.num('page', 1), pageSize: u.num('size', 25) };
  const q = useSubmissions(homework.id, f);
  const waiting = homework.stats ? toReviewCount(homework.stats) : 0;
  const ids = (q.data?.data ?? []).map((s) => s.id);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect label="Filter by status" allLabel="All submissions" value={status} onChange={(v) => u.set({ status: v })} options={STATUS_OPTIONS} />
        {status && <FilterChip label={`Status: ${STATUS_OPTIONS.find((o) => o.value === status)?.label}`} onRemove={() => u.set({ status: null })} />}
        <p className="t-caption ml-auto text-ink-2" aria-live="polite">
          {waiting > 0 ? `${waiting} waiting for your review` : 'Nothing is waiting for review'}
        </p>
      </div>
      <DataTable<SubmissionItem>
        id="teacher-homework-submissions"
        caption="Submissions"
        rows={q.data?.data}
        rowKey={(s) => s.id}
        loading={q.isPending}
        error={q.error ? new Error(teacherError(q.error)) : undefined}
        onRetry={() => void q.refetch()}
        onRowClick={(s) => onOpen({ id: s.id, ids })}
        page={f.page}
        pageSize={f.pageSize}
        total={q.data?.meta.total}
        onPageChange={(p) => u.set({ page: p }, { keepPage: true })}
        onPageSizeChange={(s) => u.set({ size: s === 25 ? null : s })}
        columns={[
          {
            id: 'student',
            header: 'Student',
            mobile: 'title',
            hideable: false,
            cell: (s) => (
              <span className="inline-flex items-baseline gap-2">
                <span className="tnum w-6 text-right text-[13px] text-ink-3">{s.rollNo ?? ''}</span>
                <span className="font-medium">{s.studentName}</span>
              </span>
            ),
          },
          {
            id: 'submitted',
            header: 'Handed in',
            mobile: 'sub',
            cell: (s) => (
              <span className="inline-flex flex-wrap items-center gap-1.5 text-ink-2">
                {fmtDateTime(s.submittedAt)}
                {s.isLate && <Badge variant="warning">Late</Badge>}
              </span>
            ),
          },
          { id: 'status', header: 'Status', mobile: 'status', cell: (s) => <WorkStatusChip status={s.status} /> },
          { id: 'marks', header: 'Marks', align: 'right', mobile: 'detail', cell: (s) => <span className="tnum">{homework.maxMarks ? marksText(s.marks, homework.maxMarks) : '—'}</span> },
          {
            id: 'open',
            header: <span className="sr-only">Open</span>,
            label: 'Open',
            hideable: false,
            mobile: 'hide',
            align: 'right',
            cell: (s) => (
              <Button variant={s.status === 'submitted' || s.status === 'late' ? 'secondary' : 'ghost'} size="sm" onClick={(e) => { e.stopPropagation(); onOpen({ id: s.id, ids }); }} aria-label={`${canReview ? 'Review' : 'View'} ${s.studentName}’s submission`}>
                {canReview && (s.status === 'submitted' || s.status === 'late') ? 'Review' : 'Open'}
              </Button>
            ),
          },
        ]}
        empty={
          status ? (
            <EmptyState illustration="no-results" title="No submissions with this status" filters={<FilterChip label={`Status: ${STATUS_OPTIONS.find((o) => o.value === status)?.label}`} onRemove={() => u.set({ status: null })} />} action={<Button variant="secondary" onClick={() => u.set({ status: null })}>Clear filter</Button>} />
          ) : (
            <EmptyState illustration="empty-homework" title="Nothing handed in yet" description={homework.status === 'published' ? 'Submissions appear here as students hand in their work.' : 'Submissions appear here once the homework is published and students hand in work.'} />
          )
        }
      />
    </div>
  );
}

/* ───────────────────────── the drawer ───────────────────────── */

export function SubmissionDrawer({ homework, state, onChange, canReview }: { homework: HomeworkItem; state: DrawerState | null; onChange: (s: DrawerState | null) => void; canReview: boolean }) {
  const [dirty, setDirty] = React.useState(false);
  const { guard, dialog } = useUnsavedGuard(dirty, { title: 'Discard this review?', description: 'You have typed marks or feedback that has not been saved. If you leave now it will be lost.', confirmLabel: 'Discard' });
  const q = useSubmission(state?.id);
  const idx = state ? state.ids.indexOf(state.id) : -1;
  const prevId = state && idx > 0 ? state.ids[idx - 1]! : null;
  const nextId = state && idx >= 0 && idx < state.ids.length - 1 ? state.ids[idx + 1]! : null;

  const go = (id: string, force = false) => {
    if (!state) return;
    const act = () => {
      setDirty(false);
      onChange({ ...state, id });
    };
    if (force) act();
    else guard(act);
  };
  const close = () =>
    guard(() => {
      setDirty(false);
      onChange(null);
    });

  return (
    <>
      <Drawer open={state !== null} onOpenChange={(o) => !o && close()}>
        <DrawerContent title="Review submission" description={`${homework.title} · ${homework.subjectName}`} showTitle>
          {state && q.isPending ? (
            <SheetBody>
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-32 w-full" />
            </SheetBody>
          ) : state && q.isError ? (
            <SheetBody>
              <EmptyState compact illustration="error-offline" title="We couldn’t open this submission" description={teacherError(q.error)} action={<Button variant="secondary" size="sm" onClick={() => void q.refetch()}>Try again</Button>} />
            </SheetBody>
          ) : state && q.data ? (
            <ReviewBody
              key={q.data.id}
              homework={homework}
              sub={q.data}
              canReview={canReview}
              position={idx >= 0 ? { n: idx + 1, of: state.ids.length } : null}
              prevId={prevId}
              nextId={nextId}
              onGo={go}
              onDirty={setDirty}
            />
          ) : null}
        </DrawerContent>
      </Drawer>
      {dialog}
    </>
  );
}

const FIELD_FOR_CODE: Record<string, 'marks' | 'feedback'> = { MARKS_EXCEED_MAX: 'marks', MARKS_NOT_ENABLED: 'marks', EMPTY_REVIEW: 'feedback' };
const STALE_CODES = new Set(['INVALID_STATE', 'SUBMISSION_LOCKED', 'HOMEWORK_CLOSED']);

function ReviewBody({ homework, sub, canReview, position, prevId, nextId, onGo, onDirty }: { homework: HomeworkItem; sub: SubmissionItem; canReview: boolean; position: { n: number; of: number } | null; prevId: string | null; nextId: string | null; onGo: (id: string, force?: boolean) => void; onDirty: (d: boolean) => void }) {
  const qc = useQueryClient();
  const gate = useWriteGate();
  const review = useReviewSubmission();
  const ret = useReturnSubmission();
  const max = homework.maxMarks;
  const schema = React.useMemo(
    () =>
      submissionReviewBody.extend({
        marks: (max === null ? z.number() : z.number('Enter the marks as a number').min(0, 'Marks can’t be negative').max(max, `Marks can’t be more than ${max}`)).multipleOf(0.01, 'Use at most two decimal places').optional(),
        feedback: z.string().trim().max(2000, 'Keep feedback under 2,000 characters').optional(),
      }),
    [max],
  );
  const form = useZodForm(schema, { defaultValues: { marks: sub.marks ?? undefined, feedback: sub.feedback ?? '' } });
  const [error, setError] = React.useState<string | null>(null);
  const [confirmReturn, setConfirmReturn] = React.useState<string | null>(null);
  const marksId = React.useId();
  const fbId = React.useId();
  const dirty = form.formState.isDirty;
  React.useEffect(() => onDirty(dirty), [dirty, onDirty]);
  React.useEffect(() => () => onDirty(false), [onDirty]);

  const waiting = sub.status === 'returned';
  const editable = canReview && !waiting && !gate.readOnly;
  const busy = review.isPending || ret.isPending;

  const fail = (e: unknown) => {
    const msg = applyApiErrors(form, e);
    const field = e instanceof ApiError ? FIELD_FOR_CODE[e.code] : undefined;
    if (field) {
      form.setError(field, { type: 'server', message: teacherError(e) });
      setError(null);
    } else setError(msg === null ? null : teacherError(e));
    if (e instanceof ApiError && STALE_CODES.has(e.code)) void qc.invalidateQueries({ queryKey: ['submissions'] });
  };

  const save = async (v: { marks?: number; feedback?: string }, andNext: boolean) => {
    setError(null);
    const feedback = v.feedback?.trim() || undefined;
    if (v.marks === undefined && !feedback) {
      setError('Give marks or feedback before saving the review.');
      return;
    }
    try {
      const res = await review.mutateAsync({ id: sub.id, body: { marks: v.marks, feedback } });
      form.reset({ marks: res.marks ?? undefined, feedback: res.feedback ?? '' });
      onDirty(false);
      toast.success('Review saved', { description: `${sub.studentName} has been told it was reviewed.` });
      if (andNext && nextId) onGo(nextId, true);
    } catch (e) {
      fail(e);
    }
  };
  const submit = (andNext: boolean) => form.handleSubmit((v) => save(v, andNext))();

  const askReturn = () => {
    setError(null);
    const fb = form.getValues('feedback')?.trim() ?? '';
    if (!submissionReturnBody.safeParse({ feedback: fb }).success) {
      form.setError('feedback', { type: 'validate', message: 'Say what needs to change, so the student knows what to redo.' });
      return;
    }
    setConfirmReturn(fb);
  };
  const doReturn = async () => {
    if (confirmReturn === null) return;
    try {
      const res = await ret.mutateAsync({ id: sub.id, body: { feedback: confirmReturn } });
      form.reset({ marks: undefined, feedback: res.feedback ?? '' });
      onDirty(false);
      setConfirmReturn(null);
      toast.success('Returned for rework', { description: `${sub.studentName} can hand it in again.` });
      if (nextId) onGo(nextId, true);
    } catch (e) {
      setConfirmReturn(null);
      fail(e);
    }
  };

  return (
    <>
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit(false);
      }}
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && editable) {
          e.preventDefault();
          void submit(false);
        }
      }}
      noValidate
    >
      <SheetBody>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="t-section truncate">{sub.studentName}</h3>
            <p className="t-caption text-ink-2">
              {sub.rollNo ? `Roll ${sub.rollNo} · ` : ''}
              Handed in {fmtDateTime(sub.submittedAt)}
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <WorkStatusChip status={sub.status} />
              {sub.isLate && sub.status !== 'late' && <Badge variant="warning">Late</Badge>}
            </div>
          </div>
          {position && (
            <div className="flex shrink-0 items-center gap-1" role="group" aria-label="Move between submissions">
              <IconButton type="button" label="Previous submission" size="icon-sm" disabled={!prevId} onClick={() => prevId && onGo(prevId)}>
                <ChevronLeft />
              </IconButton>
              <span className="t-caption tnum min-w-12 text-center text-ink-2" aria-live="polite">
                {position.n} of {position.of}
              </span>
              <IconButton type="button" label="Next submission" size="icon-sm" disabled={!nextId} onClick={() => nextId && onGo(nextId)}>
                <ChevronRight />
              </IconButton>
            </div>
          )}
        </div>

        {waiting && (
          <Banner tone="warning" title="Returned for rework">
            Waiting for {sub.studentName} to hand it in again. You can review it once they do.
          </Banner>
        )}
        {!canReview && <Banner tone="info">You can view this work, but your role doesn’t include reviewing it.</Banner>}
        {gate.readOnly && canReview && <Banner tone="locked">{gate.reason}</Banner>}
        {homework.status === 'closed' && <Banner tone="info">This homework is closed. You can still review work, but not return it for rework.</Banner>}
        {error && (
          <Banner tone="danger" title="We couldn’t save that" onDismiss={() => setError(null)}>
            {error}
          </Banner>
        )}

        <section aria-label="The student’s work" className="space-y-2">
          <h4 className="t-label text-ink">Student’s work</h4>
          {sub.text ? <p className="whitespace-pre-wrap break-words rounded-md bg-surface-subtle px-3 py-2.5 text-sm">{sub.text}</p> : <p className="text-sm text-ink-2">{sub.attachments.length ? 'No written answer. See the attachments.' : 'No written answer and no attachments.'}</p>}
          <AttachmentLinks items={sub.attachments} />
        </section>

        <section aria-label="Your review" className="space-y-4">
          <h4 className="t-label text-ink">Your review</h4>
          <Controller
            control={form.control}
            name="marks"
            render={({ field, fieldState }) => (
              <Field label={max !== null ? `Marks (out of ${max})` : 'Marks'} htmlFor={marksId} error={fieldState.error?.message} hint={max === null ? 'This homework has no marks. Edit it to add a maximum.' : undefined}>
                <Input
                  id={marksId}
                  type="number"
                  inputMode="decimal"
                  step={0.01}
                  min={0}
                  max={max ?? undefined}
                  className="sm:max-w-40"
                  disabled={!editable || max === null}
                  value={field.value ?? ''}
                  onChange={(e) => field.onChange(e.target.value === '' ? undefined : Number(e.target.value))}
                  onBlur={field.onBlur}
                  invalid={!!fieldState.error}
                />
              </Field>
            )}
          />
          <Controller
            control={form.control}
            name="feedback"
            render={({ field, fieldState }) => (
              <Field label="Feedback" htmlFor={fbId} error={fieldState.error?.message} hint="Required when you return the work for rework.">
                <Textarea id={fbId} rows={5} maxLength={2000} disabled={!editable} value={field.value ?? ''} onChange={field.onChange} onBlur={field.onBlur} invalid={!!fieldState.error} />
              </Field>
            )}
          />
          {sub.reviewedAt && sub.status === 'reviewed' && <p className="t-caption text-ink-2">Reviewed {fmtDateTime(sub.reviewedAt)}.</p>}
          {editable && <p className="t-caption hidden text-ink-3 sm:block">Press Ctrl or ⌘ + Enter to save.</p>}
        </section>
      </SheetBody>

      {editable && (
        <SheetFooter>
          <Button type="button" variant="secondary" onClick={askReturn} disabled={busy || homework.status === 'closed'} title={homework.status === 'closed' ? 'Closed homework can’t be returned for rework' : undefined}>
            Return for rework
          </Button>
          <Button type="submit" variant={nextId ? 'secondary' : 'primary'} loading={review.isPending} disabled={busy}>
            Save review
          </Button>
          {nextId && (
            <Button type="button" onClick={() => void submit(true)} disabled={busy}>
              Save and next
            </Button>
          )}
        </SheetFooter>
      )}
    </form>
    <ConfirmDialog
      open={confirmReturn !== null}
      onOpenChange={(o) => !o && !ret.isPending && setConfirmReturn(null)}
      title={`Return ${sub.studentName}’s work?`}
      description="Any marks you gave are cleared, your feedback is sent, and the student is asked to hand it in again."
      confirmLabel="Return for rework"
      loading={ret.isPending}
      onConfirm={() => void doReturn()}
    />
    </>
  );
}
