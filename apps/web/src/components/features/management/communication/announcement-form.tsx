'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Controller } from 'react-hook-form';
import { z } from 'zod';
import { ANNOUNCEMENT_PRIORITIES, announcementCreateBody, audienceTargetIn, type AnnouncementItem } from '@school-sync/shared';
import { useAnnouncementAction, useCreateAnnouncement, useUpdateAnnouncement } from '@/lib/client/communication';
import { friendlyError } from '@/lib/client/mgmt';
import { applyApiErrors, useZodForm } from '@/lib/client/use-zod-form';
import { useUnsavedGuard } from '@/lib/client/use-unsaved-guard';
import { fmtZoned, isFuture } from '@/lib/zoned';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { FormCheckbox, FormInput, FormSection, FormSelect, FormTextarea } from '@/components/ui/form';
import { Field } from '@/components/ui/input';
import { toast } from '@/components/ui/toaster';
import { FormDateTime } from '../common/date-time-field';
import { FileUploader, type UploadedFile } from '../common/file-uploader';
import { GuardedButton } from '../common/guarded';
import { useMgmt } from '../common/use-mgmt';
import { AudiencePicker } from './audience-picker';

const PRIORITY_LABEL: Record<string, string> = { normal: 'Normal', important: 'Important', urgent: 'Urgent (also sent as a high-priority notification)' };

const formSchema = announcementCreateBody.extend({
  title: z.string().trim().min(1, 'Write a title').max(200, 'Keep the title under 200 characters'),
  body: z.string().trim().min(1, 'Write the message').max(10_000, 'The message is too long'),
  audience: z.array(audienceTargetIn).min(1, 'Choose who should receive it').max(20),
});

/**
 * Compose or edit an announcement. The same form serves a new announcement and a draft (or scheduled) one.
 * Save a draft, schedule it, or publish now; attachments upload through POST /files (purpose announcement).
 */
export function AnnouncementForm({ announcement, onSaved }: { announcement?: AnnouncementItem; onSaved?: (a: AnnouncementItem) => void }) {
  const router = useRouter();
  const { tz, canWrite, writeBlock, base } = useMgmt();
  const isEdit = !!announcement;
  const create = useCreateAnnouncement();
  const update = useUpdateAnnouncement();
  const action = useAnnouncementAction();
  const [files, setFiles] = React.useState<UploadedFile[]>(announcement?.attachments.map((f) => ({ fileId: f.fileId, name: f.name, sizeBytes: f.sizeBytes, mimeType: f.mimeType })) ?? []);
  const [filesDirty, setFilesDirty] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<'draft' | 'publish' | 'schedule' | null>(null);
  const form = useZodForm(formSchema, {
    defaultValues: announcement
      ? { title: announcement.title, body: announcement.body, priority: announcement.priority, requiresAck: announcement.requiresAck, audience: announcement.audience.map((a) => (a.type === 'all' ? { type: a.type } : { type: a.type, id: a.id })), attachmentFileIds: [], publishAt: announcement.publishAt, expiresAt: announcement.expiresAt }
      : { title: '', body: '', priority: 'normal', requiresAck: false, audience: [], attachmentFileIds: [], publishAt: null, expiresAt: null },
  });
  const dirty = form.formState.isDirty || filesDirty;
  const { guard, dialog } = useUnsavedGuard(dirty);
  const publishAt = form.watch('publishAt');
  const scheduled = !!publishAt && isFuture(publishAt);
  const canPublish = canWrite('announcements:publish');

  const run = (mode: 'draft' | 'publish' | 'schedule') =>
    form.handleSubmit(async (v) => {
      setErr(null);
      if (mode === 'schedule' && !(v.publishAt && new Date(v.publishAt).getTime() > Date.now())) {
        form.setError('publishAt', { message: 'Pick a time in the future to schedule it.' });
        return;
      }
      if (v.expiresAt && new Date(v.expiresAt).getTime() <= Date.now()) {
        form.setError('expiresAt', { message: 'The expiry must be in the future.' });
        return;
      }
      if (v.expiresAt && v.publishAt && new Date(v.expiresAt).getTime() <= new Date(v.publishAt).getTime()) {
        form.setError('expiresAt', { message: 'It must expire after it is published.' });
        return;
      }
      setBusy(mode);
      try {
        const common = { title: v.title, body: v.body, priority: v.priority, requiresAck: v.requiresAck, audience: v.audience, attachmentFileIds: files.map((f) => f.fileId), expiresAt: v.expiresAt ?? null };
        const publishAtForSave = mode === 'draft' ? (v.publishAt ?? null) : mode === 'schedule' ? v.publishAt! : null;
        let saved: AnnouncementItem;
        if (isEdit) saved = await update.mutateAsync({ id: announcement.id, body: { ...common, publishAt: publishAtForSave } });
        else saved = await create.mutateAsync({ ...common, publishAt: publishAtForSave });
        if (mode === 'publish') saved = await action.mutateAsync({ id: saved.id, action: 'publish' });
        form.reset(form.getValues());
        setFilesDirty(false);
        toast.success(mode === 'publish' ? 'Announcement published' : mode === 'schedule' || saved.state === 'scheduled' ? `Scheduled for ${fmtZoned(saved.publishAt, tz)}` : isEdit ? 'Changes saved' : 'Draft saved');
        if (onSaved) onSaved(saved);
        else router.push(`${base}/communication/announcements/${saved.id}`);
      } catch (e) {
        setErr(applyApiErrors(form, e) ?? friendlyError(e));
        // a failed publish after the draft was saved: keep the user on the saved draft
      } finally {
        setBusy(null);
      }
    }, () => setErr('Please fix the highlighted fields.'))();

  return (
    <>
      <form onSubmit={(e) => e.preventDefault()} noValidate className="space-y-8">
        <FormSection title="Message">
          <FormInput control={form.control} name="title" label="Title" required maxLength={200} placeholder="Annual Day: rehearsal schedule" />
          <FormTextarea control={form.control} name="body" label="Message" required rows={8} maxLength={10_000} hint="Plain text. Line breaks are kept." />
        </FormSection>

        <FormSection title="Who receives it">
          <Controller control={form.control} name="audience" render={({ field, fieldState }) => <AudiencePicker value={field.value ?? []} onChange={field.onChange} perm="announcements:create" initialLabels={announcement?.audience} error={fieldState.error?.message ?? (form.formState.errors.audience as { message?: string } | undefined)?.message ?? null} />} />
        </FormSection>

        <FormSection title="Options">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormSelect control={form.control} name="priority" label="Priority" options={ANNOUNCEMENT_PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p]! }))} />
          </div>
          <FormCheckbox control={form.control} name="requiresAck" label="Ask recipients to acknowledge it" hint="Everyone has to tap “I have read this”; you can see who has not and follow up." />
          <Field label="Attachments" hint="Up to 10 files: images, PDFs and documents.">
            <FileUploader
              purpose="announcement"
              max={10}
              value={files}
              onChange={(v) => {
                setFiles(v);
                setFilesDirty(true);
              }}
              label="Attach files"
            />
          </Field>
        </FormSection>

        <FormSection title="Timing" description="Optional. Without a time it is published when you press Publish.">
          <FormDateTime control={form.control} name="publishAt" label="Publish at" tz={tz} min={new Date().toISOString().slice(0, 10)} hint={`School time (${tz}). Scheduling needs permission to publish.`} />
          <FormDateTime control={form.control} name="expiresAt" label="Stop showing it at" tz={tz} hint="After this it disappears from feeds and is archived." />
        </FormSection>

        {err && <Banner tone="danger">{err}</Banner>}
        {!canPublish && <Banner tone="info">Your role can write announcements but not publish them. Save it as a draft and ask someone with publish rights.</Banner>}

        <div className="sticky bottom-0 -mx-1 flex flex-wrap items-center justify-end gap-2 border-t border-border bg-bg/95 px-1 py-3 backdrop-blur">
          <Button
            type="button"
            variant="ghost"
            onClick={() =>
              guard(() => {
                if (isEdit) {
                  form.reset();
                  setFiles(announcement.attachments.map((f) => ({ fileId: f.fileId, name: f.name, sizeBytes: f.sizeBytes, mimeType: f.mimeType })));
                  setFilesDirty(false);
                } else router.push(`${base}/communication/announcements`);
              })
            }
          >
            {isEdit ? 'Discard changes' : 'Cancel'}
          </Button>
          <Button type="button" variant="secondary" loading={busy === 'draft'} disabled={!!busy && busy !== 'draft'} onClick={() => void run('draft')}>
            {isEdit ? 'Save changes' : 'Save draft'}
          </Button>
          {scheduled && (
            <GuardedButton blocked={writeBlock('announcements:publish')} type="button" loading={busy === 'schedule'} disabled={!!busy && busy !== 'schedule'} onClick={() => void run('schedule')}>
              Schedule
            </GuardedButton>
          )}
          <GuardedButton blocked={writeBlock('announcements:publish')} type="button" variant={scheduled ? 'secondary' : 'primary'} loading={busy === 'publish'} disabled={!!busy && busy !== 'publish'} onClick={() => void run('publish')}>
            Publish now
          </GuardedButton>
        </div>
      </form>
      {dialog}
    </>
  );
}
