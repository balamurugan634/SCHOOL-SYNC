import type { Job } from '../jobs';
import { flushSchool, hasWork, PER_SCHOOL_CAP, purgeFinished } from './queue';

/** Background jobs of the outgoing-email queue. */
export const jobs: Job[] = [
  {
    // every ~10 s: send the school's due mail strictly one message at a time (core/email/queue.ts). It takes its own short
    // locks (never a long transaction around SMTP), hence `selfLocking`.
    name: 'email.send',
    everyMinutes: 1,
    everySeconds: 10,
    selfLocking: true,
    run: async (tenant, db) => {
      if (!(await hasWork(db))) return;
      await flushSchool(tenant, { limit: PER_SCHOOL_CAP });
    },
  },
  {
    // sent mail is kept 30 days, failed/cancelled 90 days
    name: 'email.retention',
    everyMinutes: 360,
    run: async (_tenant, db) => {
      await purgeFinished(db);
    },
  },
];
