import { bigint, boolean, date, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';
import { timestamp } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export interface TenantBranding {
  /** uploaded file id of the logo (served publicly by GET /api/v1/site/logo) */
  logoFileId?: string | null;
  logoUrl?: string | null;
  primaryColor?: string;
  accentColor?: string | null;
  shortName?: string | null;
}
export interface TenantFeatures {
  fees: boolean;
  transport: boolean;
  library: boolean;
  onlinePayments: boolean;
  studentLogin: boolean;
}
export const DEFAULT_FEATURES: TenantFeatures = { fees: true, transport: true, library: true, onlinePayments: false, studentLogin: true };

/** One row per school ("site"). The school's data lives in its own database `dbName`. */
export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    /** URL-safe site code, e.g. "greenvalley" → greenvalley.<BASE_DOMAIN>, X-Tenant: greenvalley */
    code: text('code').notNull(),
    name: text('name').notNull(),
    dbName: text('db_name').notNull(),
    /** Optional: AES-GCM encrypted connection string for tenants on a different cluster */
    dbUrlEnc: text('db_url_enc'),
    status: text('status', { enum: ['provisioning', 'active', 'suspended', 'archived', 'failed'] })
      .notNull()
      .default('provisioning'),
    plan: text('plan').notNull().default('standard'),
    timezone: text('timezone').notNull().default('Asia/Kolkata'),
    locale: text('locale').notNull().default('en'),
    currency: text('currency').notNull().default('INR'),
    branding: jsonb('branding').$type<TenantBranding>().notNull().default({}),
    features: jsonb('features').$type<TenantFeatures>().notNull().default(DEFAULT_FEATURES),
    /** schema version applied to this tenant DB (latest drizzle migration tag) */
    schemaVersion: text('schema_version'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex('tenants_code_uq').on(t.code), uniqueIndex('tenants_db_uq').on(t.dbName)],
);

/** Custom domains: school.example.edu → tenant */
export const tenantDomains = pgTable(
  'tenant_domains',
  {
    domain: text('domain').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    isPrimary: boolean('is_primary').notNull().default(false),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('tenant_domains_tenant_idx').on(t.tenantId)],
);

/** Platform operators (us) — separate from any school's users. */
export const platformAudit = pgTable('platform_audit', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => uuidv7()),
  at: ts('at').notNull().defaultNow(),
  actor: text('actor').notNull(),
  action: text('action').notNull(),
  tenantCode: text('tenant_code'),
  detail: jsonb('detail'),
});

/**
 * Commercial model: priced **per student, per academic year**.
 * A subscription covers one academic year of one school. The billable unit is a student with an
 * enrollment in that year (counted once, even if they transfer mid-year), measured from the school's own DB.
 */
export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** matches academic_years.name in the school DB, e.g. "2026-27" */
    academicYear: text('academic_year').notNull(),
    startsOn: date('starts_on', { mode: 'string' }).notNull(),
    endsOn: date('ends_on', { mode: 'string' }).notNull(),
    /** days after endsOn during which the school keeps full access (renewal window) */
    graceDays: integer('grace_days').notNull().default(30),
    status: text('status', { enum: ['trial', 'active', 'cancelled'] })
      .notNull()
      .default('active'),
    pricePerStudentMinor: bigint('price_per_student_minor', { mode: 'number' }).notNull().default(0),
    currency: text('currency').notNull().default('INR'),
    /** committed seats; NULL = unlimited */
    licensedStudents: integer('licensed_students'),
    /** over the committed seats: keep admitting and bill the difference (true-up), or refuse new students */
    overagePolicy: text('overage_policy', { enum: ['allow_and_bill', 'block'] })
      .notNull()
      .default('allow_and_bill'),
    notes: text('notes'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex('subscriptions_tenant_year_uq').on(t.tenantId, t.academicYear)],
);

/** Daily metering, one row per school per day. `billableStudents` is the running count for the subscription year. */
export const usageSnapshots = pgTable(
  'usage_snapshots',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    subscriptionId: uuid('subscription_id').references(() => subscriptions.id, { onDelete: 'set null' }),
    snapshotDate: date('snapshot_date', { mode: 'string' }).notNull(),
    billableStudents: integer('billable_students').notNull(),
    activeStudents: integer('active_students').notNull(),
    staff: integer('staff').notNull().default(0),
    parents: integer('parents').notNull().default(0),
    takenAt: ts('taken_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('usage_snapshots_day_uq').on(t.tenantId, t.snapshotDate)],
);

/** What we bill the school: the committed-seats invoice at the start, true-ups for students above the commitment. */
export const billingInvoices = pgTable(
  'billing_invoices',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    number: text('number').notNull(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    subscriptionId: uuid('subscription_id')
      .notNull()
      .references(() => subscriptions.id),
    kind: text('kind', { enum: ['seats', 'true_up', 'adjustment'] }).notNull(),
    students: integer('students').notNull(),
    unitPriceMinor: bigint('unit_price_minor', { mode: 'number' }).notNull(),
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    currency: text('currency').notNull(),
    status: text('status', { enum: ['draft', 'issued', 'paid', 'void'] })
      .notNull()
      .default('issued'),
    issuedAt: ts('issued_at').notNull().defaultNow(),
    dueOn: date('due_on', { mode: 'string' }),
    paidAt: ts('paid_at'),
    notes: text('notes'),
  },
  (t) => [uniqueIndex('billing_invoices_number_uq').on(t.number), index('billing_invoices_tenant_idx').on(t.tenantId, t.issuedAt)],
);
