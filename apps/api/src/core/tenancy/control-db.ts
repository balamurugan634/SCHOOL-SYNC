import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { config } from '../../config';
import * as controlSchema from '../../db/control/schema';

export type ControlDb = NodePgDatabase<typeof controlSchema>;

export function pgConfig(database: string, extra: pg.PoolConfig = {}): pg.PoolConfig {
  return {
    host: config.PG_HOST,
    port: config.PG_PORT,
    user: config.PG_USER,
    password: config.PG_PASSWORD,
    database,
    ssl: config.PG_SSL ? { rejectUnauthorized: true } : undefined,
    ...extra,
  };
}

/** Connection settings for provisioning work that needs a session (create/drop database, migrations, advisory locks): direct to Postgres, never through a transaction pooler. */
export function adminPgConfig(database: string, extra: pg.PoolConfig = {}): pg.PoolConfig {
  return pgConfig(database, { host: config.PG_ADMIN_HOST ?? config.PG_HOST, port: config.PG_ADMIN_PORT ?? config.PG_PORT, ...extra });
}

let controlPool: pg.Pool | undefined;
let controlDbInstance: ControlDb | undefined;

export function controlDb(): ControlDb {
  if (!controlDbInstance) {
    controlPool = new pg.Pool(pgConfig(config.CONTROL_DB, { max: 5, idleTimeoutMillis: 30_000, application_name: 'schoolsync-control' }));
    controlPool.on('error', (err) => console.error('[control-db] idle client error', err.message));
    controlDbInstance = drizzle(controlPool, { schema: controlSchema });
  }
  return controlDbInstance;
}

/** Short-lived admin connection to the `postgres` maintenance DB (CREATE/DROP DATABASE). */
export async function withAdminClient<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client(adminPgConfig('postgres'));
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function databaseExists(name: string): Promise<boolean> {
  return withAdminClient(async (c) => (await c.query('select 1 from pg_database where datname = $1', [name])).rowCount === 1);
}

/**
 * Control-plane migrations: tiny, ordered, applied once each (tracked in control_migrations).
 * Append new steps at the end — never edit a step that has shipped.
 */
const CONTROL_MIGRATIONS: { id: number; sql: string }[] = [
  {
    id: 1,
    sql: `
create table tenants (
  id uuid primary key,
  code text not null,
  name text not null,
  db_name text not null,
  db_url_enc text,
  status text not null default 'provisioning',
  plan text not null default 'standard',
  timezone text not null default 'Asia/Kolkata',
  locale text not null default 'en',
  currency text not null default 'INR',
  branding jsonb not null default '{}'::jsonb,
  features jsonb not null default '{"fees":true,"transport":true,"library":true,"onlinePayments":false,"studentLogin":true}'::jsonb,
  schema_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index tenants_code_uq on tenants (code);
create unique index tenants_db_uq on tenants (db_name);
create table tenant_domains (
  domain text primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);
create index tenant_domains_tenant_idx on tenant_domains (tenant_id);
create table platform_audit (
  id uuid primary key,
  at timestamptz not null default now(),
  actor text not null,
  action text not null,
  tenant_code text,
  detail jsonb
);`,
  },
  {
    id: 2,
    sql: `
create table subscriptions (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  academic_year text not null,
  starts_on date not null,
  ends_on date not null,
  grace_days integer not null default 30,
  status text not null default 'active',
  price_per_student_minor bigint not null default 0,
  currency text not null default 'INR',
  licensed_students integer,
  overage_policy text not null default 'allow_and_bill',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index subscriptions_tenant_year_uq on subscriptions (tenant_id, academic_year);
create table usage_snapshots (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  subscription_id uuid references subscriptions(id) on delete set null,
  snapshot_date date not null,
  billable_students integer not null,
  active_students integer not null,
  staff integer not null default 0,
  parents integer not null default 0,
  taken_at timestamptz not null default now()
);
create unique index usage_snapshots_day_uq on usage_snapshots (tenant_id, snapshot_date);
create table billing_invoices (
  id uuid primary key,
  number text not null,
  tenant_id uuid not null references tenants(id) on delete cascade,
  subscription_id uuid not null references subscriptions(id),
  kind text not null,
  students integer not null,
  unit_price_minor bigint not null,
  amount_minor bigint not null,
  currency text not null,
  status text not null default 'issued',
  issued_at timestamptz not null default now(),
  due_on date,
  paid_at timestamptz,
  notes text
);
create unique index billing_invoices_number_uq on billing_invoices (number);
create index billing_invoices_tenant_idx on billing_invoices (tenant_id, issued_at);`,
  },
  {
    // Platform operator console: operator accounts + their rotating-refresh sessions, and a payment reference on our invoices.
    id: 3,
    sql: `
create table platform_operators (
  id uuid primary key,
  email text not null,
  display_name text not null,
  password_hash text not null,
  status text not null default 'active',
  must_change_password boolean not null default true,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  password_changed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index platform_operators_email_uq on platform_operators (email);
create table platform_sessions (
  id uuid primary key,
  operator_id uuid not null references platform_operators(id) on delete cascade,
  refresh_hash text not null,
  prev_refresh_hash text,
  ip text,
  user_agent text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_reason text
);
create index platform_sessions_operator_idx on platform_sessions (operator_id, revoked_at);
alter table billing_invoices add column payment_reference text;
create index platform_audit_at_idx on platform_audit (id desc);
create index platform_audit_tenant_idx on platform_audit (tenant_code, id desc);`,
  },
];

/** Creates the control database + applies pending control migrations. Idempotent; call on boot and from CLIs. */
export async function ensureControlSchema(): Promise<void> {
  // CREATE DATABASE from several processes at once (parallel test files, rolling deploys) can fail on
  // pg_database_datname_index (23505) instead of 42P04, so serialise it with a cluster-wide advisory lock.
  await withAdminClient(async (c) => {
    await c.query('select pg_advisory_lock(727000)');
    try {
      const exists = (await c.query('select 1 from pg_database where datname = $1', [config.CONTROL_DB])).rowCount === 1;
      if (!exists) await c.query(`create database "${config.CONTROL_DB.replace(/"/g, '')}"`);
    } finally {
      await c.query('select pg_advisory_unlock(727000)');
    }
  });
  const c = new pg.Client(adminPgConfig(config.CONTROL_DB));
  await c.connect();
  try {
    await c.query('select pg_advisory_lock(727001)');
    await c.query('create table if not exists control_migrations (id integer primary key, applied_at timestamptz not null default now())');
    const done = new Set((await c.query<{ id: number }>('select id from control_migrations')).rows.map((r) => r.id));
    for (const m of CONTROL_MIGRATIONS) {
      if (done.has(m.id)) continue;
      await c.query('begin');
      try {
        await c.query(m.sql);
        await c.query('insert into control_migrations (id) values ($1)', [m.id]);
        await c.query('commit');
      } catch (e) {
        await c.query('rollback');
        throw e;
      }
    }
    await c.query('select pg_advisory_unlock(727001)');
  } finally {
    await c.end();
  }
}

export async function closeControlDb(): Promise<void> {
  await controlPool?.end();
  controlPool = undefined;
  controlDbInstance = undefined;
}
