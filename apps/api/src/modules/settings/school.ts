import { eq } from 'drizzle-orm';
import type { BrandingOut, FeaturesOut } from '@school-sync/shared';
import { audit } from '../../core/audit';
import { AppError, notFound } from '../../core/errors';
import { assertFilesExist } from '../../core/files';
import { putSetting, SETTING_DEFS, type SettingKey } from '../../core/settings';
import { controlDb } from '../../core/tenancy/control-db';
import type { Executor } from '../../core/tenancy/pools';
import { invalidateTenant, type TenantInfo } from '../../core/tenancy/registry';
import { tenants, type TenantBranding } from '../../db/control/schema';
import { settings } from '../../db/tenant/schema';
import type { RoleCtx } from './roles';

// ── generic key/value groups ────────────────────────────────────────────────────────────────────
export const settingGroups = (): SettingKey[] => Object.keys(SETTING_DEFS) as SettingKey[];

export function requireGroup(group: string): SettingKey {
  if (!Object.hasOwn(SETTING_DEFS, group)) throw notFound('Settings group');
  return group as SettingKey;
}

/** Every group in one round trip (defaults filled in for groups that were never saved). */
export async function getAllSettings(db: Executor): Promise<Record<string, Record<string, unknown>>> {
  const rows = await db.select().from(settings);
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  return Object.fromEntries(settingGroups().map((k) => [k, SETTING_DEFS[k].parse(byKey.get(k) ?? {}) as Record<string, unknown>]));
}

export async function getGroup(db: Executor, group: SettingKey): Promise<Record<string, unknown>> {
  const [row] = await db.select().from(settings).where(eq(settings.key, group)).limit(1);
  return SETTING_DEFS[group].parse(row?.value ?? {}) as Record<string, unknown>;
}

/** Validate `patch` (any subset of the group's fields) against the group's schema and save the merged value. */
export async function updateGroup(tx: Executor, ctx: RoleCtx, group: SettingKey, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
  const schema = SETTING_DEFS[group];
  const known = Object.keys(schema.shape);
  const unknown = Object.keys(patch).filter((k) => !known.includes(k));
  if (unknown.length) throw new AppError(422, 'UNKNOWN_SETTING', `Unknown setting${unknown.length > 1 ? 's' : ''} in "${group}": ${unknown.join(', ')}`, { invalid: unknown, allowed: known });
  const before = await getGroup(tx, group);
  const merged = schema.safeParse({ ...before, ...patch });
  if (!merged.success) {
    const errors = merged.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    throw new AppError(422, 'VALIDATION_ERROR', 'One or more fields are invalid', { errors });
  }
  const after = (await putSetting(tx, group, patch as never, ctx.principal.userId)) as Record<string, unknown>;
  await audit(tx, ctx.actor, { action: 'settings.update', entity: 'settings', entityId: group, summary: `Updated ${group} settings`, before, after });
  return after;
}

// ── branding (control plane) ────────────────────────────────────────────────────────────────────
const LOGO_URL = '/api/v1/site/logo';
type StoredBranding = TenantBranding;

async function loadTenantRow(tenant: Pick<TenantInfo, 'id'>) {
  const [row] = await controlDb().select().from(tenants).where(eq(tenants.id, tenant.id)).limit(1);
  if (!row) throw notFound('School');
  return row;
}

const brandingView = (name: string, b: StoredBranding, row: { timezone: string; locale: string; currency: string }): BrandingOut => ({
  name,
  shortName: b.shortName ?? null,
  logoFileId: b.logoFileId ?? null,
  logoUrl: b.logoUrl ?? null,
  primaryColor: b.primaryColor ?? '#4f46e5',
  accentColor: b.accentColor ?? null,
  timezone: row.timezone,
  locale: row.locale,
  currency: row.currency,
});

export async function getBranding(tenant: Pick<TenantInfo, 'id'>): Promise<BrandingOut> {
  const row = await loadTenantRow(tenant);
  return brandingView(row.name, row.branding as StoredBranding, row);
}

export async function updateBranding(
  tx: Executor,
  ctx: RoleCtx,
  tenant: Pick<TenantInfo, 'id' | 'code'>,
  input: { name?: string; shortName?: string | null; logoFileId?: string | null; primaryColor?: string; accentColor?: string | null },
): Promise<BrandingOut> {
  const row = await loadTenantRow(tenant);
  const old = row.branding as StoredBranding;
  const next: StoredBranding = { ...old };
  if (input.shortName !== undefined) next.shortName = input.shortName;
  if (input.primaryColor !== undefined) next.primaryColor = input.primaryColor.toLowerCase();
  if (input.accentColor !== undefined) next.accentColor = input.accentColor ? input.accentColor.toLowerCase() : null;
  if (input.logoFileId !== undefined) {
    if (input.logoFileId) await assertFilesExist(tx, [input.logoFileId]);
    // the file is served to everyone (no session) by the public GET /api/v1/site/logo route
    next.logoFileId = input.logoFileId;
    next.logoUrl = input.logoFileId ? LOGO_URL : null;
  }
  const name = input.name ?? row.name;
  const before = brandingView(row.name, old, row);
  const after = brandingView(name, next, row);
  // control-plane write first: if it fails nothing is audited; if the audit insert fails the transaction rolls back (the row is rewritten by the next save)
  await controlDb().update(tenants).set({ name, branding: next }).where(eq(tenants.id, tenant.id));
  await audit(tx, ctx.actor, { action: 'branding.update', entity: 'tenant', entityId: tenant.code, summary: 'Updated school profile / branding', before, after });
  invalidateTenant(tenant.code);
  return after;
}

// ── feature toggles (control plane) ─────────────────────────────────────────────────────────────
export async function getFeatures(tenant: Pick<TenantInfo, 'id'>): Promise<FeaturesOut> {
  const row = await loadTenantRow(tenant);
  const f = row.features;
  return { fees: f.fees, transport: f.transport, library: f.library, onlinePayments: f.onlinePayments, studentLogin: f.studentLogin };
}

export async function updateFeatures(tx: Executor, ctx: RoleCtx, tenant: Pick<TenantInfo, 'id' | 'code'>, patch: Partial<FeaturesOut>): Promise<FeaturesOut> {
  const row = await loadTenantRow(tenant);
  const before = { ...row.features };
  const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => typeof v === 'boolean'));
  const after = { ...before, ...clean };
  await controlDb().update(tenants).set({ features: after }).where(eq(tenants.id, tenant.id));
  await audit(tx, ctx.actor, { action: 'features.update', entity: 'tenant', entityId: tenant.code, summary: 'Changed feature toggles', before, after });
  invalidateTenant(tenant.code);
  return after;
}
