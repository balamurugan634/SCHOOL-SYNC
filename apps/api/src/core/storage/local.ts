import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { StorageLimitError, StorageNotFoundError, type StorageDriver } from './driver';

/** `<tenantCode>/<yyyy>/<mm>/<uuid>` — the only key shape this driver will touch (blocks path traversal outright). */
const KEY_RE = /^[a-z0-9][a-z0-9-]{0,40}\/\d{4}\/\d{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Filesystem driver: `<root>/<tenantCode>/<yyyy>/<mm>/<uuid>`. Writes go to `<key>.part` and are renamed into place. */
export class LocalStorageDriver implements StorageDriver {
  readonly name = 'local';
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private path(key: string): string {
    if (!KEY_RE.test(key)) throw new Error(`Invalid storage key: ${key}`);
    const p = resolve(this.root, key);
    if (!p.startsWith(this.root + sep)) throw new Error('Storage key escapes the storage root');
    return p;
  }

  async put(key: string, body: Readable, opts: { contentType: string; maxBytes?: number }): Promise<{ sizeBytes: number }> {
    const target = this.path(key);
    const tmp = `${target}.part`;
    await mkdir(dirname(target), { recursive: true });
    let size = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        size += chunk.length;
        if (opts.maxBytes !== undefined && size > opts.maxBytes) return cb(new StorageLimitError(opts.maxBytes));
        cb(null, chunk);
      },
    });
    try {
      await pipeline(body, counter, createWriteStream(tmp, { flags: 'wx', mode: 0o640 }));
      await rename(tmp, target);
    } catch (e) {
      await rm(tmp, { force: true }).catch(() => undefined);
      throw e;
    }
    return { sizeBytes: size };
  }

  async stream(key: string, range?: { start: number; end: number }): Promise<Readable> {
    const p = this.path(key);
    if (!(await this.stat(key))) throw new StorageNotFoundError(key);
    return createReadStream(p, range ? { start: range.start, end: range.end } : undefined);
  }

  async stat(key: string): Promise<{ sizeBytes: number } | null> {
    try {
      const s = await stat(this.path(key));
      return s.isFile() ? { sizeBytes: s.size } : null;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }

  async exists(key: string): Promise<boolean> {
    return (await this.stat(key)) !== null;
  }

  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }
}
