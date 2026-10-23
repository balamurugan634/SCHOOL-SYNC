'use client';

import { StatTile } from '../ui/stat-tile';
import { PageHeader } from '../shell/page-header';
import { ComingSoonCard } from './coming-online';
import { useMe } from '../me-context';

/** "Dr. Meenakshi Raman" → "Meenakshi" (honorifics are skipped). */
const firstName = (n: string) => n.trim().replace(/^((dr|mr|mrs|ms|miss|prof|sri|shri|smt)\.?\s+)+/i, '').split(/\s+/)[0] || n;

const INTRO = 'These sections connect to live school data in an upcoming release:';

export function StudentHome() {
  const me = useMe();
  const cls = [me.profile.gradeName, me.profile.sectionName].filter(Boolean).join(' · ');
  return (
    <>
      <PageHeader title="Home" description={`Welcome back, ${firstName(me.displayName)}.`} />
      {cls && (
        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatTile label="Class" value={cls} />
        </div>
      )}
      <ComingSoonCard intro={INTRO} items={['Today’s classes and timetable', 'Homework due and your own tasks', 'Attendance for this term', 'Exams, events and announcements', 'Published results and study materials']} />
    </>
  );
}

export function TeacherHome() {
  const me = useMe();
  const assigned = me.profile.assignedSectionIds.length;
  const leading = me.profile.classTeacherSectionIds.length;
  return (
    <>
      <PageHeader title="Home" description={`Welcome back, ${firstName(me.displayName)}.`} />
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatTile label="Classes assigned" value={assigned} />
        <StatTile label="Class teacher of" value={leading} />
      </div>
      <ComingSoonCard intro={INTRO} items={['Today’s periods with a shortcut to take attendance', 'Homework to review and marks due', 'Pending tasks, leave and meeting requests', 'Class announcements and events']} />
    </>
  );
}
