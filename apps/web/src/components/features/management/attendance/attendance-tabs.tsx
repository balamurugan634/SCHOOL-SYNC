'use client';

import { AreaTabs } from '../shared/detail';
import { useAccess } from '../shared/access';
import { paths } from '../shared/paths';

/** The attendance area's tab bar. Only the tabs the signed-in role can use are shown (the API still enforces). */
export function AttendanceTabs() {
  const { can } = useAccess();
  const items = [
    can('attendance:view', 'school') && { href: paths.attendance, label: 'Overview', exact: true },
    can('attendance:view') && { href: paths.attendanceClass(), label: 'Class view' },
    can('attendance:approve') && { href: paths.attendanceCorrections, label: 'Corrections' },
    can('leave:view') && { href: paths.studentLeave, label: 'Student leave' },
    can('staff_leave:view', 'school') && { href: paths.staffLeave, label: 'Staff leave' },
    can('staff_attendance:view', 'school') && { href: paths.staffAttendance, label: 'Staff attendance' },
  ].filter((x): x is { href: string; label: string; exact?: boolean } => !!x);
  if (items.length < 2) return null;
  return <AreaTabs items={items} />;
}
