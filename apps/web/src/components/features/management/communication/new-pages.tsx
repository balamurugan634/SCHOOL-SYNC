'use client';

import { PageHeader } from '@/components/shell/page-header';
import { useMgmt } from '../common/use-mgmt';
import { AnnouncementForm } from './announcement-form';
import { EventForm } from './event-form';

export function NewAnnouncement() {
  const { base } = useMgmt();
  return (
    <>
      <PageHeader title="New announcement" description="Write it, choose who receives it, then save a draft, schedule it or publish it." crumbs={[{ label: 'Announcements', href: `${base}/communication/announcements` }, { label: 'New' }]} />
      <div className="max-w-3xl">
        <AnnouncementForm />
      </div>
    </>
  );
}

export function NewEvent() {
  const { base } = useMgmt();
  return (
    <>
      <PageHeader title="New event" description="Add an event, a holiday or a meeting day to the school calendar." crumbs={[{ label: 'Events and calendar', href: `${base}/communication/events` }, { label: 'New' }]} />
      <div className="max-w-3xl">
        <EventForm />
      </div>
    </>
  );
}
