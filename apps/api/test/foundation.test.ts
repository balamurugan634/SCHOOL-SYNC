import { beforeAll, describe, expect, it } from 'vitest';
import { assertSeatAvailable } from '../src/core/billing/license';
import { upsertSubscription } from '../src/core/billing/invoicing';
import { createTestSchool, PASSWORD, type TestSchool } from './helpers';

let s: TestSchool;
beforeAll(async () => {
  s = await createTestSchool();
});

describe('tenancy & auth', () => {
  it('serves public site info for the resolved school only', async () => {
    const ok = await s.req('GET', '/site/info');
    expect(ok.status).toBe(200);
    expect(ok.body.code).toBe(s.tenant.code);
    const res = await s.app.inject({ method: 'GET', url: '/api/v1/site/info', headers: { 'x-tenant': 'does-not-exist' } });
    expect(res.statusCode).toBe(404);
  });

  it('logs in each persona and returns the right experience', async () => {
    const cases: [string, string][] = [['t001', 'teacher'], [s.ctx.students[0]!.username, 'student'], [s.ctx.guardians[0]!.username, 'parent'], ['principal', 'management']];
    for (const [u, exp] of cases) {
      const r = await s.req('POST', '/auth/login', null, { identifier: u, password: PASSWORD });
      expect(r.status, u).toBe(200);
      expect(r.body.user.experience).toBe(exp);
    }
    expect((await s.req('POST', '/auth/login', null, { identifier: 't001', password: 'wrong' })).status).toBe(401);
  });

  it('rejects a token from one school at another school', async () => {
    const token = await s.login('t001');
    const res = await s.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { authorization: `Bearer ${token}`, 'x-tenant': 'demo' } });
    expect([401, 404]).toContain(res.statusCode); // other school missing in this test DB, or wrong key → never 200
  });

  it('rotates refresh tokens and flags reuse', async () => {
    const login = await s.req('POST', '/auth/login', null, { identifier: 't002', password: PASSWORD });
    const rt1 = login.body.refreshToken as string;
    const r2 = await s.req('POST', '/auth/refresh', null, { refreshToken: rt1 });
    expect(r2.status).toBe(200);
    expect(r2.body.refreshToken).not.toBe(rt1);
    const replay = await s.req('POST', '/auth/refresh', null, { refreshToken: rt1 });
    expect(replay.status).toBe(409); // inside the race window; later replays revoke the session
  });
});

describe('linked-children scoping', () => {
  it('a parent with an unverified link sees no children', async () => {
    const t = await s.login('9099999999');
    const me = await s.req('GET', '/auth/me', t);
    expect(me.body.profile.children).toHaveLength(0);
  });
  it('a parent sees exactly their verified children', async () => {
    const g = s.ctx.guardians[0]!;
    const t = await s.login(g.username);
    const me = await s.req('GET', '/auth/me', t);
    expect(me.body.profile.children.map((c: any) => c.studentId).sort()).toEqual([...g.studentIds].sort());
  });
});

describe('per-student pricing', () => {
  it('reports seats and blocks new students once committed seats are used (block policy)', async () => {
    const t = await s.login('admin@test.school');
    // enrolled students in the seeded year = 12 (small seed)
    await upsertSubscription({ tenantCode: s.tenant.code, academicYear: s.ctx.yearName, startsOn: '2000-01-01', endsOn: '2999-12-31', pricePerStudent: 100, licensedStudents: 12, overagePolicy: 'block' });
    const { invalidateLicense } = await import('../src/core/billing/license');
    invalidateLicense(s.tenant.id);
    const lic = await s.req('GET', '/license', t);
    expect(lic.status).toBe(200);
    expect(lic.body.seats).toMatchObject({ used: 12, licensed: 12, remaining: 0 });
    await expect(assertSeatAvailable(s.tenant, s.db, 1)).rejects.toMatchObject({ code: 'LICENSE_LIMIT_REACHED', status: 402 });
    await expect(assertSeatAvailable(s.tenant, s.db, 0)).resolves.toBeUndefined();
  });

  it('goes read-only after the grace period', async () => {
    await upsertSubscription({ tenantCode: s.tenant.code, academicYear: '2020-21', startsOn: '2020-04-01', endsOn: '2021-03-31', pricePerStudent: 100, licensedStudents: 12, graceDays: 10 });
    await upsertSubscription({ tenantCode: s.tenant.code, academicYear: s.ctx.yearName, startsOn: '2000-01-01', endsOn: '2001-01-01', pricePerStudent: 100, licensedStudents: 12, graceDays: 10 });
    const { invalidateLicense } = await import('../src/core/billing/license');
    invalidateLicense(s.tenant.id);
    expect((await s.req('GET', '/site/info')).body.readOnly).toBe(true);
    const t = await s.login('t001'); // login stays allowed
    expect((await s.req('GET', '/auth/me', t)).status).toBe(200); // reads work
    const write = await s.req('POST', '/devices', t, { platform: 'android', pushToken: 'x'.repeat(40) });
    expect(write.status).toBe(200); // allowWhenReadOnly route
  });
});
