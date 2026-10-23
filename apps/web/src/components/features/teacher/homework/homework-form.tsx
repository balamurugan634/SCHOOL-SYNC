'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Controller } from 'react-hook-form';
import { z } from 'zod';
import { homeworkCreateBody, type HomeworkCreateBody, type HomeworkItem, type HomeworkUpdateBody } from '@school-sync/shared';
import { ApiError } from '@/lib/problem';
import { fmtDateTime, todayIso } from '@/lib/format';
import { useMyTeaching, type TeachPair } from '@/lib/client/teacher';
import { teacherError, isOutOfScope } from '@/lib/client/teacher-errors';
import { useCreateHomework, useHomework, usePublishHomework, useUpdateHomework } from '@/lib/client/teacher-homework';
import { applyApiErrors, useZodForm } from '@/lib/client/use-zod-form';
import { useUnsavedGuard } from '@/lib/client/use-unsaved-guard';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { FormActions, FormCheckbox, FormInput, FormSection, FormTextarea } from '@/components/ui/form';
import { Field, Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toaster';
import { PageHeader } from '@/components/shell/page-header';
import { useMeContext, usePermissions } from '@/components/me-context';
import { AttachmentPicker, DateTimeField, ErrorCard, OutOfScope, useUrlState, useWriteGate } from '../common';
import { hwClass } from './shared';

/** The shared create schema, with the messages a teacher can act on (same constraints as the API). */
const formSchema = homeworkCreateBody.extend({
  sectionId: z.uuid('Choose a class and subject'),
  subjectId: z.uuid('Choose a class and subject'),
  title: z.string().trim().min(1, 'Add a title').max(200, 'Keep the title under 200 characters'),
  description: z.string().trim().max(5000, 'Keep the description under 5,000 characters').nullish(),
  dueAt: z.iso.datetime({ offset: true, message: 'Pick a due date and time' }),
  maxMarks: z.number('Enter a whole number').int('Enter a whole number').min(1, 'Marks start at 1').max(1000, 'The most you can set is 1,000').nullish(),
});
type FormOut = z.output<typeof formSchema>;

const FIELD_FOR_CODE: Record<string, 'dueAt' | 'maxMarks' | 'subjectId'> = {
  DUE_DATE_PAST: 'dueAt',
  MARKS_EXCEED_MAX: 'maxMarks',
  NOT_TEACHING_SUBJECT: 'subjectId',
  SUBJECT_NOT_OFFERED: 'subjectId',
};

/** `Date.now()` lives outside the component so the render stays pure. */
const isPast = (iso: string): boolean => new Date(iso).getTime() <= Date.now();
const PAST_DUE = 'The due date must be in the future. Pick a later date and time.';
const sameIds = (a: { fileId: string }[], b: { fileId: string }[]) => a.length === b.length && a.every((x, i) => x.fileId === b[i]!.fileId);

/* ───────────────────────── screens ───────────────────────── */

export function NewHomeworkScreen() {
  const { base } = useMeContext();
  const u = useUrlState();
  const { can } = usePermissions();
  const teaching = useMyTeaching();
  const crumbs = [{ label: 'Home', href: base || '/' }, { label: 'Homework', href: `${base}/homework` }, { label: 'New homework' }];

  if (!can('homework:create')) {
    return (
      <>
        <PageHeader title="New homework" crumbs={crumbs} />
        <Card>
          <EmptyState title="You can’t create homework" description="Your role does not include setting homework. If that looks wrong, ask the school office." />
        </Card>
      </>
    );
  }

  const pre = teaching.pairs.find((p) => p.sectionId === u.get('section') && (!u.get('subject') || p.subjectId === u.get('subject'))) ?? null;
  return (
    <>
      <PageHeader title="New homework" description="Save a draft to finish later, or publish it to tell students and guardians." crumbs={crumbs} />
      {teaching.isPending ? (
        <Skeleton className="h-96 w-full max-w-2xl" />
      ) : teaching.error ? (
        <ErrorCard error={teaching.error} onRetry={teaching.refetch} title="We couldn’t load your classes" />
      ) : teaching.pairs.length === 0 ? (
        <Card>
          <EmptyState illustration="empty-generic" title="You aren’t assigned to a class and subject yet" description="Homework is set for a class and subject you teach. Ask the school office to add your teaching assignments." />
        </Card>
      ) : (
        <HomeworkForm mode="create" pairs={teaching.pairs} preselect={pre} />
      )}
    </>
  );
}

export function EditHomeworkScreen({ id }: { id: string }) {
  const { base } = useMeContext();
  const q = useHomework(id);
  const back = `${base}/homework`;
  const crumbs = [{ label: 'Home', href: base || '/' }, { label: 'Homework', href: back }, ...(q.data ? [{ label: q.data.title, href: `${back}/${id}` }] : []), { label: 'Edit' }];

  if (q.isPending)
    return (
      <>
        <PageHeader title="Edit homework" crumbs={crumbs} />
        <Skeleton className="h-96 w-full max-w-2xl" />
      </>
    );
  if (q.isError)
    return (
      <>
        <PageHeader title="Edit homework" crumbs={crumbs} />
        {isOutOfScope(q.error) ? <OutOfScope what="This homework" backHref={back} backLabel="Back to homework" /> : <ErrorCard error={q.error} onRetry={() => void q.refetch()} />}
      </>
    );

  const h = q.data;
  return (
    <>
      <PageHeader title="Edit homework" description={`${hwClass(h)} · ${h.subjectName}`} crumbs={crumbs} />
      {h.status === 'closed' ? (
        <Banner tone="locked" title="This homework is closed">
          Closed homework can’t be edited. Students can no longer submit.
          <div className="mt-3">
            <Button asChild variant="secondary" size="sm">
              <Link href={`${back}/${id}`}>Back to the homework</Link>
            </Button>
          </div>
        </Banner>
      ) : (
        <HomeworkForm mode="edit" initial={h} />
      )}
    </>
  );
}

/* ───────────────────────── the form ───────────────────────── */

type Props = { mode: 'create'; pairs: TeachPair[]; preselect: TeachPair | null; initial?: undefined } | { mode: 'edit'; initial: HomeworkItem; pairs?: undefined; preselect?: undefined };

function HomeworkForm(props: Props) {
  const { mode } = props;
  const initial = props.initial;
  const router = useRouter();
  const { base } = useMeContext();
  const { can } = usePermissions();
  const gate = useWriteGate();
  const create = useCreateHomework();
  const update = useUpdateHomework(initial?.id ?? '');
  const publishM = usePublishHomework();

  const form = useZodForm(formSchema, {
    defaultValues: initial
      ? { sectionId: initial.sectionId, subjectId: initial.subjectId, title: initial.title, description: initial.description ?? '', attachments: initial.attachments, dueAt: initial.dueAt, allowSubmission: initial.allowSubmission, maxMarks: initial.maxMarks, publish: false }
      : { sectionId: props.preselect?.sectionId ?? '', subjectId: props.preselect?.subjectId ?? '', title: '', description: '', attachments: [], dueAt: '', allowSubmission: true, maxMarks: null, publish: false },
  });
  const [formError, setFormError] = React.useState<string | null>(null);
  const [confirm, setConfirm] = React.useState<FormOut | null>(null);
  const [done, setDone] = React.useState(false);
  const errorRef = React.useRef<HTMLDivElement>(null);
  const { guard, dialog } = useUnsavedGuard(form.formState.isDirty && !done);
  const sectionId = form.watch('sectionId');
  const subjectId = form.watch('subjectId');
  const pairId = React.useId();
  const dueId = React.useId();
  const marksId = React.useId();

  React.useEffect(() => {
    if (formError) errorRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [formError]);

  const back = initial ? `${base}/homework/${initial.id}` : `${base}/homework`;
  const status = initial?.status ?? 'draft';
  const canPublish = can('homework:publish') && (mode === 'create' || status === 'draft');
  const canSave = mode === 'create' ? can('homework:create') : can('homework:edit');
  const busy = create.isPending || update.isPending || publishM.isPending;
  const selected = props.pairs?.find((p) => p.sectionId === sectionId && p.subjectId === subjectId);

  const fail = (e: unknown) => {
    const msg = applyApiErrors(form, e);
    const field = e instanceof ApiError ? FIELD_FOR_CODE[e.code] : undefined;
    if (field) {
      form.setError(field, { type: 'server', message: teacherError(e) });
      setFormError(null);
    } else setFormError(msg === null ? null : teacherError(e));
  };

  const run = async (v: FormOut, publish: boolean) => {
    setFormError(null);
    const dueChanged = !initial || new Date(v.dueAt).getTime() !== new Date(initial.dueAt).getTime();
    if ((publish || dueChanged || status === 'draft') && isPast(v.dueAt)) {
      form.setError('dueAt', { type: 'validate', message: PAST_DUE });
      return;
    }
    const description = v.description?.trim() || null;
    try {
      let res: HomeworkItem;
      if (!initial) {
        const body: HomeworkCreateBody = { sectionId: v.sectionId, subjectId: v.subjectId, title: v.title, description, attachments: v.attachments, dueAt: v.dueAt, allowSubmission: v.allowSubmission, maxMarks: v.maxMarks ?? null, publish };
        res = await create.mutateAsync(body);
      } else {
        const patch: HomeworkUpdateBody = {};
        if (v.title !== initial.title) patch.title = v.title;
        if (description !== (initial.description ?? null)) patch.description = description;
        if (dueChanged) patch.dueAt = v.dueAt;
        if (v.allowSubmission !== initial.allowSubmission) patch.allowSubmission = v.allowSubmission;
        if ((v.maxMarks ?? null) !== initial.maxMarks) patch.maxMarks = v.maxMarks ?? null;
        if (!sameIds(v.attachments, initial.attachments)) patch.attachments = v.attachments;
        res = Object.keys(patch).length ? await update.mutateAsync(patch) : initial;
        if (publish) res = await publishM.mutateAsync(initial.id);
      }
      setDone(true);
      toast.success(publish ? 'Homework published' : mode === 'create' ? 'Draft saved' : 'Changes saved', { description: publish ? 'Students and their guardians have been notified.' : `${res.title} · due ${fmtDateTime(res.dueAt)}` });
      router.push(`${base}/homework/${res.id}`);
    } catch (e) {
      setConfirm(null);
      fail(e);
    }
  };

  const onDraft = form.handleSubmit((v) => run(v, false));
  const onPublish = form.handleSubmit((v) => {
    setFormError(null);
    if (isPast(v.dueAt)) {
      form.setError('dueAt', { type: 'validate', message: PAST_DUE });
      return;
    }
    setConfirm(v);
  });

  return (
    <form onSubmit={onDraft} noValidate className="max-w-2xl space-y-5" aria-busy={busy || undefined}>
      {gate.readOnly && <Banner tone="locked" title="Read-only mode">{gate.reason}</Banner>}
      {mode === 'edit' && status === 'published' && <Banner tone="info">This homework is published. Changes are visible to students straight away.</Banner>}
      {formError && (
        <Banner ref={errorRef} tone="danger" title="We couldn’t save this homework" onDismiss={() => setFormError(null)}>
          {formError}
        </Banner>
      )}

      <Card>
        <CardBody className="space-y-5">
          <FormSection title="What is the work?">
            {initial ? (
              <Field label="Class and subject" htmlFor={pairId} hint="A homework can’t be moved to another class. Create a new one instead.">
                <Input id={pairId} value={`${hwClass(initial)} · ${initial.subjectName}`} disabled readOnly />
              </Field>
            ) : (
              <Controller
                control={form.control}
                name="subjectId"
                render={({ field, fieldState }) => (
                  <Field
                    label="Class and subject"
                    htmlFor={pairId}
                    required
                    error={fieldState.error?.message ?? form.formState.errors.sectionId?.message}
                    hint={selected?.via === 'lead' ? 'You lead this class, so you can set work for any of its subjects.' : 'Only classes and subjects you teach or lead are listed.'}
                  >
                    <Select
                      id={pairId}
                      placeholder="Choose a class and subject"
                      invalid={!!fieldState.error || !!form.formState.errors.sectionId}
                      value={sectionId && field.value ? `${sectionId}:${field.value}` : ''}
                      options={(props.pairs ?? []).map((p) => ({ value: `${p.sectionId}:${p.subjectId}`, label: p.via === 'lead' ? `${p.label} (class teacher)` : p.label }))}
                      onValueChange={(v) => {
                        const [s, sub] = v.split(':');
                        form.setValue('sectionId', s ?? '', { shouldDirty: true, shouldValidate: true });
                        field.onChange(sub ?? '');
                      }}
                    />
                  </Field>
                )}
              />
            )}
            <FormInput control={form.control} name="title" label="Title" required maxLength={200} placeholder="e.g. Exercise problems 1 to 10" />
            <FormTextarea control={form.control} name="description" label="Instructions" hint="What students should do, and how to hand it in." rows={5} maxLength={5000} />
          </FormSection>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="space-y-5">
          <FormSection title="Deadline and hand-in">
            <Controller
              control={form.control}
              name="dueAt"
              render={({ field, fieldState }) => (
                <Field label="Due" htmlFor={dueId} required error={fieldState.error?.message} hint="Work handed in after this time is marked as late.">
                  <DateTimeField id={dueId} value={field.value} min={todayIso()} invalid={!!fieldState.error} onChange={(iso) => field.onChange(iso ?? '')} />
                </Field>
              )}
            />
            <FormCheckbox control={form.control} name="allowSubmission" label="Students hand it in online" hint="Turn this off for work done in the notebook or in class." />
            <Controller
              control={form.control}
              name="maxMarks"
              render={({ field, fieldState }) => (
                <Field label="Maximum marks" htmlFor={marksId} error={fieldState.error?.message} hint="Optional. Leave empty if this work isn’t marked.">
                  <Input
                    id={marksId}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={1000}
                    step={1}
                    className="sm:max-w-40"
                    value={field.value ?? ''}
                    onChange={(e) => field.onChange(e.target.value === '' ? null : Number(e.target.value))}
                    onBlur={field.onBlur}
                    invalid={!!fieldState.error}
                  />
                </Field>
              )}
            />
          </FormSection>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <Controller control={form.control} name="attachments" render={({ field }) => <AttachmentPicker value={field.value ?? []} onChange={field.onChange} purpose="homework" max={10} disabled={gate.readOnly} label="Attachments" hint="Worksheets, images or documents. Up to 10 files." />} />
        </CardBody>
      </Card>

      <FormActions className="bottom-14 rounded-lg border shadow-pop md:bottom-4">
        <Button type="button" variant="ghost" onClick={() => guard(() => router.push(back))}>
          Cancel
        </Button>
        {canSave && (
          <Button type="submit" variant="secondary" loading={(create.isPending || update.isPending) && !confirm} disabled={gate.readOnly || busy} title={gate.reason}>
            {mode === 'create' ? 'Save as draft' : 'Save changes'}
          </Button>
        )}
        {canPublish && (
          <Button type="button" onClick={() => void onPublish()} disabled={gate.readOnly || busy} title={gate.reason}>
            {mode === 'create' ? 'Publish now' : 'Save and publish'}
          </Button>
        )}
      </FormActions>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && !busy && setConfirm(null)}
        title="Publish this homework?"
        description={
          <>
            “{confirm?.title}” goes to {(selected ? selected.sectionName : initial ? hwClass(initial) : 'the class')}. Students and their verified guardians are notified straight away.
          </>
        }
        confirmLabel="Publish and notify"
        loading={busy}
        onConfirm={() => confirm && void run(confirm, true)}
      />
      {dialog}
    </form>
  );
}

