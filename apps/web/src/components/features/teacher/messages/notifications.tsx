'use client';

import * as React from 'react';
import Link from 'next/link';
import { BellRing, Check, CheckCheck, Trash2 } from 'lucide-react';
import { notificationPreferencesUpdateBody, NOTIFICATION_CATEGORY_LIST, type NotificationItem, type NotificationPreferences } from '@school-sync/shared';
import { cn } from '@/lib/cn';
import { fmtDateTime } from '@/lib/format';
import { useZodForm } from '@/lib/client/use-zod-form';
import { useUnsavedGuard } from '@/lib/client/use-unsaved-guard';
import { commsError } from '@/lib/client/teacher-comms';
import {
  teacherRouteFor,
  useDeleteNotification,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotificationPreferences,
  useNotificationUnread,
  useNotifications,
  useSaveNotificationPreferences,
  useSendTestNotification,
  type NotificationTestResult,
} from '@/lib/client/teacher-comms';
import { Badge } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { IconButton } from '@/components/ui/icon-button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toaster';
import { CardListSkeleton, ErrorCard, FilterSelect, useUrlState, useWriteGate } from '../common';

const CATEGORY_LABEL: Record<string, string> = {
  attendance: 'Attendance',
  homework: 'Homework',
  marks: 'Marks',
  fees: 'Fees',
  announcement: 'Announcements',
  event: 'Events',
  meeting: 'Meetings',
  leave: 'Leave',
  tasks: 'Tasks',
  system: 'System',
};

export function NotificationsScreen() {
  const url = useUrlState();
  const tab = url.get('tab', 'inbox') === 'preferences' ? 'preferences' : 'inbox';
  const [dirty, setDirty] = React.useState(false);
  const { guard, dialog } = useUnsavedGuard(dirty, { title: 'Discard your notification settings?', description: 'You changed settings but have not saved them. If you leave now the changes are lost.', confirmLabel: 'Discard changes' });

  return (
    <div className="space-y-5">
      <Tabs value={tab} onValueChange={(v) => guard(() => { setDirty(false); url.set({ tab: v === 'inbox' ? null : v, category: null, unread: null }); })}>
        <TabsList aria-label="Notifications">
          <TabsTrigger value="inbox">Inbox</TabsTrigger>
          <TabsTrigger value="preferences">Settings</TabsTrigger>
        </TabsList>
      </Tabs>
      {tab === 'inbox' ? <Inbox /> : <Preferences onDirtyChange={setDirty} />}
      {dialog}
    </div>
  );
}

/* ───────────────────────── inbox ───────────────────────── */

function Inbox() {
  const url = useUrlState();
  const gate = useWriteGate();
  const unreadOnly = url.get('unread') === '1';
  const category = url.get('category');
  const list = useNotifications({ unread: unreadOnly, category });
  const unread = useNotificationUnread();
  const readAll = useMarkAllNotificationsRead();
  const [removing, setRemoving] = React.useState<NotificationItem | null>(null);
  const del = useDeleteNotification();

  const items = list.data?.pages.flatMap((p) => p.data) ?? [];
  const filtered = unreadOnly || !!category;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <FilterSelect label="Category" value={category} onChange={(v) => url.set({ category: v })} allLabel="All categories" options={NOTIFICATION_CATEGORY_LIST.map((c) => ({ value: c, label: CATEGORY_LABEL[c]! }))} />
          <FilterSelect label="Show" value={unreadOnly ? 'unread' : ''} onChange={(v) => url.set({ unread: v === 'unread' ? '1' : null })} allLabel="All notifications" options={[{ value: 'unread', label: 'Unread only' }]} />
        </div>
        <div className="flex items-center gap-3">
          {unread.data && <span className="t-caption tnum text-ink-2">{unread.data.unread} unread</span>}
          <Button
            variant="secondary"
            size="sm"
            loading={readAll.isPending}
            disabled={gate.readOnly || (unread.data?.unread ?? 0) === 0}
            title={gate.reason}
            onClick={() =>
              readAll.mutate(category || undefined, {
                onSuccess: (r) => toast.success(r.updated > 0 ? `${r.updated} marked as read` : 'Everything was already read'),
                onError: (e) => toast.error(commsError(e), { duration: 8000 }),
              })
            }
          >
            <CheckCheck /> {category ? `Mark ${CATEGORY_LABEL[category]?.toLowerCase() ?? ''} read` : 'Mark all read'}
          </Button>
        </div>
      </div>

      {list.isPending ? (
        <CardListSkeleton rows={5} />
      ) : list.isError ? (
        <ErrorCard error={list.error} onRetry={() => void list.refetch()} title="We couldn’t load your notifications" />
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            illustration="empty-notifications"
            title={filtered ? 'No notifications match' : 'You have no notifications'}
            description={filtered ? 'Try another category, or show all notifications.' : 'Homework submissions, leave decisions, meeting requests and school messages will appear here.'}
            action={filtered ? <Button variant="secondary" size="sm" onClick={() => url.set({ unread: null, category: null })}>Clear filters</Button> : undefined}
          />
        </Card>
      ) : (
        <>
          <Card>
            <ul className="divide-y divide-border" aria-label="Notifications">
              {items.map((n) => (
                <NotificationRow key={n.id} n={n} onDelete={() => setRemoving(n)} />
              ))}
            </ul>
          </Card>
          {list.hasNextPage ? (
            <div className="flex justify-center">
              <Button variant="secondary" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
                Load older notifications
              </Button>
            </div>
          ) : (
            <p className="t-caption text-center text-ink-3">That’s everything.</p>
          )}
        </>
      )}

      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Delete this notification?"
        description={removing ? <>“{removing.title}” is removed from your inbox. It doesn’t affect the record it was about.</> : null}
        confirmLabel="Delete"
        destructive
        loading={del.isPending}
        onConfirm={() =>
          removing &&
          del.mutate(removing.id, {
            onSuccess: () => {
              toast.success('Notification deleted');
              setRemoving(null);
            },
            onError: (e) => {
              toast.error(commsError(e), { duration: 8000 });
              setRemoving(null);
            },
          })
        }
      />
    </div>
  );
}

function NotificationRow({ n, onDelete }: { n: NotificationItem; onDelete: () => void }) {
  const read = useMarkNotificationRead();
  const gate = useWriteGate();
  const href = teacherRouteFor((n.data as Record<string, unknown>)?.route);
  const markRead = () => {
    if (!n.read && !gate.readOnly) read.mutate(n.id);
  };
  const title = (
    <span className={cn('text-sm', n.read ? 'font-medium' : 'font-semibold')}>{n.title}</span>
  );
  return (
    <li className={cn('flex items-start gap-3 px-4 py-3 max-sm:px-3', !n.read && 'bg-brand-soft/40')}>
      <span className={cn('mt-2 size-2 shrink-0 rounded-full', n.read ? 'bg-transparent' : 'bg-brand')} aria-label={n.read ? undefined : 'Unread'} role={n.read ? undefined : 'img'} />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="flex flex-wrap items-center gap-2">
          {href ? (
            <Link href={href} onClick={markRead} className="rounded-sm underline-offset-2 hover:underline">
              {title}
            </Link>
          ) : (
            title
          )}
          <Badge variant="outline">{CATEGORY_LABEL[n.category] ?? n.category}</Badge>
          {n.priority === 'high' && <Badge variant="warning">High priority</Badge>}
        </p>
        {n.body && <p className="line-clamp-3 text-sm text-ink-2">{n.body}</p>}
        <p className="t-caption text-ink-3">{fmtDateTime(n.createdAt)}</p>
      </div>
      <div className="flex shrink-0 items-center">
        {!n.read && (
          <IconButton label="Mark as read" size="icon-sm" loading={read.isPending} disabled={gate.readOnly} onClick={markRead}>
            <Check />
          </IconButton>
        )}
        <IconButton label="Delete notification" size="icon-sm" disabled={gate.readOnly} onClick={onDelete}>
          <Trash2 />
        </IconButton>
      </div>
    </li>
  );
}

/* ───────────────────────── preferences ───────────────────────── */

type Mode = 'default' | 'custom' | 'off';
const modeOf = (from: string | null | undefined, to: string | null | undefined): Mode => (!from && !to ? 'default' : from && from === to ? 'off' : 'custom');

const TEST_COPY: Record<NotificationTestResult['status'], { tone: 'success' | 'info' | 'warning'; text: (d: number) => string }> = {
  sent: { tone: 'success', text: (d) => `Sent to ${d} device${d === 1 ? '' : 's'}. It should arrive in a moment.` },
  pending: { tone: 'info', text: () => 'Queued. It should arrive in a moment.' },
  skipped: { tone: 'warning', text: () => 'Nothing was sent: you have no device registered for push, or push is switched off for System notifications below.' },
  held: { tone: 'info', text: () => 'Held back because quiet hours are in effect. It is delivered when they end.' },
  failed: { tone: 'warning', text: () => 'The push service refused it. Try again in a little while.' },
};

function Preferences({ onDirtyChange }: { onDirtyChange: (d: boolean) => void }) {
  const q = useNotificationPreferences();
  if (q.isPending) return <CardListSkeleton rows={4} />;
  if (q.isError || !q.data) return <ErrorCard error={q.error} onRetry={() => void q.refetch()} title="We couldn’t load your notification settings" />;
  return <PreferencesForm key={JSON.stringify(q.data.categories)} data={q.data} onDirtyChange={onDirtyChange} />;
}

function PreferencesForm({ data, onDirtyChange }: { data: NotificationPreferences; onDirtyChange: (d: boolean) => void }) {
  const gate = useWriteGate();
  const save = useSaveNotificationPreferences();
  const test = useSendTestNotification();
  const [testResult, setTestResult] = React.useState<NotificationTestResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const form = useZodForm(notificationPreferencesUpdateBody, {
    defaultValues: { preferences: data.categories.map((c) => ({ category: c.category, push: c.push, email: c.email, quietFrom: c.quietFrom, quietTo: c.quietTo })) },
  });
  const rows = form.watch('preferences');
  const { quietFrom: defFrom, quietTo: defTo } = data.schoolDefaults;

  const changed = rows.filter((r, i) => {
    const c = data.categories[i]!;
    return r.push !== c.push || r.email !== c.email || (r.quietFrom ?? null) !== c.quietFrom || (r.quietTo ?? null) !== c.quietTo;
  });
  const dirty = changed.length > 0;
  React.useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  React.useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  const set = (i: number, patch: Partial<{ push: boolean; email: boolean; quietFrom: string | null; quietTo: string | null }>) => {
    (Object.keys(patch) as (keyof typeof patch)[]).forEach((k) => form.setValue(`preferences.${i}.${k}` as `preferences.${number}.push`, patch[k] as never, { shouldDirty: true }));
  };
  const setMode = (i: number, m: Mode) => {
    if (m === 'default') set(i, { quietFrom: null, quietTo: null });
    else if (m === 'off') set(i, { quietFrom: '00:00', quietTo: '00:00' });
    else set(i, { quietFrom: defFrom, quietTo: defTo });
  };

  const submit = form.handleSubmit(async () => {
    setError(null);
    try {
      await save.mutateAsync({ preferences: changed });
      toast.success('Notification settings saved');
      onDirtyChange(false);
    } catch (e) {
      setError(commsError(e));
    }
  });

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      {gate.readOnly && <Banner tone="locked">{gate.reason}</Banner>}
      {error && <Banner tone="danger" onDismiss={() => setError(null)}>{error}</Banner>}
      <Card>
        <CardHeader title="What reaches you" description={`Choose push and email per kind of notification. Quiet hours follow school time (${data.timezone}); the school default is ${defFrom} to ${defTo}.`} />
        <CardBody className="pt-3">
          <ul className="divide-y divide-border" aria-label="Notification settings by category">
            {data.categories.map((c, i) => {
              const r = rows[i]!;
              const mode = modeOf(r.quietFrom, r.quietTo);
              return (
                <li key={c.category} className="grid gap-3 py-3 first:pt-0 last:pb-0 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1.3fr)] md:items-center">
                  <p className="text-sm font-medium">{c.label}</p>
                  <div className="flex items-center gap-5">
                    <label className="flex min-h-11 items-center gap-2 text-sm sm:min-h-8">
                      <Checkbox checked={!!r.push} disabled={gate.readOnly} onCheckedChange={(v) => set(i, { push: v === true })} aria-label={`${c.label}: push`} />
                      Push
                    </label>
                    <label className="flex min-h-11 items-center gap-2 text-sm sm:min-h-8">
                      <Checkbox checked={!!r.email} disabled={gate.readOnly} onCheckedChange={(v) => set(i, { email: v === true })} aria-label={`${c.label}: email`} />
                      Email
                    </label>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Select
                      aria-label={`${c.label}: quiet hours`}
                      className="w-full sm:w-44"
                      value={mode}
                      disabled={gate.readOnly}
                      onValueChange={(v) => setMode(i, v as Mode)}
                      options={[
                        { value: 'default', label: `School default` },
                        { value: 'custom', label: 'Custom hours' },
                        { value: 'off', label: 'No quiet hours' },
                      ]}
                    />
                    {mode === 'custom' && (
                      <div className="flex items-center gap-1.5">
                        <Input type="time" aria-label={`${c.label}: quiet from`} className="w-[7.5rem]" value={r.quietFrom ?? ''} onChange={(e) => set(i, { quietFrom: e.target.value || null })} disabled={gate.readOnly} />
                        <span className="t-caption text-ink-3" aria-hidden>to</span>
                        <Input type="time" aria-label={`${c.label}: quiet until`} className="w-[7.5rem]" value={r.quietTo ?? ''} onChange={(e) => set(i, { quietTo: e.target.value || null })} disabled={gate.readOnly} />
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </CardBody>
      </Card>

      <div className="sticky bottom-14 z-20 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface-raised p-3 shadow-pop md:bottom-4">
        <p className="t-caption text-ink-2">{dirty ? `${changed.length} ${changed.length === 1 ? 'category' : 'categories'} changed` : 'No unsaved changes'}</p>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" disabled={!dirty || save.isPending} onClick={() => form.reset()}>
            Reset
          </Button>
          <Button type="submit" loading={save.isPending} disabled={!dirty || gate.readOnly}>
            Save settings
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader title="Test notification" description="Sends a push to the devices signed in to your account, using your System settings." />
        <CardBody className="space-y-3 pt-3">
          <Button
            type="button"
            variant="secondary"
            loading={test.isPending}
            disabled={gate.readOnly}
            onClick={() => {
              setTestResult(null);
              test.mutate(undefined, {
                onSuccess: setTestResult,
                onError: (e) => setError(commsError(e)),
              });
            }}
          >
            <BellRing /> Send a test notification
          </Button>
          {testResult && (
            <Banner tone={TEST_COPY[testResult.status].tone} role="status">
              {TEST_COPY[testResult.status].text(testResult.devices)}
            </Banner>
          )}
          <p className="t-caption text-ink-3">You can send up to 5 tests a minute.</p>
        </CardBody>
      </Card>
    </form>
  );
}

