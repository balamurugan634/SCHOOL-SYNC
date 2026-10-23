'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { useMeContext } from '@/components/me-context';
import { Button } from '@/components/ui/button';
import { MoreNav } from '../more-nav';
import { ChildContext, NeedsLearner } from '../states';
import { useGates } from '../use-learner';
import { UrlTabs, useUrlParams } from '../url-state';
import { AnnouncementsPanel } from './announcements';
import { CalendarPanel } from './calendar';
import { EventsPanel } from './events';
import { MeetingsPanel } from './meetings';
import { NotificationPreferencesPanel, NotificationsInbox } from './notifications';

// ───────────────────────────── student pages ─────────────────────────────

export function StudentCalendarScreen() {
  return (
    <>
      <PageHeader title="Calendar" description="Classes, exams, homework deadlines, holidays and school events in one place." />
      <CalendarPanel />
    </>
  );
}

export function StudentAnnouncementsScreen() {
  return (
    <>
      <PageHeader title="Announcements" description="Notices from your school. Open one to read it in full." />
      <MoreNav />
      <AnnouncementsPanel />
    </>
  );
}

export function StudentEventsScreen() {
  return (
    <>
      <PageHeader title="Events" description="School events, trips and holidays. Some ask you to register." />
      <MoreNav />
      <EventsPanel />
    </>
  );
}

export function StudentNotificationsScreen() {
  return (
    <>
      <PageHeader title="Notifications" description="Everything the school has told you, newest first." />
      <MoreNav />
      <NotificationsInbox />
    </>
  );
}

export function StudentPreferencesScreen() {
  const { base } = useMeContext();
  return (
    <>
      <PageHeader title="Notification settings" description="Choose how the school reaches you, and when to keep quiet." crumbs={[{ label: 'Home', href: base }, { label: 'Notifications', href: `${base}/notifications` }, { label: 'Settings' }]} />
      <div className="max-w-3xl">
        <NotificationPreferencesPanel />
      </div>
    </>
  );
}

// ───────────────────────────── parent: Communication ─────────────────────────────

type Tab = 'announcements' | 'events' | 'calendar' | 'meetings' | 'notifications';
/** URL keys that only make sense inside one tab — cleared when switching tabs. */
const TAB_SCOPED = ['open', 'page', 'unread', 'priority', 'kind', 'when', 'cat', 'mstatus', 'mpage', 'view', 'month', 'day'] as const;

export function ParentCommunicationScreen() {
  const { base } = useMeContext();
  const { can } = useGates();
  const { get, set } = useUrlParams();
  const raw = get('tab');
  const tabs = [
    { value: 'announcements' as const, label: 'Announcements' },
    { value: 'events' as const, label: 'Events' },
    { value: 'calendar' as const, label: 'Calendar' },
    { value: 'meetings' as const, label: 'Meetings', hidden: !can('meetings:view') },
    { value: 'notifications' as const, label: 'Notifications' },
  ];
  const visible = tabs.filter((t) => !t.hidden).map((t) => t.value);
  const tab: Tab = (visible as string[]).includes(raw ?? '') ? (raw as Tab) : 'announcements';
  const onTab = (t: Tab) => set({ tab: t === 'announcements' ? null : t, ...Object.fromEntries(TAB_SCOPED.map((k) => [k, null])) });

  return (
    <>
      <PageHeader
        title="Communication"
        description="Announcements, events, meetings with teachers and your notifications."
        actions={
          <Button asChild variant="secondary" size="sm">
            <Link href={`${base}/more`}>
              More: bus, library, corrections <ArrowRight />
            </Link>
          </Button>
        }
      />
      <ChildContext />
      <UrlTabs tabs={tabs} tab={tab} onTab={onTab} label="Communication" />
      <div role="tabpanel" aria-label={tabs.find((t) => t.value === tab)?.label}>
        {tab === 'announcements' && <AnnouncementsPanel />}
        {tab === 'events' && <EventsPanel />}
        {tab === 'calendar' && (
          <NeedsLearner>
            <CalendarPanel />
          </NeedsLearner>
        )}
        {tab === 'meetings' && (
          <NeedsLearner>
            <MeetingsPanel />
          </NeedsLearner>
        )}
        {tab === 'notifications' && <NotificationsInbox />}
      </div>
    </>
  );
}

export function ParentPreferencesScreen() {
  const { base } = useMeContext();
  return (
    <>
      <PageHeader
        title="Notification settings"
        description="Choose how the school reaches you, and when to keep quiet."
        crumbs={[{ label: 'Home', href: base }, { label: 'Communication', href: `${base}/communication?tab=notifications` }, { label: 'Settings' }]}
      />
      <div className="max-w-3xl">
        <NotificationPreferencesPanel />
      </div>
    </>
  );
}
