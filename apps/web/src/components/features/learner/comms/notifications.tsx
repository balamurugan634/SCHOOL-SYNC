'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bell, CalendarCheck2, CalendarDays, CalendarX2, Check, CheckCheck, Info, ListChecks, Megaphone, NotebookPen, Settings2, Trash2, Trophy, Users, Wallet, type LucideIcon } from 'lucide-react';
import { z } from 'zod';
import { NOTIFICATION_CATEGORY_LIST, notificationPreferencesUpdateBody, timeStr, type NotificationItem, type NotificationPreferences } from '@school-sync/shared';
import { cn } from '@/lib/cn';
import { applyApiErrors, useZodForm } from '@/lib/client/use-zod-form';
import { useUnsavedGuard } from '@/lib/client/use-unsaved-guard';
import { errorMessage } from '@/lib/problem';
import {
  useDeleteNotification,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotificationPreferences,
  useNotificationsInbox,
  useNotificationUnread,
  useSendTestNotification,
  useUpdateNotificationPreferences,
} from '@/lib/client/learner-comms';
import { Badge } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { FormActions, FormCheckbox, FormInput } from '@/components/ui/form';
import { IconButton } from '@/components/ui/icon-button';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toaster';
import { useMeContext } from '@/components/me-context';
import { ErrorState, SkeletonRows } from '../states';
import { useGates } from '../use-learner';
import { useUrlParams } from '../url-state';
import { ago, Segmented } from './common';
import { inboxHref, mapNotificationRoute, preferencesHref } from './routes';

const CATEGORY_ICON: Record<string, LucideIcon> = {
  attendance: CalendarCheck2,
  homework: NotebookPen,
  marks: Trophy,
  fees: Wallet,
  announcement: Megaphone,
  event: CalendarDays,
  meeting: Users,
  leave: CalendarX2,
  tasks: ListChecks,
  system: Settings2,
};
export function CategoryIcon({ category, className }: { category: string; className?: string }) {
  const Icon = CATEGORY_ICON[category] ?? Info;
  return <Icon className={className} aria-hidden />;
}

const CATEGORY_LABEL: Record<string, string> = { attendance: 'Attendance', homework: 'Homework', marks: 'Marks and results', fees: 'Fees', announcement: 'Announcements', event: 'Events', meeting: 'Meetings', leave: 'Leave', tasks: 'Tasks', system: 'Account and system' };
const CATEGORY_OPTIONS = [{ value: 'all', label: 'All categories' }, ...NOTIFICATION_CATEGORY_LIST.map((c) => ({ value: c, label: CATEGORY_LABEL[c] ?? c }))];

/** Open a notification: mark it read, then go where it points (when this app has a page for it). */
export function useOpenNotification(onNavigate?: () => void) {
  const router = useRouter();
  const { me } = useMeContext();
  const markRead = useMarkNotificationRead();
  return React.useCallback(
    (n: NotificationItem) => {
      if (!n.read) markRead.mutate(n.id);
      const href = mapNotificationRoute(n.data?.route, me.experience);
      if (href) {
        onNavigate?.();
        router.push(href);
      }
    },
    [markRead, me.experience, router, onNavigate],
  );
}

export function NotificationRow({ n, onOpen, onDelete, onMarkRead, compact }: { n: NotificationItem; onOpen: (n: NotificationItem) => void; onDelete?: (n: NotificationItem) => void; onMarkRead?: (n: NotificationItem) => void; compact?: boolean }) {
  return (
    <div className={cn('flex items-start gap-1', !n.read && 'bg-brand-soft/40')}>
      <button type="button" onClick={() => onOpen(n)} className={cn('tr-colors flex min-w-0 flex-1 items-start gap-3 text-left hover:bg-surface-subtle', compact ? 'px-4 py-3' : 'px-5 py-4 max-sm:px-4')}>
        <span className="relative mt-0.5 shrink-0">
          <CategoryIcon category={n.category} className="size-[18px] text-ink-2" />
          {!n.read && <span className="absolute -right-1 -top-1 size-2 rounded-full bg-brand ring-2 ring-surface" aria-hidden />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2">
            {!n.read && <span className="sr-only">Unread: </span>}
            <span className={cn('text-sm', n.read ? 'font-medium' : 'font-semibold')}>{n.title}</span>
            {n.priority === 'high' && <Badge variant="warning">Important</Badge>}
          </span>
          {n.body && <span className={cn('mt-0.5 block text-[13px] text-ink-2', compact ? 'line-clamp-2' : 'line-clamp-3')}>{n.body}</span>}
          <span className="t-caption mt-1 block text-ink-3">
            {CATEGORY_LABEL[n.category] ?? n.category} · {ago(n.createdAt)}
          </span>
        </span>
      </button>
      {(onMarkRead || onDelete) && (
        <span className="flex shrink-0 items-center pr-2 pt-2.5">
          {onMarkRead && !n.read && (
            <IconButton label={`Mark “${n.title}” as read`} variant="ghost" size="icon-sm" onClick={() => onMarkRead(n)}>
              <Check />
            </IconButton>
          )}
          {onDelete && (
            <IconButton label={`Delete “${n.title}”`} variant="ghost" size="icon-sm" onClick={() => onDelete(n)}>
              <Trash2 />
            </IconButton>
          )}
        </span>
      )}
    </div>
  );
}

/** The full inbox (GET /notifications, keyset pagination). Filters live in the URL: `?unread=1&cat=homework`. */
export function NotificationsInbox() {
  const { me } = useMeContext();
  const { readOnly } = useGates();
  const { get, set } = useUrlParams();
  const unread = get('unread') === '1';
  const cat = get('cat') ?? 'all';
  const filters = { unread, category: cat === 'all' ? undefined : cat };
  const q = useNotificationsInbox(filters);
  const count = useNotificationUnread();
  const markRead = useMarkNotificationRead();
  const readAll = useMarkAllNotificationsRead();
  const del = useDeleteNotification();
  const open = useOpenNotification();
  const [deleting, setDeleting] = React.useState<NotificationItem | null>(null);
  const items = q.data?.pages.flatMap((p) => p.data) ?? [];
  const prefs = preferencesHref(me.experience);
  const filtered = unread || cat !== 'all';

  const doReadAll = async () => {
    try {
      const r = await readAll.mutateAsync(cat === 'all' ? undefined : cat);
      toast.success(r.updated > 0 ? `${r.updated} notification${r.updated === 1 ? '' : 's'} marked as read` : 'Everything is already read');
    } catch (e) {
      toast.error(errorMessage(e), { duration: 8000 });
    }
  };
  const doDelete = async () => {
    if (!deleting) return;
    try {
      await del.mutateAsync(deleting.id);
      toast.success('Notification deleted');
    } catch (e) {
      toast.error(errorMessage(e), { duration: 8000 });
    }
    setDeleting(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented label="Show" value={unread ? 'unread' : 'all'} onChange={(v) => set({ unread: v === 'unread' ? '1' : null })} options={[{ value: 'all', label: 'All' }, { value: 'unread', label: 'Unread' }]} />
        <Select aria-label="Category" className="w-52" value={cat} onValueChange={(v) => set({ cat: v === 'all' ? null : v })} options={CATEGORY_OPTIONS} />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {count.data !== undefined && <span className="t-caption text-ink-2" aria-live="polite">{count.data} unread</span>}
          <Button variant="secondary" size="sm" onClick={() => void doReadAll()} loading={readAll.isPending} disabled={readOnly || count.data === 0}>
            <CheckCheck /> Mark all read
          </Button>
          {prefs && (
            <Button asChild variant="ghost" size="sm">
              <Link href={prefs}>Preferences</Link>
            </Button>
          )}
        </div>
      </div>

      <Card className="overflow-hidden">
        {q.isPending ? (
          <SkeletonRows rows={5} />
        ) : q.isError && !q.data ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : items.length === 0 ? (
          filtered ? (
            <EmptyState illustration="no-results" title="No notifications match" filters={<>{unread && <Badge variant="outline">Unread only</Badge>}{cat !== 'all' && <Badge variant="outline">{CATEGORY_LABEL[cat] ?? cat}</Badge>}</>} action={<Button variant="secondary" size="sm" onClick={() => set({ unread: null, cat: null })}>Clear filters</Button>} />
          ) : (
            <EmptyState illustration="empty-notifications" title="You have no notifications" description="Reminders, results and notices from the school will show up here." />
          )
        ) : (
          <>
            <ul className="divide-y divide-border" aria-busy={q.isFetching && !q.isFetchingNextPage ? true : undefined}>
              {items.map((n) => (
                <li key={n.id}>
                  <NotificationRow n={n} onOpen={open} onMarkRead={readOnly ? undefined : (x) => markRead.mutate(x.id)} onDelete={readOnly ? undefined : setDeleting} />
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-center border-t border-border px-5 py-3">
              {q.hasNextPage ? (
                <Button variant="secondary" size="sm" onClick={() => void q.fetchNextPage()} loading={q.isFetchingNextPage}>
                  Load more
                </Button>
              ) : (
                <span className="t-caption text-ink-3">You’re up to date — that’s everything.</span>
              )}
            </div>
          </>
        )}
      </Card>

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this notification?"
        description={deleting ? `“${deleting.title}” will be removed from your inbox. This can’t be undone.` : ''}
        confirmLabel="Delete"
        destructive
        loading={del.isPending}
        onConfirm={() => void doDelete()}
      />
    </div>
  );
}

// ───────────────────────────── preferences ─────────────────────────────

const prefsForm = z
  .object({
    preferences: z.array(
      z.object({
        category: z.enum(NOTIFICATION_CATEGORY_LIST),
        push: z.boolean(),
        email: z.boolean(),
        quietFrom: timeStr.or(z.literal('')),
        quietTo: timeStr.or(z.literal('')),
      }),
    ),
  })
  .superRefine((v, ctx) => {
    v.preferences.forEach((p, i) => {
      if (!!p.quietFrom !== !!p.quietTo) ctx.addIssue({ code: 'custom', path: ['preferences', i, p.quietFrom ? 'quietTo' : 'quietFrom'], message: 'Set both times, or clear both to use the school’s default' });
    });
  });
type PrefsValues = z.input<typeof prefsForm>;

const toForm = (d: NotificationPreferences): PrefsValues => ({ preferences: d.categories.map((c) => ({ category: c.category, push: c.push, email: c.email, quietFrom: c.quietFrom ?? '', quietTo: c.quietTo ?? '' })) });

/** Notification settings (GET / PUT /notifications/preferences): push + email per category, quiet hours, a test button. */
export function NotificationPreferencesPanel() {
  const q = useNotificationPreferences();
  if (q.isPending)
    return (
      <Card>
        <CardBody className="space-y-4">
          {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </CardBody>
      </Card>
    );
  if (q.isError || !q.data) return <Card><ErrorState error={q.error} onRetry={() => void q.refetch()} /></Card>;
  return <PrefsForm data={q.data} />;
}

function PrefsForm({ data }: { data: NotificationPreferences }) {
  const { readOnly, can } = useGates();
  const save = useUpdateNotificationPreferences();
  const test = useSendTestNotification();
  const [formError, setFormError] = React.useState<string | null>(null);
  const form = useZodForm(prefsForm, { defaultValues: toForm(data) });
  const { dialog } = useUnsavedGuard(form.formState.isDirty);
  const canEdit = can('notifications:edit') && !readOnly;

  const submit = form.handleSubmit(async (values) => {
    setFormError(null);
    // only what changed since the server's copy goes over the wire
    const changes = values.preferences.flatMap((p) => {
      const was = data.categories.find((c) => c.category === p.category);
      if (!was) return [];
      const item: { category: string; push?: boolean; email?: boolean; quietFrom?: string | null; quietTo?: string | null } = { category: p.category };
      let changed = false;
      if (p.push !== was.push) { item.push = p.push; changed = true; }
      if (p.email !== was.email) { item.email = p.email; changed = true; }
      if ((p.quietFrom || null) !== was.quietFrom || (p.quietTo || null) !== was.quietTo) {
        item.quietFrom = p.quietFrom || null;
        item.quietTo = p.quietTo || null;
        changed = true;
      }
      return changed ? [item] : [];
    });
    if (changes.length === 0) {
      toast.message('Nothing to save — no settings were changed');
      return;
    }
    const body = notificationPreferencesUpdateBody.safeParse({ preferences: changes });
    if (!body.success) {
      setFormError(body.error.issues[0]?.message ?? 'Check the settings and try again.');
      return;
    }
    try {
      const res = await save.mutateAsync(body.data);
      form.reset(toForm(res));
      toast.success('Notification settings saved');
    } catch (e) {
      setFormError(applyApiErrors(form, e));
    }
  });

  const sendTest = async () => {
    try {
      const r = await test.mutateAsync();
      if (r.status === 'sent') toast.success(`Test notification sent to ${r.devices} device${r.devices === 1 ? '' : 's'}`);
      else if (r.status === 'skipped') toast.message('Test saved to your inbox', { description: 'No device is registered for push on this account, or push is off for “Account and system”.' });
      else if (r.status === 'held') toast.message('Test saved to your inbox', { description: 'Push is held back during quiet hours.' });
      else toast.error('The test push could not be delivered. It is in your inbox.', { duration: 8000 });
    } catch (e) {
      toast.error(errorMessage(e), { duration: 8000 });
    }
  };

  return (
    <>
      <form onSubmit={submit} noValidate className="space-y-4">
        {readOnly && <Banner tone="locked">This school is in read-only mode, so settings can’t be changed right now.</Banner>}
        <Card>
          <CardHeader title="What you hear about" description={`Quiet hours default to ${data.schoolDefaults.quietFrom}–${data.schoolDefaults.quietTo} (${data.timezone}). Push is held back during quiet hours and delivered afterwards.`} />
          <CardBody className="pt-2">
            <ul className="divide-y divide-border">
              {data.categories.map((c, i) => {
                return (
                  <li key={c.category} className="py-4 first:pt-2 last:pb-0">
                    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                      <p className="flex min-w-40 flex-1 items-center gap-2.5 text-sm font-medium">
                        <CategoryIcon category={c.category} className="size-4 text-ink-2" /> {c.label}
                      </p>
                      <fieldset disabled={!canEdit} className="flex items-center gap-6 border-0 p-0">
                        <legend className="sr-only">How to reach you about {c.label}</legend>
                        <FormCheckbox control={form.control} name={`preferences.${i}.push`} label="Push" />
                        <FormCheckbox control={form.control} name={`preferences.${i}.email`} label="Email" />
                      </fieldset>
                    </div>
                    <details className="group mt-2" open={!!(c.quietFrom || c.quietTo) || undefined}>
                      <summary className="tr-colors t-caption inline-flex min-h-8 cursor-pointer items-center rounded px-1 text-ink-2 hover:text-ink">Quiet hours{c.quietFrom && c.quietTo ? ` · ${c.quietFrom}–${c.quietTo}` : ' · school default'}</summary>
                      <fieldset disabled={!canEdit} className="mt-2 grid gap-3 border-0 p-0 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                        <FormInput control={form.control} name={`preferences.${i}.quietFrom`} label="Quiet from" type="time" />
                        <FormInput control={form.control} name={`preferences.${i}.quietTo`} label="Quiet until" type="time" hint="Same time in both = no quiet hours" />
                        <Button type="button" variant="ghost" size="sm" onClick={() => { form.setValue(`preferences.${i}.quietFrom`, '', { shouldDirty: true }); form.setValue(`preferences.${i}.quietTo`, '', { shouldDirty: true }); }}>
                          Use school default
                        </Button>
                      </fieldset>
                    </details>
                  </li>
                );
              })}
            </ul>
          </CardBody>
          {formError && <div className="px-5 pb-4"><Banner tone="danger">{formError}</Banner></div>}
          <FormActions className="rounded-b-lg">
            <Button type="button" variant="secondary" disabled={!form.formState.isDirty} onClick={() => form.reset(toForm(data))}>
              Discard changes
            </Button>
            <Button type="submit" loading={form.formState.isSubmitting || save.isPending} disabled={!canEdit || !form.formState.isDirty}>
              Save settings
            </Button>
          </FormActions>
        </Card>

        <Card>
          <CardHeader title="Test it" description="Send yourself a test notification to check that push reaches your phone." />
          <CardBody className="pt-3">
            <Button type="button" variant="secondary" onClick={() => void sendTest()} loading={test.isPending} disabled={!canEdit}>
              <Bell /> Send a test notification
            </Button>
          </CardBody>
        </Card>
      </form>
      {dialog}
    </>
  );
}

export { inboxHref };
