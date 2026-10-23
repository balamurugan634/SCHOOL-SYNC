import { PageHeader } from '@/components/shell/page-header';
import { SubNav } from '@/components/features/teacher/common';

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PageHeader title="Me" description="Check in and out, your leave and your details." className="mb-4 sm:mb-6" />
      <SubNav
        label="Me sections"
        items={[
          { href: '/me', label: 'Attendance', exact: true },
          { href: '/me/leave', label: 'Leave' },
          { href: '/me/profile', label: 'Profile' },
        ]}
      />
      {children}
    </>
  );
}
