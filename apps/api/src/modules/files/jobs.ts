import type { Job } from '../../core/jobs';
import { purgeDeletedFiles } from './service';

/** Housekeeping for the file store. Registered through communication/jobs.ts (core/jobs.ts lists one jobs file per module). */
export const jobs: Job[] = [
  {
    // remove the bytes of files soft-deleted more than 30 days ago (rows stay for history); safe to run twice
    name: 'files.purge-deleted',
    everyMinutes: 24 * 60,
    run: async (_tenant, db) => {
      await purgeDeletedFiles(db, 30);
    },
  },
];
