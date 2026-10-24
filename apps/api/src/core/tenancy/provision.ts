import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import type { SystemRoleKey } from '@school-sync/shared';
import { config } from '../../config';
import { DEFAULT_FEATURES, platformAudit, tenants, type TenantBranding, type TenantFeatures } from '../../db/control/schema';
import * as schema from '../../db/tenant/schema';
import { roles, staff, userRoles, users } from '../../db/tenant/schema';
import { unseal } from '../crypto';
import { generatePassword, hashPassword } from '../auth/password';
import { closeControlDb, controlDb, databaseExists, ensureControlSchema, pgConfig, withAdminClient } from './control-db';
import { closeAllTenantPools, directClient } from './pools';
import { invalidateTenant } from './registry';
import { upsertSubscription, type SubscriptionInput } from '../billing/invoicing';
import { academicYearSpan, seedTenantDefaults, syncSystemRoles } from './seed-defaults';

export const SITE_CODE_RE = /^[a-z][a-z0-9-]{2,30}$/;
export const RESERVED_SITE_CODES = new Set(['www', 'api', 'admin', 'app', 'platform', 'static', 'assets', 'mail', 'status', 'docs', 'localhost']);

function migrationsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [process.env.MIGRATIONS_DIR, resolve(here, 'migrations'), resolve(here, '../migrations'), resolve(here, '../../db/tenant/migrations')].filter(Boolean) as string[];
  const found = candidates.find((d) => existsSync(resolve(d, 'meta/_journal.json')));
  if (!found) throw new Error(`Tenant migrations not found. Looked in: ${candidates.join(', ')}`);
  return found;
}

export function latestMigrationTag(): string {
  const journal = JSON.parse(readFileSync(resolve(migrationsDir(), 'meta/_journal.json'), 'utf8')) as { entries: { tag: string }[] };
  return journal.entries.at(-1)?.tag ?? '0';
}

/** Apply pending migrations to one school DB. Safe to run concurrently from several instances (advisory lock). */
export async function migrateTenantDatabase(dbName: string, dbUrl?: string | null): Promise<void> {
  const client = dbUrl ? new pg.Client({ connectionString: dbUrl }) : directClient(dbName);
  await client.connect();
  try {
    await client.query('select pg_advisory_lock(727002)');
    if (config.TENANT_SCHEMA_MODE === 'push' && config.NODE_ENV !== 'production') {
      // dev/test convenience: sync the DB to the TypeScript schema directly (no migration files needed)
      const { pushSchema } = await import('drizzle-kit/api');
      const { apply } = await pushSchema(schema, drizzle(client, { schema }) as never);
      await apply();
    } else {
      await migrate(drizzle(client, { schema }), { migrationsFolder: migrationsDir() });
    }
    await client.query('select pg_advisory_unlock(727002)');
  } finally {
    await client.end();
  }
}

export interface CreateTenantInput {
  code: string;
  name: string;
  adminName?: string;
  adminEmail?: string;
  adminUsername?: string;
  adminPassword?: string;
  timezone?: string;
  locale?: string;
  currency?: string;
  branding?: TenantBranding;
  features?: Partial<TenantFeatures>;
  /** Commercial terms (per student, per academic year). Year defaults to the current April–March year. */
  subscription?: Omit<SubscriptionInput, 'tenantCode' | 'academicYear' | 'startsOn' | 'endsOn'> & Partial<Pick<SubscriptionInput, 'academicYear' | 'startsOn' | 'endsOn'>>;
  /** who is creating the site, for the platform audit log (default `cli`) and extra audit detail */
  audit?: { actor: string; detail?: Record<string, unknown> };
}

export interface CreateTenantResult {
  tenant: typeof tenants.$inferSelect;
  admin: { username: string; password: string; generated: boolean };
}

/**
 * "Create a site": new database → migrations → default roles/data → first super administrator.
 * Failure leaves the tenant row as `failed` (and the DB in place for inspection); re-run with the same code to resume.
 */
export async function createTenant(input: CreateTenantInput): Promise<CreateTenantResult> {
  const code = input.code.toLowerCase();
  if (!SITE_CODE_RE.test(code) || RESERVED_SITE_CODES.has(code)) throw new Error(`Invalid site code "${input.code}". Use 3–31 chars: a–z, 0–9, hyphen; start with a letter.`);
  await ensureControlSchema();
  const cdb = controlDb();
  const dbName = `${config.TENANT_DB_PREFIX}${code.replace(/-/g, '_')}`;

  let [row] = await cdb.select().from(tenants).where(eq(tenants.code, code)).limit(1);
  if (row && row.status === 'active') throw new Error(`Site "${code}" already exists`);
  if (!row) {
    [row] = await cdb
      .insert(tenants)
      .values({
        code,
        name: input.name,
        dbName,
        status: 'provisioning',
        timezone: input.timezone ?? 'Asia/Kolkata',
        locale: input.locale ?? 'en',
        currency: input.currency ?? 'INR',
        branding: { primaryColor: '#2457a5', ...input.branding },
        features: { ...DEFAULT_FEATURES, ...input.features },
      })
      .returning();
  }
  const tenant = row!;

  try {
    if (!(await databaseExists(tenant.dbName))) {
      await withAdminClient((c) => c.query(`create database "${tenant.dbName}" encoding 'UTF8'`));
    }
    await migrateTenantDatabase(tenant.dbName);

    const pool = new pg.Pool({ ...pgConfig(tenant.dbName), max: 2 });
    const db = drizzle(pool, { schema });
    const password = input.adminPassword ?? generatePassword(16);
    const username = (input.adminUsername ?? input.adminEmail ?? 'admin').toLowerCase();
    try {
      await seedTenantDefaults(db, { schoolName: tenant.name });
      const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.username, username)).limit(1);
      if (!existing) {
        const [u] = await db
          .insert(users)
          .values({ userType: 'staff', username, email: input.adminEmail?.toLowerCase() ?? null, displayName: input.adminName ?? 'School Administrator', passwordHash: await hashPassword(password), mustChangePassword: !input.adminPassword, passwordChangedAt: new Date() })
          .returning({ id: users.id });
        await db.insert(staff).values({ userId: u!.id, employeeId: 'ADM001', firstName: input.adminName ?? 'School', lastName: input.adminName ? null : 'Administrator', designation: 'Super Administrator', staffType: 'non_teaching', email: input.adminEmail?.toLowerCase() ?? null });
        const [role] = await db.select({ id: roles.id }).from(roles).where(eq(roles.key, 'super_admin' satisfies SystemRoleKey)).limit(1);
        await db.insert(userRoles).values({ userId: u!.id, roleId: role!.id });
      }
    } finally {
      await pool.end();
    }

    const [done] = await cdb.update(tenants).set({ status: 'active', schemaVersion: latestMigrationTag() }).where(eq(tenants.id, tenant.id)).returning();
    await cdb.insert(platformAudit).values({ actor: input.audit?.actor ?? 'cli', action: 'tenant.create', tenantCode: code, detail: { dbName: tenant.dbName, ...input.audit?.detail } });
    if (input.subscription) {
      const span = academicYearSpan();
      await upsertSubscription({ academicYear: span.name, startsOn: span.startDate, endsOn: span.endDate, ...input.subscription, tenantCode: code }, input.audit?.actor ?? 'cli');
    }
    invalidateTenant(code);
    return { tenant: done!, admin: { username, password, generated: !input.adminPassword } };
  } catch (err) {
    await cdb.update(tenants).set({ status: 'failed' }).where(eq(tenants.id, tenant.id));
    throw err;
  }
}

/** Run pending migrations (and top-up system roles) for every active school. Returns per-school outcome. */
export async function migrateAllTenants(opts: { concurrency?: number; only?: string } = {}): Promise<{ code: string; ok: boolean; error?: string }[]> {
  await ensureControlSchema();
  const cdb = controlDb();
  const list = (await cdb.select().from(tenants)).filter((t) => (t.status === 'active' || t.status === 'suspended') && (!opts.only || t.code === opts.only));
  const results: { code: string; ok: boolean; error?: string }[] = [];
  const queue = [...list];
  const worker = async () => {
    for (let t = queue.shift(); t; t = queue.shift()) {
      try {
        const url = t.dbUrlEnc ? unseal(t.dbUrlEnc, config.APP_ENCRYPTION_KEY) : null;
        await migrateTenantDatabase(t.dbName, url);
        const pool = new pg.Pool(url ? { connectionString: url, max: 2 } : { ...pgConfig(t.dbName), max: 2 });
        try {
          await syncSystemRoles(drizzle(pool, { schema }));
        } finally {
          await pool.end();
        }
        await cdb.update(tenants).set({ schemaVersion: latestMigrationTag() }).where(eq(tenants.id, t.id));
        results.push({ code: t.code, ok: true });
      } catch (e) {
        results.push({ code: t.code, ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? 4) }, worker));
  return results;
}

export async function shutdownTenancy(): Promise<void> {
  await closeAllTenantPools();
  await closeControlDb();
}


/** DEV/TEST ONLY: remove a site completely (database + control rows). Refuses in production. */
export async function dropTenant(code: string): Promise<void> {
  if (config.NODE_ENV === 'production') throw new Error('Refusing to drop a site in production');
  const cdb = controlDb();
  const [t] = await cdb.select().from(tenants).where(eq(tenants.code, code.toLowerCase())).limit(1);
  if (!t) return;
  await withAdminClient(async (c) => {
    await c.query('select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()', [t.dbName]);
    await c.query(`drop database if exists "${t.dbName}"`);
  });
  await cdb.delete(tenants).where(eq(tenants.id, t.id));
  invalidateTenant(t.code);
}
