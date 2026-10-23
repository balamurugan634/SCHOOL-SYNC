import fp from 'fastify-plugin';
import { getLicense } from '../core/billing/license';
import { AppError } from '../core/errors';
import { tenantDb } from '../core/tenancy/pools';
import { resolveTenant, TenantResolutionError } from '../core/tenancy/registry';
import './context';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Every request is bound to exactly one school before any handler runs:
 *   Host (sub/custom domain) | X-Tenant header → TenantInfo → that school's DB pool.
 * Then the subscription gate: when a school's subscription has lapsed past its grace period it becomes read-only
 * (reads work, writes get 402) — students' data is never locked away, but new data stops until renewal.
 */
export default fp(async (app) => {
  app.decorateRequest('tenant', undefined as never);
  app.decorateRequest('db', { getter(this: { tenant: Parameters<typeof tenantDb>[0] }) { return tenantDb(this.tenant); } } as never);
  app.decorateRequest('auth', undefined as never);
  app.decorateRequest('sessionId', '');

  app.addHook('onRequest', async (req) => {
    if (req.routeOptions.config.noTenant || req.method === 'OPTIONS') return;
    try {
      req.tenant = await resolveTenant({ host: req.headers.host, header: req.headers['x-tenant'] as string | undefined });
    } catch (e) {
      if (e instanceof TenantResolutionError) throw new AppError(e.status, e.code, e.message);
      throw e;
    }
    if (!SAFE.has(req.method) && !req.routeOptions.config.allowWhenReadOnly) {
      const lic = await getLicense(req.tenant.id);
      if (lic.readOnly) throw new AppError(402, 'SUBSCRIPTION_EXPIRED', 'This school’s subscription has expired, so changes are disabled. Please contact the school office.');
    }
  });
});
