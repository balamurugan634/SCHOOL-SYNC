import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  type PlatformLicense,
  type PlatformMigrateOut,
  type PlatformSchemaState,
  type PlatformSeats,
  type PlatformSubscription,
  type PlatformSubscriptionBody,
  type PlatformSubscriptionTerms,
  type PlatformTenantCreateBody,
  type PlatformTenantCreateOut,
  type PlatformTenantDetail,
  type PlatformTenantListQuery,
  type PlatformTenantSummary,
  type PlatformTenantUpdateBody,
  type PlatformUsagePoint,
} from '@school-sync/shared';
import { config } from '../../config';
import { billingInvoices, subscriptions, tenantDomains, tenants, usageSnapshots } from '../../db/control/schema';
import { upsertSubscription, type SubscriptionInput } from '../billing/invoicing';
import { computeLicense, invalidateLicense, seatUsage, type License } from '../billing/license';
import { snapshotAllTenants, snapshotTenant } from '../billing/metering';
import { AppError, notFound } from '../errors';
import { ilikeAny } from '../http';
import { controlDb, databaseExists } from '../tenancy/control-db';
import { tenantDb } from '../tenancy/pools';
import { createTenant, latestMigrationTag, migrateAllTenants, RESERVED_SITE_CODES, SITE_CODE_RE } from '../tenancy/provision';
import { invalidateTenant, tenantByCode } from '../tenancy/registry';
import { actorLabel, platformAuditLog, type PlatformActor } from './audit';

type TenantRow = typeof tenants.$inferSelect;
type SubRow = typeof subscriptions.$inferSelect;

const todayIso = () => new Date().toISOString().slice(0, 10);
const fieldErrors = (path: string, message: string) => ({ errors: [{ path, message }] });
const invalid = (path: string, message: string) => new AppError(422, 'VALIDATION_ERROR', message, fieldErrors(path, message));

export const isValidTimeZone = (tz: string): boolean => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

/** Demo data creates users with a well-known password, so it is never offered in production. */
/** Demo data: on by default outside production, off by default in production, and PLATFORM_ALLOW_DEMO_DATA=true / false overrides either way (a pilot or demo server may want it on). */
export const demoDataAllowed = (): boolean => config.PLATFORM_ALLOW_DEMO_DATA === true || (config.NODE_ENV !== 'production' && config.PLATFORM_ALLOW_DEMO_DATA !== false);

// ── views ───────────────────────────────────────────────────────────────────────────────────────
export function toSubscription(r: SubRow): PlatformSubscription {
  return {
    id: r.id,
    academicYear: r.academicYear,
    startsOn: r.startsOn,
    endsOn: r.endsOn,
    graceDays: r.graceDays,
    status: r.status,
    pricePerStudentMinor: r.pricePerStudentMinor,
    currency: r.currency,
    licensedStudents: r.licensedStudents,
    overagePolicy: r.overagePolicy,
    notes: r.notes,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function licenseView(lic: License): PlatformLicense {
  const s = lic.subscription;
  return {
    subscriptionId: s?.id ?? null,
    state: lic.state,
    readOnly: lic.readOnly,
    academicYear: s?.academicYear ?? null,
    startsOn: s?.startsOn ?? null,
    endsOn: s?.endsOn ?? null,
    graceEndsOn: lic.graceEndsOn,
    daysLeft: lic.daysLeft,
    licensedStudents: lic.licensedStudents,
    pricePerStudentMinor: s?.pricePerStudentMinor ?? null,
    currency: s?.currency ?? null,
    overagePolicy: lic.overagePolicy,
  };
}

function seatsView(licensed: number | null, used: number | null, asOf: string | null): PlatformSeats {
  return {
    used,
    licensed,
    remaining: used === null || licensed === null ? null : Math.max(0, licensed - used),
    overBy: used === null || licensed === null ? 0 : Math.max(0, used - licensed),
    nearLimit: used !== null && licensed !== null && licensed > 0 && used >= licensed * 0.9,
    asOf,
  };
}

type UsageRow = typeof usageSnapshots.$inferSelect;
const usageView = (u: UsageRow): PlatformUsagePoint => ({ date: u.snapshotDate, billableStudents: u.billableStudents, activeStudents: u.activeStudents, staff: u.staff, parents: u.parents });

/** The school database's structure version against the newest one this server ships. */
function schemaState(version: string | null): PlatformSchemaState {
  const latest = latestMigrationTag();
  return { version, latest, upToDate: version === latest };
}

/** Error text for operators: enough to act on, without a connection string or password in it. */
function safeError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  return raw.replace(/postgres(?:ql)?:\/\/\S+/gi, '[database url]').replace(/password[^,;\n]*/gi, 'password [hidden]').slice(0, 300);
}

/** Bring one school (or every school) up to the newest database structure: what `pnpm site:migrate` did, as an action. */
export async function migrateSchools(only: string | undefined, actor: PlatformActor): Promise<PlatformMigrateOut> {
  if (only) await getTenantRow(only); // 404 for an unknown code
  const before = new Map((await controlDb().select({ code: tenants.code, v: tenants.schemaVersion }).from(tenants)).map((t) => [t.code, t.v]));
  const done = await migrateAllTenants({ only, concurrency: 4 });
  const results = done.map((r) => ({ code: r.code, ok: r.ok, error: r.ok ? null : safeError(r.error) }));
  for (const r of results) await platformAuditLog(actor, 'tenant.migrate', r.code, { from: before.get(r.code) ?? null, to: latestMigrationTag(), ok: r.ok, ...(r.error ? { error: r.error } : {}) });
  return { updated: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
}

/** Everything the list needs for these schools in 4 queries (no per-school round trips). */
async function summarize(rows: TenantRow[]): Promise<PlatformTenantSummary[]> {
  if (!rows.length) return [];
  const db = controlDb();
  const ids = rows.map((r) => r.id);
  const today = todayIso();
  const [subs, latest, brief] = await Promise.all([
    db.select().from(subscriptions).where(inArray(subscriptions.tenantId, ids)).orderBy(desc(subscriptions.endsOn)),
    db.selectDistinctOn([usageSnapshots.tenantId]).from(usageSnapshots).where(inArray(usageSnapshots.tenantId, ids)).orderBy(usageSnapshots.tenantId, desc(usageSnapshots.snapshotDate)),
    db
      .select({
        tenantId: billingInvoices.tenantId,
        amount: sql<number>`coalesce(sum(${billingInvoices.amountMinor}), 0)::float8`,
        n: sql<number>`count(*)::int`,
        overdue: sql<number>`(count(*) filter (where ${billingInvoices.dueOn} is not null and ${billingInvoices.dueOn} < ${today}))::int`,
      })
      .from(billingInvoices)
      .where(and(inArray(billingInvoices.tenantId, ids), eq(billingInvoices.status, 'issued')))
      .groupBy(billingInvoices.tenantId),
  ]);
  const subsOf = Map.groupBy(subs, (s) => s.tenantId);
  const usageOf = new Map(latest.map((u) => [u.tenantId, u]));
  const briefOf = new Map(brief.map((b) => [b.tenantId, b]));
  return rows.map((t) => {
    const lic = computeLicense(subsOf.get(t.id) ?? [], today);
    const u = usageOf.get(t.id) ?? null;
    const used = u && lic.subscription && u.subscriptionId === lic.subscription.id ? u.billableStudents : null;
    const b = briefOf.get(t.id);
    return {
      id: t.id,
      code: t.code,
      name: t.name,
      status: t.status,
      dbName: t.dbName,
      timezone: t.timezone,
      currency: t.currency,
      brandColor: t.branding.primaryColor ?? null,
      createdAt: t.createdAt.toISOString(),
      license: licenseView(lic),
      seats: seatsView(lic.licensedStudents, used, used === null ? null : u!.snapshotDate),
      usage: u ? usageView(u) : null,
      billing: { outstandingMinor: b?.amount ?? 0, outstandingCount: b?.n ?? 0, overdueCount: b?.overdue ?? 0 },
      schema: schemaState(t.schemaVersion),
    };
  });
}

export async function listTenants(q: PlatformTenantListQuery) {
  const rows = await controlDb()
    .select()
    .from(tenants)
    .where(q.q ? ilikeAny(q.q, tenants.code, tenants.name) : undefined)
    .orderBy(asc(tenants.code));
  const all = await summarize(rows);
  const facets = { status: {} as Record<string, number>, license: {} as Record<string, number>, updates: 0 };
  for (const s of all) {
    if ((s.status === 'active' || s.status === 'suspended') && !s.schema.upToDate) facets.updates += 1;
    facets.status[s.status] = (facets.status[s.status] ?? 0) + 1;
    facets.license[s.license.state] = (facets.license[s.license.state] ?? 0) + 1;
  }
  const filtered = all.filter((s) => (!q.status || s.status === q.status) && (!q.license || s.license.state === q.license));
  const pageSize = q.pageSize ?? Math.max(1, filtered.length);
  const page = q.pageSize ? (q.page ?? 1) : 1;
  const data = filtered.slice((page - 1) * pageSize, page * pageSize);
  return { data, meta: { page, pageSize, total: filtered.length, totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)) }, facets };
}

export async function getTenantRow(code: string): Promise<TenantRow> {
  const [t] = await controlDb().select().from(tenants).where(eq(tenants.code, code.toLowerCase())).limit(1);
  if (!t) throw notFound('School');
  return t;
}

export async function tenantDetail(code: string): Promise<PlatformTenantDetail> {
  const t = await getTenantRow(code);
  const db = controlDb();
  const [[summary], domains, subs] = await Promise.all([
    summarize([t]),
    db.select().from(tenantDomains).where(eq(tenantDomains.tenantId, t.id)).orderBy(desc(tenantDomains.isPrimary), asc(tenantDomains.domain)),
    db.select().from(subscriptions).where(eq(subscriptions.tenantId, t.id)).orderBy(desc(subscriptions.endsOn)),
  ]);
  let seats = summary!.seats;
  // the detail page counts the roll live (the list uses the last metered number)
  const info = t.status === 'active' || t.status === 'suspended' ? await tenantByCode(t.code) : null;
  if (info) {
    const lic = computeLicense(subs, todayIso());
    if (lic.subscription) {
      try {
        const live = await seatUsage(tenantDb(info), lic);
        seats = seatsView(lic.licensedStudents, live.used, todayIso());
      } catch {
        /* school database unreachable: keep the metered figure */
      }
    }
  }
  return {
    tenant: {
      id: t.id,
      code: t.code,
      name: t.name,
      status: t.status,
      dbName: t.dbName,
      plan: t.plan,
      timezone: t.timezone,
      locale: t.locale,
      currency: t.currency,
      branding: { primaryColor: t.branding.primaryColor ?? null, shortName: t.branding.shortName ?? null, logoUrl: t.branding.logoUrl ?? null },
      features: t.features,
      schemaVersion: t.schemaVersion,
      schemaLatest: latestMigrationTag(),
      schemaUpToDate: t.schemaVersion === latestMigrationTag(),
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    },
    domains: domains.map((d) => ({ domain: d.domain, isPrimary: d.isPrimary, createdAt: d.createdAt.toISOString() })),
    license: summary!.license,
    seats,
    usage: summary!.usage,
    billing: summary!.billing,
    subscriptions: subs.map(toSubscription),
  };
}

// ── site code ───────────────────────────────────────────────────────────────────────────────────
export async function checkCode(raw: string): Promise<{ available: boolean; reason: 'invalid' | 'reserved' | 'taken' | null; message: string | null }> {
  const code = raw.trim().toLowerCase();
  if (!SITE_CODE_RE.test(code)) return { available: false, reason: 'invalid', message: 'Use 3 to 31 characters: letters, digits and hyphens, starting with a letter.' };
  if (RESERVED_SITE_CODES.has(code)) return { available: false, reason: 'reserved', message: 'That code is reserved. Choose another.' };
  const [row] = await controlDb().select({ status: tenants.status, dbName: tenants.dbName }).from(tenants).where(eq(tenants.code, code)).limit(1);
  if (row) {
    if (row.status === 'failed') return { available: true, reason: null, message: 'An earlier attempt with this code did not finish. Creating it again resumes that attempt.' };
    return { available: false, reason: 'taken', message: 'That code is already used by another school.' };
  }
  if (await databaseExists(`${config.TENANT_DB_PREFIX}${code.replace(/-/g, '_')}`)) return { available: false, reason: 'taken', message: 'A database for that code already exists on the server.' };
  return { available: true, reason: null, message: null };
}

// ── subscriptions ───────────────────────────────────────────────────────────────────────────────
type Terms = Omit<SubscriptionInput, 'tenantCode' | 'academicYear' | 'startsOn' | 'endsOn'> & Partial<Pick<SubscriptionInput, 'academicYear' | 'startsOn' | 'endsOn'>>;

function validateTerms(b: { academicYear?: string; startsOn?: string; endsOn?: string }, prefix = ''): void {
  if (b.academicYear) {
    const start = Number(b.academicYear.slice(0, 4));
    if (Number(b.academicYear.slice(5)) !== (start + 1) % 100) throw invalid(`${prefix}academicYear`, 'The second part must be the next year, for example 2026-27.');
  }
  if (b.startsOn && b.endsOn && b.endsOn <= b.startsOn) throw invalid(`${prefix}endsOn`, 'The period must end after it starts.');
}

function toTerms(b: PlatformSubscriptionBody | PlatformSubscriptionTerms): Terms {
  return {
    ...(b.academicYear ? { academicYear: b.academicYear } : {}),
    ...(b.startsOn ? { startsOn: b.startsOn } : {}),
    ...(b.endsOn ? { endsOn: b.endsOn } : {}),
    pricePerStudent: b.pricePerStudentMinor !== undefined ? b.pricePerStudentMinor / 100 : (b.pricePerStudent ?? 0),
    licensedStudents: b.licensedStudents,
    overagePolicy: b.overagePolicy,
    graceDays: b.graceDays,
    trial: b.trial,
    currency: b.currency?.toUpperCase(),
    notes: b.notes,
  };
}

export async function upsertTenantSubscription(code: string, body: PlatformSubscriptionBody, actor: PlatformActor): Promise<PlatformSubscription> {
  const t = await getTenantRow(code);
  validateTerms(body);
  const input = { ...toTerms(body), academicYear: body.academicYear, startsOn: body.startsOn, endsOn: body.endsOn, tenantCode: t.code };
  const sub = await upsertSubscription(input, actorLabel(actor)).catch((e: Error) => {
    throw new AppError(400, 'SUBSCRIBE_FAILED', e.message);
  });
  return toSubscription(sub);
}

export async function listTenantSubscriptions(code: string): Promise<PlatformSubscription[]> {
  const t = await getTenantRow(code);
  const rows = await controlDb().select().from(subscriptions).where(eq(subscriptions.tenantId, t.id)).orderBy(desc(subscriptions.endsOn));
  return rows.map(toSubscription);
}

// ── create / update / status ────────────────────────────────────────────────────────────────────
export async function createSchool(body: PlatformTenantCreateBody, actor: PlatformActor): Promise<PlatformTenantCreateOut> {
  const code = body.code.trim().toLowerCase();
  const check = await checkCode(code);
  if (!check.available) throw new AppError(check.reason === 'taken' ? 409 : 422, check.reason === 'taken' ? 'CODE_TAKEN' : 'VALIDATION_ERROR', check.message ?? 'That code cannot be used', fieldErrors('code', check.message ?? 'That code cannot be used'));
  if (body.timezone && !isValidTimeZone(body.timezone)) throw invalid('timezone', 'Unknown time zone. Use a name like Asia/Kolkata.');
  if (body.demoData && !demoDataAllowed()) throw invalid('demoData', 'Demo data is switched off on this server.');
  if (body.subscription) validateTerms(body.subscription, 'subscription.');

  const [prior] = await controlDb().select({ status: tenants.status }).from(tenants).where(eq(tenants.code, code)).limit(1);
  const created = await createTenant({
    code,
    name: body.name.trim(),
    adminName: body.adminName,
    adminEmail: body.adminEmail,
    adminUsername: body.adminUsername,
    adminPassword: body.adminPassword,
    timezone: body.timezone,
    currency: body.currency?.toUpperCase(),
    locale: body.locale,
    branding: body.brandColor ? { primaryColor: body.brandColor.toLowerCase() } : undefined,
    features: body.features,
    subscription: body.subscription ? toTerms(body.subscription) : undefined,
    audit: { actor: actorLabel(actor), detail: { name: body.name.trim(), currency: body.currency?.toUpperCase() ?? 'INR', resumed: prior?.status === 'failed', demoData: !!body.demoData, subscription: body.subscription ? { academicYear: body.subscription.academicYear ?? null, seats: body.subscription.licensedStudents ?? null } : null, ...(actor.ip ? { ip: actor.ip } : {}), via: actor.kind } },
  }).catch((e: Error) => {
    throw new AppError(400, 'CREATE_FAILED', e.message);
  });

  let demoLoaded = false;
  if (body.demoData) {
    try {
      const { seedDemo } = await import('../../cli/seed/index');
      await seedDemo(code, 'small');
      demoLoaded = true;
    } catch (e) {
      await platformAuditLog(actor, 'tenant.demo_data_failed', code, { error: e instanceof Error ? e.message.slice(0, 200) : 'unknown' });
    }
    if (demoLoaded) await platformAuditLog(actor, 'tenant.demo_data', code, { size: 'small' });
  }
  const [sub] = body.subscription ? await controlDb().select().from(subscriptions).where(eq(subscriptions.tenantId, created.tenant.id)).orderBy(desc(subscriptions.createdAt)).limit(1) : [];
  return { id: created.tenant.id, code: created.tenant.code, name: created.tenant.name, status: created.tenant.status, admin: created.admin, subscription: sub ? toSubscription(sub) : null, demoDataLoaded: demoLoaded };
}

export async function updateTenant(code: string, patch: PlatformTenantUpdateBody, actor: PlatformActor): Promise<PlatformTenantDetail> {
  const t = await getTenantRow(code);
  if (patch.timezone && !isValidTimeZone(patch.timezone)) throw invalid('timezone', 'Unknown time zone. Use a name like Asia/Kolkata.');
  const branding = { ...t.branding };
  if (patch.brandColor !== undefined) branding.primaryColor = patch.brandColor.toLowerCase();
  if (patch.shortName !== undefined) branding.shortName = patch.shortName;
  const features = { ...t.features, ...Object.fromEntries(Object.entries(patch.features ?? {}).filter(([, v]) => typeof v === 'boolean')) };
  const next = { name: patch.name ?? t.name, timezone: patch.timezone ?? t.timezone, branding, features };
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  const note = (k: string, a: unknown, b: unknown) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      before[k] = a;
      after[k] = b;
    }
  };
  note('name', t.name, next.name);
  note('timezone', t.timezone, next.timezone);
  note('primaryColor', t.branding.primaryColor ?? null, branding.primaryColor ?? null);
  note('shortName', t.branding.shortName ?? null, branding.shortName ?? null);
  note('features', t.features, features);
  if (Object.keys(after).length) {
    await controlDb().update(tenants).set(next).where(eq(tenants.id, t.id));
    invalidateTenant(t.code);
    await platformAuditLog(actor, 'tenant.update', t.code, { before, after });
  }
  return tenantDetail(t.code);
}

export async function setTenantStatus(code: string, status: 'active' | 'suspended' | 'archived', reason: string | undefined, actor: PlatformActor): Promise<TenantRow['status']> {
  const t = await getTenantRow(code);
  if (status === 'active' && (t.status === 'provisioning' || t.status === 'failed')) throw new AppError(409, 'NOT_PROVISIONED', 'This school was not fully created. Create it again with the same code to finish setting it up.');
  const [row] = await controlDb().update(tenants).set({ status }).where(eq(tenants.id, t.id)).returning();
  invalidateTenant(t.code);
  invalidateLicense(t.id);
  await platformAuditLog(actor, `tenant.${status}`, t.code, { from: t.status, ...(reason ? { reason } : {}) });
  return row!.status;
}

// ── usage ───────────────────────────────────────────────────────────────────────────────────────
export async function tenantUsage(code: string, days: number) {
  const t = await getTenantRow(code);
  const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const rows = await controlDb()
    .select()
    .from(usageSnapshots)
    .where(and(eq(usageSnapshots.tenantId, t.id), sql`${usageSnapshots.snapshotDate} >= ${from}`))
    .orderBy(asc(usageSnapshots.snapshotDate));
  const subs = await controlDb().select().from(subscriptions).where(eq(subscriptions.tenantId, t.id)).orderBy(desc(subscriptions.endsOn));
  const lic = computeLicense(subs, todayIso());
  const peak = lic.subscription ? rows.filter((r) => r.subscriptionId === lic.subscription!.id).reduce((m, r) => Math.max(m, r.billableStudents), 0) : 0;
  return { data: rows.map(usageView), peakBillable: peak, academicYear: lic.subscription?.academicYear ?? null };
}

export async function meterTenant(code: string, actor: PlatformActor) {
  const t = await getTenantRow(code);
  const info = t.status === 'active' || t.status === 'suspended' ? await tenantByCode(t.code) : null;
  if (!info) throw new AppError(409, 'NOT_METERABLE', 'Only a school that has been created can be metered.');
  const usage = await snapshotTenant(info).catch((e: Error) => {
    throw new AppError(502, 'METER_FAILED', `Could not read the school’s database: ${e.message}`);
  });
  invalidateLicense(t.id);
  await platformAuditLog(actor, 'usage.snapshot', t.code, { billableStudents: usage.billableStudents });
  const d = await tenantDetail(t.code);
  return { usage: d.usage!, seats: d.seats };
}

export async function meterAll(actor: PlatformActor) {
  const data = await snapshotAllTenants();
  invalidateLicense();
  await platformAuditLog(actor, 'usage.snapshot_all', null, { schools: data.length, failed: data.filter((r) => !r.ok).length });
  return { data };
}
