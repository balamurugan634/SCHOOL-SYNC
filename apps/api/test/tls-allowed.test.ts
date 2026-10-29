import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { config } from '../src/config';
import { controlDb } from '../src/core/tenancy/control-db';
import { tenantDomains, tenants } from '../src/db/control/schema';
import { createTestSchool, type TestSchool } from './helpers';

let s: TestSchool;
const base = config.BASE_DOMAIN;
const DOMAIN = 'tls-test-school.example.edu';

beforeAll(async () => {
  s = await createTestSchool();
  await controlDb().insert(tenantDomains).values({ domain: DOMAIN, tenantId: s.tenant.id, isPrimary: false });
});
afterAll(async () => {
  await controlDb().delete(tenantDomains).where(eq(tenantDomains.domain, DOMAIN));
});

/** Caddy asks from inside the Docker network, i.e. from a private address. */
const ask = (domain: string, remoteAddress = '172.18.0.5') => s.app.inject({ method: 'GET', url: `/api/v1/site/tls-allowed?domain=${encodeURIComponent(domain)}`, remoteAddress });

describe('on-demand TLS check (which hosts may get a certificate)', () => {
  it('allows the base domain and its console hosts', async () => {
    for (const host of [base, `www.${base}`, `admin.${base}`, `platform.${base}`]) expect((await ask(host)).statusCode, host).toBe(200);
  });

  it('allows <code>.<base> of a live school and nothing else under the base domain', async () => {
    expect((await ask(`${s.tenant.code}.${base}`)).statusCode).toBe(200);
    expect((await ask(`${s.tenant.code.toUpperCase()}.${base}.`)).statusCode).toBe(200); // case and trailing dot are normalised
    expect((await ask(`no-such-school.${base}`)).statusCode).toBe(404);
    expect((await ask(`Bad_Code.${base}`)).statusCode).toBe(404);
    expect((await ask(`a.b.${s.tenant.code}.${base}`)).statusCode).toBe(404);
  });

  it('allows a registered custom domain and refuses unregistered names and IP addresses', async () => {
    expect((await ask(DOMAIN)).statusCode).toBe(200);
    expect((await ask('evil.example.com')).statusCode).toBe(404);
    expect((await ask('127.0.0.1')).statusCode).toBe(404);
    expect((await ask('not a host')).statusCode).toBe(404);
  });

  it('serves a suspended school (its notice page needs HTTPS) but not an archived one', async () => {
    const host = `${s.tenant.code}.${base}`;
    await controlDb().update(tenants).set({ status: 'suspended' }).where(eq(tenants.id, s.tenant.id));
    expect((await ask(host)).statusCode).toBe(200);
    await controlDb().update(tenants).set({ status: 'archived' }).where(eq(tenants.id, s.tenant.id));
    expect((await ask(host)).statusCode).toBe(404);
    expect((await ask(DOMAIN)).statusCode).toBe(404);
    await controlDb().update(tenants).set({ status: 'active' }).where(eq(tenants.id, s.tenant.id));
  });

  it('answers callers from the internet as if the route did not exist', async () => {
    expect((await ask(`${s.tenant.code}.${base}`, '8.8.8.8')).statusCode).toBe(404);
    expect((await ask(base, '2001:4860:4860::8888')).statusCode).toBe(404);
  });
});
