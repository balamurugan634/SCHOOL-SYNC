import type { Job } from '../../core/jobs';
import { jobs as fileJobs } from '../files/jobs';
import { runScheduled } from './announcements';

/** Background jobs for this module (and the file store's housekeeping). Must be idempotent. */
export const jobs: Job[] = [
  {
    // publishes drafts whose publishAt has arrived (fan-out included) and archives announcements past expiresAt
    name: 'communication.publish-scheduled',
    everyMinutes: 1,
    run: async (tenant, db) => {
      await runScheduled(tenant, db);
    },
  },
  ...fileJobs,
];
