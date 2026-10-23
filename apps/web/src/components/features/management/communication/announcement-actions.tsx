'use client';

import * as React from 'react';
import type { AnnouncementItem } from '@school-sync/shared';
import { useAnnouncementAction, useDeleteAnnouncement, useUpdateAnnouncement } from '@/lib/client/communication';
import { fmtZoned, isFuture } from '@/lib/zoned';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/input';
import { toast } from '@/components/ui/toaster';
import { friendlyError } from '@/lib/client/mgmt';
import { AsyncConfirm } from '../common/dialogs';
import { DateTimeField } from '../common/date-time-field';
import { useMgmt } from '../common/use-mgmt';

export type AnnouncementOp = 'publish' | 'schedule' | 'unschedule' | 'expire' | 'archive' | 'delete' | 'expiry';

/** What the viewer may do with an announcement in its current state (the API has the final say). */
export function availableOps(a: AnnouncementItem, can: (p: 'announcements:publish' | 'announcements:edit' | 'announcements:delete') => boolean): { op: AnnouncementOp; label: string; perm: 'announcements:publish' | 'announcements:edit' | 'announcements:delete'; danger?: boolean }[] {
  if (!a.canManage) return [];
  const out: { op: AnnouncementOp; label: string; perm: 'announcements:publish' | 'announcements:edit' | 'announcements:delete'; danger?: boolean }[] = [];
  if (a.state === 'draft') out.push({ op: 'publish', label: 'Publish now', perm: 'announcements:publish' }, { op: 'schedule', label: 'Schedule…', perm: 'announcements:publish' }, { op: 'delete', label: 'Delete draft', perm: 'announcements:edit', danger: true });
  if (a.state === 'scheduled') out.push({ op: 'publish', label: 'Publish now', perm: 'announcements:publish' }, { op: 'schedule', label: 'Change time…', perm: 'announcements:publish' }, { op: 'unschedule', label: 'Back to draft', perm: 'announcements:publish' }, { op: 'delete', label: 'Delete', perm: 'announcements:edit', danger: true });
  if (a.state === 'published') out.push({ op: 'expiry', label: 'Change expiry…', perm: 'announcements:publish' }, { op: 'expire', label: 'End now', perm: 'announcements:publish' }, { op: 'archive', label: 'Archive', perm: 'announcements:delete' });
  if (a.state === 'expired') out.push({ op: 'archive', label: 'Archive', perm: 'announcements:delete' });
  return out.filter((o) => o.op === 'archive' || o.op === 'delete' ? can(o.perm) || can('announcements:edit') : can(o.perm));
}

/**
 * One place for the confirm dialogs of every announcement action (list rows and the detail header share it).
 * Each states the consequence; failures stay visible in the dialog.
 */
export function useAnnouncementOps(onDone?: (op: AnnouncementOp, a: AnnouncementItem) => void) {
  const { tz } = useMgmt();
  const act = useAnnouncementAction();
  const del = useDeleteAnnouncement();
  const upd = useUpdateAnnouncement();
  const [state, setState] = React.useState<{ op: AnnouncementOp; a: AnnouncementItem } | null>(null);
  const [when, setWhen] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const request = React.useCallback(
    (op: AnnouncementOp, a: AnnouncementItem) => {
      setErr(null);
      setBusy(false);
      setWhen(op === 'schedule' ? a.publishAt : op === 'expiry' ? a.expiresAt : null);
      setState({ op, a });
    },
    [],
  );
  const close = () => setState(null);
  const finish = (op: AnnouncementOp, a: AnnouncementItem, msg: string) => {
    toast.success(msg);
    close();
    onDone?.(op, a);
  };

  const dialogs = (() => {
    if (!state) return null;
    const { op, a } = state;
    const audience = a.audience.map((x) => x.label).join(', ') || 'the audience';
    if (op === 'schedule' || op === 'expiry') {
      const isSchedule = op === 'schedule';
      const invalid = isSchedule ? !when || !isFuture(when) : !!when && !isFuture(when);
      return (
        <Dialog open onOpenChange={(o) => !o && !busy && close()}>
          <DialogContent title={isSchedule ? 'Schedule this announcement' : 'Change when it expires'} description={a.title}>
            <div className="mt-4 space-y-4">
              <Field label={isSchedule ? 'Publish at' : 'Stop showing it at'} required={isSchedule} hint={isSchedule ? `It is published automatically at this time (school time, ${tz}) and ${audience} are notified.` : 'Leave empty to keep it up until someone ends or archives it.'} error={invalid ? (isSchedule ? 'Pick a time in the future.' : 'The expiry must be in the future.') : null}>
                <DateTimeField value={when} onChange={setWhen} tz={tz} invalid={invalid} />
              </Field>
              {err && <Banner tone="danger">{err}</Banner>}
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={close} disabled={busy}>
                  Cancel
                </Button>
                <Button
                  loading={busy}
                  disabled={invalid || (isSchedule && !when)}
                  onClick={async () => {
                    setBusy(true);
                    setErr(null);
                    try {
                      if (isSchedule) await act.mutateAsync({ id: a.id, action: 'schedule', publishAt: when! });
                      else await upd.mutateAsync({ id: a.id, body: { expiresAt: when } });
                      finish(op, a, isSchedule ? `Scheduled for ${fmtZoned(when, tz)}` : when ? `Expires ${fmtZoned(when, tz)}` : 'Expiry removed');
                    } catch (e) {
                      setErr(friendlyError(e));
                      setBusy(false);
                    }
                  }}
                >
                  {isSchedule ? 'Schedule' : 'Save'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      );
    }
    const spec = {
      publish: { title: `Publish “${a.title}” now?`, body: `It goes out immediately to ${audience} and they are notified. A published announcement cannot be unsent; you can end it later and it disappears from their feeds.`, confirm: 'Publish now', done: 'Announcement published', destructive: false },
      unschedule: { title: 'Take this back to a draft?', body: 'It will not be published automatically any more. You can edit it and schedule or publish it again.', confirm: 'Back to draft', done: 'Back to draft', destructive: false },
      expire: { title: `End “${a.title}” now?`, body: 'It disappears from everyone’s feed straight away and is archived shortly after. The delivery history is kept.', confirm: 'End announcement', done: 'Announcement ended', destructive: true },
      archive: { title: `Archive “${a.title}”?`, body: 'It leaves the active lists. Who read and acknowledged it stays available in the history.', confirm: 'Archive', done: 'Announcement archived', destructive: false },
      delete: { title: `Delete the draft “${a.title}”?`, body: 'The draft and its attachments are removed. This cannot be undone.', confirm: 'Delete draft', done: 'Draft deleted', destructive: true },
    }[op];
    return (
      <AsyncConfirm
        open
        onOpenChange={(o) => !o && close()}
        title={spec.title}
        description={spec.body}
        confirmLabel={spec.confirm}
        destructive={spec.destructive}
        onConfirm={async () => {
          if (op === 'delete') await del.mutateAsync({ id: a.id });
          else await act.mutateAsync({ id: a.id, action: op });
          finish(op, a, spec.done);
        }}
      />
    );
  })();

  return { request, dialogs };
}
