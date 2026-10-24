import { eq, sql } from 'drizzle-orm';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { seedFoundation } from '../src/cli/seed/core';
import { config } from '../src/config';
import { todayIn } from '../src/core/http';
import { enqueueMail, EmailInputError, flushSchool } from '../src/core/email';
import { assertSmtpTargetAllowed, isBlockedAddress, resolveSmtpTarget, SmtpTargetError } from '../src/core/email/guard';
import { BACKOFF_MINUTES, purgeFinished, recoverStuck } from '../src/core/email/queue';
import { openForTenant, sealForTenant } from '../src/core/email/secret';
import { emailTestHooks } from '../src/core/email/test-hooks';
import { sanitiseMailError } from '../src/core/email/errors';
import { ALL_JOBS, runJobOnce } from '../src/core/jobs';
import { createTenant, dropTenant, shutdownTenancy } from '../src/core/tenancy/provision';
import { withAdminClient } from '../src/core/tenancy/control-db';
import { directClient, tenantDb, type TenantDb } from '../src/core/tenancy/pools';
import { tenantByCode, type TenantInfo } from '../src/core/tenancy/registry';
import { auditLogs, emailAccounts, emailQueue } from '../src/db/tenant/schema';
import { PASSWORD } from './helpers';
import { startStubSmtp } from './stub-smtp';

// ── two schools with their own mail accounts: nothing of A may ever be used for B ───────────────────
const tag = `${Date.now().toString(36)}${process.pid}`;
const CODE_A = `emailtesta${tag}`;
const CODE_B = `emailtestb${tag}`;
let app: FastifyInstance;
let A: TenantInfo;
let B: TenantInfo;
let dbA: TenantDb;
let dbB: TenantDb;
let adminA = '';
let adminB = '';
let teacherA = '';
let viewerA = '';

const SECRET = 'S3cret-Pa55 word!';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call(code: string, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, token?: string | null, body?: unknown) {
  const res = await app.inject({ method, url: `/api/v1${path}`, headers: { 'x-tenant': code, ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, payload: body === undefined ? undefined : JSON.stringify(body) });
  let parsed: any = res.body;
  try {
    parsed = res.body ? JSON.parse(res.body) : null;
  } catch {
    /* not JSON */
  }
  return { status: res.statusCode, body: parsed, raw: res.body };
}
const a = (m: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', p: string, body?: unknown, tok = adminA) => call(CODE_A, m, p, tok, body);
const b = (m: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', p: string, body?: unknown, tok = adminB) => call(CODE_B, m, p, tok, body);
const login = async (code: string, identifier: string, password = PASSWORD) => {
  const r = await call(code, 'POST', '/auth/login', null, { identifier, password });
  if (r.status !== 200) throw new Error(`login ${identifier}: ${r.status} ${r.raw}`);
  return r.body.accessToken as string;
};

// ── a stub transport factory records every send and (optionally) fails/slows it ──────────────────────
interface Sent {
  kind: 'platform' | 'account';
  accountId?: string;
  user?: string;
  host?: string;
  msg: any;
}
const sent: Sent[] = [];
const attempted: Sent[] = [];
let inFlight = 0;
let maxInFlight = 0;
let sendDelay = 0;
let behaviour: (s: Sent) => void | Promise<void> = () => undefined;

function installStub() {
  emailTestHooks.factory = (args) => ({
    async sendMail(m) {
      const opts = args.options as { auth?: { user: string }; host?: string };
      const rec: Sent = { kind: args.kind, accountId: args.accountId, user: opts?.auth?.user, host: opts?.host, msg: m };
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        if (sendDelay) await sleep(sendDelay);
        attempted.push(rec);
        await behaviour(rec);
        sent.push(rec);
        return { messageId: `<${sent.length}.${Date.now()}@stub>` };
      } finally {
        inFlight--;
      }
    },
    close() {},
  });
}

const DNS: Record<string, string> = {
  'smtp.school-a.test': '93.184.216.34',
  'smtp.school-b.test': '93.184.216.35',
  'smtp.other.test': '93.184.216.40',
  'internal.test': '10.0.0.5',
  'meta.test': '169.254.169.254',
  'loop.test': '127.0.0.1',
  'v6.test': '2607:f8b0:4004:c07::6a',
  'v6private.test': 'fd00:ec2::254',
};
const rebind: Record<string, string> = {};

const acctBody = (over: Record<string, unknown> = {}) => ({
  name: 'Office mailbox',
  emailAddress: 'office@school-a.test',
  senderName: 'Green Valley Office',
  provider: 'custom',
  smtpHost: 'smtp.school-a.test',
  smtpPort: 587,
  smtpSecurity: 'starttls',
  smtpUsername: 'user-a',
  smtpPassword: SECRET,
  ...over,
});
const acctB = (over: Record<string, unknown> = {}) => acctBody({ name: 'B mailbox', emailAddress: 'office@school-b.test', smtpHost: 'smtp.school-b.test', smtpUsername: 'user-b', smtpPassword: 'b-password-9', ...over });

async function clearAll(db: TenantDb) {
  await db.delete(emailQueue);
  await db.delete(emailAccounts);
}
const queueRows = (db: TenantDb) => db.select().from(emailQueue).orderBy(emailQueue.createdAt);
const bodyOf = (db: TenantDb, id: string) => db.select().from(emailQueue).where(eq(emailQueue.id, id)).then((r) => r[0]!);

beforeAll(async () => {
  config.ALLOW_PRIVATE_SMTP = false;
  emailTestHooks.lookup = async (host) => {
    const addr = rebind[host] ?? DNS[host];
    if (!addr) throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
    return [{ address: addr, family: addr.includes(':') ? 6 : 4 }];
  };
  emailTestHooks.sendIntervalMs = 2;
  installStub();
  for (const [code, name] of [[CODE_A, 'Green Valley Test'], [CODE_B, 'Blue Ridge Test']] as const) {
    await createTenant({ code, name, adminEmail: `admin@${code}.school`, adminPassword: PASSWORD });
  }
  A = (await tenantByCode(CODE_A))!;
  B = (await tenantByCode(CODE_B))!;
  dbA = tenantDb(A);
  dbB = tenantDb(B);
  await seedFoundation(dbA, A, 'small');
  app = await buildApp({ logger: false });
  await app.ready();
  adminA = await login(CODE_A, `admin@${CODE_A}.school`);
  adminB = await login(CODE_B, `admin@${CODE_B}.school`);
  teacherA = await login(CODE_A, 't001');
  // a custom role that may VIEW settings but not edit them
  const role = await a('POST', '/roles', { name: 'Settings Viewer', grants: { 'settings:view': 'school' } });
  expect(role.status).toBe(201);
  const user = await a('POST', '/users', { displayName: 'Viewer Vee', username: 'viewer.vee', email: 'vee@school-a.test' });
  expect(user.status).toBe(201);
  expect((await a('PUT', `/users/${user.body.id}/roles`, { roleIds: [role.body.id] })).status).toBe(200);
  viewerA = await login(CODE_A, 'viewer.vee', user.body.temporaryPassword);
}, 180_000);

afterAll(async () => {
  config.ALLOW_PRIVATE_SMTP = false;
  emailTestHooks.factory = undefined;
  emailTestHooks.lookup = undefined;
  emailTestHooks.platformConfigured = undefined;
  emailTestHooks.forceKick = undefined;
  emailTestHooks.sendIntervalMs = undefined;
  await app?.close();
  await dropTenant(CODE_A).catch(() => undefined);
  await dropTenant(CODE_B).catch(() => undefined);
  await shutdownTenancy();
});

afterEach(async () => {
  // the hourly test-email allowance is counted from the audit log: every test starts with a fresh one
  for (const db of [dbA, dbB]) await db.delete(auditLogs).where(eq(auditLogs.action, 'email_account.test'));
  sent.length = 0;
  attempted.length = 0;
  maxInFlight = 0;
  sendDelay = 0;
  behaviour = () => undefined;
  emailTestHooks.platformConfigured = undefined;
  emailTestHooks.forceKick = undefined;
  config.ALLOW_PRIVATE_SMTP = false;
  for (const k of Object.keys(rebind)) delete rebind[k];
  installStub();
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('encryption at rest', () => {
  it('round-trips, binds to school and row, and rejects tampering', () => {
    const box = sealForTenant(SECRET, A.id, 'row-1');
    expect(box).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/); // iv, tag, ciphertext
    expect(box).not.toContain('S3cret');
    expect(openForTenant(box, A.id, 'row-1')).toBe(SECRET);
    expect(sealForTenant(SECRET, A.id, 'row-1')).not.toBe(box); // fresh IV every time
    expect(() => openForTenant(box, B.id, 'row-1')).toThrow(); // another school's key
    expect(() => openForTenant(box, A.id, 'row-2')).toThrow(); // another row
    const [v, iv, tag2, ct] = box.split('.');
    expect(() => openForTenant([v, iv, tag2, ct!.slice(0, -2) + (ct!.endsWith('AA') ? 'BB' : 'AA')].join('.'), A.id, 'row-1')).toThrow();
    expect(() => openForTenant('garbage', A.id, 'row-1')).toThrow();
  });
});

describe('SSRF guard', () => {
  it('blocks loopback, private, link-local, CGNAT, metadata and reserved ranges (IPv4 and IPv6)', () => {
    const blocked = [
      '127.0.0.1', '127.255.255.254', '10.0.0.1', '10.255.1.1', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '169.254.0.1',
      '100.64.0.1', '100.127.255.255', '100.100.100.200', '0.0.0.0', '0.1.2.3', '224.0.0.1', '239.255.255.255', '255.255.255.255', '240.0.0.1', '198.18.0.1', '192.0.2.1', '192.0.0.8',
      '::1', '::', 'fe80::1', 'febf::1', 'fc00::1', 'fd12:3456::1', 'fd00:ec2::254', 'ff02::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.1.2.3', '::ffff:a9fe:a9fe',
      '64:ff9b::7f00:1', '64:ff9b::a9fe:a9fe', '2002:7f00:1::', '2002:a9fe:a9fe::1', '2001:db8::1', '2001::1', '100::1', '::127.0.0.1', 'not-an-ip',
    ];
    for (const ip of blocked) expect(isBlockedAddress(ip), ip).toBe(true);
    const open = ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '172.15.255.255', '100.63.255.255', '100.128.0.1', '11.0.0.1', '192.169.0.1', '2607:f8b0:4004:c07::6a', '2a00:1450:4001::1', '::ffff:8.8.8.8', '64:ff9b::808:808'];
    for (const ip of open) expect(isBlockedAddress(ip), ip).toBe(false);
  });

  it('resolves the host and refuses any private answer; allows the port list only', async () => {
    for (const host of ['internal.test', 'meta.test', 'loop.test', 'v6private.test']) {
      await expect(resolveSmtpTarget(host, 587), host).rejects.toMatchObject({ code: 'HOST_BLOCKED' });
    }
    await expect(resolveSmtpTarget('127.0.0.1', 587)).rejects.toMatchObject({ code: 'HOST_BLOCKED' });
    await expect(resolveSmtpTarget('[::1]', 587)).rejects.toMatchObject({ code: 'HOST_BLOCKED' });
    await expect(resolveSmtpTarget('nope.invalid', 587)).rejects.toMatchObject({ code: 'HOST_NOT_FOUND' });
    // one private address among public ones is enough to refuse
    const saved = emailTestHooks.lookup;
    emailTestHooks.lookup = async () => [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.9', family: 4 }];
    await expect(resolveSmtpTarget('mixed.test', 587)).rejects.toBeInstanceOf(SmtpTargetError);
    emailTestHooks.lookup = saved;

    for (const port of [25, 465, 587, 2525]) expect((await resolveSmtpTarget('smtp.school-a.test', port)).address).toBe('93.184.216.34');
    for (const port of [22, 80, 443, 3306, 5432, 6379, 8080, 2526, 0, 65535]) await expect(resolveSmtpTarget('smtp.school-a.test', port), String(port)).rejects.toMatchObject({ code: 'PORT_NOT_ALLOWED' });
    expect((await resolveSmtpTarget('v6.test', 587)).family).toBe(6);
  });

  it('ALLOW_PRIVATE_SMTP (dev/test) lifts the address and port checks', async () => {
    config.ALLOW_PRIVATE_SMTP = true;
    expect((await resolveSmtpTarget('loop.test', 2626)).address).toBe('127.0.0.1');
    await assertSmtpTargetAllowed('internal.test', 5000);
    config.ALLOW_PRIVATE_SMTP = false;
    await expect(assertSmtpTargetAllowed('internal.test', 587)).rejects.toBeInstanceOf(SmtpTargetError);
  });
});

describe('mail errors are sanitised', () => {
  it('maps server failures to fixed sentences and never repeats server text', () => {
    const raw = 'Invalid login: 535 5.7.8 Username and Password not accepted user=bob pass=hunter2 banner-xyz';
    const m = sanitiseMailError(Object.assign(new Error(raw), { code: 'EAUTH', responseCode: 535, response: raw }));
    expect(m).toMatch(/username or password/i);
    expect(m).not.toMatch(/hunter2|banner-xyz|bob/);
    expect(sanitiseMailError(Object.assign(new Error('connect ECONNREFUSED 10.1.1.1:25'), { code: 'ECONNREFUSED' }))).toMatch(/could not connect/i);
    expect(sanitiseMailError(Object.assign(new Error('connect ECONNREFUSED 10.1.1.1:25'), { code: 'ECONNREFUSED' }))).not.toContain('10.1.1.1');
    expect(sanitiseMailError(Object.assign(new Error('self-signed certificate in certificate chain'), { code: 'SELF_SIGNED_CERT_IN_CHAIN' }))).toMatch(/certificate/i);
    expect(sanitiseMailError(Object.assign(new Error('Greeting never received'), { code: 'ETIMEDOUT' }))).toMatch(/could not connect/i);
    expect(sanitiseMailError(Object.assign(new Error('Recipient rejected 550 secret-banner'), { code: 'EENVELOPE', responseCode: 550, command: 'RCPT TO' }))).toMatch(/refused the sender or recipient/i);
    expect(sanitiseMailError(new Error('totally unknown secret-banner'))).not.toContain('secret-banner');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('accounts API: permissions, validation, secrets', () => {
  afterEach(async () => {
    await clearAll(dbA);
    await clearAll(dbB);
  });

  it('admins manage accounts; viewers only read; teachers and anonymous users are refused', async () => {
    expect((await a('GET', '/settings/email/accounts', undefined, teacherA)).status).toBe(403);
    expect((await a('GET', '/settings/email/accounts', undefined, '')).status).toBe(401);
    expect((await a('POST', '/settings/email/accounts', acctBody(), teacherA)).status).toBe(403);
    expect((await a('GET', '/settings/email/queue', undefined, teacherA)).status).toBe(403);
    expect((await a('POST', '/settings/email/queue/flush', undefined, teacherA)).status).toBe(403);

    const created = await a('POST', '/settings/email/accounts', acctBody());
    expect(created.status).toBe(201);
    const id = created.body.id;
    // read-only user: may see, may not change or test
    expect((await a('GET', '/settings/email/accounts', undefined, viewerA)).status).toBe(200);
    expect((await a('GET', '/settings/email/queue/summary', undefined, viewerA)).status).toBe(200);
    for (const [m, p, body] of [
      ['POST', '/settings/email/accounts', acctBody({ name: 'Other box' })],
      ['PATCH', `/settings/email/accounts/${id}`, { enabled: false }],
      ['DELETE', `/settings/email/accounts/${id}`, undefined],
      ['POST', `/settings/email/accounts/${id}/default`, undefined],
      ['POST', `/settings/email/accounts/${id}/test`, {}],
      ['POST', '/settings/email/use-platform-default', undefined],
      ['POST', '/settings/email/queue/flush', undefined],
      ['POST', '/settings/email/queue/clear', { olderThanDays: 0, statuses: ['sent'] }],
    ] as const) {
      expect((await a(m, p, body, viewerA)).status, `${m} ${p}`).toBe(403);
    }
    expect((await a('GET', '/settings/email/accounts', undefined, adminA)).body.data).toHaveLength(1);
  });

  it('never returns, logs or audits the password; stores it sealed', async () => {
    const created = await a('POST', '/settings/email/accounts', acctBody());
    expect(created.status).toBe(201);
    const id = created.body.id;
    expect(created.body.passwordSet).toBe(true);
    const responses = [created.raw, (await a('GET', '/settings/email/accounts')).raw];
    const patched = await a('PATCH', `/settings/email/accounts/${id}`, { senderName: 'Front office' });
    expect(patched.body.passwordSet).toBe(true); // omitted = kept
    responses.push(patched.raw, (await a('GET', '/settings/email/queue')).raw);
    const replaced = await a('PATCH', `/settings/email/accounts/${id}`, { smtpPassword: 'N3w-Passw0rd-xyz' });
    responses.push(replaced.raw);
    for (const r of responses) {
      expect(r).not.toContain('S3cret');
      expect(r).not.toContain('N3w-Passw0rd');
      expect(r).not.toMatch(/smtpPasswordEnc|smtp_password_enc|"smtpPassword"/);
    }
    const [row] = await dbA.select().from(emailAccounts).where(eq(emailAccounts.id, id));
    expect(row!.smtpPasswordEnc).toMatch(/^v1\./);
    expect(row!.smtpPasswordEnc).not.toContain('N3w');
    expect(openForTenant(row!.smtpPasswordEnc!, A.id, id)).toBe('N3w-Passw0rd-xyz');
    // the audit trail records the change but no secret
    const audits = await dbA.select().from(auditLogs).where(sql`${auditLogs.action} like 'email_account.%'`);
    expect(audits.map((x) => x.action)).toEqual(expect.arrayContaining(['email_account.create', 'email_account.update']));
    const dump = JSON.stringify(audits);
    expect(dump).not.toContain('S3cret');
    expect(dump).not.toContain('N3w-Passw0rd');
    expect(dump).not.toContain(row!.smtpPasswordEnc!);
    // clearing: "" removes it
    const cleared = await a('PATCH', `/settings/email/accounts/${id}`, { smtpPassword: '', smtpUsername: '' });
    expect(cleared.status).toBe(200);
    expect(cleared.body.passwordSet).toBe(false);
    expect((await dbA.select().from(emailAccounts).where(eq(emailAccounts.id, id)))[0]!.smtpPasswordEnc).toBeNull();
  });

  it('validates input: ports, hosts, addresses, line breaks, insecure mode, duplicates', async () => {
    const bad = async (over: Record<string, unknown>, status: number, code?: string) => {
      const r = await a('POST', '/settings/email/accounts', acctBody(over));
      expect(r.status, JSON.stringify(over)).toBe(status);
      if (code) expect(r.body.code).toBe(code);
      return r;
    };
    await bad({ smtpPort: 22 }, 422, 'SMTP_PORT_NOT_ALLOWED');
    await bad({ smtpPort: 3306 }, 422, 'SMTP_PORT_NOT_ALLOWED');
    await bad({ smtpPort: 70000 }, 422, 'VALIDATION_ERROR');
    await bad({ smtpHost: 'internal.test' }, 422, 'SMTP_HOST_BLOCKED');
    await bad({ smtpHost: 'meta.test' }, 422, 'SMTP_HOST_BLOCKED');
    await bad({ smtpHost: '127.0.0.1' }, 422, 'SMTP_HOST_BLOCKED');
    await bad({ smtpHost: '169.254.169.254' }, 422, 'SMTP_HOST_BLOCKED');
    await bad({ smtpHost: 'https://smtp.school-a.test' }, 422, 'VALIDATION_ERROR');
    await bad({ smtpHost: 'smtp.school-a.test:587' }, 422, 'VALIDATION_ERROR');
    await bad({ emailAddress: 'not an address' }, 422, 'VALIDATION_ERROR');
    await bad({ emailAddress: 'a@b.co\r\nBcc: evil@x.co' }, 422, 'VALIDATION_ERROR');
    await bad({ replyTo: 'x@y.co\nBcc: evil@x.co' }, 422, 'VALIDATION_ERROR');
    await bad({ senderName: 'Office\r\nBcc: evil@x.co' }, 422, 'VALIDATION_ERROR');
    await bad({ name: 'Line\nbreak' }, 422, 'VALIDATION_ERROR');
    await bad({ smtpUsername: 'user\r\nX: 1' }, 422, 'VALIDATION_ERROR');
    await bad({ smtpSecurity: 'none' }, 422, 'INSECURE_NOT_ACKNOWLEDGED');
    await bad({ smtpPassword: undefined }, 422, 'PASSWORD_REQUIRED'); // a username needs its password
    await bad({ dailyLimit: 0 }, 422, 'VALIDATION_ERROR');
    expect((await a('POST', '/settings/email/accounts', acctBody({ smtpSecurity: 'none', allowInsecure: true, smtpPort: 25 }))).status).toBe(201);
  });

  it('keeps names unique ignoring case', async () => {
    expect((await a('POST', '/settings/email/accounts', acctBody())).status).toBe(201);
    const dup = await a('POST', '/settings/email/accounts', acctBody({ name: 'office MAILBOX' }));
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('EMAIL_ACCOUNT_NAME_TAKEN');
  });

  it('PATCH validates a changed host and drops stale test results', async () => {
    const id = (await a('POST', '/settings/email/accounts', acctBody())).body.id;
    const t = await a('POST', `/settings/email/accounts/${id}/test`, {});
    expect(t.body.ok).toBe(true);
    expect((await a('GET', '/settings/email/accounts')).body.data[0].lastTestOk).toBe(true);
    expect((await a('PATCH', `/settings/email/accounts/${id}`, { smtpHost: 'internal.test' })).body.code).toBe('SMTP_HOST_BLOCKED');
    expect((await a('PATCH', `/settings/email/accounts/${id}`, { smtpPort: 22 })).body.code).toBe('SMTP_PORT_NOT_ALLOWED');
    expect((await a('PATCH', `/settings/email/accounts/${id}`, { smtpSecurity: 'none' })).body.code).toBe('INSECURE_NOT_ACKNOWLEDGED');
    const moved = await a('PATCH', `/settings/email/accounts/${id}`, { smtpHost: 'smtp.other.test' });
    expect(moved.status).toBe(200);
    expect(moved.body.lastTestOk).toBeNull(); // the old result says nothing about the new server
    expect((await a('PATCH', `/settings/email/accounts/${id}`, { name: 'Renamed' })).body.name).toBe('Renamed');
    expect((await a('PATCH', `/settings/email/accounts/${randomUuid()}`, { name: 'xx' })).status).toBe(404);
  });

  it('keeps exactly one default account, switched in one transaction', async () => {
    const platformOnly = (await a('GET', '/settings/email/accounts')).body.platform;
    expect(platformOnly).toMatchObject({ active: true, senderName: 'Green Valley Test' });
    const one = (await a('POST', '/settings/email/accounts', acctBody({ isDefaultOutgoing: true }))).body;
    const two = (await a('POST', '/settings/email/accounts', acctBody({ name: 'Second', isDefaultOutgoing: true, emailAddress: 'two@school-a.test' }))).body;
    const defaults = async () => (await dbA.select().from(emailAccounts).where(eq(emailAccounts.isDefaultOutgoing, true))).map((x) => x.id);
    expect(await defaults()).toEqual([two.id]); // creating a second default demoted the first
    expect((await a('POST', `/settings/email/accounts/${one.id}/default`)).body.isDefaultOutgoing).toBe(true);
    expect(await defaults()).toEqual([one.id]);
    const list = (await a('GET', '/settings/email/accounts')).body;
    expect(list.data.filter((x: any) => x.isDefaultOutgoing)).toHaveLength(1);
    expect(list.platform.active).toBe(false);

    // the database itself refuses a second default
    await expect(dbA.update(emailAccounts).set({ isDefaultOutgoing: true }).where(eq(emailAccounts.id, two.id))).rejects.toMatchObject({ cause: { code: '23505' } });

    // a disabled account cannot be default; disabling the default hands it back to the platform sender
    expect((await a('PATCH', `/settings/email/accounts/${two.id}`, { enabled: false })).body.enabled).toBe(false);
    expect((await a('POST', `/settings/email/accounts/${two.id}/default`)).body.code).toBe('ACCOUNT_DISABLED');
    const off = await a('PATCH', `/settings/email/accounts/${one.id}`, { enabled: false });
    expect(off.body).toMatchObject({ enabled: false, isDefaultOutgoing: false });
    expect(await defaults()).toEqual([]);
    expect((await a('GET', '/settings/email/accounts')).body.platform.active).toBe(true);

    await a('PATCH', `/settings/email/accounts/${one.id}`, { enabled: true });
    await a('POST', `/settings/email/accounts/${one.id}/default`);
    expect((await a('POST', '/settings/email/use-platform-default')).status).toBe(200);
    expect(await defaults()).toEqual([]);
    const audits = (await dbA.select().from(auditLogs).where(sql`${auditLogs.action} like 'email_account.%'`)).map((x) => x.action);
    expect(audits).toEqual(expect.arrayContaining(['email_account.set_default', 'email_account.use_platform_default']));
  });

  it('deleting an account keeps its queued mail (sent by the default sender instead)', async () => {
    const id = (await a('POST', '/settings/email/accounts', acctBody({ isDefaultOutgoing: true }))).body.id;
    const q = await enqueueMail(A, { to: 'p@x.co', subject: 'Hello', text: 'Hi' });
    expect((await bodyOf(dbA, q.id)).accountId).toBe(id);
    expect((await a('DELETE', `/settings/email/accounts/${id}`)).status).toBe(200);
    expect((await bodyOf(dbA, q.id)).accountId).toBeNull();
    expect((await a('GET', `/settings/email/accounts`)).body.data).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('test email endpoint', () => {
  afterEach(async () => {
    await clearAll(dbA);
    await clearAll(dbB);
  });

  it('sends to the admin or a typed address, records the result, and hides server text', async () => {
    const id = (await a('POST', '/settings/email/accounts', acctBody())).body.id;
    const own = await a('POST', `/settings/email/accounts/${id}/test`, {});
    expect(own.body).toMatchObject({ ok: true, error: null, sentTo: `admin@${CODE_A}.school` });
    expect(sent.at(-1)).toMatchObject({ kind: 'account', accountId: id, user: 'user-a', host: '93.184.216.34' }); // connected to the validated IP
    expect(sent.at(-1)!.msg.from).toEqual({ name: 'Green Valley Office', address: 'office@school-a.test' });
    expect(sent.at(-1)!.msg.to).toEqual([`admin@${CODE_A}.school`]);
    const typed = await a('POST', `/settings/email/accounts/${id}/test`, { to: 'someone@else.co' });
    expect(typed.body).toMatchObject({ ok: true, sentTo: 'someone@else.co' });
    expect((await a('POST', `/settings/email/accounts/${id}/test`, { to: 'bad\r\nBcc: x@y.co' })).status).toBe(422);

    behaviour = () => {
      throw Object.assign(new Error('Invalid login: 535 5.7.8 pass=S3cret-Pa55 stub-banner-7f3a'), { code: 'EAUTH', responseCode: 535 });
    };
    const failed = await a('POST', `/settings/email/accounts/${id}/test`, {});
    expect(failed.status).toBe(200);
    expect(failed.body.ok).toBe(false);
    expect(failed.body.error).toMatch(/username or password/i);
    expect(failed.raw).not.toMatch(/S3cret|stub-banner|535 5\.7\.8/);
    const listed = (await a('GET', '/settings/email/accounts')).body.data[0];
    expect(listed).toMatchObject({ lastTestOk: false });
    expect(listed.lastTestError).toMatch(/username or password/i);
    expect(JSON.stringify(await dbA.select().from(auditLogs).where(eq(auditLogs.action, 'email_account.test')))).not.toMatch(/stub-banner|S3cret/);
  });

  it('tests the platform sender (own address only) and reports when none is configured', async () => {
    const none = await a('POST', '/settings/email/platform/test');
    expect(none.body.ok).toBe(false);
    expect(none.body.error).toMatch(/no default mail server/i);
    emailTestHooks.platformConfigured = true;
    const ok = await a('POST', '/settings/email/platform/test', { to: 'ignored@x.co' });
    expect(ok.body).toMatchObject({ ok: true, sentTo: `admin@${CODE_A}.school` });
    expect(sent.at(-1)).toMatchObject({ kind: 'platform' });
  });

  it('is limited to 5 per hour per school (and school A does not use up school B’s)', async () => {
    const id = (await b('POST', '/settings/email/accounts', acctB())).body.id;
    for (let i = 0; i < 5; i++) expect((await b('POST', `/settings/email/accounts/${id}/test`, {})).status, `test ${i}`).toBe(200);
    const sixth = await b('POST', `/settings/email/accounts/${id}/test`, {});
    expect(sixth.status).toBe(429);
    expect(sixth.body.code).toBe('RATE_LIMITED');
    expect(sent.filter((s) => s.user === 'user-b')).toHaveLength(5);
    const idA = (await a('POST', '/settings/email/accounts', acctBody())).body.id;
    expect((await a('POST', `/settings/email/accounts/${idA}/test`, {})).status).toBe(200);
  });

  it('talks real SMTP to a local stub server (ALLOW_PRIVATE_SMTP only because this is a test)', async () => {
    emailTestHooks.factory = undefined; // use nodemailer for real
    const smtp = await startStubSmtp({ auth: { user: 'mailer', pass: 'right-pass-1' } });
    try {
      // the guard is ON: a loopback server is refused ...
      const refused = await a('POST', '/settings/email/accounts', acctBody({ smtpHost: smtp.host, smtpPort: smtp.port, smtpSecurity: 'none', allowInsecure: true, smtpUsername: 'mailer', smtpPassword: 'right-pass-1' }));
      expect(['SMTP_PORT_NOT_ALLOWED', 'SMTP_HOST_BLOCKED']).toContain(refused.body.code); // a random port AND a loopback host
      // ... until the dev/test switch is on
      config.ALLOW_PRIVATE_SMTP = true;
      const ok = await a('POST', '/settings/email/accounts', acctBody({ smtpHost: smtp.host, smtpPort: smtp.port, smtpSecurity: 'none', allowInsecure: true, smtpUsername: 'mailer', smtpPassword: 'wrong-pass' }));
      expect(ok.status).toBe(201);
      const bad = await a('POST', `/settings/email/accounts/${ok.body.id}/test`, {});
      expect(bad.body.ok).toBe(false);
      expect(bad.body.error).toMatch(/username or password/i);
      expect(bad.raw).not.toMatch(/stub-banner|wrong-pass|Username and Password not accepted/);
      await a('PATCH', `/settings/email/accounts/${ok.body.id}`, { smtpPassword: 'right-pass-1' });
      const good = await a('POST', `/settings/email/accounts/${ok.body.id}/test`, { to: 'tester@example.org' });
      expect(good.body, JSON.stringify(good.body)).toMatchObject({ ok: true });
      expect(smtp.messages).toHaveLength(1);
      expect(smtp.messages[0]).toMatchObject({ from: 'office@school-a.test', to: ['tester@example.org'], user: 'mailer' });
      expect(smtp.messages[0]!.data).toMatch(/Subject: Test email from Green Valley Test/);
      // and a queued mail goes the same way, End to end
      await a('POST', `/settings/email/accounts/${ok.body.id}/default`);
      const q = await enqueueMail(A, { to: 'parent@example.org', subject: 'Real SMTP', text: 'It works' });
      await flushSchool(A);
      expect((await bodyOf(dbA, q.id)).status).toBe('sent');
      expect(smtp.messages.at(-1)!.to).toEqual(['parent@example.org']);
    } finally {
      await smtp.close();
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('choosing the transport', () => {
  afterEach(async () => {
    await clearAll(dbA);
    await clearAll(dbB);
  });

  it('uses the platform sender with the school name and the school’s contact address as Reply-To', async () => {
    emailTestHooks.platformConfigured = true;
    expect((await a('PUT', '/settings/school', { email: 'office@greenvalley.example' })).status).toBe(200);
    const q = await enqueueMail(A, { to: 'parent@x.co', subject: 'Receipt', text: 'Paid' });
    expect((await bodyOf(dbA, q.id)).accountId).toBeNull();
    await flushSchool(A);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: 'platform' });
    expect(sent[0]!.msg.from).toEqual({ name: 'Green Valley Test', address: 'no-reply@schoolsync.local' });
    expect(sent[0]!.msg.replyTo).toBe('office@greenvalley.example');
    expect((await bodyOf(dbA, q.id))).toMatchObject({ status: 'sent', sentVia: 'platform' });
  });

  it('uses the default account (or an explicit one) and ignores disabled accounts', async () => {
    const def = (await a('POST', '/settings/email/accounts', acctBody({ isDefaultOutgoing: true, replyTo: 'help@school-a.test' }))).body;
    const other = (await a('POST', '/settings/email/accounts', acctBody({ name: 'Accounts desk', emailAddress: 'accounts@school-a.test', senderName: 'Accounts', smtpUsername: 'user-acc' }))).body;
    const m1 = await enqueueMail(A, { to: 'p@x.co', subject: 'Default', text: 'a' });
    const m2 = await enqueueMail(A, { to: 'p@x.co', subject: 'Explicit', text: 'b', accountId: other.id });
    await flushSchool(A);
    expect(sent.map((s) => [s.msg.subject, s.accountId, s.msg.from.address])).toEqual([['Default', def.id, 'office@school-a.test'], ['Explicit', other.id, 'accounts@school-a.test']]);
    expect(sent[0]!.msg.replyTo).toBe('help@school-a.test');
    expect(sent[0]!.msg.from.name).toBe('Green Valley Office');
    expect((await bodyOf(dbA, m1.id)).sentVia).toBe('account');
    expect((await bodyOf(dbA, m2.id)).accountId).toBe(other.id);
    // disabled accounts cannot be named
    await a('PATCH', `/settings/email/accounts/${other.id}`, { enabled: false });
    await expect(enqueueMail(A, { to: 'p@x.co', subject: 'x', text: 'y', accountId: other.id })).rejects.toBeInstanceOf(EmailInputError);
    // a queued mail whose account was switched off meanwhile falls back to today's default
    await a('PATCH', `/settings/email/accounts/${other.id}`, { enabled: true });
    const m3 = await enqueueMail(A, { to: 'p@x.co', subject: 'Late', text: 'c', accountId: other.id });
    await a('PATCH', `/settings/email/accounts/${other.id}`, { enabled: false });
    sent.length = 0;
    await flushSchool(A);
    expect(sent[0]).toMatchObject({ accountId: def.id });
    expect((await bodyOf(dbA, m3.id)).status).toBe('sent');
  });

  it('alwaysUseAccountAddress=false lets a message ask for another address on the same domain only', async () => {
    const id = (await a('POST', '/settings/email/accounts', acctBody({ isDefaultOutgoing: true, alwaysUseAccountAddress: false }))).body.id;
    await enqueueMail(A, { to: 'p@x.co', subject: 'Same domain', text: 'a', fromEmail: 'principal@school-a.test' });
    await enqueueMail(A, { to: 'p@x.co', subject: 'Other domain', text: 'b', fromEmail: 'ceo@evil.example' });
    await flushSchool(A);
    expect(sent.map((s) => s.msg.from.address)).toEqual(['principal@school-a.test', 'office@school-a.test']);
    await a('PATCH', `/settings/email/accounts/${id}`, { alwaysUseAccountAddress: true });
    sent.length = 0;
    await enqueueMail(A, { to: 'p@x.co', subject: 'Forced', text: 'c', fromEmail: 'principal@school-a.test' });
    await flushSchool(A);
    expect(sent[0]!.msg.from.address).toBe('office@school-a.test');
  });

  it('school A’s account is never used for school B', async () => {
    const accA = (await a('POST', '/settings/email/accounts', acctBody({ isDefaultOutgoing: true }))).body;
    const accB = (await b('POST', '/settings/email/accounts', acctB({ isDefaultOutgoing: true }))).body;
    for (let i = 0; i < 3; i++) {
      await enqueueMail(A, { to: `a${i}@x.co`, subject: `A${i}`, text: 'x' });
      await enqueueMail(B, { to: `b${i}@x.co`, subject: `B${i}`, text: 'x' });
    }
    await Promise.all([flushSchool(A), flushSchool(B)]);
    expect(sent).toHaveLength(6);
    for (const s of sent) {
      const school = String(s.msg.subject).startsWith('A') ? 'A' : 'B';
      expect(s.user, s.msg.subject).toBe(school === 'A' ? 'user-a' : 'user-b');
      expect(s.accountId).toBe(school === 'A' ? accA.id : accB.id);
      expect(s.host).toBe(school === 'A' ? '93.184.216.34' : '93.184.216.35');
      expect(s.msg.from.address).toBe(school === 'A' ? 'office@school-a.test' : 'office@school-b.test');
    }
    // B cannot even name A's account, and A's queue rows are invisible to B
    await expect(enqueueMail(B, { to: 'x@y.co', subject: 's', text: 't', accountId: accA.id })).rejects.toBeInstanceOf(EmailInputError);
    expect((await b('GET', '/settings/email/queue')).body.data.map((r: any) => r.subject).sort()).toEqual(['B0', 'B1', 'B2']);
    expect((await b('GET', '/settings/email/accounts')).body.data.map((r: any) => r.id)).toEqual([accB.id]);
    expect((await b('PATCH', `/settings/email/accounts/${accA.id}`, { enabled: false })).status).toBe(404);
    expect((await b('POST', `/settings/email/accounts/${accA.id}/test`, {})).status).toBe(404);
    // one school's sealed password cannot be opened with the other's key
    const [rowA] = await dbA.select().from(emailAccounts).where(eq(emailAccounts.id, accA.id));
    expect(() => openForTenant(rowA!.smtpPasswordEnc!, B.id, accA.id)).toThrow();
  });

  it('re-checks the host when connecting: a DNS answer that turned private is refused', async () => {
    const id = (await a('POST', '/settings/email/accounts', acctBody({ isDefaultOutgoing: true }))).body.id;
    const q = await enqueueMail(A, { to: 'p@x.co', subject: 'Rebind', text: 'x' });
    rebind['smtp.school-a.test'] = '10.0.0.7'; // DNS rebinding after the settings were saved
    await flushSchool(A);
    expect(attempted).toHaveLength(0); // no connection was even prepared
    const row = await bodyOf(dbA, q.id);
    expect(row.status).toBe('error');
    expect(row.lastError).toMatch(/not allowed/i);
    expect((await a('GET', '/settings/email/accounts')).body.data[0].lastSendError).toMatch(/not allowed/i);
    expect(id).toBeTruthy();
  });

  it('rejects bad addresses and strips line breaks from subjects (header injection)', async () => {
    await expect(enqueueMail(A, { to: 'ok@x.co\r\nBcc: evil@x.co', subject: 's', text: 't' })).rejects.toBeInstanceOf(EmailInputError);
    await expect(enqueueMail(A, { to: ['ok@x.co', 'nope'], subject: 's', text: 't' })).rejects.toBeInstanceOf(EmailInputError);
    await expect(enqueueMail(A, { to: [], subject: 's', text: 't' })).rejects.toBeInstanceOf(EmailInputError);
    await expect(enqueueMail(A, { to: 'a@b.co', cc: ['bad\n@x.co'], subject: 's', text: 't' })).rejects.toBeInstanceOf(EmailInputError);
    await expect(enqueueMail(A, { to: 'a@b.co', subject: '   ', text: 't' })).rejects.toBeInstanceOf(EmailInputError);
    const q = await enqueueMail(A, { to: ['a@b.co', 'A@B.co'], subject: 'Hi\r\nBcc: evil@x.co', text: 't' });
    const row = await bodyOf(dbA, q.id);
    expect(row.subject).toBe('Hi Bcc: evil@x.co');
    expect(row.toAddresses).toEqual(['a@b.co']); // de-duplicated
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('the queue worker', () => {
  afterEach(async () => {
    await clearAll(dbA);
    await clearAll(dbB);
  });

  const asAccount = async () => (await a('POST', '/settings/email/accounts', acctBody({ isDefaultOutgoing: true }))).body.id as string;

  it('sends strictly one message at a time, by priority then age', async () => {
    await asAccount();
    sendDelay = 15;
    const order: [string, number][] = [['bulk-1', 9], ['normal-1', 5], ['high-1', 1], ['normal-2', 5], ['bulk-2', 9], ['high-2', 1], ['normal-3', 5]];
    for (const [subject, priority] of order) await enqueueMail(A, { to: 'p@x.co', subject, text: 'x', priority });
    // several overlapping triggers (tick + kick + admin flush) must still produce one sequential stream
    const stats = await Promise.all([flushSchool(A), flushSchool(A), flushSchool(A, { limit: 50 })]);
    await flushSchool(A);
    expect(maxInFlight).toBe(1);
    expect(sent.map((s) => s.msg.subject)).toEqual(['high-1', 'high-2', 'normal-1', 'normal-2', 'normal-3', 'bulk-1', 'bulk-2']);
    expect(stats[0]!.sent).toBe(7); // the three triggers were merged into one run
    expect((await queueRows(dbA)).every((r) => r.status === 'sent' && r.attempts === 1 && r.messageId)).toBe(true);
  });

  it('a second worker (another process) is kept out by the one-sending-row guarantee', async () => {
    await asAccount();
    const mid = (await enqueueMail(A, { to: 'p@x.co', subject: 'in flight', text: 'x' })).id;
    await dbA.update(emailQueue).set({ status: 'sending', claimedAt: new Date() }).where(eq(emailQueue.id, mid));
    await enqueueMail(A, { to: 'p@x.co', subject: 'waits', text: 'x' });
    const stats = await flushSchool(A);
    expect(stats).toMatchObject({ busy: true, sent: 0 });
    expect(sent).toHaveLength(0);
    // the database refuses a second `sending` row outright
    const other = (await enqueueMail(A, { to: 'p@x.co', subject: 'second', text: 'x' })).id;
    await expect(dbA.update(emailQueue).set({ status: 'sending' }).where(eq(emailQueue.id, other))).rejects.toMatchObject({ cause: { code: '23505' } });
  });

  it('does not block other schools: each school is processed independently', async () => {
    await asAccount();
    await b('POST', '/settings/email/accounts', acctB({ isDefaultOutgoing: true }));
    const mid = (await enqueueMail(A, { to: 'p@x.co', subject: 'A in flight', text: 'x' })).id;
    await dbA.update(emailQueue).set({ status: 'sending', claimedAt: new Date() }).where(eq(emailQueue.id, mid));
    await enqueueMail(B, { to: 'p@x.co', subject: 'B goes', text: 'x' });
    expect((await flushSchool(A)).busy).toBe(true);
    expect((await flushSchool(B)).sent).toBe(1);
  });

  it('retries with 1, 5 then 30 minutes of backoff and ends in Error after max attempts', async () => {
    expect(BACKOFF_MINUTES).toEqual([1, 5, 30]);
    await asAccount();
    behaviour = () => {
      throw Object.assign(new Error('connect ETIMEDOUT 1.2.3.4:587 secret-banner'), { code: 'ETIMEDOUT' });
    };
    const q3 = (await enqueueMail(A, { to: 'p@x.co', subject: 'three', text: 'x' })).id; // default 3 attempts
    const q4 = (await enqueueMail(A, { to: 'p@x.co', subject: 'four', text: 'x', maxAttempts: 4 })).id;
    const expectNext = async (id: string, minutes: number, attempts: number) => {
      const r = await bodyOf(dbA, id);
      expect(r.status).toBe('not_sent');
      expect(r.attempts).toBe(attempts);
      const wait = (r.nextAttemptAt.getTime() - Date.now()) / 60_000;
      expect(wait).toBeGreaterThan(minutes - 0.5);
      expect(wait).toBeLessThanOrEqual(minutes + 0.01);
      expect(r.lastError).toMatch(/could not connect/i);
      expect(r.lastError).not.toMatch(/secret-banner|1\.2\.3\.4/);
    };
    const makeDue = () => dbA.update(emailQueue).set({ nextAttemptAt: new Date(Date.now() - 1000) }).where(eq(emailQueue.status, 'not_sent'));

    const first = await flushSchool(A);
    expect(first).toMatchObject({ sent: 0, retrying: 2, failed: 0 });
    await expectNext(q3, 1, 1);
    await expectNext(q4, 1, 1);
    // not due yet: another flush does nothing and attempts do not move
    const idle = await flushSchool(A);
    expect(idle).toMatchObject({ sent: 0, retrying: 0, failed: 0 });
    expect(attempted).toHaveLength(2);

    await makeDue();
    await flushSchool(A);
    await expectNext(q3, 5, 2);
    await expectNext(q4, 5, 2);

    await makeDue();
    const third = await flushSchool(A);
    expect(third).toMatchObject({ retrying: 1, failed: 1 });
    const final = await bodyOf(dbA, q3);
    expect(final.status).toBe('error');
    expect(final.attempts).toBe(3);
    expect(final.lastError).toMatch(/could not connect/i);
    await expectNext(q4, 30, 3);

    await makeDue();
    await flushSchool(A);
    expect(await bodyOf(dbA, q4)).toMatchObject({ status: 'error', attempts: 4 });
    // finished rows are never touched again
    attempted.length = 0;
    await flushSchool(A);
    expect(attempted).toHaveLength(0);
  });

  it('fails permanently at once on a wrong password or refused recipient, without blocking later mail', async () => {
    const id = await asAccount();
    behaviour = (s) => {
      if (s.msg.subject === 'bad login') throw Object.assign(new Error('535 nope'), { code: 'EAUTH', responseCode: 535 });
      if (s.msg.subject === 'bad rcpt') throw Object.assign(new Error('550 no user'), { code: 'EENVELOPE', responseCode: 550, command: 'RCPT TO' });
    };
    const q1 = await enqueueMail(A, { to: 'p@x.co', subject: 'bad login', text: 'x' });
    const q2 = await enqueueMail(A, { to: 'p@x.co', subject: 'bad rcpt', text: 'x' });
    const q3 = await enqueueMail(A, { to: 'p@x.co', subject: 'fine', text: 'x' });
    const stats = await flushSchool(A);
    expect(stats).toMatchObject({ sent: 1, failed: 2, retrying: 0 });
    expect((await bodyOf(dbA, q1.id))).toMatchObject({ status: 'error', attempts: 1 });
    expect((await bodyOf(dbA, q1.id)).lastError).toMatch(/username or password/i);
    expect((await bodyOf(dbA, q2.id)).lastError).toMatch(/refused the sender or recipient/i);
    expect((await bodyOf(dbA, q3.id)).status).toBe('sent');
    const acct = (await a('GET', '/settings/email/accounts')).body.data.find((x: any) => x.id === id);
    expect(acct.lastSendAt).toBeTruthy(); // the account's last send status is visible in settings
  });

  it('recovers rows stuck in "sending" for more than 10 minutes', async () => {
    await asAccount();
    const mk = async (subject: string, over: Partial<typeof emailQueue.$inferInsert>) => {
      const id = (await enqueueMail(A, { to: 'p@x.co', subject, text: 'x' })).id;
      await dbA.update(emailQueue).set(over).where(eq(emailQueue.id, id));
      return id;
    };
    // stuck for 11 minutes → back in the queue (one attempt used, retried after the backoff)
    const stuck = await mk('stuck', { status: 'sending', claimedAt: new Date(Date.now() - 11 * 60_000) });
    expect(await recoverStuck(dbA)).toBe(1);
    expect(await bodyOf(dbA, stuck)).toMatchObject({ status: 'not_sent', attempts: 1, claimedAt: null });
    expect((await bodyOf(dbA, stuck)).lastError).toMatch(/interrupted/i);
    // out of attempts → Error
    const last = await mk('last chance', { status: 'sending', claimedAt: new Date(Date.now() - 30 * 60_000), attempts: 2 });
    await recoverStuck(dbA);
    expect(await bodyOf(dbA, last)).toMatchObject({ status: 'error', attempts: 3 });
    // 5 minutes is still "in progress": the school's worker leaves it (and stays out of the way)
    await dbA.update(emailQueue).set({ nextAttemptAt: new Date(Date.now() - 1000) }).where(eq(emailQueue.id, stuck));
    const live = await mk('live', { status: 'sending', claimedAt: new Date(Date.now() - 5 * 60_000) });
    expect((await flushSchool(A)).busy).toBe(true);
    expect((await bodyOf(dbA, live)).status).toBe('sending');
    // a flush recovers by itself once the row is old enough
    await dbA.update(emailQueue).set({ claimedAt: new Date(Date.now() - 12 * 60_000) }).where(eq(emailQueue.id, live));
    await flushSchool(A);
    expect((await bodyOf(dbA, live)).status).toBe('not_sent');
  });

  it('honours the daily limit of an account and carries the rest to the next day', async () => {
    const limited = (await a('POST', '/settings/email/accounts', acctBody({ isDefaultOutgoing: true, dailyLimit: 2 }))).body.id as string;
    const free = (await a('POST', '/settings/email/accounts', acctBody({ name: 'No limit', emailAddress: 'free@school-a.test', smtpUsername: 'user-free' }))).body.id as string;
    for (let i = 0; i < 4; i++) await enqueueMail(A, { to: 'p@x.co', subject: `L${i}`, text: 'x' });
    await enqueueMail(A, { to: 'p@x.co', subject: 'F0', text: 'x', accountId: free });
    const stats = await flushSchool(A);
    expect(stats.sent).toBe(3); // L0, L1 and the unlimited account's F0
    expect(sent.map((s) => s.msg.subject).sort()).toEqual(['F0', 'L0', 'L1']);
    const rows = await queueRows(dbA);
    expect(rows.filter((r) => r.status === 'not_sent').map((r) => r.subject)).toEqual(['L2', 'L3']);
    expect(rows.filter((r) => r.status === 'not_sent').every((r) => r.attempts === 0 && !r.lastError)).toBe(true); // waiting, not failing
    expect((await a('GET', '/settings/email/accounts')).body.data.find((x: any) => x.id === limited)).toMatchObject({ sentToday: 2, dailyLimit: 2 });
    sent.length = 0;
    expect((await flushSchool(A)).sent).toBe(0); // still the same day
    // the next day the counter starts again
    await dbA.update(emailAccounts).set({ sentCountDay: '2000-01-01' }).where(eq(emailAccounts.id, limited));
    expect((await flushSchool(A)).sent).toBe(2);
    expect(sent.map((s) => s.msg.subject)).toEqual(['L2', 'L3']);
  });

  it('is driven by the scheduler: a 10-second job that sends what is due and idles otherwise', async () => {
    const job = ALL_JOBS.find((j) => j.name === 'email.send')!;
    expect(job).toMatchObject({ everySeconds: 10, selfLocking: true });
    expect(ALL_JOBS.find((j) => j.name === 'email.retention')).toBeTruthy();
    await asAccount();
    expect(await runJobOnce(A, job)).toBe(true);
    expect(sent).toHaveLength(0); // nothing queued: no work
    await enqueueMail(A, { to: 'p@x.co', subject: 'Via the scheduler', text: 'x' });
    await enqueueMail(A, { to: 'p@x.co', subject: 'Later', text: 'x' });
    await dbA.update(emailQueue).set({ nextAttemptAt: new Date(Date.now() + 3_600_000) }).where(eq(emailQueue.subject, 'Later'));
    await runJobOnce(A, job);
    expect(sent.map((s) => s.msg.subject)).toEqual(['Via the scheduler']); // the future one waits for its time
  });

  it('caps what one school sends per run so others are not starved', async () => {
    await asAccount();
    for (let i = 0; i < 7; i++) await enqueueMail(A, { to: 'p@x.co', subject: `m${i}`, text: 'x' });
    expect((await flushSchool(A, { limit: 3 })).sent).toBe(3);
    expect((await flushSchool(A, { limit: 3 })).sent).toBe(3);
    expect((await flushSchool(A, { limit: 3 })).sent).toBe(1);
  });

  it('retention deletes sent mail after 30 days and failed or cancelled mail after 90', async () => {
    const day = 86_400_000;
    const ids: Record<string, string> = {};
    for (const [key, status, ageDays] of [['sent31', 'sent', 31], ['sent29', 'sent', 29], ['err91', 'error', 91], ['err89', 'error', 89], ['can91', 'cancelled', 91], ['wait200', 'not_sent', 200]] as const) {
      const id = (await enqueueMail(A, { to: 'p@x.co', subject: key, text: 'x' })).id;
      ids[key] = id;
      const at = new Date(Date.now() - ageDays * day);
      await dbA.update(emailQueue).set({ status, sentAt: status === 'sent' ? at : null, updatedAt: at, createdAt: at }).where(eq(emailQueue.id, id));
    }
    expect(await purgeFinished(dbA)).toBe(3);
    const left = (await queueRows(dbA)).map((r) => r.subject).sort();
    expect(left).toEqual(['err89', 'sent29', 'wait200']);
    expect(await purgeFinished(dbA)).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('password reset and one-time messages', () => {
  afterEach(async () => {
    await clearAll(dbA);
    emailTestHooks.forceKick = undefined;
  });

  it('answers 202 without waiting for SMTP, then sends the link from the background and erases it', async () => {
    emailTestHooks.platformConfigured = true;
    emailTestHooks.forceKick = true;
    sendDelay = 1500; // a slow mail server
    const t0 = Date.now();
    const r = await call(CODE_A, 'POST', '/auth/forgot-password', null, { identifier: `admin@${CODE_A}.school` });
    const took = Date.now() - t0;
    expect(r.status).toBe(202);
    expect(took).toBeLessThan(1000);
    expect(sent).toHaveLength(0); // the request returned while the mail was still being delivered
    const [queued] = await queueRows(dbA);
    expect(queued).toMatchObject({ priority: 1, sensitive: true, referenceType: 'password_reset' });
    expect(queued!.textBody).toMatch(/^v1\./); // sealed at rest, not the reset link
    expect(queued!.textBody).not.toContain('reset-password');
    // visible to the admin as a row, but its body is never shown
    const detail = await a('GET', `/settings/email/queue/${queued!.id}`);
    expect(detail.body).toMatchObject({ bodyHidden: true, textBody: null, htmlBody: null, subject: expect.stringContaining('reset your password') });
    expect(detail.raw).not.toMatch(/token=/);
    // the background flush delivers it
    for (let i = 0; i < 60 && sent.length === 0; i++) await sleep(100);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.msg.text).toMatch(/reset-password\?site=.*&token=/);
    expect(sent[0]!.msg.to).toEqual([`admin@${CODE_A}.school`]);
    for (let i = 0; i < 30 && (await bodyOf(dbA, queued!.id)).status !== 'sent'; i++) await sleep(50);
    const done = await bodyOf(dbA, queued!.id);
    expect(done).toMatchObject({ status: 'sent', textBody: null, htmlBody: null }); // the link does not outlive the delivery
  });

  it('answers 202 for unknown accounts too, queueing nothing', async () => {
    const r = await call(CODE_A, 'POST', '/auth/forgot-password', null, { identifier: 'nobody-here' });
    expect(r.status).toBe(202);
    expect(await queueRows(dbA)).toHaveLength(0);
  });

  it('falls back to the platform sender when the school’s server is down, so nobody is locked out', async () => {
    emailTestHooks.platformConfigured = true;
    const id = (await a('POST', '/settings/email/accounts', acctBody({ isDefaultOutgoing: true }))).body.id;
    behaviour = (s) => {
      if (s.kind === 'account') throw Object.assign(new Error('timeout secret-banner'), { code: 'ETIMEDOUT' });
    };
    const reset = await enqueueMail(A, { to: 'user@x.co', subject: 'Reset', text: 'link', sendNow: true, sensitive: true, referenceType: 'password_reset' });
    const normal = await enqueueMail(A, { to: 'user@x.co', subject: 'Receipt', text: 'paid' });
    await flushSchool(A);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: 'platform' });
    expect(sent[0]!.msg.from.name).toBe('Green Valley Test');
    expect(await bodyOf(dbA, reset.id)).toMatchObject({ status: 'sent', sentVia: 'platform_fallback', priority: 1 });
    expect((await bodyOf(dbA, reset.id)).lastError).toMatch(/default sender instead/i);
    // ordinary mail is NOT silently redirected: it waits and retries
    expect(await bodyOf(dbA, normal.id)).toMatchObject({ status: 'not_sent', attempts: 1 });
    // and the failure is visible in the settings
    const acct = (await a('GET', '/settings/email/accounts')).body.data.find((x: any) => x.id === id);
    expect(acct.lastSendError).toMatch(/could not connect/i);
    expect(acct.lastSendError).not.toContain('secret-banner');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('queue admin API', () => {
  beforeAll(() => {
    emailTestHooks.forceKick = undefined;
  });
  afterEach(async () => {
    await clearAll(dbA);
  });

  const seedRows = async () => {
    await a('POST', '/settings/email/accounts', acctBody({ isDefaultOutgoing: true }));
    const mk = async (subject: string, status: 'not_sent' | 'sent' | 'error' | 'cancelled' | 'sending', extra: Partial<typeof emailQueue.$inferInsert> = {}) => {
      const id = (await enqueueMail(A, { to: `${subject.replace(/\W/g, '').toLowerCase()}@parents.example`, subject, text: `Body of ${subject}` })).id;
      await dbA.update(emailQueue).set({ status, ...extra }).where(eq(emailQueue.id, id));
      return id;
    };
    return {
      waiting: await mk('Waiting mail', 'not_sent'),
      done: await mk('Done mail', 'sent', { sentAt: new Date(), sentVia: 'account', messageId: '<m1@x>' }),
      failed: await mk('Failed mail', 'error', { attempts: 3, lastError: 'Could not connect to the mail server.' }),
      cancelled: await mk('Cancelled mail', 'cancelled'),
      sending: await mk('Sending mail', 'sending', { claimedAt: new Date() }),
    };
  };

  it('summarises, lists, filters and shows details', async () => {
    const ids = await seedRows();
    const sum = (await a('GET', '/settings/email/queue/summary')).body;
    expect(sum.counts).toEqual({ not_sent: 1, sending: 1, sent: 1, error: 1, cancelled: 1 });
    expect(sum.retention).toEqual({ sentDays: 30, failedDays: 90 });
    expect(sum.nextDueAt).toBeTruthy();
    const all = await a('GET', '/settings/email/queue');
    expect(all.body.meta.total).toBe(5);
    expect((await a('GET', '/settings/email/queue?status=error')).body.data.map((r: any) => r.subject)).toEqual(['Failed mail']);
    expect((await a('GET', '/settings/email/queue?q=waitingmail@parents')).body.data.map((r: any) => r.subject)).toEqual(['Waiting mail']);
    expect((await a('GET', '/settings/email/queue?q=done')).body.meta.total).toBe(1);
    expect((await a('GET', '/settings/email/queue?q=%25')).body.meta.total).toBe(0); // % is not a wildcard
    expect((await a('GET', '/settings/email/queue?accountId=platform')).body.meta.total).toBe(0);
    const today = todayIn(A.timezone); // the filter works in the school's own time zone
    expect((await a('GET', `/settings/email/queue?from=${today}&to=${today}`)).body.meta.total).toBe(5);
    expect((await a('GET', '/settings/email/queue?from=2000-01-01&to=2000-01-02')).body.meta.total).toBe(0);
    expect((await a('GET', '/settings/email/queue?pageSize=2&page=3')).body.data).toHaveLength(1);
    const d = (await a('GET', `/settings/email/queue/${ids.failed}`)).body;
    expect(d).toMatchObject({ status: 'error', attempts: 3, maxAttempts: 3, lastError: 'Could not connect to the mail server.', textBody: 'Body of Failed mail', bodyHidden: false, accountName: 'Office mailbox' });
    expect(d.sender).toContain('office@school-a.test');
    expect((await a('GET', `/settings/email/queue/${randomUuid()}`)).status).toBe(404);
  });

  it('send now, retry, cancel and delete follow the state rules and are audited', async () => {
    const ids = await seedRows();
    const state = async (id: string) => (await bodyOf(dbA, id)).status;
    // cancel only applies to Not Sent
    expect((await a('POST', `/settings/email/queue/${ids.waiting}/cancel`)).body.status).toBe('cancelled');
    expect((await a('POST', `/settings/email/queue/${ids.done}/cancel`)).status).toBe(409);
    expect((await a('POST', `/settings/email/queue/${ids.sending}/cancel`)).status).toBe(409);
    // retry: Error or Cancelled → Not Sent with fresh attempts, due now
    const retried = await a('POST', `/settings/email/queue/${ids.failed}/retry`);
    expect(retried.body).toMatchObject({ status: 'not_sent', attempts: 0, lastError: null });
    expect((await a('POST', `/settings/email/queue/${ids.done}/retry`)).status).toBe(409);
    expect((await a('POST', `/settings/email/queue/${ids.cancelled}/retry`)).body.status).toBe('not_sent');
    // send now: due immediately even if waiting out a backoff
    await dbA.update(emailQueue).set({ nextAttemptAt: new Date(Date.now() + 3_600_000) }).where(eq(emailQueue.id, ids.failed));
    const now = await a('POST', `/settings/email/queue/${ids.failed}/send-now`);
    expect(now.status).toBe(200);
    expect(new Date(now.body.nextAttemptAt).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    // delete: anything but a message being sent right now
    expect((await a('DELETE', `/settings/email/queue/${ids.sending}`)).status).toBe(409);
    expect((await a('DELETE', `/settings/email/queue/${ids.done}`)).status).toBe(200);
    expect(await state(ids.waiting)).toBe('cancelled');
    expect((await a('DELETE', `/settings/email/queue/${ids.done}`)).status).toBe(404);
    const acts = (await dbA.select({ action: auditLogs.action }).from(auditLogs).where(sql`${auditLogs.action} like 'email_queue.%'`)).map((x) => x.action);
    expect(new Set(acts)).toEqual(new Set(['email_queue.cancel', 'email_queue.retry', 'email_queue.send_now', 'email_queue.delete']));
  });

  it('bulk actions skip rows in the wrong state; flush makes waiting mail due; clear removes old finished mail', async () => {
    const ids = await seedRows();
    const bulk = await a('POST', '/settings/email/queue/bulk', { action: 'cancel', ids: [ids.waiting, ids.done, ids.failed, ids.sending] });
    expect(bulk.body).toEqual({ affected: 1, skipped: 3 });
    expect((await a('POST', '/settings/email/queue/bulk', { action: 'retry', ids: [ids.waiting, ids.failed, ids.cancelled] })).body).toEqual({ affected: 3, skipped: 0 });
    expect((await a('POST', '/settings/email/queue/bulk', { action: 'send_now', ids: [ids.done] })).body).toEqual({ affected: 0, skipped: 1 });
    expect((await a('POST', '/settings/email/queue/bulk', { action: 'cancel', ids: [] })).status).toBe(422);

    await dbA.update(emailQueue).set({ nextAttemptAt: new Date(Date.now() + 3_600_000) }).where(eq(emailQueue.status, 'not_sent'));
    const flushed = await a('POST', '/settings/email/queue/flush');
    expect(flushed.body).toEqual({ ok: true, due: 3 });
    expect((await queueRows(dbA)).filter((r) => r.status === 'not_sent').every((r) => r.nextAttemptAt.getTime() <= Date.now() + 1000)).toBe(true);

    // clear: finished rows older than N days of the chosen statuses
    const old = new Date(Date.now() - 40 * 86_400_000);
    await dbA.update(emailQueue).set({ sentAt: old, updatedAt: old }).where(eq(emailQueue.id, ids.done));
    expect((await a('POST', '/settings/email/queue/clear', { olderThanDays: 30, statuses: ['sent'] })).body).toEqual({ deleted: 1 });
    expect((await a('POST', '/settings/email/queue/clear', { olderThanDays: 30, statuses: ['sent', 'error', 'cancelled'] })).body).toEqual({ deleted: 0 }); // nothing else is old enough
    await dbA.update(emailQueue).set({ status: 'sent', sentAt: new Date() }).where(eq(emailQueue.id, ids.waiting));
    expect((await a('POST', '/settings/email/queue/clear', { olderThanDays: 0, statuses: ['sent'] })).body).toEqual({ deleted: 1 });
    expect((await a('POST', '/settings/email/queue/clear', { olderThanDays: 1, statuses: [] })).status).toBe(422);
    expect((await a('POST', '/settings/email/queue/flush', undefined, teacherA)).status).toBe(403);
  });

  it('keeps one-time message bodies out of the admin screen even when asked for directly', async () => {
    const q = await enqueueMail(A, { to: 'x@y.co', subject: 'Reset', text: 'https://x/reset?token=abc', html: '<p>token=abc</p>', sensitive: true });
    const d = await a('GET', `/settings/email/queue/${q.id}`);
    expect(d.body).toMatchObject({ bodyHidden: true, textBody: null, htmlBody: null });
    expect(d.raw).not.toContain('token=abc');
    expect((await a('GET', '/settings/email/queue')).raw).not.toContain('token=abc');
    // cancelling it erases the sealed body for good
    await a('POST', `/settings/email/queue/${q.id}/cancel`);
    const row = await bodyOf(dbA, q.id);
    expect(row).toMatchObject({ status: 'cancelled', textBody: null, htmlBody: null });
    expect((await a('POST', `/settings/email/queue/${q.id}/retry`)).status).toBe(409); // nothing left to send
  });

  it('writes no secret into any audit entry of this school', async () => {
    const dump = JSON.stringify(await dbA.select().from(auditLogs).where(sql`${auditLogs.entity} in ('email_account', 'email_queue')`));
    expect(dump).not.toMatch(/S3cret|N3w-Passw0rd|right-pass|wrong-pass/);
    expect(dump).not.toMatch(/"v1\.[\w-]+\.[\w-]+\.[\w-]+"/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('schema migration for existing schools', () => {
  it('a school created before this feature gets the email tables when it is migrated', async () => {
    const name = `sst_emailtestmig${tag}`.slice(0, 60);
    const real = fileURLToPath(new URL('../src/db/tenant/migrations', import.meta.url));
    const baselineOnly = mkdtempSync(join(tmpdir(), 'ss-mig-'));
    cpSync(real, baselineOnly, { recursive: true });
    const journalPath = join(baselineOnly, 'meta/_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { tag: string }[] };
    expect(journal.entries.map((e) => e.tag)).toContain('0001_email_accounts_queue');
    writeFileSync(journalPath, JSON.stringify({ ...journal, entries: journal.entries.slice(0, 1) }));
    unlinkSync(join(baselineOnly, '0001_email_accounts_queue.sql'));

    await withAdminClient((c) => c.query(`create database "${name}" encoding 'UTF8'`));
    const client = directClient(name);
    try {
      await client.connect();
      const db = drizzle(client);
      await migrate(db, { migrationsFolder: baselineOnly }); // the school as it was
      const tables = async () => (await client.query<{ table_name: string }>(`select table_name from information_schema.tables where table_schema = 'public' and table_name like 'email_%'`)).rows.map((r) => r.table_name).sort();
      expect(await tables()).toEqual([]);
      await migrate(db, { migrationsFolder: real }); // `site:migrate`
      expect(await tables()).toEqual(['email_accounts', 'email_queue']);
      const idx = (await client.query<{ indexname: string; indexdef: string }>(`select indexname, indexdef from pg_indexes where tablename in ('email_accounts', 'email_queue')`)).rows;
      expect(idx.find((i) => i.indexname === 'email_accounts_default_uq')!.indexdef).toMatch(/WHERE/i); // one default account per school
      expect(idx.find((i) => i.indexname === 'email_queue_one_sending_uq')!.indexdef).toMatch(/sending/); // one message in flight per school
      await migrate(db, { migrationsFolder: real }); // re-running is harmless
    } finally {
      await client.end().catch(() => undefined);
      await withAdminClient((c) => c.query(`drop database if exists "${name}" with (force)`));
      rmSync(baselineOnly, { recursive: true, force: true });
    }
  });
});

function randomUuid() {
  return '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
}
