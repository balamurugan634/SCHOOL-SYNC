import type { FastifyInstance } from 'fastify';
import { afterAll } from 'vitest';
import { buildApp } from '../src/app';
import { seedFoundation } from '../src/cli/seed/core';
import type { SeedContext, SeedSize } from '../src/cli/seed/context';
import { MODULE_SEEDERS } from '../src/cli/seed/index';
import { dropTenant, createTenant, shutdownTenancy } from '../src/core/tenancy/provision';
import { tenantDb, type TenantDb } from '../src/core/tenancy/pools';
import { tenantByCode, type TenantInfo } from '../src/core/tenancy/registry';

export const PASSWORD = 'Demo@12345';

export interface TestSchool {
  app: FastifyInstance;
  tenant: TenantInfo;
  db: TenantDb;
  /** seeded people & structure (see src/cli/seed/context.ts) */
  ctx: SeedContext;
  /** log in and return an access token */
  login(username: string, password?: string): Promise<string>;
  /** inject an authenticated request: `await s.req('GET', '/attendance', token)` (path is relative to /api/v1) */
  req(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, token?: string | null, body?: unknown): Promise<{ status: number; body: any; headers: Record<string, unknown> }>;
}

let counter = 0;

/**
 * Provision a brand-new school (own database, default roles/data) + seed the demo foundation
 * (and, with `modules: true`, every module's demo data). Cleans up after the test file.
 *
 *   const s = await createTestSchool();
 *   const t = await s.login('t001');                       // teacher
 *   const r = await s.req('GET', '/students', t);
 */
export async function createTestSchool(opts: { size?: SeedSize; modules?: boolean } = {}): Promise<TestSchool> {
  const code = `t${Date.now().toString(36)}${process.pid}${counter++}`.toLowerCase().slice(0, 30);
  await createTenant({ code, name: `Test School ${code}`, adminEmail: 'admin@test.school', adminPassword: PASSWORD });
  const tenant = (await tenantByCode(code))!;
  const db = tenantDb(tenant);
  const ctx = (await seedFoundation(db, tenant, opts.size ?? 'small'))!;
  if (opts.modules) for (const m of MODULE_SEEDERS) await m.seed(ctx);
  const app = await buildApp({ logger: false });
  await app.ready();

  const req: TestSchool['req'] = async (method, path, token, body) => {
    const res = await app.inject({ method, url: `/api/v1${path}`, headers: { 'x-tenant': code, ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, payload: body === undefined ? undefined : JSON.stringify(body) });
    let parsed: unknown = res.body;
    try {
      parsed = res.body ? JSON.parse(res.body) : null;
    } catch {
      /* non-JSON body */
    }
    return { status: res.statusCode, body: parsed as any, headers: res.headers as Record<string, unknown> };
  };
  const login: TestSchool['login'] = async (username, password = PASSWORD) => {
    const r = await req('POST', '/auth/login', null, { identifier: username, password });
    if (r.status !== 200) throw new Error(`login(${username}) failed: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body.accessToken as string;
  };

  afterAll(async () => {
    await app.close();
    await dropTenant(code).catch(() => undefined);
    await shutdownTenancy();
  });
  return { app, tenant, db, ctx, login, req };
}
