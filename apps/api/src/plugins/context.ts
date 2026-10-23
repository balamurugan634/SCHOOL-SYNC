import type { Principal } from '../core/rbac/principal';
import type { TenantDb } from '../core/tenancy/pools';
import type { TenantInfo } from '../core/tenancy/registry';

declare module 'fastify' {
  interface FastifyRequest {
    /** the school this request belongs to (set by the tenant plugin) */
    tenant: TenantInfo;
    /** Drizzle handle on the school's own database */
    db: TenantDb;
    /** the authenticated caller (set by requireAuth) */
    auth: Principal;
    sessionId: string;
  }
  interface FastifyContextConfig {
    /** route does not belong to a school (health checks, platform API) */
    noTenant?: boolean;
    /** route is callable while the school is read-only (login, refresh, logout) */
    allowWhenReadOnly?: boolean;
  }
}
export {};
