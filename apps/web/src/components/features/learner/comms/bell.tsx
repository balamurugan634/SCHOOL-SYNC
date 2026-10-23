'use client';

import * as React from 'react';
import Link from 'next/link';
import { Bell, CheckCheck } from 'lucide-react';
import { errorMessage } from '@/lib/problem';
import { cn } from '@/lib/cn';
import { useLatestNotifications, useMarkAllNotificationsRead, useNotificationUnread } from '@/lib/client/learner-comms';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { IconButton } from '@/components/ui/icon-button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toaster';
import { useMeContext } from '@/components/me-context';
import { ErrorState } from '../states';
import { useGates } from '../use-learner';
import { inboxHref } from './routes';
import { NotificationRow, useOpenNotification } from './notifications';

/**
 * The top-bar bell for every role: live unread count (polled every minute), the latest notifications in a popover,
 * mark-all-read, and a link to the full inbox where one exists. Without `notifications:view` it stays an empty bell.
 */
export function LiveNotificationsBell() {
  const { me } = useMeContext();
  const { can, readOnly } = useGates();
  const allowed = can('notifications:view');
  const [open, setOpen] = React.useState(false);
  const count = useNotificationUnread(allowed);
  const latest = useLatestNotifications(allowed && open);
  const readAll = useMarkAllNotificationsRead();
  const openOne = useOpenNotification(() => setOpen(false));
  const inbox = inboxHref(me.experience);
  const unread = count.data ?? 0;

  const doReadAll = async () => {
    try {
      await readAll.mutateAsync(undefined);
    } catch (e) {
      toast.error(errorMessage(e), { duration: 8000 });
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <IconButton label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'} className="relative">
          <Bell />
          {unread > 0 && (
            <span className="absolute right-0.5 top-0.5 grid min-w-4 place-items-center rounded-full bg-brand px-1 text-[11px] font-semibold leading-4 text-on-brand ring-2 ring-bg" aria-hidden>
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </IconButton>
      </PopoverTrigger>
      <PopoverContent className="w-[min(380px,calc(100vw-1.5rem))]">
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
          <h2 className="text-sm font-semibold">Notifications</h2>
          {allowed && unread > 0 && (
            <Button variant="ghost" size="sm" onClick={() => void doReadAll()} loading={readAll.isPending} disabled={readOnly}>
              <CheckCheck /> Mark all read
            </Button>
          )}
        </div>
        {!allowed ? (
          <EmptyState compact illustration="empty-notifications" title="You have no notifications" description="Announcements and reminders will appear here." />
        ) : latest.isPending ? (
          <div className="space-y-3 p-4" aria-busy="true">
            <span className="sr-only">Loading notifications…</span>
            {[0, 1, 2].map((i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            ))}
          </div>
        ) : latest.isError ? (
          <ErrorState error={latest.error} onRetry={() => void latest.refetch()} compact />
        ) : latest.data.length === 0 ? (
          <EmptyState compact illustration="empty-notifications" title="You have no notifications" description="Announcements and reminders will appear here." />
        ) : (
          <ul className="max-h-[min(60dvh,420px)] divide-y divide-border overflow-y-auto">
            {latest.data.map((n) => (
              <li key={n.id}>
                <NotificationRow n={n} onOpen={openOne} compact />
              </li>
            ))}
          </ul>
        )}
        {allowed && inbox && (
          <div className={cn('border-t border-border p-2 text-center')}>
            <Button asChild variant="ghost" size="sm" className="w-full">
              <Link href={inbox} onClick={() => setOpen(false)}>
                View all notifications
              </Link>
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
