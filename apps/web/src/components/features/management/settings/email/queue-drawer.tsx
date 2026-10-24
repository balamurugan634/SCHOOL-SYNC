'use client';

import * as React from 'react';
import { Ban, RotateCcw, Send, Trash2 } from 'lucide-react';
import { EMAIL_QUEUE_STATUS_LABELS, type EmailQueueAction, type EmailQueueDetail } from '@school-sync/shared';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Drawer, DrawerContent, SheetBody, SheetFooter } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useEmailQueueActions, useEmailQueueItem } from '@/lib/client/email';
import { fmtDateTime } from '@/lib/format';
import { useAccess } from '../../shared/access';
import { DefList, ErrorPanel } from '../../shared/detail';
import { priorityLabel, QueueStatusBadge } from './email-bits';

const VIA: Record<string, string> = { account: 'The school’s own account', platform: 'The SchoolSync default sender', platform_fallback: 'The SchoolSync default sender (the school’s account failed)' };

function BodyPreview({ m }: { m: EmailQueueDetail }) {
  if (m.bodyHidden) {
    return <p className="rounded-lg border border-border bg-surface-subtle p-3 text-sm text-ink-2">This is a one-time message (for example a password reset link). Its content is kept secret, so it is never shown here, and it is erased once it has been sent.</p>;
  }
  if (!m.textBody && !m.htmlBody) return <p className="text-sm text-ink-2">The content is no longer stored.</p>;
  return (
    <div className="space-y-3">
      {m.textBody && <pre tabIndex={0} aria-label="Message text" className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-surface-subtle p-3 font-sans text-[13px] leading-5">{m.textBody}</pre>}
      {m.htmlBody && (
        <details className="rounded-lg border border-border">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium">HTML version (shown as source)</summary>
          <pre tabIndex={0} aria-label="Message HTML source" className="max-h-60 overflow-auto whitespace-pre-wrap break-all border-t border-border bg-surface-subtle p-3 font-mono text-xs">{m.htmlBody}</pre>
        </details>
      )}
    </div>
  );
}

type Confirm = EmailQueueAction | null;

/** One queued email: status, recipients, error, attempts, a body preview, and Send now / Retry / Cancel / Delete. */
export function QueueDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const access = useAccess();
  const editable = access.ok('settings:edit', 'school');
  const q = useEmailQueueItem(id);
  const actions = useEmailQueueActions();
  const [confirm, setConfirm] = React.useState<Confirm>(null);
  const m = q.data;

  const can = {
    send_now: !!m && (m.status === 'not_sent' || m.status === 'error'),
    retry: !!m && (m.status === 'error' || m.status === 'cancelled'),
    cancel: !!m && m.status === 'not_sent',
    delete: !!m && m.status !== 'sending',
  };
  const run = async (action: EmailQueueAction) => {
    if (!id) return;
    const r = await actions.one.run({ id, action });
    if (r.ok) {
      setConfirm(null);
      if (action === 'delete') onClose();
    }
  };

  return (
    <>
      <Drawer open={!!id} onOpenChange={(o) => !o && onClose()}>
        <DrawerContent title={m?.subject ?? 'Email'} description={m ? `${EMAIL_QUEUE_STATUS_LABELS[m.status]} · ${m.to[0] ?? ''}${m.to.length > 1 ? ` +${m.to.length - 1}` : ''}` : 'Email details'} showTitle>
          <SheetBody>
            {q.isPending ? (
              <div className="space-y-3" aria-busy aria-label="Loading email"><Skeleton className="h-5 w-1/2" /><Skeleton className="h-4 w-2/3" /><Skeleton className="h-40 w-full" /></div>
            ) : q.isError || !m ? (
              <ErrorPanel error={q.error} onRetry={() => void q.refetch()} title="We couldn’t load this email" />
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2"><QueueStatusBadge status={m.status} /><span className="t-caption text-ink-2">{priorityLabel(m.priority)} priority · attempt {m.attempts} of {m.maxAttempts}</span></div>
                {m.lastError && (
                  <Banner tone={m.status === 'error' ? 'danger' : 'warning'} title={m.status === 'error' ? 'This email could not be sent' : m.sentVia === 'platform_fallback' ? 'Sent another way' : 'The last attempt failed'}>
                    {m.lastError}
                    {m.status === 'not_sent' && m.nextAttemptAt && <span className="mt-1 block">It will be tried again at {fmtDateTime(m.nextAttemptAt)}.</span>}
                  </Banner>
                )}
                <DefList
                  items={[
                    { label: 'To', value: m.to.join(', ') },
                    { label: 'Cc', value: m.cc.length ? m.cc.join(', ') : null },
                    { label: 'From', value: m.sender },
                    { label: 'Reply-to', value: m.replyTo },
                    { label: 'Subject', value: m.subject },
                    { label: 'Account', value: m.accountName ?? 'SchoolSync default (platform)' },
                    { label: 'Created', value: `${fmtDateTime(m.createdAt)}${m.createdByName ? ` by ${m.createdByName}` : ''}` },
                    { label: 'Next attempt', value: m.status === 'not_sent' && m.nextAttemptAt ? fmtDateTime(m.nextAttemptAt) : null },
                    { label: 'Sent', value: m.sentAt ? fmtDateTime(m.sentAt) : null },
                    { label: 'Sent through', value: m.sentVia ? (VIA[m.sentVia] ?? m.sentVia) : null },
                    { label: 'About', value: m.referenceType ? m.referenceType.replace(/_/g, ' ') : null },
                    { label: 'Message ID', value: m.messageId ? <code className="break-all text-xs">{m.messageId}</code> : null },
                  ]}
                />
                <section aria-labelledby="mail-body-h" className="space-y-2">
                  <h3 id="mail-body-h" className="t-section">Message</h3>
                  <BodyPreview m={m} />
                </section>
              </>
            )}
          </SheetBody>
          {m && (
            <SheetFooter>
              {!editable && <span className="t-caption mr-auto text-ink-2">{access.hint('settings:edit', 'school')}</span>}
              <Button variant="danger" size="sm" disabled={!editable || !can.delete} onClick={() => setConfirm('delete')} title={m.status === 'sending' ? 'It is being sent right now.' : undefined}><Trash2 /> Delete</Button>
              <Button variant="secondary" size="sm" disabled={!editable || !can.cancel} onClick={() => setConfirm('cancel')}><Ban /> Cancel</Button>
              <Button variant="secondary" size="sm" disabled={!editable || !can.retry} onClick={() => void run('retry')} loading={actions.one.isPending && actions.one.variables?.action === 'retry'}><RotateCcw /> Retry</Button>
              <Button size="sm" disabled={!editable || !can.send_now} onClick={() => void run('send_now')} loading={actions.one.isPending && actions.one.variables?.action === 'send_now'}><Send /> Send now</Button>
            </SheetFooter>
          )}
        </DrawerContent>
      </Drawer>
      <ConfirmDialog open={confirm === 'cancel'} onOpenChange={(o) => !o && setConfirm(null)} title="Cancel this email?" description="It will not be sent. You can bring it back with Retry later (a one-time message such as a password reset cannot be brought back)." confirmLabel="Cancel the email" cancelLabel="Keep it" destructive loading={actions.one.isPending} onConfirm={() => void run('cancel')} />
      <ConfirmDialog open={confirm === 'delete'} onOpenChange={(o) => !o && setConfirm(null)} title="Delete this email from the queue?" description={m?.status === 'not_sent' ? 'It has not been sent yet, and deleting it means it never will be. The history entry is removed for good.' : 'The entry and its history are removed for good. An email that was already sent stays sent.'} confirmLabel="Delete" destructive loading={actions.one.isPending} onConfirm={() => void run('delete')} />
    </>
  );
}
