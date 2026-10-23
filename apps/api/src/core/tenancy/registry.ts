import { eq } from 'drizzle-orm';
import { LRUCache } from 'lru-cache';
import { config } from '../../config';
import { tenantDomains, tenants, type TenantBranding, type TenantFeatures } from '../../db/control/schema';
import { unseal } from '../crypto';
import { controlDb } from './control-db';

export interface TenantInfo {
  id: string;
  code: string;
  name: string;
  dbName: string;
  /** decrypted connection string when the school lives on a different cluster */
  dbUrl: string | null;
  status: 'provisioning' | 'active' | 'suspended' | 'archived' | 'failed';
  plan: string;
  timezone: string;
  locale: string;
  currency: string;
  branding: TenantBranding;
  features: TenantFeatures;
}

type Row = typeof tenants.$inferSelect;
const toInfo = (r: Row): TenantInfo => ({
  id: r.id,
  code: r.code,
  name: r.name,
  dbName: r.dbName,
  dbUrl: r.dbUrlEnc ? unseal(r.dbUrlEnc, config.APP_ENCRYPTION_KEY) : null,
  status: r.status,
  plan: r.plan,
  timezone: r.timezone,
  locale: r.locale,
  currency: r.currency,
  branding: r.branding,
  features: r.features,
});

/** Small TTL cache: a few thousand schools fit comfortably; negative results are cached briefly to blunt host-scanning. */
const byCode = new LRUCache<string, { v: TenantInfo | null }>({ max: 5000, ttl: 30_000 });
const byDomain = new LRUCache<string, { v: string | null }>({ max: 5000, ttl: 30_000 });

export async function tenantByCode(code: string): Promise<TenantInfo | null> {
  const key = code.toLowerCase();
  const hit = byCode.get(key);
  if (hit) return hit.v;
  const [row] = await controlDb().select().from(tenants).where(eq(tenants.code, key)).limit(1);
  const info = row ? toInfo(row) : null;
  byCode.set(key, { v: info }, { ttl: info ? 30_000 : 10_000 });
  return info;
}

export async function tenantByDomain(domain: string): Promise<TenantInfo | null> {
  const key = domain.toLowerCase();
  const hit = byDomain.get(key);
  if (hit) return hit.v ? tenantByCode(hit.v) : null;
  const [row] = await controlDb()
    .select({ code: tenants.code })
    .from(tenantDomains)
    .innerJoin(tenants, eq(tenants.id, tenantDomains.tenantId))
    .where(eq(tenantDomains.domain, key))
    .limit(1);
  byDomain.set(key, { v: row?.code ?? null }, { ttl: row ? 30_000 : 10_000 });
  return row ? tenantByCode(row.code) : null;
}

export function invalidateTenant(code?: string): void {
  if (code) byCode.delete(code.toLowerCase());
  else byCode.clear();
  byDomain.clear();
}

export function hostOf(hostHeader: string | undefined): string | null {
  if (!hostHeader) return null;
  return hostHeader.toLowerCase().replace(/:\d+$/, '').trim() || null;
}

const IP_RE = /^(\d{1,3}\.){3}\d{1,3}$|^\[?[0-9a-f:]+\]?$/;

export class TenantResolutionError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Resolution order: custom/sub-domain from Host → X-Tenant header → DEFAULT_TENANT.
 * If both Host and header resolve and disagree we refuse (misconfigured proxy or tampering).
 */
export async function resolveTenant(input: { host?: string; header?: string }): Promise<TenantInfo> {
  const host = hostOf(input.host);
  let fromHost: TenantInfo | null = null;
  if (host && !IP_RE.test(host)) {
    if (host.endsWith(`.${config.BASE_DOMAIN}`)) {
      const label = host.slice(0, -(config.BASE_DOMAIN.length + 1));
      if (/^[a-z0-9-]+$/.test(label)) fromHost = await tenantByCode(label);
    } else if (host !== config.BASE_DOMAIN) {
      fromHost = await tenantByDomain(host);
    }
  }
  let fromHeader: TenantInfo | null = null;
  const headerCode = input.header?.trim().toLowerCase();
  if (headerCode && config.ALLOW_TENANT_HEADER) {
    if (!/^[a-z][a-z0-9-]{1,40}$/.test(headerCode)) throw new TenantResolutionError(400, 'INVALID_SITE', 'Invalid site code');
    fromHeader = await tenantByCode(headerCode);
    if (!fromHeader) throw new TenantResolutionError(404, 'SITE_NOT_FOUND', 'School site not found');
  }
  if (fromHost && fromHeader && fromHost.id !== fromHeader.id) throw new TenantResolutionError(400, 'TENANT_MISMATCH', 'Host and X-Tenant disagree');
  const tenant = fromHost ?? fromHeader ?? (config.DEFAULT_TENANT ? await tenantByCode(config.DEFAULT_TENANT) : null);
  if (!tenant) throw new TenantResolutionError(404, 'SITE_NOT_FOUND', 'School site not found');
  if (tenant.status === 'suspended') throw new TenantResolutionError(403, 'SITE_SUSPENDED', 'This school site is suspended. Contact the school.');
  if (tenant.status !== 'active') throw new TenantResolutionError(404, 'SITE_NOT_FOUND', 'School site not found');
  return tenant;
}
