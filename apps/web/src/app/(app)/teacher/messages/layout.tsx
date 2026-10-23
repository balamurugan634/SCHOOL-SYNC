import { PageHeader } from '@/components/shell/page-header';
import { SubNav } from '@/components/features/teacher/common';

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PageHeader title="Messages & events" description="Announcements to your classes, events, parent meetings and your notifications." className="mb-4 sm:mb-6" />
      <SubNav
        label="Messages sections"
        items={[
          { href: '/messages', label: 'Announcements', exact: true },
          { href: '/messages/events', label: 'Events' },
          { href: '/messages/meetings', label: 'Meetings' },
          { href: '/messages/notifications', label: 'Notifications' },
        ]}
      />
      {children}
    </>
  );
}
