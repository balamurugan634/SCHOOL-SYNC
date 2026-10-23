'use client';

import * as React from 'react';
import Link from 'next/link';
import { CheckCircle2, Clock3, Lock, Pencil, RotateCcw } from 'lucide-react';
import { homeworkSubmitBody, type HomeworkItem, type SubmissionItem } from '@school-sync/shared';
import { bff } from '@/lib/client/fetcher';
import { useHomework, useSubmission, useSubmitHomework } from '@/lib/client/learner-learning';
import { applyApiErrors, useZodForm } from '@/lib/client/use-zod-form';
import { useUnsavedGuard } from '@/lib/client/use-unsaved-guard';
import { ApiError, errorMessage } from '@/lib/problem';
import { dueLabel, fmtDateTime } from '@/lib/format';
import { PageHeader } from '@/components/shell/page-header';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { FormTextarea } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toaster';
import { ErrorState, NeedsLearner } from '../states';
import { useGates, useLearner } from '../use-learner';
import { AttachmentList, HomeworkStatusChip, marksText } from './common';
import { AttachmentPicker, useAttachmentUploads } from './uploader';

const SUBMIT_ERRORS: Record<string, string> = {
  HOMEWORK_CLOSED: 'This homework has been closed, so it can’t take any more hand-ins.',
  SUBMISSION_NOT_ALLOWED: 'This homework isn’t handed in online. Follow your teacher’s instructions.',
  SUBMISSION_LOCKED: 'Your teacher has already reviewed this work, so it can’t be changed. Ask your teacher if something needs fixing.',
  EMPTY_SUBMISSION: 'Write a note or attach a file before handing in.',
  SUBMISSIONS_STUDENTS_ONLY: 'Only the student can hand in homework.',
};
const submitMessage = (e: unknown) => (e instanceof ApiError && SUBMIT_ERRORS[e.code]) || errorMessage(e);

export function HomeworkDetailScreen({ id }: { id: string }) {
  const l = useLearner();
  return (
    <NeedsLearner>
      <Inner id={id} key={`${id}-${l.studentId}`} />
    </NeedsLearner>
  );
}

function Inner({ id }: { id: string }) {
  const l = useLearner();
  const hw = useHomework(id, l.q, l.studentId);
  const sub = useSubmission(id, l.q, l.studentId);
  const listHref = `${l.base}/${l.isParent ? 'academics' : 'learning'}`;
  const crumbs = [{ label: 'Home', href: l.base || '/' }, { label: l.isParent ? 'Academics' : 'Learning', href: `${listHref}?tab=homework` }, { label: 'Homework' }];

  if (hw.isPending || sub.isPending) {
    return (
      <>
        <PageHeader title="Homework" crumbs={crumbs} />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]" aria-busy="true">
          <div className="space-y-6">
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
          <Skeleton className="h-56 w-full" />
        </div>
      </>
    );
  }
  if (hw.isError || !hw.data) {
    return (
      <>
        <PageHeader title="Homework" crumbs={crumbs} />
        <Card>
          <ErrorState error={hw.error} onRetry={() => void hw.refetch()} title="We couldn’t open this homework" />
        </Card>
      </>
    );
  }
  const h = hw.data;
  const submission = sub.data ?? null;
  const status = h.learner?.status ?? 'pending';
  const due = dueLabel(h.dueAt);

  return (
    <>
      <PageHeader
        title={h.title}
        description={`${h.subjectName}${h.teacherName ? ` · ${h.teacherName}` : ''}${l.isParent ? ` · for ${l.name}` : ''}`}
        crumbs={crumbs}
        actions={<HomeworkStatusChip status={status} />}
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader title="The task" />
            <CardBody className="space-y-4 pt-3">
              {h.description ? <p className="max-w-[68ch] whitespace-pre-wrap text-sm leading-6">{h.description}</p> : <p className="text-sm text-ink-2">Your teacher didn’t add a description.</p>}
              {h.attachments.length > 0 && (
                <div className="space-y-2">
                  <h3 className="t-label text-ink">From your teacher</h3>
                  <AttachmentList attachments={h.attachments} />
                </div>
              )}
            </CardBody>
          </Card>

          {sub.isError && !sub.data ? (
            <Card>
              <ErrorState error={sub.error} onRetry={() => void sub.refetch()} title="We couldn’t load the hand-in" />
            </Card>
          ) : (
            <SubmissionSection hw={h} submission={submission} />
          )}
        </div>

        <aside aria-label="Homework details" className="space-y-6">
          <Card>
            <CardHeader title="Details" />
            <dl className="divide-y divide-border px-5 pb-2 pt-2 text-sm max-sm:px-4">
              <Fact k="Subject" v={h.subjectName} />
              <Fact k="Teacher" v={h.teacherName ?? '—'} />
              <Fact k="Set on" v={fmtDateTime(h.assignedAt)} />
              <Fact k="Due" v={<span className={due.overdue && !submission ? 'font-medium text-danger' : undefined}>{fmtDateTime(h.dueAt)}</span>} />
              <Fact k="Marks" v={h.maxMarks ? `Out of ${h.maxMarks}` : 'Not marked'} />
              <Fact k="Hand-in" v={h.allowSubmission ? 'Online' : 'Not online'} />
              {h.status === 'closed' && <Fact k="State" v="Closed" />}
            </dl>
          </Card>
          <Button asChild variant="secondary" className="w-full">
            <Link href={`${listHref}?tab=homework`}>Back to all homework</Link>
          </Button>
        </aside>
      </div>
    </>
  );
}

const Fact = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div className="flex items-baseline justify-between gap-4 py-2.5">
    <dt className="text-ink-2">{k}</dt>
    <dd className="min-w-0 text-right font-medium">{v}</dd>
  </div>
);

// ───────────────────────────── hand-in ─────────────────────────────

function SubmissionSection({ hw, submission }: { hw: HomeworkItem; submission: SubmissionItem | null }) {
  const l = useLearner();
  const { readOnly, can } = useGates();
  const [editing, setEditing] = React.useState(false);
  const closed = hw.status === 'closed';
  const isStudent = !l.isParent;
  const mayWrite = isStudent && can('submissions:create') && !readOnly && hw.allowSubmission && !closed;
  const status = submission?.status;
  const canEdit = mayWrite && !!submission && status !== 'reviewed';

  if (editing && canEdit) return <SubmitForm hw={hw} submission={submission} onDone={() => setEditing(false)} onCancel={() => setEditing(false)} />;
  if (!submission) {
    if (mayWrite) return <SubmitForm hw={hw} submission={null} onDone={() => undefined} />;
    return (
      <Card>
        <CardHeader title={isStudent ? 'Your hand-in' : `${l.name}’s hand-in`} />
        <CardBody className="pt-3">
          <Banner tone={closed ? 'locked' : 'info'}>
            {closed
              ? isStudent ? 'This homework is closed and nothing was handed in.' : 'This homework is closed and nothing was handed in.'
              : !hw.allowSubmission
                ? 'This homework isn’t handed in online. Follow your teacher’s instructions.'
                : readOnly
                  ? 'The school is in read-only mode, so work can’t be handed in right now.'
                  : isStudent
                    ? 'Handing in is switched off for your account.'
                    : `${l.name} hasn’t handed this in yet. Only the student can hand homework in; you’ll see it here with the teacher’s feedback.`}
          </Banner>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title={isStudent ? 'Your hand-in' : `${l.name}’s hand-in`}
        description={`Handed in ${fmtDateTime(submission.submittedAt)}${submission.isLate ? ' · after the due time' : ''}`}
        action={<HomeworkStatusChip status={submission.status === 'submitted' && submission.isLate ? 'late' : submission.status} />}
      />
      <CardBody className="space-y-5 pt-3">
        {submission.status === 'reviewed' && (
          <Banner tone="success" title="Reviewed by your teacher" >
            {submission.marks !== null ? (
              <span>
                Marks: <strong className="tnum text-ink">{marksText(submission.marks, hw.maxMarks)}</strong>
              </span>
            ) : (
              'Your teacher left feedback below.'
            )}
          </Banner>
        )}
        {submission.status === 'returned' && (
          <Banner tone="warning" title={isStudent ? 'Your teacher asked for some changes' : 'Returned for rework'}>
            {isStudent ? 'Read the feedback, update your work and hand it in again.' : `${l.name} needs to update the work and hand it in again.`}
          </Banner>
        )}
        {submission.feedback && (
          <div>
            <h3 className="t-label mb-1.5 text-ink">Teacher’s feedback</h3>
            <p className="max-w-[68ch] whitespace-pre-wrap rounded-md bg-surface-subtle p-3 text-sm leading-6">{submission.feedback}</p>
          </div>
        )}
        {submission.text && (
          <div>
            <h3 className="t-label mb-1.5 text-ink">{isStudent ? 'Your note' : 'Note'}</h3>
            <p className="max-w-[68ch] whitespace-pre-wrap text-sm leading-6">{submission.text}</p>
          </div>
        )}
        {submission.attachments.length > 0 && (
          <div>
            <h3 className="t-label mb-1.5 text-ink">Files</h3>
            <AttachmentList attachments={submission.attachments} />
          </div>
        )}
        {!submission.text && submission.attachments.length === 0 && <p className="text-sm text-ink-2">Nothing was written or attached.</p>}

        {isStudent && submission.status === 'reviewed' && (
          <p className="t-caption flex items-center gap-1.5 text-ink-2">
            <Lock className="size-3.5" aria-hidden /> Reviewed work can’t be changed. Ask your teacher if something needs fixing.
          </p>
        )}
        {isStudent && closed && submission.status !== 'reviewed' && (
          <p className="t-caption flex items-center gap-1.5 text-ink-2">
            <Lock className="size-3.5" aria-hidden /> This homework is closed, so it can’t be changed.
          </p>
        )}
        {canEdit && (
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => setEditing(true)} variant={status === 'returned' ? 'primary' : 'secondary'}>
              {status === 'returned' ? <RotateCcw /> : <Pencil />} {status === 'returned' ? 'Rework and hand in again' : 'Edit and hand in again'}
            </Button>
            {status !== 'returned' && <span className="t-caption text-ink-2">You can change your work until your teacher reviews it.</span>}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function SubmitForm({ hw, submission, onDone, onCancel }: { hw: HomeworkItem; submission: SubmissionItem | null; onDone: () => void; onCancel?: () => void }) {
  const submit = useSubmitHomework(hw.id);
  const form = useZodForm(homeworkSubmitBody, { defaultValues: { text: submission?.text ?? '', attachments: [] } });
  const uploads = useAttachmentUploads(submission?.attachments ?? [], 'submission');
  const [formError, setFormError] = React.useState<string | null>(null);
  const [sent, setSent] = React.useState(false);
  const dirty = !sent && (form.formState.isDirty || uploads.changed);
  const { guard, dialog } = useUnsavedGuard(dirty, { description: 'Your note or files haven’t been handed in yet. If you leave now they will be lost.', confirmLabel: 'Leave without handing in' });
  const text = form.watch('text') ?? '';
  const resubmitting = !!submission;
  const due = dueLabel(hw.dueAt);
  const [openedAt] = React.useState(() => Date.now());
  const lateNow = new Date(hw.dueAt).getTime() < openedAt;

  const onSubmit = form.handleSubmit(async (v) => {
    setFormError(null);
    if (uploads.busy) {
      setFormError('Wait for the files to finish uploading.');
      return;
    }
    if (uploads.failed) {
      setFormError('Some files didn’t upload. Retry or remove them, then hand in.');
      return;
    }
    const note = v.text?.trim() ?? '';
    if (!note && uploads.refs.length === 0) {
      setFormError('Write a note or attach a file before handing in.');
      return;
    }
    try {
      const res = await submit.mutateAsync({ text: note || null, attachments: uploads.refs });
      setSent(true);
      // files that were on the old hand-in and are no longer attached can go (best effort; the API refuses if something still uses them)
      for (const old of submission?.attachments ?? []) if (!uploads.refs.some((r) => r.fileId === old.fileId)) void bff(`/files/${old.fileId}`, { method: 'DELETE' }).catch(() => undefined);
      toast.success(res.isLate ? 'Handed in — marked as late' : resubmitting ? 'Handed in again' : 'Handed in');
      onDone();
    } catch (e) {
      setFormError(applyApiErrors(form, e) ?? submitMessage(e));
      if (e instanceof ApiError && SUBMIT_ERRORS[e.code]) setFormError(SUBMIT_ERRORS[e.code]!);
    }
  });

  return (
    <Card>
      <CardHeader title={resubmitting ? (submission?.status === 'returned' ? 'Rework and hand in again' : 'Change your hand-in') : 'Hand in your work'} description={lateNow ? 'The due time has passed — this will be marked as late.' : `Due ${due.text}`} />
      <form onSubmit={onSubmit} noValidate>
        <CardBody className="space-y-5 pt-3">
          {submission?.status === 'returned' && submission.feedback && (
            <Banner tone="warning" title="Teacher’s feedback">
              <span className="whitespace-pre-wrap">{submission.feedback}</span>
            </Banner>
          )}
          <FormTextarea control={form.control} name="text" label="Your note" hint={`${text.length.toLocaleString()} / 10,000 — write your answer here, or attach a photo of your notebook.`} rows={6} maxLength={10000} />
          <div className="space-y-2">
            <p className="t-label text-ink">Files</p>
            <AttachmentPicker uploads={uploads} disabled={submit.isPending} />
          </div>
          {formError && <Banner tone="danger">{formError}</Banner>}
          <div className="flex flex-wrap items-center justify-end gap-2">
            {resubmitting && onCancel && (
              <Button type="button" variant="secondary" onClick={() => guard(onCancel)}>
                Cancel
              </Button>
            )}
            <Button type="submit" loading={submit.isPending || form.formState.isSubmitting} disabled={uploads.busy}>
              <CheckCircle2 /> {resubmitting ? 'Hand in again' : 'Hand in'}
            </Button>
          </div>
          {uploads.busy && (
            <p className="t-caption flex items-center gap-1.5 text-ink-2">
              <Clock3 className="size-3.5" aria-hidden /> Uploading files… you can hand in when they’re ready.
            </p>
          )}
        </CardBody>
      </form>
      {dialog}
    </Card>
  );
}
