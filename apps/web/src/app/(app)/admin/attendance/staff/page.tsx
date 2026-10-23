import type { Metadata } from 'next';
import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { NoAccess } from '@/components/dashboard/coming-online';
import { StaffAttendanceScreen } from '@/components/features/management/attendance/staff-attendance';
import { paths } from '@/components/features/management/shared/paths';
import { can } from '@/lib/permissions';
import { requireMe } from '@/lib/server/session';

export const metadata: Metadata = { title: 'Staff attendance' };

export default async function Page() {
  const me = await requireMe();
  if (!can(me.permissions, 'staff_attendance:view', 'school')) {
    // the nav entry covers staff attendance and staff leave; send leave-only roles to the leave queue
    if (can(me.permissions, 'staff_leave:view', 'school')) redirect(paths.staffLeave);
    return <NoAccess />;
  }
  return (
    <Suspense>
      <StaffAttendanceScreen />
    </Suspense>
  );
}
