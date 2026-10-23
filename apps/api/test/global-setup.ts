import EmbeddedPostgres from 'embedded-postgres';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Starts a throw-away real PostgreSQL for the whole test run and points the app config at it. */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as { port: number }).port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

export default async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'schoolsync-test-pg-'));
  const port = await freePort();
  const pg = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'postgres', port, persistent: false, onLog: () => {}, onError: () => {} });
  await pg.initialise();
  await pg.start();

  Object.assign(process.env, {
    NODE_ENV: 'test',
    PG_HOST: '127.0.0.1',
    PG_PORT: String(port),
    PG_USER: 'postgres',
    PG_PASSWORD: 'postgres',
    CONTROL_DB: 'schoolsync_test_control',
    TENANT_DB_PREFIX: 'sst_',
    JWT_SECRET: 'test-jwt-secret-test-jwt-secret-0123456789',
    APP_ENCRYPTION_KEY: 'test-encryption-key-test-encryption-0123',
    PLATFORM_API_KEY: 'test-platform-key-0123456789abcdef',
    ALLOW_TENANT_HEADER: 'true',
    LOG_LEVEL: 'silent',
    RUN_WORKERS: 'false',
    AUTH_RATE_LIMIT_MAX: '1000',
    RATE_LIMIT_MAX: '100000',
    // build school schemas straight from the TypeScript schema: tests never depend on regenerated migrations
    TENANT_SCHEMA_MODE: 'push',
    STORAGE_DIR: join(dir, 'storage'),
    REDIS_URL: '',
  });

  return async () => {
    await pg.stop().catch(() => undefined);
    rmSync(dir, { recursive: true, force: true });
  };
}
