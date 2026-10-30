import { asc } from 'drizzle-orm';
import { events, meetings } from '../../db/tenant/schema';
import { todayIn } from '../http';
import type { Job } from '../jobs';
import { purgeCleanup, runCleanup } from './cleanup';
import { eventsNeedingSync, meetingsNeedingSync, syncOnline } from './sync';

const PER_RUN = 10;

/**
 * Finishes what a provider outage interrupted: creates, updates and cancellations that failed (for a day after the first
 * failure), plus deleted events whose meeting could not be cancelled. Each row is handled under its own short lease
 * (`selfLocking`: no long transaction around network calls), so two API instances never double-handle a row.
 */
export const jobs: Job[] = [
  {
    name: 'online-meetings.retry',
    everyMinutes: 5,
    selfLocking: true,
    run: async (tenant, db) => {
      const today = todayIn(tenant.timezone);
      const [ev, mt] = await Promise.all([
        db.select({ id: events.id }).from(events).where(eventsNeedingSync(today)).orderBy(asc(events.onlineFailedAt)).limit(PER_RUN),
        db.select({ id: meetings.id }).from(meetings).where(meetingsNeedingSync()).orderBy(asc(meetings.onlineFailedAt)).limit(PER_RUN),
      ]);
      for (const r of ev) await syncOnline(tenant, db, 'event', r.id);
      for (const r of mt) await syncOnline(tenant, db, 'meeting', r.id);
      await runCleanup(tenant, db, { limit: PER_RUN });
      await purgeCleanup(db);
    },
  },
];
