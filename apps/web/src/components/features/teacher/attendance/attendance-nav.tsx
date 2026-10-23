'use client';

import { useTeacherDashboard, useTeacherScope } from '@/lib/client/teacher';
import { useCorrections } from '@/lib/client/teacher-classes';
import { usePermissions } from '@/components/me-context';
import { SubNav } from '../common';

/** Sibling pages of the roll call. Badges show what is waiting for this teacher's decision. */
export function AttendanceNav() {
  const { can } = usePermissions();
  const scope = useTeacherScope();
  const canDecide = can('attendance:approve');
  const dash = useTeacherDashboard();
  const pendingCorrections = useCorrections({ status: 'pending', sectionId: '', mine: false, page: 1, pageSize: 1 }, canDecide);
  return (
    <SubNav
      label="Attendance sections"
      items={[
        { href: '/attendance', label: 'Roll call', exact: true },
        { href: '/attendance/history', label: 'History' },
        { href: '/attendance/corrections', label: 'Corrections', badge: canDecide ? (pendingCorrections.data?.meta.total ?? null) : null },
        { href: '/attendance/leave', label: 'Student leave', hidden: !can('leave:view'), badge: scope.isClassTeacher ? (dash.data?.pendingLeaveCount ?? null) : null },
      ]}
    />
  );
}
