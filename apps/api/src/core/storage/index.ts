import { resolve } from 'node:path';
import { v7 as uuidv7 } from 'uuid';
import { config } from '../../config';
import type { StorageDriver } from './driver';
import { LocalStorageDriver } from './local';

export * from './driver';
export { LocalStorageDriver } from './local';

let driver: StorageDriver | undefined;

/** The process-wide storage driver, chosen by `STORAGE_DRIVER` (only `local` is implemented). */
export function storage(): StorageDriver {
  driver ??= new LocalStorageDriver(resolve(config.STORAGE_DIR));
  return driver;
}

/** Test hook: swap the driver (e.g. an in-memory fake). */
export function setStorageDriver(d: StorageDriver | undefined): void {
  driver = d;
}

/** `<tenantCode>/<yyyy>/<mm>/<id>` — the layout is part of the driver contract (see driver.ts). */
export function newStorageKey(tenantCode: string, id: string = uuidv7(), now = new Date()): string {
  return `${tenantCode}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${id}`;
}
