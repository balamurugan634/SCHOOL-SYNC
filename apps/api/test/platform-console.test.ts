import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Env must be in place before the app config is read (vi.hoisted runs before the imports below).
vi.hoisted(() => {
  process.env.PLATFORM_LOGIN_RATE_LIMIT_MAX = '6';
  process.env.PLATFORM_ADMIN_EMAIL = 'Root@Console.Test';
  process.env.PLATFORM_ADMIN_PASSWORD = 'Bootstrap#Pass1';
  process.env.PLATFORM_ALLOW_DEMO_DATA = 'false';
  process.env.RESERVED_SITE_CODES_EXTRA = 'lahab, Restoconnect';
});

// The real upgrade (baseline → latest migration) is covered in email-settings.test.ts. The test schema mode ("push") cannot re-sync a database
// that already exists, so here only that one step is stood in for: it records the newest version, like the real one does.
vi.mock('../src/core/tenancy/provision', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/core/tenancy/provision')>();
  return {
    ...mod,
    migrateAllTenants: vi.fn(async (opts: { only?: string } = {}) => {
      const { controlDb } = await import('../src/core/tenancy/control-db');
      const { tenants } = await import('../src/db/control/schema');
      const { eq } = await import('drizzle-orm');
      const rows = (await controlDb().select().from(tenants)).filter((t) => (t.status === 'active' || t.status === 'suspended') && (!opts.only || t.code === opts.only));
      for (const t of rows) await controlDb().update(tenants).set({ schemaVersion: mod.latestMigrationTag() }).where(eq(tenants.id, t.id));
      return rows.map((t) => ({ code: t.code, ok: true }));
    }),
  };
});

import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { buildApp } from '../src/app';
import { signAccessToken } from '../src/core/auth/tokens';
import { config } from '../src/config';
import { controlDb, ensureControlSchema } from '../src/core/tenancy/control-db';
import { bootstrapFirstOperator } from '../src/core/platform/operators';
import { dropTenant, shutdownTenancy } from '../src/core/tenancy/provision';
import { academicYearSpan } from '../src/core/tenancy/seed-defaults';
import { platformOperators, platformSessions, subscriptions, tenants, usageSnapshots } from '../src/db/control/schema';

const KEY = config.PLATFORM_API_KEY!;
// subscription periods are relative to today (the current April-March year and the next one), so the test never ages
const cur = academicYearSpan();
const nxt = academicYearSpan(new Date(Date.UTC(Number(cur.name.slice(0, 4)) + 1, 5, 1)));
const [Y1, Y1S, Y1E, Y2, Y2S, Y2E] = [cur.name, cur.startDate, cur.endDate, nxt.name, nxt.startDate, nxt.endDate];
const BOOT = { email: 'root@console.test', password: 'Bootstrap#Pass1' };
const NEW_PW = 'Changed#Pass22';

let app: FastifyInstance;
const created: string[] = [];
let nextIp = 10;
const freshIp = () => `10.20.0.${nextIp++}`;

interface CallOpts {
  token?: string | null;
  key?: string | null;
  body?: unknown;
  ip?: string;
  headers?: Record<string, string>;
  prefix?: string;
}
async function call(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, o: CallOpts = {}) {
  const res = await app.inject({
    method,
    url: `${o.prefix ?? '/api/v1/platform'}${path}`,
    remoteAddress: o.ip ?? '10.20.0.1',
    headers: { ...(o.token ? { authorization: `Bearer ${o.token}` } : {}), ...(o.key ? { 'x-platform-key': o.key } : {}), ...(o.body !== undefined ? { 'content-type': 'application/json' } : {}), ...o.headers },
    payload: o.body === undefined ? undefined : JSON.stringify(o.body),
  });
  let body: any = res.body;
  try {
    body = res.body ? JSON.parse(res.body) : null;
  } catch {
    /* not JSON */
  }
  return { status: res.statusCode, body, raw: res.body };
}
const login = (email: string, password: string, ip = freshIp()) => call('POST', '/auth/login', { body: { email, password }, ip });
async function signIn(email: string, password: string) {
  const r = await login(email, password);
  expect(r.status, r.raw).toBe(200);
  return r.body as { accessToken: string; refreshToken: string; operator: { id: string; mustChangePassword: boolean } };
}

let root: { token: string; id: string; refresh: string };
const code = `consoletest${Date.now().toString(36)}`.slice(0, 30);

beforeAll(async () => {
  await ensureControlSchema();
  expect(await bootstrapFirstOperator()).toBe(true);
  app = await buildApp({ logger: false });
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  for (const c of created) await dropTenant(c).catch(() => undefined);
  await shutdownTenancy();
});

describe('bootstrap and operator sign-in', () => {
  it('bootstraps exactly one first operator from the environment', async () => {
    expect(await bootstrapFirstOperator()).toBe(false); // an operator exists now
    const rows = await controlDb().select().from(platformOperators);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.email).toBe(BOOT.email);
    expect(rows[0]!.mustChangePassword).toBe(true);
    expect(rows[0]!.passwordHash.startsWith('$argon2id$')).toBe(true);
  });

  it('forces a password change before anything else', async () => {
    const r = await signIn(BOOT.email, BOOT.password);
    expect(r.operator.mustChangePassword).toBe(true);
    const blocked = await call('GET', '/tenants', { token: r.accessToken });
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect((await call('GET', '/auth/me', { token: r.accessToken })).status).toBe(200);

    // wrong current password, weak and reused passwords are refused
    expect((await call('POST', '/auth/change-password', { token: r.accessToken, body: { currentPassword: 'nope-nope', newPassword: NEW_PW } })).status).toBe(401);
    expect((await call('POST', '/auth/change-password', { token: r.accessToken, body: { currentPassword: BOOT.password, newPassword: 'short' } })).status).toBe(422);
    expect((await call('POST', '/auth/change-password', { token: r.accessToken, body: { currentPassword: BOOT.password, newPassword: BOOT.password } })).body.code).toBe('PASSWORD_REUSED');

    // a second session of the same operator is signed out by the change
    const other = await signIn(BOOT.email, BOOT.password);
    expect((await call('POST', '/auth/change-password', { token: r.accessToken, body: { currentPassword: BOOT.password, newPassword: NEW_PW } })).status).toBe(200);
    expect((await call('GET', '/auth/me', { token: other.accessToken })).status).toBe(401);
    expect((await call('GET', '/auth/me', { token: r.accessToken })).status).toBe(200);
    expect((await login(BOOT.email, BOOT.password)).status).toBe(401);

    const again = await signIn(BOOT.email, NEW_PW);
    expect(again.operator.mustChangePassword).toBe(false);
    root = { token: again.accessToken, id: again.operator.id, refresh: again.refreshToken };
    expect((await call('GET', '/tenants', { token: root.token })).status).toBe(200);
  });

  it('answers unknown accounts and wrong passwords identically, and never returns secrets', async () => {
    const a = await login('nobody@console.test', 'Whatever#123');
    const b = await login(BOOT.email, 'Whatever#123456');
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    const strip = (x: any) => ({ ...x.body, requestId: undefined });
    expect(strip(a)).toEqual(strip(b));
    const me = await call('GET', '/auth/me', { token: root.token });
    expect(JSON.stringify(me.body)).not.toMatch(/hash|argon2|"password"/i);
    expect(Object.keys(me.body).sort()).toEqual(['createdAt', 'displayName', 'email', 'id', 'lastLoginAt', 'lockedUntil', 'mustChangePassword', 'status']);
  });

  it('locks the account after repeated failures, and a reset clears the lock', async () => {
    const created = await call('POST', '/operators', { token: root.token, body: { email: 'Lock.Me@console.test', displayName: 'Lock Me' } });
    expect(created.status).toBe(201);
    const { operator, temporaryPassword } = created.body as { operator: { id: string; email: string }; temporaryPassword: string };
    expect(operator.email).toBe('lock.me@console.test');
    const ip = freshIp();
    for (let i = 0; i < 5; i++) expect((await login(operator.email, 'Wrong#Pass123', ip)).body.code).toBe('INVALID_CREDENTIALS');
    const locked = await login(operator.email, temporaryPassword, ip); // even the right password is refused while locked
    expect(locked.status).toBe(423);
    expect(locked.body.code).toBe('ACCOUNT_LOCKED');
    expect(locked.body.retryAfterSeconds).toBeGreaterThan(0);
    const listed = (await call('GET', '/operators', { token: root.token })).body.data.find((o: any) => o.id === operator.id);
    expect(listed.lockedUntil).not.toBeNull();

    const reset = await call('POST', `/operators/${operator.id}/reset-password`, { token: root.token });
    expect(reset.status).toBe(200);
    const ok = await login(operator.email, reset.body.temporaryPassword);
    expect(ok.status).toBe(200);
    expect(ok.body.operator.mustChangePassword).toBe(true);
    expect(reset.body.temporaryPassword).not.toBe(temporaryPassword);
  });

  it('rate-limits sign-in attempts per client address', async () => {
    const ip = freshIp();
    const codes: number[] = [];
    for (let i = 0; i < 8; i++) codes.push((await login('ratelimit@console.test', 'Whatever#123', ip)).status);
    expect(codes.slice(0, 6).every((c) => c === 401)).toBe(true);
    expect(codes.at(-1)).toBe(429);
    expect((await login('ratelimit@console.test', 'Whatever#123', freshIp())).status).toBe(401); // another client is unaffected
  });

  it('rotates refresh tokens and revokes the session when an old one is replayed', async () => {
    const s = await signIn(BOOT.email, NEW_PW);
    const r1 = await call('POST', '/auth/refresh', { body: { refreshToken: s.refreshToken } });
    expect(r1.status).toBe(200);
    expect(r1.body.refreshToken).not.toBe(s.refreshToken);
    expect((await call('POST', '/auth/refresh', { body: { refreshToken: s.refreshToken } })).status).toBe(409); // inside the race window
    await controlDb().update(platformSessions).set({ lastUsedAt: new Date(Date.now() - 60_000) }).where(eq(platformSessions.id, r1.body.sessionId));
    expect((await call('POST', '/auth/refresh', { body: { refreshToken: s.refreshToken } })).status).toBe(401); // replay later = theft
    expect((await call('POST', '/auth/refresh', { body: { refreshToken: r1.body.refreshToken } })).status).toBe(401); // the session is dead now
    expect((await call('GET', '/auth/me', { token: r1.body.accessToken })).status).toBe(401);
  });

  it('signs out', async () => {
    const s = await signIn(BOOT.email, NEW_PW);
    expect((await call('POST', '/auth/logout', { token: s.accessToken })).status).toBe(200);
    expect((await call('GET', '/auth/me', { token: s.accessToken })).status).toBe(401);
    expect((await call('POST', '/auth/refresh', { body: { refreshToken: s.refreshToken } })).status).toBe(401);
  });
});

describe('token audience separation and key-or-token access', () => {
  it('rejects a school token on the platform API and an operator token on a school route', async () => {
    const schoolToken = await signAccessToken({ userId: root.id, sessionId: root.id, tenantId: root.id, authVersion: 1 });
    const r = await call('GET', '/tenants', { token: schoolToken });
    expect(r.status).toBe(401);
    expect(r.body.code).toBe('INVALID_TOKEN');

    const school = await createSchool();
    const reverse = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { authorization: `Bearer ${root.token}`, 'x-tenant': school.code } });
    expect(reverse.statusCode).toBe(401);
    expect(JSON.parse(reverse.body).code).toBe('INVALID_TOKEN');
  });

  it('accepts either the key or an operator token, and nothing else', async () => {
    expect((await call('GET', '/tenants', { key: KEY })).status).toBe(200);
    expect((await call('GET', '/tenants', { token: root.token })).status).toBe(200);
    expect((await call('GET', '/tenants')).status).toBe(401);
    expect((await call('GET', '/tenants', { key: 'wrong-key-wrong-key-wrong-key-1234' })).body.code).toBe('INVALID_PLATFORM_KEY');
    expect((await call('GET', '/tenants', { token: 'garbage.token.value' })).status).toBe(401);
    expect((await call('GET', '/auth/me', { key: KEY })).body.code).toBe('OPERATOR_REQUIRED'); // "me" is about a person
  });
});

// The school is created through the API like an operator would, and shared by the following groups.
let school: { code: string; adminPassword: string; adminUsername: string; id: string };
async function createSchool() {
  if (school) return school;
  const taken = await call('GET', `/tenants/check-code?code=${code}`, { token: root.token });
  expect(taken.body).toEqual({ available: true, reason: null, message: null });
  const r = await call('POST', '/tenants', {
    token: root.token,
    body: {
      code,
      name: 'Console Test School',
      timezone: 'Asia/Kolkata',
      currency: 'INR',
      brandColor: '#1B6B4F',
      adminName: 'Test Principal',
      adminEmail: `principal@${code}.test`,
      subscription: { academicYear: Y1, startsOn: Y1S, endsOn: Y1E, pricePerStudentMinor: 15000, licensedStudents: 5, overagePolicy: 'allow_and_bill' },
    },
  });
  expect(r.status, r.raw).toBe(201);
  created.push(code);
  school = { code, adminPassword: r.body.admin.password, adminUsername: r.body.admin.username, id: r.body.id };
  return school;
}

describe('schools', () => {
  it('creates a school and returns the temporary admin password once', async () => {
    const s = await createSchool();
    expect(s.adminPassword.length).toBeGreaterThanOrEqual(12);
    // it really is the school's first admin, and must change that password at first sign-in
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { 'x-tenant': s.code, 'content-type': 'application/json' }, payload: JSON.stringify({ identifier: s.adminUsername, password: s.adminPassword }) });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).user.mustChangePassword).toBe(true);
    // never again: the detail does not contain it
    const detail = await call('GET', `/tenants/${s.code}`, { token: root.token });
    expect(detail.raw).not.toContain(s.adminPassword);
    // the temporary password is stored hashed only (the audit entry must not carry it either)
    const audit = await call('GET', `/audit?tenant=${s.code}&limit=50`, { token: root.token });
    expect(audit.raw).not.toContain(s.adminPassword);
  });

  it('keeps names that other apps on the domain use (RESERVED_SITE_CODES_EXTRA) from becoming schools', async () => {
    for (const code of ['lahab', 'restoconnect']) expect((await call('GET', `/tenants/check-code?code=${code}`, { token: root.token })).body).toMatchObject({ available: false, reason: 'reserved' });
    expect((await call('GET', '/tenants/check-code?code=greenvalley-x', { token: root.token })).body.available).toBe(true);
  });

  it('refuses invalid, reserved and taken codes, and demo data when the server forbids it', async () => {
    expect((await call('GET', '/tenants/check-code?code=Bad_Code!', { token: root.token })).body.reason).toBe('invalid');
    expect((await call('GET', '/tenants/check-code?code=admin', { token: root.token })).body.reason).toBe('reserved');
    expect((await call('GET', `/tenants/check-code?code=${code}`, { token: root.token })).body.reason).toBe('taken');
    const dup = await call('POST', '/tenants', { token: root.token, body: { code, name: 'Again', adminEmail: 'x@y.test' } });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('CODE_TAKEN');
    expect(dup.body.errors[0].path).toBe('code');
    const bad = await call('POST', '/tenants', { token: root.token, body: { code: 'ab', name: 'Short code' } });
    expect(bad.status).toBe(422);
    const demo = await call('POST', '/tenants', { token: root.token, body: { code: `${code}d`, name: 'Demo wanted', demoData: true } });
    expect(demo.status).toBe(422);
    expect(demo.body.errors[0].path).toBe('demoData');
    expect((await call('GET', '/config', { token: root.token })).body).toMatchObject({ demoDataAllowed: false, environment: 'test' });
    expect((await call('GET', `/tenants/${code}d`, { token: root.token })).status).toBe(404); // nothing was created
  });

  it('lists schools with licence state, seats and price (and keeps the original list shape)', async () => {
    const r = await call('GET', `/tenants?q=${code}`, { key: KEY });
    expect(r.status).toBe(200);
    const row = r.body.data.find((t: any) => t.code === code);
    expect(row).toMatchObject({ code, name: 'Console Test School', status: 'active', currency: 'INR', brandColor: '#1b6b4f' });
    expect(row.dbName).toMatch(/consoletest/);
    expect(row.license).toMatchObject({ state: 'active', academicYear: Y1, licensedStudents: 5, pricePerStudentMinor: 15000, readOnly: false });
    expect(row.seats).toMatchObject({ used: null, licensed: 5 });
    expect(row).toHaveProperty('usage');
    expect(r.body.facets.license.active).toBeGreaterThanOrEqual(1);
    expect(r.body.meta.total).toBe(r.body.data.length); // not paged unless asked
    const paged = await call('GET', `/tenants?q=${code}&pageSize=1&page=1&license=expired`, { token: root.token });
    expect(paged.body.data).toHaveLength(0);
    expect(paged.body.meta.total).toBe(0);
  });

  it('shows the school detail: profile, features, subscription history', async () => {
    const r = await call('GET', `/tenants/${code}`, { token: root.token });
    expect(r.status).toBe(200);
    expect(r.body.tenant).toMatchObject({ code, timezone: 'Asia/Kolkata', features: { fees: true, library: true } });
    expect(r.body.subscriptions).toHaveLength(1);
    expect(r.body.seats).toMatchObject({ used: 0, licensed: 5 }); // counted live on the detail page
    expect((await call('GET', '/tenants/nope-no-school', { token: root.token })).status).toBe(404);
  });

  it('updates name, brand colour and feature switches, and the school sees them', async () => {
    const r = await call('PATCH', `/tenants/${code}`, { token: root.token, body: { name: 'Console Test School (renamed)', brandColor: '#2457A5', features: { library: false } } });
    expect(r.status, r.raw).toBe(200);
    expect(r.body.tenant).toMatchObject({ name: 'Console Test School (renamed)', features: { library: false, fees: true }, branding: { primaryColor: '#2457a5' } });
    await new Promise((res) => setTimeout(res, 50));
    const info = await app.inject({ method: 'GET', url: '/api/v1/site/info', headers: { 'x-tenant': code } });
    expect(JSON.parse(info.body)).toMatchObject({ name: 'Console Test School (renamed)', primaryColor: '#2457a5', features: { library: false } });
    expect((await call('PATCH', `/tenants/${code}`, { token: root.token, body: {} })).status).toBe(200); // empty patch changes nothing
    expect((await call('PATCH', `/tenants/${code}`, { token: root.token, body: { timezone: 'Mars/Olympus' } })).status).toBe(422);
    expect((await call('PATCH', `/tenants/${code}`, { token: root.token, body: { brandColor: 'red' } })).status).toBe(422);
  });

  it('suspends and resumes a school', async () => {
    expect((await call('POST', `/tenants/${code}/status`, { token: root.token, body: { status: 'suspended', reason: 'unpaid' } })).body).toMatchObject({ ok: true, status: 'suspended' });
    await new Promise((res) => setTimeout(res, 50));
    const blocked = await app.inject({ method: 'GET', url: '/api/v1/site/info', headers: { 'x-tenant': code } });
    expect(blocked.statusCode).toBe(403);
    expect(JSON.parse(blocked.body).code).toBe('SITE_SUSPENDED');
    expect((await call('POST', `/tenants/${code}/status`, { key: KEY, body: { status: 'active' } })).status).toBe(200);
    await new Promise((res) => setTimeout(res, 50));
    expect((await app.inject({ method: 'GET', url: '/api/v1/site/info', headers: { 'x-tenant': code } })).statusCode).toBe(200);
  });
});

describe('database updates from the console', () => {
  it('shows a school whose database is behind, and brings it up to date without a command', async () => {
    const s = await createSchool();
    const fresh = await call('GET', `/tenants/${s.code}`, { token: root.token });
    expect(fresh.body.tenant).toMatchObject({ schemaUpToDate: true });
    expect(fresh.body.tenant.schemaLatest).toBe(fresh.body.tenant.schemaVersion);

    // an older recorded version = an update is waiting
    await controlDb().update(tenants).set({ schemaVersion: '0000_old' }).where(eq(tenants.code, s.code));
    const behind = await call('GET', `/tenants/${s.code}`, { token: root.token });
    expect(behind.body.tenant.schemaUpToDate).toBe(false);
    const row = (await call('GET', `/tenants?q=${s.code}`, { token: root.token })).body.data.find((t: { code: string }) => t.code === s.code);
    expect(row.schema).toMatchObject({ version: '0000_old', upToDate: false });

    const done = await call('POST', `/tenants/${s.code}/migrate`, { token: root.token });
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ updated: 1, failed: 0 });
    expect(done.body.results[0]).toMatchObject({ code: s.code, ok: true, error: null });
    expect((await call('GET', `/tenants/${s.code}`, { token: root.token })).body.tenant.schemaUpToDate).toBe(true);

    // who did it is on record
    const audit = await call('GET', `/audit?tenant=${s.code}&limit=50`, { token: root.token });
    expect(audit.raw).toContain('tenant.migrate');
  });

  it('updates every school at once, refuses unknown codes and anonymous callers', async () => {
    const all = await call('POST', '/tenants/migrate-all', { key: KEY });
    expect(all.status).toBe(200);
    expect(all.body.failed).toBe(0);
    expect(all.body.updated).toBeGreaterThanOrEqual(1);
    expect((await call('POST', '/tenants/nosuchschool/migrate', { token: root.token })).status).toBe(404);
    expect((await call('POST', '/tenants/migrate-all', {})).status).toBe(401);
  });
});

describe('subscriptions, usage and invoices', () => {
  let seatInvoiceId = '';
  let trueUpId = '';

  it('renews with a new academic year and edits an existing one', async () => {
    const next = await call('PUT', `/tenants/${code}/subscription`, { token: root.token, body: { academicYear: Y2, startsOn: Y2S, endsOn: Y2E, pricePerStudentMinor: 16000, licensedStudents: 6 } });
    expect(next.status, next.raw).toBe(200);
    expect(next.body.subscription).toMatchObject({ academicYear: Y2, pricePerStudentMinor: 16000, licensedStudents: 6, currency: 'INR' });
    const edit = await call('PUT', `/tenants/${code}/subscription`, { key: KEY, body: { academicYear: Y1, startsOn: Y1S, endsOn: Y1E, pricePerStudent: 150, licensedStudents: 5, overagePolicy: 'allow_and_bill' } }); // the original major-units form
    expect(edit.status).toBe(200);
    const list = await call('GET', `/tenants/${code}/subscriptions`, { token: root.token });
    expect(list.body.data.map((s: any) => s.academicYear)).toEqual([Y2, Y1]);
    expect((await call('PUT', `/tenants/${code}/subscription`, { token: root.token, body: { academicYear: Y1, startsOn: Y1S, endsOn: Y1S, pricePerStudentMinor: 1 } })).status).toBe(422);
    expect((await call('PUT', `/tenants/${code}/subscription`, { token: root.token, body: { academicYear: '2026-28', startsOn: Y1S, endsOn: Y1E, pricePerStudentMinor: 1 } })).body.errors[0].path).toBe('academicYear');
    expect((await call('PUT', `/tenants/${code}/subscription`, { token: root.token, body: { academicYear: Y1, startsOn: Y1S, endsOn: Y1E } })).status).toBe(422); // price required
  });

  it('meters a school now and keeps a time series', async () => {
    const r = await call('POST', `/tenants/${code}/usage/snapshot`, { token: root.token });
    expect(r.status, r.raw).toBe(200);
    expect(r.body.usage.billableStudents).toBe(0);
    const series = await call('GET', `/tenants/${code}/usage?days=30`, { token: root.token });
    expect(series.body.data).toHaveLength(1);
    expect(series.body.academicYear).toBe(Y1);
    const all = await call('POST', '/billing/snapshot', { key: KEY });
    expect(all.body.data.find((x: any) => x.code === code)).toMatchObject({ ok: true });
  });

  it('issues the seats invoice and a true-up, refuses duplicates, and reports what is due', async () => {
    // pretend the school grew to 7 students (peak) against 5 committed seats
    const [t] = await controlDb().select().from(tenants).where(eq(tenants.code, code));
    const [sub] = await controlDb().select().from(subscriptions).where(eq(subscriptions.tenantId, t!.id));
    const target = (await controlDb().select().from(subscriptions).where(eq(subscriptions.tenantId, t!.id))).find((s) => s.academicYear === Y1)!;
    void sub;
    await controlDb().update(usageSnapshots).set({ billableStudents: 7, subscriptionId: target.id }).where(eq(usageSnapshots.tenantId, t!.id));

    const before = (await call('GET', '/billing/overview', { token: root.token })).body;
    const row0 = before.schools.find((s: any) => s.code === code);
    expect(row0).toMatchObject({ licensedStudents: 5, peakBillable: 7, invoicedStudents: 0, seatsInvoiced: false, trueUpStudents: 7, academicYear: Y1 });

    const seats = await call('POST', `/tenants/${code}/invoices`, { token: root.token, body: { kind: 'seats', academicYear: Y1, dueOn: '2020-01-15' } });
    expect(seats.status, seats.raw).toBe(200);
    expect(seats.body.invoice).toMatchObject({ kind: 'seats', students: 5, unitPriceMinor: 15000, amountMinor: 75000, currency: 'INR', status: 'issued', dueOn: '2020-01-15', tenantCode: code, overdue: true });
    seatInvoiceId = seats.body.invoice.id;
    const dup = await call('POST', `/tenants/${code}/invoices`, { key: KEY, body: { kind: 'seats', academicYear: Y1 } });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('INVOICE_FAILED');

    const tu = await call('POST', `/tenants/${code}/invoices`, { token: root.token, body: { kind: 'true_up', academicYear: Y1 } });
    expect(tu.body.invoice).toMatchObject({ kind: 'true_up', students: 2, amountMinor: 30000 });
    trueUpId = tu.body.invoice.id;
    const none = await call('POST', `/tenants/${code}/invoices`, { token: root.token, body: { kind: 'true_up', academicYear: Y1 } });
    expect(none.body.invoice).toBeNull();
    expect(none.body.message).toMatch(/nothing/i);
    expect((await call('POST', `/tenants/${code}/invoices`, { token: root.token, body: { kind: 'seats', academicYear: '2031-32' } })).body.code).toBe('NO_SUBSCRIPTION');

    const after = (await call('GET', '/billing/overview', { token: root.token })).body;
    const row = after.schools.find((s: any) => s.code === code);
    expect(row).toMatchObject({ invoicedStudents: 7, seatsInvoiced: true, trueUpStudents: 0, outstandingMinor: 105000, outstandingCount: 2, overdueCount: 1 });
    const inr = after.totals.find((t: any) => t.currency === 'INR');
    expect(inr.outstandingMinor).toBeGreaterThanOrEqual(105000);
    expect(inr.overdueMinor).toBeGreaterThanOrEqual(75000);
  });

  it('lists invoices across schools and per school, with filters', async () => {
    const all = await call('GET', `/invoices?tenant=${code}`, { token: root.token });
    expect(all.body.meta.total).toBe(2);
    expect(all.body.data.every((i: any) => i.tenantCode === code && i.academicYear === Y1)).toBe(true);
    expect((await call('GET', `/invoices?tenant=${code}&overdue=true`, { token: root.token })).body.data.map((i: any) => i.id)).toEqual([seatInvoiceId]);
    expect((await call('GET', `/invoices?tenant=${code}&kind=true_up`, { token: root.token })).body.data).toHaveLength(1);
    expect((await call('GET', `/invoices?q=${code}`, { token: root.token })).body.meta.total).toBe(2);
    expect((await call('GET', `/tenants/${code}/invoices`, { token: root.token })).body.data).toHaveLength(2);
  });

  it('marks an invoice paid with a date and reference, and voids another with a reason', async () => {
    expect((await call('POST', `/invoices/${seatInvoiceId}/pay`, { token: root.token, body: { paidOn: '2999-01-01' } })).status).toBe(422);
    const paid = await call('POST', `/invoices/${seatInvoiceId}/pay`, { token: root.token, body: { paidOn: '2026-05-02', reference: 'NEFT 8841-2210' } });
    expect(paid.status, paid.raw).toBe(200);
    expect(paid.body).toMatchObject({ status: 'paid', paymentReference: 'NEFT 8841-2210', overdue: false });
    expect(paid.body.paidAt).toBe('2026-05-02T12:00:00.000Z');
    expect((await call('POST', `/invoices/${seatInvoiceId}/pay`, { token: root.token, body: { paidOn: '2026-05-03' } })).body.code).toBe('INVOICE_ALREADY_PAID');
    expect((await call('POST', `/invoices/${seatInvoiceId}/void`, { token: root.token, body: { reason: 'oops' } })).body.code).toBe('INVOICE_PAID');
    expect((await call('POST', `/invoices/${trueUpId}/void`, { token: root.token, body: { reason: 'x' } })).status).toBe(422); // reason too short
    const voided = await call('POST', `/invoices/${trueUpId}/void`, { token: root.token, body: { reason: 'Issued to the wrong school' } });
    expect(voided.body).toMatchObject({ status: 'void' });
    expect(voided.body.notes).toContain('Issued to the wrong school');
    expect((await call('POST', `/invoices/${trueUpId}/pay`, { token: root.token, body: { paidOn: '2026-05-03' } })).body.code).toBe('INVOICE_NOT_PAYABLE');
    // a voided true-up frees the seats it covered, so it can be issued again
    const again = await call('POST', `/tenants/${code}/invoices`, { token: root.token, body: { kind: 'true_up', academicYear: Y1 } });
    expect(again.body.invoice).toMatchObject({ students: 2 });
    expect(again.body.invoice.number).not.toBe(voided.body.number);
  });
});

describe('operators management', () => {
  it('creates, disables, enables operators and protects the last one', async () => {
    const dupe = await call('POST', '/operators', { token: root.token, body: { email: BOOT.email, displayName: 'Dupe' } });
    expect(dupe.status).toBe(409);
    expect(dupe.body.code).toBe('EMAIL_TAKEN');
    expect((await call('POST', '/operators', { token: root.token, body: { email: 'not-an-email', displayName: 'X' } })).status).toBe(422);

    const c = await call('POST', '/operators', { token: root.token, body: { email: 'second@console.test', displayName: 'Second Operator' } });
    expect(c.status).toBe(201);
    expect(c.body.temporaryPassword).toMatch(/^[A-Za-z0-9]{16}$/);
    const second = await signIn('second@console.test', c.body.temporaryPassword);
    expect((await call('POST', '/auth/change-password', { token: second.accessToken, body: { currentPassword: c.body.temporaryPassword, newPassword: 'Second#Pass123' } })).status).toBe(200);
    const sToken = (await signIn('second@console.test', 'Second#Pass123')).accessToken;
    expect((await call('GET', '/operators', { token: sToken })).body.data.length).toBeGreaterThanOrEqual(2);

    expect((await call('POST', `/operators/${root.id}/disable`, { token: root.token })).body.code).toBe('CANNOT_DISABLE_SELF');
    const off = await call('POST', `/operators/${c.body.operator.id}/disable`, { token: root.token });
    expect(off.body.status).toBe('disabled');
    expect((await call('GET', '/auth/me', { token: sToken })).status).toBe(401); // signed out at once
    expect((await login('second@console.test', 'Second#Pass123')).body.code).toBe('ACCOUNT_DISABLED');
    expect((await call('POST', `/operators/${c.body.operator.id}/enable`, { token: root.token })).body.status).toBe('active');
    expect((await login('second@console.test', 'Second#Pass123')).status).toBe(200);

    // with only one active operator left, that one cannot be disabled by someone else either
    const others = (await call('GET', '/operators', { token: root.token })).body.data.filter((o: any) => o.id !== root.id && o.status === 'active');
    for (const o of others) await call('POST', `/operators/${o.id}/disable`, { token: root.token });
    const key = await call('POST', `/operators/${root.id}/disable`, { key: KEY });
    expect(key.body.code).toBe('LAST_OPERATOR');
  });
});

describe('platform audit', () => {
  it('records every mutation with who did it (operator id or the key), and pages with a cursor', async () => {
    const r = await call('GET', `/audit?tenant=${code}&limit=100`, { token: root.token });
    expect(r.status).toBe(200);
    const actions = r.body.data.map((e: any) => e.action);
    for (const a of ['tenant.create', 'tenant.update', 'tenant.suspended', 'tenant.active', 'subscription.upsert', 'usage.snapshot', 'invoice.issue', 'invoice.paid', 'invoice.void']) expect(actions, a).toContain(a);

    const byOperator = r.body.data.find((e: any) => e.action === 'tenant.suspended');
    expect(byOperator).toMatchObject({ actor: root.id, actorKind: 'operator', actorName: 'Platform administrator' });
    expect(byOperator.detail).toMatchObject({ via: 'operator', reason: 'unpaid' });
    const byKey = r.body.data.find((e: any) => e.action === 'tenant.active' && e.actor === 'platform-api');
    expect(byKey).toMatchObject({ actorKind: 'key' });
    expect(byKey.detail).toMatchObject({ via: 'key' });

    const first = await call('GET', '/audit?limit=2', { token: root.token });
    expect(first.body.data).toHaveLength(2);
    expect(first.body.nextCursor).toBeTruthy();
    const second = await call('GET', `/audit?limit=2&cursor=${first.body.nextCursor}`, { token: root.token });
    expect(second.body.data.map((e: any) => e.id)).not.toContain(first.body.data[0].id);
    expect(new Date(second.body.data[0].at).getTime()).toBeLessThanOrEqual(new Date(first.body.data[1].at).getTime());

    const logins = await call('GET', '/audit?action=operator.login&limit=100', { token: root.token });
    expect(logins.body.data.length).toBeGreaterThan(3);
    expect(logins.body.data.some((e: any) => e.action === 'operator.login_failed')).toBe(true);
    expect(JSON.stringify(logins.body)).not.toMatch(/Bootstrap#Pass1|Changed#Pass22|Wrong#Pass123/); // passwords never reach the log
  });
});
