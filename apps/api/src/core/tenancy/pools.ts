import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { LRUCache } from 'lru-cache';
import pg from 'pg';
import { config } from '../../config';
import * as schema from '../../db/tenant/schema';
import { pgConfig } from './control-db';
import type { TenantInfo } from './registry';

export type TenantDb = NodePgDatabase<typeof schema>;
/** Either a db or a transaction handle — services accept this so they compose inside transactions. */
export type Executor = Pick<TenantDb, 'select' | 'selectDistinct' | 'selectDistinctOn' | 'insert' | 'update' | 'delete' | 'execute' | 'transaction' | '$count' | 'with'>;

interface Entry {
  pool: pg.Pool;
  db: TenantDb;
}

const PG_OPTIONS = '-c statement_timeout=30000 -c idle_in_transaction_session_timeout=60000 -c timezone=UTC';

/**
 * One bounded connection pool per school, kept in an LRU so thousands of schools can share a process:
 * only the active ones hold connections. Behind PgBouncer (transaction mode) set
 * `ignore_startup_parameters = options` or move PG_OPTIONS into the role's settings.
 */
const entries = new LRUCache<string, Entry>({
  max: config.TENANT_POOL_MAX_TENANTS,
  ttl: 10 * 60_000,
  updateAgeOnGet: true,
  ttlAutopurge: true,
  dispose: (entry) => void entry.pool.end().catch(() => undefined),
});

export function tenantDb(tenant: Pick<TenantInfo, 'id' | 'code' | 'dbName' | 'dbUrl'>): TenantDb {
  let e = entries.get(tenant.id);
  if (!e) {
    const common = { max: config.TENANT_POOL_SIZE, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000, keepAlive: true, application_name: `schoolsync:${tenant.code}`, options: PG_OPTIONS };
    const pool = new pg.Pool(tenant.dbUrl ? { connectionString: tenant.dbUrl, ...common } : pgConfig(tenant.dbName, common));
    pool.on('error', (err) => console.error(`[pool:${tenant.code}] idle client error`, err.message));
    e = { pool, db: drizzle(pool, { schema }) };
    entries.set(tenant.id, e);
  }
  return e.db;
}

export async function closeAllTenantPools(): Promise<void> {
  const all = [...entries.values()];
  entries.clear();
  await Promise.allSettled(all.map((e) => e.pool.end()));
}

/** Connect directly (no pool) — for provisioning/migrations. */
export function directClient(database: string): pg.Client {
  return new pg.Client(pgConfig(database));
}
