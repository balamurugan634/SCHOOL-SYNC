import type { Readable } from 'node:stream';

/**
 * Object-storage abstraction used by the `files` module.
 *
 * The contract is deliberately the small common subset of a filesystem and S3, so an S3 (or GCS / Azure Blob) driver can
 * be added without touching callers. Mapping for an S3 driver (NOT shipped — it cannot be tested without a bucket):
 *
 *   put(key, body, { contentType })  → `Upload` from @aws-sdk/lib-storage (streaming multipart upload, ContentType set,
 *                                       server-side encryption on); the byte count comes from the counting transform the
 *                                       caller already wraps around `body`
 *   stream(key, range?)              → GetObjectCommand({ Key, Range: 'bytes=start-end' }).Body (Readable)
 *   stat(key)                        → HeadObjectCommand → ContentLength (null on NotFound)
 *   exists(key)                      → stat(key) !== null
 *   delete(key)                      → DeleteObjectCommand (idempotent: S3 answers 204 for a missing key)
 *
 * Keys are opaque, slash-separated, and always start with the school code (`<tenantCode>/<yyyy>/<mm>/<uuid>`), so a
 * single bucket can serve many schools and a school's data can be exported or purged by prefix. Keys never contain
 * user-supplied text (the original filename lives in the database, not in the key).
 *
 * Select the implementation with `STORAGE_DRIVER` (see `./index.ts`); only `local` exists today.
 */
export interface StorageDriver {
  readonly name: string;
  /**
   * Store the whole stream under `key`. Must be atomic: after a rejection (stream error, size cap exceeded) nothing is
   * left behind under `key`. Resolves with the number of bytes stored.
   */
  put(key: string, body: Readable, opts: { contentType: string; maxBytes?: number }): Promise<{ sizeBytes: number }>;
  /** Read an object (optionally only the inclusive byte range). Rejects with `StorageNotFoundError` when missing. */
  stream(key: string, range?: { start: number; end: number }): Promise<Readable>;
  /** Size in bytes, or null when the object does not exist. */
  stat(key: string): Promise<{ sizeBytes: number } | null>;
  exists(key: string): Promise<boolean>;
  /** Remove the object. Succeeds when it is already gone. */
  delete(key: string): Promise<void>;
}

export class StorageNotFoundError extends Error {
  constructor(key: string) {
    super(`Storage object not found: ${key}`);
    this.name = 'StorageNotFoundError';
  }
}

export class StorageLimitError extends Error {
  constructor(public readonly maxBytes: number) {
    super(`Object exceeds ${maxBytes} bytes`);
    this.name = 'StorageLimitError';
  }
}
