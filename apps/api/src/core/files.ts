import { and, eq, inArray, isNull } from 'drizzle-orm';
import { files } from '../db/tenant/schema';
import { unprocessable } from './errors';
import type { Executor } from './tenancy/pools';

/**
 * Throw 422 unless every id is an uploaded, non-deleted file in this school. Use before storing attachment references.
 * Pass `{ uploadedBy: req.auth.userId }` when the caller must own the files they attach (recommended for user-supplied
 * attachments: it stops anyone from attaching a file id they merely learned).
 */
export async function assertFilesExist(db: Executor, ids: string[], opts: { uploadedBy?: string } = {}): Promise<void> {
  const unique = [...new Set(ids)];
  if (!unique.length) return;
  const rows = await db
    .select({ id: files.id })
    .from(files)
    .where(and(inArray(files.id, unique), isNull(files.deletedAt), opts.uploadedBy ? eq(files.uploadedBy, opts.uploadedBy) : undefined));
  if (rows.length !== unique.length) throw unprocessable('One or more attachments were not found', 'ATTACHMENT_NOT_FOUND');
}
