'use client';

import * as React from 'react';
import { PageHeader } from '@/components/shell/page-header';
import { MoreNav } from '../more-nav';
import { FeatureGate } from '../gate';
import { ChildContext, NeedsLearner } from '../states';
import { useLearner } from '../use-learner';
import { UrlTabs, useTabParam } from '../url-state';
import { AttendanceOverview } from './overview';
import { AttendanceRecords } from './records';
import { LeavePanel } from './leave';

const TABS = ['overview', 'records', 'leave'] as const;

/** Tabs: overview (summary, heat strip, calendar, trend) · records (history) · leave (requests). Shared by student and parent. */
function AttendanceBody() {
  const l = useLearner();
  const [tab, setTab] = useTabParam(TABS, 'overview');
  return (
    <>
      <UrlTabs
        label="Attendance sections"
        tab={tab}
        onTab={setTab}
        tabs={[
          { value: 'overview', label: 'Overview' },
          { value: 'records', label: 'Records' },
          { value: 'leave', label: 'Leave' },
        ]}
      />
      <div role="tabpanel" aria-label={tab} key={`${tab}-${l.studentId}`}>
        {tab === 'overview' && <AttendanceOverview />}
        {tab === 'records' && <AttendanceRecords />}
        {tab === 'leave' && <LeavePanel />}
      </div>
    </>
  );
}

export function StudentAttendanceScreen() {
  return (
    <>
      <PageHeader title="Attendance" description="Your attendance record, a calendar of your days and your leave requests." />
      <MoreNav />
      <FeatureGate perm="attendance:view" what="Attendance">
        <NeedsLearner>
          <AttendanceBody />
        </NeedsLearner>
      </FeatureGate>
    </>
  );
}

export function ParentAttendanceScreen() {
  return (
    <>
      <PageHeader title="Attendance" description="Daily attendance, absences and leave requests for your child." />
      <ChildContext />
      <FeatureGate perm="attendance:view" what="Attendance">
        <NeedsLearner>
          <AttendanceBody />
        </NeedsLearner>
      </FeatureGate>
    </>
  );
}
