import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import { Transform } from 'node:stream';
import { and, eq, isNotNull, lt, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { FILE_PURPOSES, type FileObject, type FilePurpose, type FileUploadResponse, type PermissionKey } from '@school-sync/shared';
import { config } from '../../config';
import { AppError, forbidden, unprocessable } from '../../core/errors';
import type { Principal } from '../../core/rbac/principal';
import { newStorageKey, storage, StorageLimitError } from '../../core/storage';
import type { Executor } from '../../core/tenancy/pools';
import type { TenantInfo } from '../../core/tenancy/registry';
import { files, users } from '../../db/tenant/schema';
import { assertAllowed, PURPOSE_MAX_MB, sanitizeFileName, SNIFF_BYTES, UploadRejected } from './sniff';
import type { FileRow } from './access';

export const fileUrl = (id: string) => `/api/v1/files/${id}`;

export const toFileObject = (f: FileRow): FileObject => ({
  id: f.id,
  url: fileUrl(f.id),
  name: f.originalName,
  mimeType: f.mimeType,
  sizeBytes: f.sizeBytes,
  sha256: f.sha256,
  purpose: f.purpose,
  uploadedBy: f.uploadedBy,
  createdAt: f.createdAt.toISOString(),
});

export const toUploadResponse = (f: FileRow): FileUploadResponse => ({ ...toFileObject(f), attachment: { fileId: f.id, name: f.originalName, mimeType: f.mimeType, sizeBytes: f.sizeBytes } });

/**
 * Who may upload which purpose (any one of the permissions suffices). Documented in the OpenAPI summary of `POST /files`;
 * other modules should upload with the purpose that matches the permission their endpoint already requires.
 */
const UPLOAD_PERMS: Record<FilePurpose, Parameters<Principal['scope']>[0][] | 'any'> = {
  avatar: 'any',
  other: 'any',
  homework: ['homework:create', 'homework:edit'],
  submission: ['submissions:create'],
  material: ['materials:create', 'materials:edit'],
  document: ['student_documents:create', 'leave:create', 'admissions:create', 'students:edit'],
  announcement: ['announcements:create', 'announcements:edit', 'events:create', 'events:edit'],
  receipt: ['payments:create', 'expenses:create', 'fees:create'],
};

export function assertMayUpload(p: Principal, purpose: FilePurpose): void {
  const need = UPLOAD_PERMS[purpose];
  if (need !== 'any' && !need.some((perm) => p.scope(perm))) throw forbidden(`You may not upload "${purpose}" files`);
}

export const isPurpose = (v: unknown): v is FilePurpose => typeof v === 'string' && (FILE_PURPOSES as readonly string[]).includes(v);

export function maxBytesFor(purpose: FilePurpose): number {
  return Math.min(config.MAX_UPLOAD_MB, PURPOSE_MAX_MB[purpose] ?? Infinity) * 1024 * 1024;
}

/**
 * Pass-through stream that sniffs the first bytes (rejecting disallowed content before it is stored), counts and hashes
 * everything, and enforces the size cap. Nothing is forwarded until the head has been inspected.
 */
class UploadGuard extends Transform {
  private head: Buffer[] = [];
  private headLen = 0;
  private checked = false;
  private readonly hash = createHash('sha256');
  size = 0;
  mime = '';
  ext = '';

  constructor(
    private readonly purpose: FilePurpose,
    private readonly filename: string,
    private readonly maxBytes: number,
  ) {
    super();
  }

  private check(): void {
    const head = Buffer.concat(this.head);
    const r = assertAllowed(head.subarray(0, SNIFF_BYTES), this.filename, this.purpose);
    this.mime = r.mime;
    this.ext = r.ext;
    this.checked = true;
  }

  override _transform(chunk: Buffer, _enc: BufferEncoding, cb: (err?: Error | null) => void): void {
    try {
      this.size += chunk.length;
      if (this.size > this.maxBytes) return cb(new StorageLimitError(this.maxBytes));
      this.hash.update(chunk);
      if (this.checked) {
        this.push(chunk);
        return cb();
      }
      this.head.push(chunk);
      this.headLen += chunk.length;
      if (this.headLen >= SNIFF_BYTES) {
        this.check();
        for (const c of this.head) this.push(c);
        this.head = [];
      }
      cb();
    } catch (e) {
      cb(e as Error);
    }
  }

  override _flush(cb: (err?: Error | null) => void): void {
    try {
      if (!this.checked) {
        this.check();
        for (const c of this.head) this.push(c);
        this.head = [];
      }
      cb();
    } catch (e) {
      cb(e as Error);
    }
  }

  digest(): string {
    return this.hash.copy().digest('hex');
  }
}

/** Translate sniffing / size errors into API errors. */
export function mapUploadError(e: unknown): unknown {
  if (e instanceof UploadRejected) return unprocessable(e.message, e.code);
  if (e instanceof StorageLimitError) return new AppError(413, 'PAYLOAD_TOO_LARGE', `File is larger than the ${Math.floor(e.maxBytes / 1024 / 1024)} MB limit`);
  if ((e as { code?: string } | null)?.code === 'FST_REQ_FILE_TOO_LARGE') return new AppError(413, 'PAYLOAD_TOO_LARGE', `File is larger than the ${config.MAX_UPLOAD_MB} MB limit`);
  return e;
}

export interface UploadInput {
  stream: Readable;
  /** set by @fastify/multipart when the per-file limit cut the stream short */
  wasTruncated: () => boolean;
  filename: string | undefined;
  purpose: FilePurpose;
}

/** Stream → sniff → store → `files` row. Nothing is left in storage when any step fails. */
export async function storeUpload(db: Executor, tenant: TenantInfo, p: Principal, input: UploadInput): Promise<FileRow> {
  const cap = maxBytesFor(input.purpose);
  const id = uuidv7();
  const key = newStorageKey(tenant.code, id);
  const guard = new UploadGuard(input.purpose, input.filename ?? '', cap);
  // the guard can fail (rejected content) before `put` has attached its own listeners; never let that be an uncaught 'error'
  guard.on('error', () => undefined);
  input.stream.on('error', (e) => guard.destroy(e));
  input.stream.pipe(guard);
  let stored: { sizeBytes: number };
  try {
    stored = await storage().put(key, guard, { contentType: 'application/octet-stream', maxBytes: cap });
  } catch (e) {
    input.stream.unpipe(guard);
    input.stream.resume();
    throw mapUploadError(e);
  }
  if (input.wasTruncated()) {
    await storage().delete(key).catch(() => undefined);
    throw mapUploadError(new StorageLimitError(cap));
  }
  const name = sanitizeFileName(input.filename, guard.ext);
  try {
    const [row] = await db
      .insert(files)
      .values({ id, storageKey: key, originalName: name, mimeType: guard.mime, sizeBytes: stored.sizeBytes, sha256: guard.digest(), purpose: input.purpose, uploadedBy: p.userId })
      .returning();
    return row!;
  } catch (e) {
    await storage().delete(key).catch(() => undefined);
    throw e;
  }
}

export async function findFile(db: Executor, id: string): Promise<FileRow | null> {
  const [row] = await db.select().from(files).where(eq(files.id, id)).limit(1);
  return row ?? null;
}

/** `bytes=a-b` | `bytes=a-` | `bytes=-n` → inclusive range, `null` when absent, `'invalid'` when unsatisfiable. */
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | null | 'invalid' {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return null; // malformed or multi-range: ignore, serve the whole file
  let start: number;
  let end: number;
  if (m[1] === '') {
    const n = Number(m[2]);
    if (n === 0) return 'invalid';
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || start > end) return 'invalid';
  return { start, end };
}

/** RFC 6266 / 5987 Content-Disposition with an ASCII fallback. */
export function contentDisposition(kind: 'inline' | 'attachment', name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}

/** Point a user's avatar at a freshly uploaded file; the previous avatar file (if the user uploaded it) is retired. */
export async function setAvatar(db: Executor, userId: string, fileId: string | null): Promise<void> {
  const [prev] = await db.select({ id: users.avatarFileId }).from(users).where(eq(users.id, userId)).limit(1);
  await db.update(users).set({ avatarFileId: fileId }).where(eq(users.id, userId));
  if (prev?.id && prev.id !== fileId) {
    await db
      .update(files)
      .set({ deletedAt: new Date() })
      .where(and(eq(files.id, prev.id), eq(files.uploadedBy, userId), eq(files.purpose, 'avatar')));
  }
}

/** Remove the bytes of files soft-deleted more than `olderThanDays` ago. Returns how many were purged. */
export async function purgeDeletedFiles(db: Executor, olderThanDays = 30, limit = 500): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 86_400_000);
  const rows = await db
    .select({ id: files.id, key: files.storageKey })
    .from(files)
    .where(and(isNotNull(files.deletedAt), lt(files.deletedAt, cutoff), sql`${files.storageKey} not like 'purged:%'`))
    .limit(limit);
  for (const r of rows) {
    await storage().delete(r.key).catch(() => undefined);
    // keep the row (history, audit) but blank the key so the purge is idempotent
    await db.update(files).set({ storageKey: sql`'purged:' || ${files.id}::text` }).where(eq(files.id, r.id));
  }
  return rows.length;
}
