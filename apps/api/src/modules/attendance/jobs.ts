import type { Job } from '../../core/jobs';
import { scanAttendanceShortage } from './views.service';

export { scanAttendanceShortage };

/** Background jobs for this module (reminders, scans, scheduled publishing). Must be idempotent. */
export const jobs: Job[] = [
  {
    // Runs once a day per school. Students below `attendance.shortagePercent` get ONE guardian alert per month
    // (unique `attendance_alerts (student, month)`), so re-runs and parallel instances send nothing twice.
    name: 'attendance.shortageScan',
    everyMinutes: 24 * 60,
    // runs inside the job transaction: the push is deferred until it has committed
    run: async (tenant, db) => {
      await scanAttendanceShortage(tenant, db, { push: 'defer' });
    },
  },
];
