import { eq } from 'drizzle-orm';
import { config } from '../../config';
import { tenantDomains, tenants } from '../../db/control/schema';
import { controlDb } from './control-db';
import { SITE_CODE_RE } from './provision';

const HOST_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$|^localhost$/;
/** Schools that can be reached (a suspended school still shows its "suspended" notice, so it needs a certificate too). */
const SERVED = ['active', 'suspended'] as const;

function consoleHosts(base: string): Set<string> {
  const extra = (process.env.PLATFORM_CONSOLE_HOSTS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return new Set([base, `www.${base}`, `admin.${base}`, `platform.${base}`, ...extra]);
}

/**
 * Caddy's on-demand TLS "ask": may a certificate be issued for this host? Only hosts this installation really serves:
 * the base domain and its console hosts, `<code>.<BASE_DOMAIN>` of a live school, and a school's registered custom domain.
 * Anything else is refused, so nobody can make the server request certificates for arbitrary names.
 */
export async function isTlsHostAllowed(input: string): Promise<boolean> {
  const host = input.trim().toLowerCase().replace(/\.$/, '');
  if (!HOST_RE.test(host)) return false;
  const base = config.BASE_DOMAIN.toLowerCase();
  if (consoleHosts(base).has(host)) return true;
  const db = controlDb();
  if (host.endsWith(`.${base}`)) {
    const code = host.slice(0, -(base.length + 1));
    if (!SITE_CODE_RE.test(code)) return false;
    const [t] = await db.select({ status: tenants.status }).from(tenants).where(eq(tenants.code, code)).limit(1);
    return !!t && (SERVED as readonly string[]).includes(t.status);
  }
  const [d] = await db.select({ tenantId: tenantDomains.tenantId }).from(tenantDomains).where(eq(tenantDomains.domain, host)).limit(1);
  if (!d) return false;
  const [t] = await db.select({ status: tenants.status }).from(tenants).where(eq(tenants.id, d.tenantId)).limit(1);
  return !!t && (SERVED as readonly string[]).includes(t.status);
}

