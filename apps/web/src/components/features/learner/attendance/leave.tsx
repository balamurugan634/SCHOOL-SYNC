'use client';

import * as React from 'react';
import { FileText, Paperclip, Plus, RotateCw, Trash2 } from 'lucide-react';
import { z } from 'zod';
import { LEAVE_STATUSES, LEAVE_TYPES, leaveCreateBody, type LeaveItem } from '@school-sync/shared';
import { useCancelLeave, useCreateLeave, useLeaves } from '@/lib/client/learner-attendance';
import { bff } from '@/lib/client/fetcher';
import { checkUpload, fileHref, formatBytes, MAX_UPLOAD_BYTES, UPLOAD_ACCEPT, uploadFile } from '@/lib/client/learner-files';
import { applyApiErrors, useZodForm } from '@/lib/client/use-zod-form';
import { useUnsavedGuard } from '@/lib/client/use-unsaved-guard';
import { ApiError, errorMessage } from '@/lib/problem';
import { fmtDate, plural, todayIso } from '@/lib/format';
import { Badge, StatusChip } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Drawer, DrawerContent, SheetBody, SheetFooter } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { FormDate, FormSection, FormSelect, FormTextarea } from '@/components/ui/form';
import { Field } from '@/components/ui/input';
import { ProgressBar } from '@/components/ui/progress';
import { Select } from '@/components/ui/select';
import { toast } from '@/components/ui/toaster';
import { useLearner, useGates } from '../use-learner';
import { usePageParam, useUrlParams } from '../url-state';

const TYPE_LABEL: Record<string, string> = { sick: 'Sick', casual: 'Casual', family: 'Family', event: 'Event / competition', other: 'Other' };
const typeOptions = LEAVE_TYPES.map((t) => ({ value: t, label: TYPE_LABEL[t] ?? t }));
const STATUS_FILTER = [{ value: 'all', label: 'All requests' }, ...LEAVE_STATUSES.map((s) => ({ value: s, label: s.replace(/^\w/, (c) => c.toUpperCase()) }))];

const span = (a: string, b: string) => (a === b ? fmtDate(a) : `${fmtDate(a, { day: 'numeric', month: 'short' })} – ${fmtDate(b)}`);

/** Leave requests of the learner on screen, with apply / cancel. Parents normally apply; students may when allowed. */
export function LeavePanel() {
  const l = useLearner();
  const { can, readOnly } = useGates();
  const { get, set } = useUrlParams();
  const [page, setPage] = usePageParam('lpage');
  const raw = get('lstatus');
  const status = (LEAVE_STATUSES as readonly string[]).includes(raw ?? '') ? (raw as string) : '';
  const [pageSize, setPageSize] = React.useState(10);
  const q = useLeaves(l.studentId, l.isParent, { page, pageSize, status });
  const cancel = useCancelLeave();
  const [open, setOpen] = React.useState(false);
  const [cancelling, setCancelling] = React.useState<LeaveItem | null>(null);
  const canApply = can('leave:create');

  const doCancel = async () => {
    if (!cancelling) return;
    try {
      await cancel.mutateAsync(cancelling.id);
      toast.success('Leave request cancelled');
      setCancelling(null);
    } catch (e) {
      toast.error(errorMessage(e), { duration: 8000 });
      setCancelling(null);
    }
  };

  const columns: Column<LeaveItem>[] = [
    { id: 'dates', header: 'Dates', cell: (r) => <span className="font-medium">{span(r.fromDate, r.toDate)}</span>, mobile: 'title' },
    { id: 'type', header: 'Type', cell: (r) => TYPE_LABEL[r.leaveType] ?? r.leaveType, mobile: 'sub' },
    { id: 'days', header: 'School days', cell: (r) => plural(r.days, 'day'), align: 'right', mobile: 'detail', label: 'School days' },
    {
      id: 'reason',
      header: 'Reason',
      cell: (r) => (
        <div className="max-w-[28ch]">
          <span className="line-clamp-2 text-ink-2">{r.reason}</span>
          {r.attachmentFileId && (
            <a href={fileHref(r.attachmentFileId)} target="_blank" rel="noopener noreferrer" className="t-caption mt-0.5 inline-flex min-h-6 items-center gap-1 text-brand-ink underline-offset-4 hover:underline">
              <Paperclip className="size-3" aria-hidden /> Attachment
            </a>
          )}
        </div>
      ),
      mobile: 'detail',
      label: 'Reason',
    },
    {
      id: 'decision',
      header: 'Decision',
      cell: (r) => (r.decisionNote ? <span className="line-clamp-2 max-w-[24ch] text-ink-2" title={r.decisionNote}>{r.decisionNote}</span> : r.decidedByName ? <span className="text-ink-2">By {r.decidedByName}</span> : <span className="text-ink-3">—</span>),
      mobile: 'detail',
      label: 'School’s note',
    },
    { id: 'status', header: 'Status', cell: (r) => <StatusChip status={r.status} />, mobile: 'status' },
    {
      id: 'action',
      header: <span className="sr-only">Actions</span>,
      cell: (r) =>
        r.canCancel ? (
          <Button variant="ghost" size="sm" disabled={readOnly} onClick={() => setCancelling(r)} aria-label={`Cancel leave request for ${span(r.fromDate, r.toDate)}`}>
            Cancel
          </Button>
        ) : null,
      hideable: false,
      align: 'right',
      mobile: 'hide',
    },
  ];

  return (
    <div className="space-y-4">
      {!canApply && <Banner tone="info">{l.isParent ? 'Your account can’t apply for leave. Please contact the school office.' : 'Leave is applied for by a parent or guardian. Ask them to request it from their app, or contact the class teacher.'}</Banner>}
      <DataTable
        id="learner-leave"
        caption="Leave requests"
        rows={q.data?.data}
        rowKey={(r) => r.id}
        columns={columns}
        loading={q.isPending}
        error={q.isError && !q.data ? q.error : undefined}
        onRetry={() => void q.refetch()}
        page={page}
        pageSize={pageSize}
        total={q.data?.meta.total}
        onPageChange={setPage}
        onPageSizeChange={(n) => {
          setPageSize(n);
          setPage(1);
        }}
        filters={
          <Select aria-label="Filter by status" className="w-44" value={status || 'all'} onValueChange={(v) => set({ lstatus: v === 'all' ? null : v, lpage: null })} options={STATUS_FILTER} />
        }
        toolbar={
          canApply ? (
            <Button size="sm" onClick={() => setOpen(true)} disabled={readOnly} className="ml-1">
              <Plus /> Apply for leave
            </Button>
          ) : undefined
        }
        empty={
          status ? (
            <EmptyState illustration="no-results" title="No requests with that status" filters={<Badge variant="outline">{status}</Badge>} action={<Button variant="secondary" size="sm" onClick={() => set({ lstatus: null, lpage: null })}>Clear filter</Button>} compact />
          ) : (
            <EmptyState illustration="empty-events" title="No leave requests yet" description={canApply ? `Apply when ${l.isParent ? `${l.name} needs` : 'you need'} to be away from school. Approved leave is not counted against attendance.` : 'Requests made for this student will be listed here.'} action={canApply ? <Button size="sm" onClick={() => setOpen(true)} disabled={readOnly}><Plus /> Apply for leave</Button> : undefined} compact />
          )
        }
      />
      {canApply && <LeaveDrawer open={open} onOpenChange={setOpen} />}
      <ConfirmDialog
        open={!!cancelling}
        onOpenChange={(o) => !o && setCancelling(null)}
        title="Cancel this leave request?"
        description={cancelling ? `Your request for ${span(cancelling.fromDate, cancelling.toDate)} (${plural(cancelling.days, 'school day')}) will be withdrawn. You can apply again at any time.` : ''}
        confirmLabel="Cancel request"
        cancelLabel="Keep it"
        destructive
        loading={cancel.isPending}
        onConfirm={() => void doCancel()}
      />
    </div>
  );
}

// ───────────────────────────── apply drawer ─────────────────────────────

/** The shared body schema, with a form-friendly shape (the optional attachment id is added at submit time). */
const leaveForm = z
  .object({
    leaveType: z.enum(LEAVE_TYPES),
    fromDate: z.string().min(1, 'Pick the first day'),
    toDate: z.string().min(1, 'Pick the last day'),
    reason: z.string().trim().min(3, 'Tell the school why (at least 3 characters)').max(1000, 'Keep it under 1000 characters'),
  })
  .refine((b) => !b.fromDate || !b.toDate || b.fromDate <= b.toDate, { message: 'The last day can’t be before the first day', path: ['toDate'] });

type Attachment = { state: 'idle' } | { state: 'uploading'; file: File; pct: number } | { state: 'done'; fileId: string; name: string; size: number } | { state: 'error'; file: File; message: string };

function AttachmentPicker({ value, onChange, disabled }: { value: Attachment; onChange: (a: Attachment) => void; disabled?: boolean }) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const abort = React.useRef<AbortController | null>(null);
  const id = React.useId();

  const start = React.useCallback(
    async (file: File) => {
      const problem = checkUpload(file);
      if (problem) {
        onChange({ state: 'error', file, message: problem });
        return;
      }
      const ctl = new AbortController();
      abort.current = ctl;
      onChange({ state: 'uploading', file, pct: 0 });
      try {
        const up = await uploadFile(file, 'document', { signal: ctl.signal, onProgress: (pct) => onChange({ state: 'uploading', file, pct }) });
        onChange({ state: 'done', fileId: up.attachment.fileId, name: up.attachment.name, size: up.sizeBytes });
      } catch (e) {
        if (e instanceof ApiError && e.code === 'UPLOAD_ABORTED') onChange({ state: 'idle' });
        else onChange({ state: 'error', file, message: errorMessage(e) });
      }
    },
    [onChange],
  );

  const remove = async () => {
    const prev = value;
    onChange({ state: 'idle' });
    if (prev.state === 'done') void bff(`/files/${prev.fileId}`, { method: 'DELETE' }).catch(() => undefined); // best effort: the file was never attached
  };

  return (
    <Field label="Attachment (optional)" htmlFor={id} hint={`A doctor’s note or letter. Photos, PDF or Word, up to ${formatBytes(MAX_UPLOAD_BYTES)}.`} error={value.state === 'error' ? value.message : null}>
      <input
        ref={inputRef}
        id={id}
        type="file"
        accept={UPLOAD_ACCEPT}
        className="sr-only"
        disabled={disabled || value.state === 'uploading'}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void start(f);
        }}
      />
      {value.state === 'idle' && (
        <Button type="button" variant="secondary" size="sm" disabled={disabled} onClick={() => inputRef.current?.click()}>
          <Paperclip /> Choose a file
        </Button>
      )}
      {value.state === 'uploading' && (
        <div className="space-y-2 rounded-md border border-border p-3" role="status" aria-live="polite">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2"><FileText className="size-4 shrink-0 text-ink-3" aria-hidden /><span className="truncate">{value.file.name}</span></span>
            <span className="tnum t-caption text-ink-2">{value.pct}%</span>
          </div>
          <ProgressBar value={value.pct} label={`Uploading ${value.file.name}`} />
          <Button type="button" variant="ghost" size="sm" onClick={() => abort.current?.abort()}>Cancel upload</Button>
        </div>
      )}
      {value.state === 'done' && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-subtle px-3 py-2 text-sm">
          <span className="flex min-w-0 items-center gap-2"><FileText className="size-4 shrink-0 text-ink-3" aria-hidden /><span className="truncate">{value.name}</span><span className="t-caption shrink-0 text-ink-3">{formatBytes(value.size)}</span></span>
          <Button type="button" variant="ghost" size="sm" onClick={() => void remove()} aria-label={`Remove ${value.name}`}><Trash2 /> Remove</Button>
        </div>
      )}
      {value.state === 'error' && (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => void start(value.file)}><RotateCw /> Try again</Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange({ state: 'idle' })}>Choose another file</Button>
        </div>
      )}
    </Field>
  );
}

function LeaveDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const l = useLearner();
  const create = useCreateLeave();
  const [formError, setFormError] = React.useState<string | null>(null);
  const [att, setAtt] = React.useState<Attachment>({ state: 'idle' });
  const today = todayIso();
  const form = useZodForm(leaveForm, { defaultValues: { leaveType: 'sick', fromDate: today, toDate: today, reason: '' } });
  const dirty = form.formState.isDirty || att.state !== 'idle';
  const { guard, dialog } = useUnsavedGuard(dirty && open);
  const from = form.watch('fromDate');

  React.useEffect(() => {
    if (open) {
      form.reset({ leaveType: 'sick', fromDate: todayIso(), toDate: todayIso(), reason: '' });
      setAtt({ state: 'idle' });
      setFormError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = form.handleSubmit(async (v) => {
    setFormError(null);
    if (att.state === 'uploading') {
      setFormError('Wait for the attachment to finish uploading, or cancel it.');
      return;
    }
    if (att.state === 'error') {
      setFormError('The attachment didn’t upload. Try it again or choose another file — or remove it to apply without one.');
      return;
    }
    const body = leaveCreateBody.safeParse({ ...v, studentId: l.isParent ? (l.studentId ?? undefined) : undefined, attachmentFileId: att.state === 'done' ? att.fileId : undefined });
    if (!body.success) {
      setFormError(body.error.issues[0]?.message ?? 'Check the form and try again.');
      return;
    }
    try {
      await create.mutateAsync(body.data);
      toast.success('Leave request sent', { description: 'You’ll be told when the school responds.' });
      form.reset();
      setAtt({ state: 'idle' });
      onOpenChange(false);
    } catch (e) {
      setFormError(applyApiErrors(form, e));
    }
  });

  return (
    <>
      <Drawer open={open} onOpenChange={(o) => (o ? onOpenChange(true) : guard(() => onOpenChange(false)))}>
        <DrawerContent title="Apply for leave" description={l.isParent ? `For ${l.name}` : 'Tell the school when you’ll be away'} showTitle onInteractOutside={(e) => dirty && (e.preventDefault(), guard(() => onOpenChange(false)))}>
          <form onSubmit={submit} noValidate className="flex h-full flex-col">
            <SheetBody className="flex-1">
              <FormSection title="When">
                <FormSelect control={form.control} name="leaveType" label="Type of leave" required options={typeOptions} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormDate control={form.control} name="fromDate" label="First day" required />
                  <FormDate control={form.control} name="toDate" label="Last day" required min={from || undefined} />
                </div>
              </FormSection>
              <FormSection title="Why">
                <FormTextarea control={form.control} name="reason" label="Reason" required rows={4} maxLength={1000} hint="A sentence or two is enough." />
                <AttachmentPicker value={att} onChange={setAtt} disabled={create.isPending} />
              </FormSection>
              {formError && <Banner tone="danger">{formError}</Banner>}
              <Card className="bg-surface-subtle p-3 shadow-none"><p className="t-caption text-ink-2">Only school days are counted. The class teacher or office will approve or decline, and approved days don’t count against attendance.</p></Card>
            </SheetBody>
            <SheetFooter>
              <Button type="button" variant="secondary" onClick={() => guard(() => onOpenChange(false))}>
                Cancel
              </Button>
              <Button type="submit" loading={form.formState.isSubmitting || create.isPending} disabled={att.state === 'uploading'}>
                Send request
              </Button>
            </SheetFooter>
          </form>
        </DrawerContent>
      </Drawer>
      {dialog}
    </>
  );
}
