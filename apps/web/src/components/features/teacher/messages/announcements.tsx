'use client';

import * as React from 'react';
import { Archive, CalendarClock, CheckCircle2, CircleDashed, Hourglass, Pencil, Plus, Send, Trash2 } from 'lucide-react';
import { announcementCreateBody, type AnnouncementCreateBody, type AnnouncementItem, type AnnouncementState, type AnnouncementUpdateBody, type LearningAttachmentRef } from '@school-sync/shared';
import { Controller } from 'react-hook-form';
import { fmtDateTime, todayIso } from '@/lib/format';
import { cn } from '@/lib/cn';
import { applyApiErrors, useZodForm } from '@/lib/client/use-zod-form';
import { useUnsavedGuard } from '@/lib/client/use-unsaved-guard';
import { commsError } from '@/lib/client/teacher-comms';
import { isOutOfScope } from '@/lib/client/teacher-errors';
import {
  useAnnouncement,
  useAnnouncementAction,
  useAnnouncementRecipients,
  useAnnouncementStats,
  useDeleteAnnouncement,
  useManagedAnnouncements,
  useReceivedAnnouncements,
  useSaveAnnouncement,
} from '@/lib/client/teacher-comms';
import { usePermissions } from '@/components/me-context';
import { Badge } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DataTable } from '@/components/ui/data-table';
import { Dialog, DialogContent, Drawer, DrawerContent, SheetBody, SheetFooter } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, SearchField } from '@/components/ui/input';
import { ProgressBar } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { StatTile } from '@/components/ui/stat-tile';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FormCheckbox, FormInput, FormSection, FormSelect, FormTextarea } from '@/components/ui/form';
import { toast } from '@/components/ui/toaster';
import { AttachmentLinks, AttachmentPicker, CardListSkeleton, DateTimeField, ErrorCard, FilterSelect, Meta, useUrlState, useWriteGate } from '../common';
import { AudiencePicker, ClearableDateTime, DrawerSection, isPast, Pager, useDebouncedValue } from './fields';

/* ───────────────────────── small pieces ───────────────────────── */

const STATE: Record<AnnouncementState, { label: string; variant: React.ComponentProps<typeof Badge>['variant']; icon: React.ReactNode }> = {
  draft: { label: 'Draft', variant: 'neutral', icon: <CircleDashed aria-hidden /> },
  scheduled: { label: 'Scheduled', variant: 'primary', icon: <CalendarClock aria-hidden /> },
  published: { label: 'Published', variant: 'success', icon: <CheckCircle2 aria-hidden /> },
  expired: { label: 'Expired', variant: 'warning', icon: <Hourglass aria-hidden /> },
  archived: { label: 'Archived', variant: 'neutral', icon: <Archive aria-hidden /> },
};
export function StateChip({ state }: { state: AnnouncementState }) {
  const s = STATE[state];
  return (
    <Badge variant={s.variant} icon={s.icon}>
      {s.label}
    </Badge>
  );
}
export function PriorityChip({ priority }: { priority: AnnouncementItem['priority'] }) {
  if (priority === 'normal') return null;
  return <Badge variant={priority === 'urgent' ? 'danger' : 'warning'}>{priority === 'urgent' ? 'Urgent' : 'Important'}</Badge>;
}
const audienceText = (a: AnnouncementItem) => (a.audience.length ? a.audience.map((x) => x.label).join(', ') : '—');

/* ───────────────────────── screen ───────────────────────── */

const PAGE_SIZE = 10;

export function AnnouncementsScreen() {
  const url = useUrlState();
  const { can } = usePermissions();
  const gate = useWriteGate();
  const view = url.get('tab', 'mine') === 'received' ? 'received' : 'mine';
  const viewId = url.get('view') || null;
  const edit = url.get('edit') || null; // 'new' | announcement id
  const [dirty, setDirty] = React.useState(false);
  const { guard, dialog } = useUnsavedGuard(dirty, { title: 'Discard this announcement?', description: 'You have changes that have not been saved. If you close now they will be lost.', confirmLabel: 'Discard changes' });
  const canCreate = can('announcements:create');

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={view} onValueChange={(v) => url.set({ tab: v === 'mine' ? null : v })}>
          <TabsList aria-label="Announcements">
            <TabsTrigger value="mine">My announcements</TabsTrigger>
            <TabsTrigger value="received">Received</TabsTrigger>
          </TabsList>
        </Tabs>
        {canCreate && (
          <Button onClick={() => url.set({ edit: 'new', view: null }, { keepPage: true })} disabled={gate.readOnly} title={gate.reason}>
            <Plus /> New announcement
          </Button>
        )}
      </div>
      {view === 'mine' ? <ManagedList canCreate={canCreate} onOpen={(id) => url.set({ view: id }, { keepPage: true })} onNew={() => url.set({ edit: 'new' }, { keepPage: true })} /> : <ReceivedList onOpen={(id) => url.set({ view: id }, { keepPage: true })} />}

      {/* read / manage */}
      <Drawer open={!!viewId && !edit} onOpenChange={(o) => !o && url.set({ view: null }, { keepPage: true })}>
        <DrawerContent title="Announcement" description="Details, delivery and actions" showTitle>
          {viewId && <AnnouncementDetail key={viewId} id={viewId} onEdit={() => url.set({ edit: viewId, view: null }, { keepPage: true })} onGone={() => url.set({ view: null }, { keepPage: true })} />}
        </DrawerContent>
      </Drawer>

      {/* write */}
      <Drawer open={!!edit} onOpenChange={(o) => !o && guard(() => { setDirty(false); url.set({ edit: null }, { keepPage: true }); })}>
        <DrawerContent
          title={edit === 'new' ? 'New announcement' : 'Edit announcement'}
          description="Write to the classes you teach or lead"
          showTitle
          onInteractOutside={(e) => {
            if (dirty) e.preventDefault();
          }}
        >
          {edit && (
            <AnnouncementFormLoader
              key={edit}
              id={edit === 'new' ? null : edit}
              onDirtyChange={setDirty}
              onCancel={() => guard(() => { setDirty(false); url.set({ edit: null, view: edit === 'new' ? null : edit }, { keepPage: true }); })}
              onDone={(savedId) => {
                setDirty(false);
                url.set({ edit: null, view: savedId }, { keepPage: true });
              }}
            />
          )}
        </DrawerContent>
      </Drawer>
      {dialog}
    </div>
  );
}

/* ───────────────────────── my announcements (manage) ───────────────────────── */

function ManagedList({ canCreate, onOpen, onNew }: { canCreate: boolean; onOpen: (id: string) => void; onNew: () => void }) {
  const url = useUrlState();
  const state = url.get('state');
  const page = url.num('page', 1);
  const qUrl = url.get('q');
  const [q, setQ] = React.useState(qUrl);
  const dq = useDebouncedValue(q, 300);
  React.useEffect(() => {
    if (dq !== qUrl) url.set({ q: dq });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dq]);

  const list = useManagedAnnouncements({ state, q: qUrl, page, pageSize: PAGE_SIZE });
  const filtered = !!state || !!qUrl;

  return (
    <DataTable
      id="teacher-announcements"
      caption="My announcements"
      rows={list.data?.data}
      rowKey={(r) => r.id}
      loading={list.isPending}
      error={list.error}
      onRetry={() => void list.refetch()}
      page={page}
      pageSize={PAGE_SIZE}
      total={list.data?.meta.total}
      onPageChange={(p) => url.set({ page: p }, { keepPage: true })}
      onRowClick={(r) => onOpen(r.id)}
      filters={
        <>
          <SearchField className="w-full sm:w-64" value={q} onChange={setQ} placeholder="Search my announcements" hint={null} />
          <FilterSelect
            label="State"
            value={state}
            onChange={(v) => url.set({ state: v })}
            allLabel="Any state"
            options={(['draft', 'scheduled', 'published', 'expired', 'archived'] as const).map((s) => ({ value: s, label: STATE[s].label }))}
          />
        </>
      }
      columns={[
        {
          id: 'title',
          header: 'Announcement',
          mobile: 'title',
          hideable: false,
          cell: (r) => (
            <div className="min-w-0">
              <p className="flex items-center gap-2">
                <span className="truncate font-medium">{r.title}</span>
                <PriorityChip priority={r.priority} />
              </p>
              <p className="t-caption truncate text-ink-2">To {audienceText(r)}</p>
            </div>
          ),
        },
        { id: 'state', header: 'State', mobile: 'status', cell: (r) => <StateChip state={r.state} /> },
        {
          id: 'when',
          header: 'When',
          mobile: 'sub',
          cell: (r) => (r.state === 'draft' ? `Saved ${fmtDateTime(r.updatedAt)}` : r.publishAt ? `${r.state === 'scheduled' ? 'Goes out' : 'Sent'} ${fmtDateTime(r.publishAt)}` : `Created ${fmtDateTime(r.createdAt)}`),
        },
        {
          id: 'reach',
          header: 'Opened',
          mobile: 'detail',
          align: 'right',
          cell: (r) => (r.state === 'draft' || r.state === 'scheduled' ? '—' : `${r.readCount ?? 0} read${r.requiresAck ? ` · ${r.ackCount ?? 0} acknowledged` : ''}`),
        },
      ]}
      empty={
        filtered ? (
          <EmptyState
            illustration="no-results"
            title="No announcements match"
            filters={
              <>
                {state && <Badge variant="outline">{STATE[state as AnnouncementState]?.label ?? state}</Badge>}
                {qUrl && <Badge variant="outline">“{qUrl}”</Badge>}
              </>
            }
            action={
              <Button variant="secondary" size="sm" onClick={() => { setQ(''); url.set({ state: null, q: null }); }}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <EmptyState
            illustration="empty-notifications"
            title="You haven’t posted anything yet"
            description="Announcements you write to your classes appear here, with who has read them."
            action={canCreate ? <Button onClick={onNew}><Plus /> New announcement</Button> : undefined}
          />
        )
      }
    />
  );
}

/* ───────────────────────── received ───────────────────────── */

function ReceivedList({ onOpen }: { onOpen: (id: string) => void }) {
  const url = useUrlState();
  const page = url.num('page', 1);
  const unread = url.get('unread') === '1';
  const list = useReceivedAnnouncements({ unread, page, pageSize: PAGE_SIZE });
  const act = useAnnouncementAction();
  const gate = useWriteGate();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect label="Show" value={unread ? 'unread' : ''} onChange={(v) => url.set({ unread: v === 'unread' ? '1' : null })} allLabel="All received" options={[{ value: 'unread', label: 'Unread only' }]} />
      </div>
      {list.isPending ? (
        <CardListSkeleton rows={4} />
      ) : list.isError ? (
        <ErrorCard error={list.error} onRetry={() => void list.refetch()} title="We couldn’t load your announcements" />
      ) : list.data.data.length === 0 ? (
        <Card>
          <EmptyState
            illustration="empty-notifications"
            title={unread ? 'Nothing unread' : 'No announcements yet'}
            description={unread ? 'You are all caught up.' : 'Messages the school sends to staff and to your classes will show here.'}
            action={unread ? <Button variant="secondary" size="sm" onClick={() => url.set({ unread: null })}>Show all</Button> : undefined}
          />
        </Card>
      ) : (
        <>
          <ul className="space-y-3" aria-label="Received announcements">
            {list.data.data.map((a) => (
              <li key={a.id}>
                <Card interactive className={cn(!a.read && 'border-l-2 border-l-brand')}>
                  <CardBody className="flex items-start gap-3">
                    <button type="button" onClick={() => onOpen(a.id)} className="min-w-0 flex-1 rounded-md text-left">
                      <span className="flex flex-wrap items-center gap-2">
                        {!a.read && <span className="size-2 shrink-0 rounded-full bg-brand" aria-label="Unread" />}
                        <span className={cn('text-sm', a.read ? 'font-medium' : 'font-semibold')}>{a.title}</span>
                        <PriorityChip priority={a.priority} />
                        {a.requiresAck && !a.acknowledged && <Badge variant="accent">Needs acknowledgement</Badge>}
                        {a.acknowledged && <Badge variant="success" icon={<CheckCircle2 aria-hidden />}>Acknowledged</Badge>}
                      </span>
                      <span className="mt-1 line-clamp-2 block text-sm text-ink-2">{a.body}</span>
                      <span className="t-caption mt-1.5 block text-ink-3">
                        {a.author?.name ?? 'School office'} · {fmtDateTime(a.publishAt ?? a.createdAt)}
                      </span>
                    </button>
                    {!a.read && !a.canManage && (
                      <Button variant="ghost" size="sm" disabled={gate.readOnly || act.isPending} onClick={() => act.mutate({ id: a.id, action: 'read' })}>
                        Mark read
                      </Button>
                    )}
                  </CardBody>
                </Card>
              </li>
            ))}
          </ul>
          <Pager page={page} pageSize={PAGE_SIZE} total={list.data.meta.total} onPage={(p) => url.set({ page: p }, { keepPage: true })} noun="announcements" />
        </>
      )}
    </div>
  );
}

/* ───────────────────────── detail ───────────────────────── */

type Confirm = 'publish' | 'expire' | 'archive' | 'delete' | 'unschedule';

const CONFIRM_COPY: Record<Confirm, { title: string; description: (a: AnnouncementItem) => React.ReactNode; label: string; destructive?: boolean }> = {
  publish: { title: 'Publish now?', description: (a) => <>“{a.title}” goes out straight away to the students and guardians of {audienceText(a)}. They are notified, and you can’t edit the text afterwards.</>, label: 'Publish now' },
  expire: { title: 'End this announcement?', description: (a) => <>“{a.title}” disappears from everyone’s feed now. The delivery history is kept.</>, label: 'End now', destructive: true },
  archive: { title: 'Archive this announcement?', description: (a) => <>“{a.title}” is hidden from feeds. The history of who read it is kept.</>, label: 'Archive', destructive: true },
  delete: { title: 'Delete this draft?', description: (a) => <>“{a.title}” has not been sent. Deleting it can’t be undone.</>, label: 'Delete draft', destructive: true },
  unschedule: { title: 'Cancel the schedule?', description: (a) => <>“{a.title}” goes back to a plain draft and will not be sent automatically.</>, label: 'Cancel schedule' },
};

function AnnouncementDetail({ id, onEdit, onGone }: { id: string; onEdit: () => void; onGone: () => void }) {
  const q = useAnnouncement(id);
  const a = q.data;
  const gate = useWriteGate();
  const { can } = usePermissions();
  const action = useAnnouncementAction();
  const del = useDeleteAnnouncement();
  const [confirm, setConfirm] = React.useState<Confirm | null>(null);
  const [scheduling, setScheduling] = React.useState(false);
  const [expiring, setExpiring] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const sent = !!a && (a.state === 'published' || a.state === 'expired' || a.state === 'archived');
  const stats = useAnnouncementStats(id, !!a?.canManage && sent);
  const markedRead = React.useRef(false);

  // opening a received announcement is reading it
  React.useEffect(() => {
    if (a && !a.read && !a.canManage && !markedRead.current && !gate.readOnly) {
      markedRead.current = true;
      action.mutate({ id, action: 'read' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a?.id, a?.read]);

  if (q.isPending)
    return (
      <SheetBody>
        <Skeleton className="h-7 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-32 w-full" />
      </SheetBody>
    );
  if (q.isError || !a)
    return (
      <SheetBody>
        <ErrorCard error={q.error} onRetry={isOutOfScope(q.error) ? undefined : () => void q.refetch()} title={isOutOfScope(q.error) ? 'This announcement isn’t available to you' : 'We couldn’t open this announcement'} />
        <Button variant="secondary" onClick={onGone}>Close</Button>
      </SheetBody>
    );

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setErr(null);
    try {
      await fn();
      toast.success(ok);
      setConfirm(null);
      setScheduling(false);
      setExpiring(false);
      return true;
    } catch (e) {
      const m = commsError(e);
      setErr(m);
      setConfirm(null);
      toast.error(m, { duration: 8000 });
      return false;
    }
  };

  const doConfirm = async () => {
    if (!confirm) return;
    if (confirm === 'delete') {
      if (await run(() => del.mutateAsync(a.id), 'Draft deleted')) onGone();
      return;
    }
    const okText = { publish: 'Announcement published', expire: 'Announcement ended', archive: 'Announcement archived', unschedule: 'Schedule cancelled' }[confirm];
    await run(() => action.mutateAsync({ id: a.id, action: confirm }), okText);
  };

  const canEditDraft = a.canManage && (a.state === 'draft' || a.state === 'scheduled') && can('announcements:edit');
  const canPublish = a.canManage && (a.state === 'draft' || a.state === 'scheduled') && can('announcements:publish');
  const busy = action.isPending || del.isPending;
  const disabled = gate.readOnly || busy;

  return (
    <>
      <SheetBody>
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <StateChip state={a.state} />
            <PriorityChip priority={a.priority} />
            {a.requiresAck && <Badge variant="accent">Acknowledgement required</Badge>}
          </div>
          <h2 className="font-display text-xl leading-7">{a.title}</h2>
          <p className="t-caption text-ink-2">
            {a.author?.name ?? 'School office'}
            {a.publishAt ? ` · ${a.state === 'scheduled' ? 'goes out' : 'sent'} ${fmtDateTime(a.publishAt)}` : ` · saved ${fmtDateTime(a.updatedAt)}`}
          </p>
        </div>

        {err && <Banner tone="danger" onDismiss={() => setErr(null)}>{err}</Banner>}
        {gate.readOnly && a.canManage && <Banner tone="locked">{gate.reason}</Banner>}

        <p className="whitespace-pre-wrap text-sm leading-6">{a.body}</p>
        <AttachmentLinks items={a.attachments} />

        {a.canManage && (
          <Meta
            items={[
              { label: 'Sent to', value: audienceText(a) },
              { label: 'Expires', value: a.expiresAt ? fmtDateTime(a.expiresAt) : 'Does not expire' },
            ]}
          />
        )}

        {/* receipts for a recipient */}
        {!a.canManage && a.requiresAck && (
          <div className="rounded-lg border border-border bg-surface-subtle p-3">
            {a.acknowledged ? (
              <p className="flex items-center gap-2 text-sm"><CheckCircle2 className="size-4 text-success" aria-hidden /> You acknowledged this{a.ackedAt ? ` on ${fmtDateTime(a.ackedAt)}` : ''}.</p>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm">The school asks you to acknowledge that you have read this.</p>
                <Button size="sm" loading={action.isPending} disabled={disabled} onClick={() => void run(() => action.mutateAsync({ id: a.id, action: 'ack' }), 'Acknowledged')}>
                  Acknowledge
                </Button>
              </div>
            )}
          </div>
        )}

        {/* delivery */}
        {a.canManage && sent && <Delivery id={a.id} requiresAck={a.requiresAck} stats={stats} />}
        {a.canManage && sent && <Recipients id={a.id} requiresAck={a.requiresAck} />}
        {a.canManage && a.state === 'published' && <p className="t-caption text-ink-2">A published announcement can’t be edited; you can change when it expires, end it now, or archive it.</p>}
      </SheetBody>

      {a.canManage && (
        <SheetFooter>
          {(a.state === 'draft' || a.state === 'scheduled') && (
            <Button variant="danger" onClick={() => setConfirm('delete')} disabled={disabled}>
              <Trash2 /> Delete
            </Button>
          )}
          <span className="flex-1" />
          {a.state === 'scheduled' && <Button variant="secondary" onClick={() => setConfirm('unschedule')} disabled={disabled}>Cancel schedule</Button>}
          {canEditDraft && (
            <Button variant="secondary" onClick={onEdit} disabled={disabled}>
              <Pencil /> Edit
            </Button>
          )}
          {canEditDraft && a.state === 'draft' && (
            <Button variant="secondary" onClick={() => setScheduling(true)} disabled={disabled}>
              <CalendarClock /> Schedule
            </Button>
          )}
          {canPublish && (
            <Button onClick={() => setConfirm('publish')} disabled={disabled}>
              <Send /> Publish now
            </Button>
          )}
          {a.state === 'published' && (
            <>
              <Button variant="secondary" onClick={() => setExpiring(true)} disabled={disabled}>Change expiry</Button>
              <Button variant="secondary" onClick={() => setConfirm('expire')} disabled={disabled}>End now</Button>
              <Button variant="secondary" onClick={() => setConfirm('archive')} disabled={disabled}>
                <Archive /> Archive
              </Button>
            </>
          )}
          {a.state === 'expired' && (
            <Button variant="secondary" onClick={() => setConfirm('archive')} disabled={disabled}>
              <Archive /> Archive
            </Button>
          )}
        </SheetFooter>
      )}

      {confirm && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setConfirm(null)}
          title={CONFIRM_COPY[confirm].title}
          description={CONFIRM_COPY[confirm].description(a)}
          confirmLabel={CONFIRM_COPY[confirm].label}
          destructive={CONFIRM_COPY[confirm].destructive}
          loading={busy}
          onConfirm={() => void doConfirm()}
        />
      )}
      {scheduling && <ScheduleDialog onClose={() => setScheduling(false)} busy={action.isPending} onSubmit={(publishAt) => run(() => action.mutateAsync({ id: a.id, action: 'schedule', body: { publishAt } }), 'Announcement scheduled')} />}
      {expiring && <ExpiryDialog current={a.expiresAt} onClose={() => setExpiring(false)} id={a.id} />}
    </>
  );
}

function ScheduleDialog({ onClose, onSubmit, busy }: { onClose: () => void; onSubmit: (iso: string) => Promise<boolean>; busy: boolean }) {
  const [at, setAt] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const today = todayIso();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Schedule this announcement" description="It is sent automatically at this time.">
        <div className="mt-4 space-y-4">
          <Field label="Send at" error={error}>
            <DateTimeField value={at} onChange={(v) => { setAt(v); setError(null); }} min={today} defaultTime="08:00" invalid={!!error} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button
              loading={busy}
              onClick={async () => {
                if (!at || isPast(at)) return setError('Pick a date and time in the future.');
                if (await onSubmit(at)) onClose();
              }}
            >
              Schedule
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ExpiryDialog({ id, current, onClose }: { id: string; current: string | null; onClose: () => void }) {
  const save = useSaveAnnouncement();
  const [at, setAt] = React.useState<string | null>(current);
  const [error, setError] = React.useState<string | null>(null);
  const submit = async (value: string | null) => {
    if (value && isPast(value)) return setError('Pick a time in the future, or use “End now”.');
    try {
      await save.mutateAsync({ id, body: { expiresAt: value } });
      toast.success(value ? 'Expiry updated' : 'Expiry removed');
      onClose();
    } catch (e) {
      setError(commsError(e));
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Change expiry" description="After this time the announcement leaves everyone’s feed.">
        <div className="mt-4 space-y-4">
          <Field label="Expires at" error={error}>
            <DateTimeField value={at} onChange={(v) => { setAt(v); setError(null); }} invalid={!!error} defaultTime="23:59" />
          </Field>
          <div className="flex flex-wrap justify-end gap-2">
            {current && <Button variant="ghost" onClick={() => void submit(null)} disabled={save.isPending}>Never expire</Button>}
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button loading={save.isPending} disabled={!at} onClick={() => void submit(at)}>Save</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ───────────────────────── delivery stats ───────────────────────── */

function Delivery({ stats, requiresAck }: { id: string; requiresAck: boolean; stats: ReturnType<typeof useAnnouncementStats> }) {
  const s = stats.data;
  return (
    <DrawerSection title="Delivery">
      {stats.isPending ? (
        <div className="grid grid-cols-2 gap-3">
          <StatTile label="Audience" state="loading" />
          <StatTile label="Read" state="loading" />
        </div>
      ) : stats.isError || !s ? (
        <ErrorCard error={stats.error} onRetry={() => void stats.refetch()} title="We couldn’t load delivery figures" />
      ) : (
        <>
          <div className={cn('grid gap-3', requiresAck ? 'grid-cols-3' : 'grid-cols-2')}>
            <StatTile label="Audience" value={s.audienceSize} hint="people" className="!p-3" />
            <StatTile label="Read" value={s.readCount} hint={`${s.unreadCount} not yet`} className="!p-3" />
            {requiresAck && <StatTile label="Acknowledged" value={s.ackCount} hint={`${s.pendingAckCount} waiting`} className="!p-3" />}
          </div>
          <div className="space-y-1.5">
            <ProgressBar value={s.readCount} max={s.audienceSize} label="Share of the audience who have read it" />
            <p className="t-caption text-ink-2">{s.audienceSize === 0 ? 'Nobody is in the audience.' : `${Math.round((s.readCount / s.audienceSize) * 100)}% of the audience have opened it.`}</p>
          </div>
          {s.byUserType.length > 0 && (
            <ul className="divide-y divide-border rounded-md border border-border" aria-label="By type of recipient">
              {s.byUserType.map((t) => (
                <li key={t.userType} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="capitalize">{t.userType === 'parent' ? 'Guardians' : `${t.userType}s`}</span>
                  <span className="t-caption tnum text-ink-2">{t.read} of {t.audience} read{requiresAck ? ` · ${t.acked} acknowledged` : ''}</span>
                </li>
              ))}
            </ul>
          )}
          {s.bySection.length > 0 && (
            <ul className="space-y-2.5" aria-label="By class">
              {s.bySection.map((c) => (
                <li key={c.sectionId} className="space-y-1">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span>{c.gradeName} {c.sectionName}</span>
                    <span className="t-caption tnum text-ink-2">{c.read} of {c.audience}</span>
                  </div>
                  <ProgressBar value={c.read} max={c.audience} label={`${c.gradeName} ${c.sectionName} read`} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </DrawerSection>
  );
}

function Recipients({ id, requiresAck }: { id: string; requiresAck: boolean }) {
  const [status, setStatus] = React.useState('all');
  const [page, setPage] = React.useState(1);
  const r = useAnnouncementRecipients(id, { status, page, pageSize: 8 }, true);
  const opts = [{ value: 'unread', label: 'Not read yet' }, ...(requiresAck ? [{ value: 'unacknowledged', label: 'Not acknowledged' }] : [])];
  return (
    <DrawerSection title="Who has seen it">
      <FilterSelect label="Recipients" value={status === 'all' ? '' : status} onChange={(v) => { setStatus(v || 'all'); setPage(1); }} allLabel="Everyone" options={opts} />
      {r.isPending ? (
        <CardListSkeleton rows={3} />
      ) : r.isError ? (
        <ErrorCard error={r.error} onRetry={() => void r.refetch()} title="We couldn’t load recipients" />
      ) : r.data.data.length === 0 ? (
        <p className="rounded-md border border-border bg-surface-subtle px-3 py-4 text-center text-sm text-ink-2">{status === 'all' ? 'No recipients.' : 'Nobody matches. Everyone has done this.'}</p>
      ) : (
        <>
          <ul className="divide-y divide-border rounded-md border border-border" aria-label="Recipients">
            {r.data.data.map((p) => (
              <li key={p.userId} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{p.name}</p>
                  <p className="t-caption capitalize text-ink-3">{p.userType === 'parent' ? 'guardian' : p.userType}</p>
                </div>
                <div className="shrink-0 text-right">
                  {p.readAt ? <p className="t-caption text-ink-2">Read {fmtDateTime(p.readAt)}</p> : <Badge variant="neutral">Not read</Badge>}
                  {requiresAck && (p.ackedAt ? <p className="t-caption text-success">Acknowledged</p> : p.readAt ? <p className="t-caption text-warning">Not acknowledged</p> : null)}
                </div>
              </li>
            ))}
          </ul>
          <Pager page={page} pageSize={8} total={r.data.meta.total} onPage={setPage} noun="recipients" />
        </>
      )}
    </DrawerSection>
  );
}

/* ───────────────────────── form ───────────────────────── */

function AnnouncementFormLoader({ id, onDone, onCancel, onDirtyChange }: { id: string | null; onDone: (id: string) => void; onCancel: () => void; onDirtyChange: (d: boolean) => void }) {
  const q = useAnnouncement(id);
  if (id && q.isPending)
    return (
      <SheetBody>
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-24 w-full" />
      </SheetBody>
    );
  if (id && (q.isError || !q.data))
    return (
      <SheetBody>
        <ErrorCard error={q.error} onRetry={isOutOfScope(q.error) ? undefined : () => void q.refetch()} title={isOutOfScope(q.error) ? 'This announcement isn’t available to you' : 'We couldn’t open this announcement'} />
      </SheetBody>
    );
  if (id && q.data && !(q.data.canManage && (q.data.state === 'draft' || q.data.state === 'scheduled')))
    return (
      <SheetBody>
        <Banner tone="warning" title="This announcement can’t be edited">
          Only drafts and scheduled announcements can be edited. A published one can only change when it expires, or be ended or archived.
        </Banner>
        <Button variant="secondary" onClick={onCancel}>Back</Button>
      </SheetBody>
    );
  return <AnnouncementForm initial={q.data ?? null} onDone={onDone} onCancel={onCancel} onDirtyChange={onDirtyChange} />;
}

type FormValues = AnnouncementCreateBody;

function AnnouncementForm({ initial, onDone, onCancel, onDirtyChange }: { initial: AnnouncementItem | null; onDone: (id: string) => void; onCancel: () => void; onDirtyChange: (d: boolean) => void }) {
  const { can } = usePermissions();
  const gate = useWriteGate();
  const save = useSaveAnnouncement();
  const action = useAnnouncementAction();
  const form = useZodForm(announcementCreateBody, {
    defaultValues: {
      title: initial?.title ?? '',
      body: initial?.body ?? '',
      priority: initial?.priority ?? 'normal',
      audience: initial?.audience.map((a) => ({ type: a.type, id: a.id })) ?? [],
      requiresAck: initial?.requiresAck ?? false,
      attachmentFileIds: initial?.attachments.map((a) => a.fileId) ?? [],
      publishAt: initial?.state === 'scheduled' ? initial.publishAt : null,
      expiresAt: initial?.expiresAt ?? null,
    },
  });
  const [files, setFiles] = React.useState<LearningAttachmentRef[]>(() => (initial?.attachments ?? []).map((a) => ({ fileId: a.fileId, name: a.name, mimeType: a.mimeType, sizeBytes: a.sizeBytes })));
  const [formError, setFormError] = React.useState<string | null>(null);
  const [confirm, setConfirm] = React.useState<FormValues | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [more, setMore] = React.useState(!!(initial?.expiresAt || (initial?.state === 'scheduled')));
  const dirty = form.formState.isDirty;
  React.useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  React.useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  const canPublish = can('announcements:publish');
  const publishAt = form.watch('publishAt');
  const known = initial?.audience;

  const checkTimes = (v: FormValues): boolean => {
    let ok = true;
    if (v.publishAt && isPast(v.publishAt)) {
      form.setError('publishAt', { type: 'validate', message: 'Pick a time in the future, or publish now.' });
      setMore(true);
      ok = false;
    }
    if (v.expiresAt && isPast(v.expiresAt)) {
      form.setError('expiresAt', { type: 'validate', message: 'The expiry must be in the future.' });
      setMore(true);
      ok = false;
    }
    if (v.expiresAt && v.publishAt && new Date(v.expiresAt) <= new Date(v.publishAt)) {
      form.setError('expiresAt', { type: 'validate', message: 'The expiry must be after it is sent.' });
      setMore(true);
      ok = false;
    }
    return ok;
  };

  const persist = async (v: FormValues, publish: boolean) => {
    setBusy(true);
    setFormError(null);
    let savedId = initial?.id ?? null;
    try {
      const body: AnnouncementCreateBody & AnnouncementUpdateBody = { ...v, publishAt: publish ? null : (v.publishAt ?? null), expiresAt: v.expiresAt ?? null };
      const r = await save.mutateAsync({ id: initial?.id, body: initial ? (body as AnnouncementUpdateBody) : (body as AnnouncementCreateBody) });
      savedId = r.id;
      if (publish) {
        await action.mutateAsync({ id: r.id, action: 'publish' });
        toast.success('Announcement published', { description: 'The students and guardians of your classes were notified.' });
      } else {
        toast.success(v.publishAt ? 'Announcement scheduled' : 'Draft saved');
      }
      setConfirm(null);
      form.reset(v);
      onDone(r.id);
    } catch (e) {
      setConfirm(null);
      const m = applyApiErrors(form, e);
      const msg = commsError(e);
      if (savedId && publish && savedId !== initial?.id) {
        // the draft exists even though publishing failed: don't lose it
        toast.error(`Saved as a draft, but it couldn’t be published. ${msg}`, { duration: 9000 });
        form.reset(v);
        onDone(savedId);
      } else {
        setFormError(m === null ? null : msg);
        if (m === null) setFormError('Some details need fixing. Check the highlighted fields.');
      }
    } finally {
      setBusy(false);
    }
  };

  const audienceError = form.formState.errors.audience ? 'Choose at least one class to send this to.' : null;
  const disabled = busy || gate.readOnly;

  return (
    <form noValidate onSubmit={(e) => e.preventDefault()}>
      <SheetBody>
        {gate.readOnly && <Banner tone="locked">{gate.reason}</Banner>}
        {formError && <Banner tone="danger" onDismiss={() => setFormError(null)}>{formError}</Banner>}
        {!can('announcements:create') && <Banner tone="warning" title="You can’t post announcements">Your role doesn’t include writing announcements. Ask the school office if that looks wrong.</Banner>}

        <FormSection title="Message">
          <FormInput control={form.control} name="title" label="Title" required maxLength={200} placeholder="e.g. Science project due Friday" />
          <FormTextarea control={form.control} name="body" label="Message" required rows={6} maxLength={10000} placeholder="Write what students and guardians need to know." />
          <FormSelect
            control={form.control}
            name="priority"
            label="Priority"
            hint="Important and urgent messages stand out in everyone’s feed."
            options={[
              { value: 'normal', label: 'Normal' },
              { value: 'important', label: 'Important' },
              { value: 'urgent', label: 'Urgent' },
            ]}
          />
        </FormSection>

        <Controller control={form.control} name="audience" render={({ field }) => <AudiencePicker value={field.value ?? []} onChange={(v) => field.onChange(v)} known={known} error={audienceError} disabled={disabled} />} />

        <FormSection title="Options">
          <FormCheckbox control={form.control} name="requiresAck" label="Ask recipients to acknowledge" hint="They tap “Acknowledge” and you can see who hasn’t." />
          <AttachmentPicker
            value={files}
            purpose="announcement"
            disabled={disabled}
            max={10}
            onChange={(v) => {
              setFiles(v);
              form.setValue('attachmentFileIds', v.map((f) => f.fileId), { shouldDirty: true });
            }}
            hint={`Up to 10 files, 10 MB each.`}
          />
        </FormSection>

        <div>
          <button type="button" onClick={() => setMore((m) => !m)} aria-expanded={more} className="tr-colors rounded-sm text-[13px] font-medium text-brand-ink underline-offset-4 hover:underline">
            {more ? 'Hide schedule and expiry' : 'Schedule or set an expiry'}
          </button>
          {more && (
            <div className="mt-3 space-y-4">
              <Controller
                control={form.control}
                name="publishAt"
                render={({ field, fieldState }) => (
                  <Field label="Send later at" hint="Leave empty to publish now or keep it as a draft." error={fieldState.error?.message}>
                    <ClearableDateTime value={field.value} onChange={field.onChange} min={todayIso()} defaultTime="08:00" invalid={!!fieldState.error} disabled={disabled} clearLabel="Remove schedule" />
                  </Field>
                )}
              />
              <Controller
                control={form.control}
                name="expiresAt"
                render={({ field, fieldState }) => (
                  <Field label="Expires at" hint="After this it leaves everyone’s feed. Optional." error={fieldState.error?.message}>
                    <ClearableDateTime value={field.value} onChange={field.onChange} min={todayIso()} defaultTime="23:59" invalid={!!fieldState.error} disabled={disabled} clearLabel="Remove expiry" />
                  </Field>
                )}
              />
            </div>
          )}
        </div>
      </SheetBody>
      <SheetFooter>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <span className="flex-1" />
        <Button
          type="button"
          variant="secondary"
          loading={busy && !confirm}
          disabled={disabled}
          onClick={form.handleSubmit(
            async (v) => {
              if (checkTimes(v)) await persist(v, false);
            },
            () => setFormError('Some details need fixing. Check the highlighted fields.'),
          )}
        >
          {publishAt ? 'Save & schedule' : 'Save draft'}
        </Button>
        {canPublish && (
          <Button
            type="button"
            disabled={disabled}
            onClick={form.handleSubmit(
              (v) => {
                if (v.expiresAt && isPast(v.expiresAt)) return void form.setError('expiresAt', { type: 'validate', message: 'The expiry must be in the future.' });
                setConfirm(v);
              },
              () => setFormError('Some details need fixing. Check the highlighted fields.'),
            )}
          >
            <Send /> Publish now
          </Button>
        )}
      </SheetFooter>
      {confirm && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setConfirm(null)}
          title="Publish now?"
          description={<>“{confirm.title}” goes out straight away to the students and guardians of the selected classes. They are notified, and you can’t edit the text afterwards.</>}
          confirmLabel="Publish now"
          loading={busy}
          onConfirm={() => void persist(confirm, true)}
        />
      )}
    </form>
  );
}

