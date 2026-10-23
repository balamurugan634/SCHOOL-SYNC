'use client';

import * as React from 'react';
import { AlertTriangle, CheckCircle2, Download, Megaphone, Paperclip } from 'lucide-react';
import type { AnnouncementItem } from '@school-sync/shared';
import { cn } from '@/lib/cn';
import { errorMessage } from '@/lib/problem';
import { useAckAnnouncement, useAnnouncement, useAnnouncements, useAnnouncementUnread, useMarkAnnouncementRead } from '@/lib/client/learner-comms';
import { fileHref, formatBytes } from '@/lib/client/learner-files';
import { Badge } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Drawer, DrawerContent, SheetBody, SheetFooter } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toaster';
import { ErrorState, SkeletonRows } from '../states';
import { useGates } from '../use-learner';
import { useUrlParams, usePageParam } from '../url-state';
import { ago, fmtWhen, Pager, Segmented } from './common';

const PAGE_SIZE = 10;
const PRIORITIES = [
  { value: 'all', label: 'All priorities' },
  { value: 'urgent', label: 'Urgent' },
  { value: 'important', label: 'Important' },
  { value: 'normal', label: 'Normal' },
];

export function PriorityBadge({ priority }: { priority: AnnouncementItem['priority'] }) {
  if (priority === 'urgent') return <Badge variant="danger" icon={<AlertTriangle aria-hidden />}>Urgent</Badge>;
  if (priority === 'important') return <Badge variant="warning" icon={<AlertTriangle aria-hidden />}>Important</Badge>;
  return null;
}

/** Announcements feed (GET /announcements) with unread state; details, read and acknowledge live in a drawer (`?open=<id>`). */
export function AnnouncementsPanel() {
  const { get, set } = useUrlParams();
  const [page, setPage] = usePageParam();
  const unread = get('unread') === '1';
  const priority = get('priority') ?? 'all';
  const open = get('open');
  const q = useAnnouncements({ page, pageSize: PAGE_SIZE, unread, priority: priority === 'all' ? undefined : priority });
  const counts = useAnnouncementUnread();
  const filtered = unread || priority !== 'all';
  const clear = () => set({ unread: null, priority: null, page: null });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          label="Show"
          value={unread ? 'unread' : 'all'}
          onChange={(v) => set({ unread: v === 'unread' ? '1' : null, page: null })}
          options={[
            { value: 'all', label: 'All' },
            { value: 'unread', label: 'Unread' },
          ]}
        />
        <Select aria-label="Priority" className="w-40" value={priority} onValueChange={(v) => set({ priority: v === 'all' ? null : v, page: null })} options={PRIORITIES} />
        {counts.data && (counts.data.unread > 0 || counts.data.pendingAck > 0) && (
          <p className="t-caption ml-auto text-ink-2" aria-live="polite">
            {counts.data.unread} unread{counts.data.pendingAck > 0 ? ` · ${counts.data.pendingAck} waiting for your acknowledgement` : ''}
          </p>
        )}
      </div>

      <Card className="overflow-hidden">
        {q.isPending ? (
          <SkeletonRows rows={5} />
        ) : q.isError && !q.data ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : q.data && q.data.data.length === 0 ? (
          filtered ? (
            <EmptyState
              illustration="no-results"
              title="No announcements match"
              filters={
                <>
                  {unread && <Badge variant="outline">Unread only</Badge>}
                  {priority !== 'all' && <Badge variant="outline">{PRIORITIES.find((p) => p.value === priority)?.label}</Badge>}
                </>
              }
              action={<Button variant="secondary" size="sm" onClick={clear}>Clear filters</Button>}
            />
          ) : (
            <EmptyState illustration="empty-notifications" title="No announcements yet" description="Notices from the school will appear here as soon as they are published." />
          )
        ) : (
          <>
            <ul className="divide-y divide-border" aria-busy={q.isFetching || undefined}>
              {q.data?.data.map((a) => (
                <li key={a.id}>
                  <button type="button" onClick={() => set({ open: a.id }, { push: true })} className="tr-colors flex w-full items-start gap-3 px-5 py-4 text-left hover:bg-surface-subtle max-sm:px-4">
                    <span className={cn('mt-[7px] size-2 shrink-0 rounded-full', a.read ? 'bg-transparent' : 'bg-brand')} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        {!a.read && <span className="sr-only">Unread: </span>}
                        <span className={cn('text-sm', a.read ? 'font-medium' : 'font-semibold')}>{a.title}</span>
                        <PriorityBadge priority={a.priority} />
                        {a.requiresAck && (a.acknowledged ? <Badge variant="success" icon={<CheckCircle2 aria-hidden />}>Acknowledged</Badge> : <Badge variant="warning">Needs acknowledgement</Badge>)}
                      </span>
                      <span className="mt-1 line-clamp-2 block text-[13px] text-ink-2">{a.body}</span>
                      <span className="t-caption mt-1.5 flex flex-wrap items-center gap-x-2 text-ink-3">
                        {a.author?.name && <span>{a.author.name}</span>}
                        <span>{ago(a.publishAt ?? a.createdAt)}</span>
                        {a.attachments.length > 0 && (
                          <span className="inline-flex items-center gap-1">
                            <Paperclip className="size-3" aria-hidden /> {a.attachments.length} attachment{a.attachments.length === 1 ? '' : 's'}
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <Pager page={page} totalPages={q.data?.meta.totalPages ?? 1} total={q.data?.meta.total ?? 0} onPage={setPage} noun="announcements" />
          </>
        )}
      </Card>

      <AnnouncementDrawer id={open} onClose={() => set({ open: null })} />
    </div>
  );
}

export function AnnouncementDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  return (
    <Drawer open={!!id} onOpenChange={(o) => !o && onClose()}>
      {id && <AnnouncementDrawerBody key={id} id={id} />}
    </Drawer>
  );
}

function AnnouncementDrawerBody({ id }: { id: string }) {
  const q = useAnnouncement(id);
  const markRead = useMarkAnnouncementRead();
  const ack = useAckAnnouncement();
  const { readOnly } = useGates();
  const a = q.data;
  const sent = React.useRef(false);

  React.useEffect(() => {
    if (a && !a.read && !sent.current) {
      sent.current = true;
      markRead.mutate(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a?.id, a?.read]);

  const doAck = async () => {
    try {
      await ack.mutateAsync(id);
      toast.success('Thank you — your acknowledgement was recorded');
    } catch (e) {
      toast.error(errorMessage(e), { duration: 8000 });
    }
  };

  return (
    <DrawerContent title={a?.title ?? 'Announcement'} description={a ? `${a.author?.name ? `${a.author.name} · ` : ''}${fmtWhen(a.publishAt ?? a.createdAt)}` : 'Loading announcement'} showTitle>
      {q.isPending ? (
        <SheetBody>
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-24 w-full" />
        </SheetBody>
      ) : q.isError || !a ? (
        <SheetBody>
          <ErrorState error={q.error} onRetry={() => void q.refetch()} compact />
        </SheetBody>
      ) : (
        <>
          <SheetBody>
            <div className="flex flex-wrap items-center gap-2">
              <PriorityBadge priority={a.priority} />
              {a.requiresAck && (a.acknowledged ? <Badge variant="success" icon={<CheckCircle2 aria-hidden />}>Acknowledged</Badge> : <Badge variant="warning">Needs acknowledgement</Badge>)}
              {a.expiresAt && <span className="t-caption text-ink-3">Valid until {fmtWhen(a.expiresAt)}</span>}
            </div>
            <div className="max-w-[68ch] whitespace-pre-wrap text-sm leading-6">{a.body}</div>
            {a.attachments.length > 0 && (
              <section aria-label="Attachments">
                <h3 className="t-label mb-2">Attachments</h3>
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {a.attachments.map((f) => (
                    <li key={f.fileId} className="flex items-center gap-3 px-3 py-2.5">
                      <Paperclip className="size-4 shrink-0 text-ink-3" aria-hidden />
                      <a href={fileHref(f.fileId)} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-sm font-medium text-brand-ink underline-offset-4 hover:underline">
                        {f.name}
                      </a>
                      {f.sizeBytes ? <span className="t-caption shrink-0 text-ink-3">{formatBytes(f.sizeBytes)}</span> : null}
                      <a href={fileHref(f.fileId, true)} download aria-label={`Download ${f.name}`} className="tr-colors grid size-9 shrink-0 place-items-center rounded-md text-ink-2 hover:bg-surface-subtle hover:text-ink sm:size-8">
                        <Download className="size-4" />
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {a.requiresAck && a.acknowledged && a.ackedAt && (
              <Banner tone="success">You acknowledged this on {fmtWhen(a.ackedAt)}.</Banner>
            )}
            {a.requiresAck && !a.acknowledged && (
              <Banner tone="warning" title="The school asks you to acknowledge this notice">
                Tap “Acknowledge” once you have read it. It tells the school you have seen it.
              </Banner>
            )}
          </SheetBody>
          {a.requiresAck && !a.acknowledged && (
            <SheetFooter>
              <Button onClick={doAck} loading={ack.isPending} disabled={readOnly} className="max-sm:w-full">
                <Megaphone /> Acknowledge
              </Button>
            </SheetFooter>
          )}
        </>
      )}
    </DrawerContent>
  );
}
