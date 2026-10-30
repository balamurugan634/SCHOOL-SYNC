import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../src/config';
import { runJobOnce } from '../src/core/jobs';
import { openCredentials } from '../src/core/online-meetings/secret';
import { eventWindow, instantToZoned, meetingWindow, zonedToInstant } from '../src/core/online-meetings/schedule';
import { jobs as onlineJobs } from '../src/core/online-meetings/jobs';
import { syncOnline } from '../src/core/online-meetings';
import { clearGoogleTokens } from '../src/core/online-meetings/google';
import { clearZoomTokens } from '../src/core/online-meetings/zoom';
import { onlineMeetingTuning } from '../src/core/online-meetings/tuning';
import { controlDb } from '../src/core/tenancy/control-db';
import { invalidateTenant } from '../src/core/tenancy/registry';
import { tenants } from '../src/db/control/schema';
import { auditLogs, events, meetingIntegrations, meetings, onlineMeetingCleanup } from '../src/db/tenant/schema';
import { createTestSchool, type TestSchool } from './helpers';
import { guardianOf, studentsIn } from './upload-helpers';
import { startStubGoogle, startStubZoom, type StubCall, type StubGoogle, type StubZoom } from './stub-meetings';

// ── fixtures ─────────────────────────────────────────────────────────────────────────────────────

let s: TestSchool; // school A, Asia/Kolkata
let b: TestSchool; // school B, America/New_York (set below)
let zoom: StubZoom;
let google: StubGoogle;
const tokens: Record<string, string> = {};
/** every response body, by who received it (for the "no secret ever leaves the API" checks) */
const seen: { who: string; path: string; text: string }[] = [];

const ZOOM_CREDS = { accountId: 'acct-1', clientId: 'cid-1', clientSecret: 'csec-1', hostEmail: 'host@school.test', enabled: true };
const DAY = 86_400_000;
const ymd = (n: number) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);

const tok = async (sch: TestSchool, who: string) => (tokens[`${sch.tenant.code}:${who}`] ??= await sch.login(who));
const call = async (sch: TestSchool, who: string | null, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown) => {
  const r = await sch.req(method, path, who ? await tok(sch, who) : null, body);
  seen.push({ who: who ?? 'anon', path, text: JSON.stringify(r.body) });
  return r;
};
const a = (who: string | null, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown) => call(s, who, method, path, body);
const ADMIN = 'admin@test.school';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const zoomApi = (c: StubCall) => c.path.startsWith('/v2/');
const zoomCreate = (c: StubCall) => c.method === 'POST' && /\/v2\/users\/[^/]+\/meetings$/.test(c.path);
const zoomDelete = (c: StubCall) => c.method === 'DELETE' && c.path.startsWith('/v2/meetings/');
const gCreate = (c: StubCall) => c.method === 'POST' && c.path.endsWith('/calendars/primary/events');
const gDelete = (c: StubCall) => c.method === 'DELETE' && c.path.includes('/calendars/primary/events/');
const dbEvent = async (id: string) => (await s.db.select().from(events).where(eq(events.id, id)))[0]!;
const dbMeeting = async (id: string) => (await s.db.select().from(meetings).where(eq(meetings.id, id)))[0]!;
const runJob = () => runJobOnce(s.tenant, onlineJobs[0]!);
/** move earlier connection tests out of the one-hour window of the rate limit */
const forgetTests = () => s.db.execute(sql`update audit_logs set at = at - interval '2 hours' where action = 'meeting_integration.test'`);
/** keep a failed event out of the background job's reach (older than the one-day retry window) */
const park = (id: string) => s.db.update(events).set({ onlineFailedAt: new Date(Date.now() - 3 * DAY) }).where(eq(events.id, id));

const connectZoom = (over: Record<string, unknown> = {}) => a(ADMIN, 'PUT', '/settings/meetings/zoom', { ...ZOOM_CREDS, ...over });
const connectGoogle = (over: Record<string, unknown> = {}) => a(ADMIN, 'PUT', '/settings/meetings/google', { serviceAccountJson: google.keyFile(), organizerEmail: 'office@school.test', enabled: true, ...over });

const evBody = (over: Record<string, unknown> = {}) => ({ title: 'Science fair', startDate: ymd(12), startTime: '10:00', endTime: '11:30', allDay: false, audience: [{ type: 'all' }], onlineMeeting: { provider: 'zoom' }, publish: true, ...over });
const mkEvent = async (over: Record<string, unknown> = {}, who = 'principal') => {
  const r = await a(who, 'POST', '/events', evBody(over));
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body as any;
};

beforeAll(async () => {
  zoom = await startStubZoom();
  google = await startStubGoogle();
  Object.assign(config, { ZOOM_OAUTH_BASE: zoom.oauthBase, ZOOM_API_BASE: zoom.apiBase, GOOGLE_TOKEN_URL: google.tokenUrl, GOOGLE_CALENDAR_BASE: google.calendarBase });
  Object.assign(onlineMeetingTuning, { timeoutMs: 700, pollDelayMs: 10, pollTries: 5 });
  s = await createTestSchool();
  b = await createTestSchool();
});

afterAll(async () => {
  await zoom?.close();
  await google?.close();
});

beforeEach(() => {
  zoom.calls.length = 0;
  google.calls.length = 0;
  zoom.heal();
  google.heal();
  google.pendingPolls = 0;
  google.delegationAllowed = true;
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('school time → provider time (Asia/Kolkata has no DST; America/New_York does)', () => {
  it('converts an instant to the school’s wall clock', () => {
    expect(instantToZoned(new Date('2027-06-15T04:30:00Z'), 'Asia/Kolkata')).toEqual({ date: '2027-06-15', time: '10:00:00' });
    expect(instantToZoned(new Date('2027-06-15T20:00:00Z'), 'Asia/Kolkata')).toEqual({ date: '2027-06-16', time: '01:30:00' }); // crosses midnight
    // 10:00 in New York is 15:00 UTC in winter (EST) and 14:00 UTC in summer (EDT)
    expect(instantToZoned(new Date('2027-03-13T15:00:00Z'), 'America/New_York').time).toBe('10:00:00');
    expect(instantToZoned(new Date('2027-03-15T14:00:00Z'), 'America/New_York').time).toBe('10:00:00');
  });

  it('converts a local date + time to the instant, on both sides of the clock change', () => {
    expect(zonedToInstant('2027-06-15', '10:00', 'Asia/Kolkata').toISOString()).toBe('2027-06-15T04:30:00.000Z');
    expect(zonedToInstant('2027-03-13', '10:00', 'America/New_York').toISOString()).toBe('2027-03-13T15:00:00.000Z');
    expect(zonedToInstant('2027-03-15', '10:00:00', 'America/New_York').toISOString()).toBe('2027-03-15T14:00:00.000Z');
    expect(zonedToInstant('2027-11-08', '10:00', 'America/New_York').toISOString()).toBe('2027-11-08T15:00:00.000Z');
  });

  it('uses real elapsed minutes for the duration, also across the clock change', () => {
    const day = (startDate: string, startTime: string, endTime: string) => ({ startDate, endDate: startDate, startTime, endTime, allDay: false });
    expect(eventWindow(day('2027-06-15', '10:00', '11:30'), 'Asia/Kolkata')).toEqual({ startLocal: '2027-06-15T10:00:00', endLocal: '2027-06-15T11:30:00', durationMin: 90 });
    // spring forward (02:00 → 03:00 on 14 March 2027): 01:00–04:00 on the clock is only two hours
    expect(eventWindow(day('2027-03-14', '01:00', '04:00'), 'America/New_York')?.durationMin).toBe(120);
    // fall back (02:00 → 01:00 on 7 November 2027): 00:30–03:30 on the clock is four hours
    expect(eventWindow(day('2027-11-07', '00:30', '03:30'), 'America/New_York')?.durationMin).toBe(240);
    expect(eventWindow(day('2027-03-16', '10:00', '11:00'), 'America/New_York')?.durationMin).toBe(60);
    // a meeting that starts at 01:30 EST (06:30 UTC) and lasts 60 real minutes ends at 03:30 EDT: the clock skips an hour
    expect(meetingWindow(new Date('2027-03-14T06:30:00Z'), 60, 'America/New_York')).toEqual({ startLocal: '2027-03-14T01:30:00', endLocal: '2027-03-14T03:30:00', durationMin: 60 });
  });

  it('refuses windows that are not one timed day', () => {
    expect(eventWindow({ startDate: '2027-06-15', endDate: '2027-06-15', startTime: null, endTime: null, allDay: true }, 'Asia/Kolkata')).toBeNull();
    expect(eventWindow({ startDate: '2027-06-15', endDate: '2027-06-16', startTime: '10:00', endTime: '11:00', allDay: false }, 'Asia/Kolkata')).toBeNull();
    expect(eventWindow({ startDate: '2027-06-15', endDate: '2027-06-15', startTime: '10:00', endTime: null, allDay: false }, 'Asia/Kolkata')).toBeNull();
    expect(eventWindow({ startDate: '2027-06-15', endDate: '2027-06-15', startTime: '11:00', endTime: '10:00', allDay: false }, 'Asia/Kolkata')).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('settings: who may connect, and what is stored', () => {
  it('only school administrators with settings rights can read or change the connections', async () => {
    for (const who of ['principal', 't001', 'accounts', 'hr', s.ctx.students[0]!.username]) {
      expect((await a(who, 'GET', '/settings/meetings')).status, who).toBe(403);
      expect((await a(who, 'PUT', '/settings/meetings/zoom', ZOOM_CREDS)).status, who).toBe(403);
      expect((await a(who, 'PUT', '/settings/meetings/default', { provider: 'zoom' })).status, who).toBe(403);
      expect((await a(who, 'POST', '/settings/meetings/zoom/test')).status, who).toBe(403);
      expect((await a(who, 'DELETE', '/settings/meetings/zoom')).status, who).toBe(403);
    }
    expect((await a(null, 'GET', '/settings/meetings')).status).toBe(401);
    const r = await a(ADMIN, 'GET', '/settings/meetings');
    expect(r.status).toBe(200);
    expect(r.body.providers.map((p: any) => [p.provider, p.state, p.connected])).toEqual([['zoom', 'not_connected', false], ['google', 'not_connected', false]]);
    expect(r.body.defaultProvider).toBeNull();
  });

  it('validates Zoom input and asks for the secret the first time', async () => {
    expect((await connectZoom({ clientSecret: '' })).body.code).toBe('CLIENT_SECRET_REQUIRED');
    expect((await connectZoom({ accountId: 'has spaces & symbols' })).status).toBe(422);
    expect((await connectZoom({ clientId: '' })).status).toBe(422);
    expect((await connectZoom({ hostEmail: 'not an email' })).status).toBe(422);
    expect((await a(ADMIN, 'POST', '/settings/meetings/zoom/test')).status).toBe(409); // nothing saved yet
  });

  it('connects Zoom: the secret is write-only, sealed per school and bound to its row', async () => {
    const r = await connectZoom();
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const z = r.body.providers.find((p: any) => p.provider === 'zoom');
    expect(z).toMatchObject({ connected: true, enabled: true, state: 'connected', secretSet: true, accountId: 'acct-1', clientId: 'cid-1', hostEmail: 'host@school.test', isDefault: true });
    expect(r.body.defaultProvider).toBe('zoom'); // the first provider connected becomes the default
    expect(JSON.stringify(r.body)).not.toContain('csec-1');

    const [row] = await s.db.select().from(meetingIntegrations).where(eq(meetingIntegrations.provider, 'zoom'));
    expect(row!.credentialsEnc).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(row!.credentialsEnc).not.toContain('csec-1');
    expect(JSON.stringify(row!.settings)).not.toContain('csec-1');
    expect(JSON.parse(openCredentials(row!.credentialsEnc!, s.tenant.id, row!.id))).toMatchObject({ clientSecret: 'csec-1' });
    // another school's key, or another row id, cannot open it
    expect(() => openCredentials(row!.credentialsEnc!, b.tenant.id, row!.id)).toThrow();
    expect(() => openCredentials(row!.credentialsEnc!, s.tenant.id, 'some-other-row')).toThrow();
  });

  it('keeps the secret when it is left empty, re-seals when it changes, and forgets the old test result', async () => {
    const [before] = await s.db.select().from(meetingIntegrations).where(eq(meetingIntegrations.provider, 'zoom'));
    const same = await connectZoom({ clientSecret: '', hostEmail: 'host@school.test' });
    expect(same.status).toBe(200);
    const [kept] = await s.db.select().from(meetingIntegrations).where(eq(meetingIntegrations.provider, 'zoom'));
    expect(kept!.credentialsEnc).toBe(before!.credentialsEnc); // untouched

    expect((await a(ADMIN, 'POST', '/settings/meetings/zoom/test')).body.ok).toBe(true);
    expect((await a(ADMIN, 'GET', '/settings/meetings')).body.providers[0].lastTestOk).toBe(true);
    const host = await connectZoom({ clientSecret: '', hostEmail: 'other@school.test' });
    expect(host.body.providers[0]).toMatchObject({ hostEmail: 'other@school.test', lastTestOk: null, lastTestAt: null });
    await connectZoom({ clientSecret: '', hostEmail: 'host@school.test' });
    const replaced = await connectZoom({ clientSecret: 'csec-1' }); // same secret again: still a "replace" request
    expect(replaced.status).toBe(200);
  });

  it('validates the Google key file before storing it, and never returns it', async () => {
    const bad = async (json: string) => {
      const r = await connectGoogle({ serviceAccountJson: json });
      expect(r.status, json.slice(0, 40)).toBe(422);
      expect(r.body.code).toBe('SERVICE_ACCOUNT_INVALID');
      return r;
    };
    await bad('not json');
    await bad(JSON.stringify({ type: 'authorized_user', client_email: 'x@y.z' }));
    await bad(google.keyFile({ client_email: undefined }));
    await bad(google.keyFile({ private_key: undefined }));
    await bad(google.keyFile({ private_key: '-----BEGIN PRIVATE KEY-----\nnot-a-key\n-----END PRIVATE KEY-----\n' }));
    expect((await connectGoogle({ serviceAccountJson: '' })).body.code).toBe('SERVICE_ACCOUNT_REQUIRED');
    expect((await connectGoogle({ organizerEmail: 'nope' })).status).toBe(422);

    const ok = await connectGoogle();
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const g = ok.body.providers.find((p: any) => p.provider === 'google');
    expect(g).toMatchObject({ connected: true, enabled: true, secretSet: true, organizerEmail: 'office@school.test', serviceAccountEmail: google.clientEmail, serviceAccountClientId: google.clientId, isDefault: false });
    expect(ok.body.defaultProvider).toBe('zoom'); // connecting a second provider leaves the default alone
    expect(JSON.stringify(ok.body)).not.toMatch(/PRIVATE KEY|kid-1/);
    const [row] = await s.db.select().from(meetingIntegrations).where(eq(meetingIntegrations.provider, 'google'));
    expect(row!.credentialsEnc).not.toMatch(/PRIVATE KEY/);
    expect(JSON.stringify(row!.settings)).not.toMatch(/PRIVATE KEY/);
    // only what is used is kept: the key file's own token_uri is dropped
    expect(openCredentials(row!.credentialsEnc!, s.tenant.id, row!.id)).not.toContain('token_uri');
    // a later save without the key keeps it
    const keep = await connectGoogle({ serviceAccountJson: '', organizerEmail: 'office@school.test' });
    expect(keep.body.providers[1].secretSet).toBe(true);
  });

  it('the default provider follows the rules', async () => {
    expect((await a(ADMIN, 'PUT', '/settings/meetings/default', { provider: 'google' })).body.defaultProvider).toBe('google');
    expect((await a(ADMIN, 'PUT', '/settings/meetings/default', { provider: 'bing' })).status).toBe(422);
    // switching the default provider off hands the default to the other usable one
    const off = await connectGoogle({ serviceAccountJson: '', enabled: false });
    expect(off.body.defaultProvider).toBe('zoom');
    expect(off.body.providers[1]).toMatchObject({ enabled: false, connected: true, isDefault: false });
    expect((await a(ADMIN, 'PUT', '/settings/meetings/default', { provider: 'google' })).status).toBe(409); // switched off
    await connectGoogle({ serviceAccountJson: '', enabled: true });
    // disconnecting the default moves it; disconnecting the last one leaves none
    expect((await a(ADMIN, 'PUT', '/settings/meetings/default', { provider: 'zoom' })).body.defaultProvider).toBe('zoom');
    const gone = await a(ADMIN, 'DELETE', '/settings/meetings/zoom');
    expect(gone.body.defaultProvider).toBe('google');
    expect(gone.body.providers[0]).toMatchObject({ connected: false, secretSet: false, state: 'not_connected' });
    expect((await a(ADMIN, 'PUT', '/settings/meetings/default', { provider: 'zoom' })).status).toBe(409); // not connected
    expect((await a(ADMIN, 'DELETE', '/settings/meetings/zoom')).status).toBe(404);
    expect((await a(ADMIN, 'DELETE', '/settings/meetings/google')).body.defaultProvider).toBeNull();
    // back to a known state for the rest of the file
    await connectZoom();
    await connectGoogle();
    expect((await a(ADMIN, 'GET', '/settings/meetings')).body.defaultProvider).toBe('zoom');
  });

  it('tests the connection without creating anything, and says why it failed in plain words', async () => {
    await forgetTests();
    zoom.calls.length = 0;
    const ok = await a(ADMIN, 'POST', '/settings/meetings/zoom/test');
    expect(ok.body).toMatchObject({ ok: true, error: null });
    expect(ok.body.detail).toMatch(/Nothing was created/);
    expect(zoom.calls.filter(zoomApi).map((c) => `${c.method} ${c.path}`)).toEqual(['GET /v2/users/host%40school.test']);
    expect(zoom.meetings.size).toBe(0);

    const g = await a(ADMIN, 'POST', '/settings/meetings/google/test');
    expect(g.body).toMatchObject({ ok: true, error: null });
    expect(google.calls.filter((c) => c.path.startsWith('/calendar/')).map((c) => `${c.method} ${c.path} ${c.query.get('maxResults')}`)).toEqual(['GET /calendar/v3/calendars/primary/events 1']);
    expect(google.events.size).toBe(0);
    // the signed request names the organizer, asks only for the calendar.events scope and is RS256
    expect(google.claims.at(-1)).toMatchObject({ iss: google.clientEmail, sub: 'office@school.test', scope: 'https://www.googleapis.com/auth/calendar.events', aud: google.tokenUrl, alg: 'RS256', kid: 'kid-1' });

    // wrong Zoom secret
    await connectZoom({ clientSecret: 'wrong-secret' });
    clearZoomTokens();
    const bad = await a(ADMIN, 'POST', '/settings/meetings/zoom/test');
    expect(bad.body).toMatchObject({ ok: false, error: 'Zoom did not accept the saved credentials. Check them in Settings → Online meetings.' });
    expect((await a(ADMIN, 'GET', '/settings/meetings')).body.providers[0]).toMatchObject({ state: 'error', lastTestOk: false });
    await connectZoom();
    clearZoomTokens();

    // Google: the Workspace admin has not authorised the service account
    google.delegationAllowed = false;
    clearGoogleTokens();
    const nope = await a(ADMIN, 'POST', '/settings/meetings/google/test');
    expect(nope.body.ok).toBe(false);
    expect(nope.body.error).toMatch(/Workspace admin must allow the service account/);
    expect(JSON.stringify(nope.body)).not.toContain('SENTINEL');
    google.delegationAllowed = true;
    // wrong organizer
    await connectGoogle({ serviceAccountJson: '', organizerEmail: 'stranger@school.test' });
    clearGoogleTokens();
    expect((await a(ADMIN, 'POST', '/settings/meetings/google/test')).body.error).toMatch(/did not accept the saved credentials/);
    await connectGoogle({ serviceAccountJson: '', organizerEmail: 'office@school.test' });
    clearGoogleTokens();
  });

  it('limits connection tests to 5 per hour per school (counted from the audit log)', async () => {
    await forgetTests();
    for (let i = 0; i < 5; i++) expect((await a(ADMIN, 'POST', '/settings/meetings/zoom/test')).status).toBe(200);
    const sixth = await a(ADMIN, 'POST', '/settings/meetings/zoom/test');
    expect(sixth.status).toBe(429);
    // the counter is per school
    await connectZoomIn(b);
    expect((await call(b, ADMIN, 'POST', '/settings/meetings/zoom/test')).status).toBe(200);
  });

  it('writes an audit entry for every change, never containing a secret', async () => {
    const rows = await s.db.select().from(auditLogs).where(sql`${auditLogs.action} like 'meeting_integration.%'`);
    const actions = new Set(rows.map((r) => r.action));
    for (const x of ['meeting_integration.connect', 'meeting_integration.update', 'meeting_integration.disconnect', 'meeting_integration.set_default', 'meeting_integration.test']) expect(actions.has(x), x).toBe(true);
    const text = JSON.stringify(rows.map((r) => [r.summary, r.before, r.after]));
    expect(text).not.toMatch(/csec-1|wrong-secret|PRIVATE KEY|kid-1|MIIE|acct-1|cid-1/);
    expect(rows.find((r) => r.action === 'meeting_integration.connect')?.after).toMatchObject({ credentialsSaved: true });
  });
});

async function connectZoomIn(sch: TestSchool) {
  return call(sch, ADMIN, 'PUT', '/settings/meetings/zoom', ZOOM_CREDS);
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('events: create on publish, update, cancel, delete', () => {
  it('refuses an online meeting that cannot work, with a clear reason', async () => {
    const allDay = await a('principal', 'POST', '/events', evBody({ allDay: true, startTime: null, endTime: null }));
    expect(allDay.status).toBe(422);
    expect(allDay.body.code).toBe('ONLINE_MEETING_NEEDS_TIME');
    expect(allDay.body.title).toMatch(/start time and an end time/);
    expect(allDay.body.field).toBe('onlineMeeting');
    expect((await a('principal', 'POST', '/events', evBody({ endTime: null }))).body.code).toBe('ONLINE_MEETING_NEEDS_TIME');
    const multi = await a('principal', 'POST', '/events', evBody({ endDate: ymd(13) }));
    expect(multi.status).toBe(422);
    expect(multi.body.code).toBe('ONLINE_MEETING_MULTI_DAY');
    expect((await a('principal', 'POST', '/events', evBody({ endTime: '09:00' }))).status).toBe(422); // ends before it starts
    // a provider that is switched off (or not connected) cannot be chosen
    await connectGoogle({ serviceAccountJson: '', enabled: false });
    const off = await a('principal', 'POST', '/events', evBody({ onlineMeeting: { provider: 'google' } }));
    expect(off.status).toBe(422);
    expect(off.body.code).toBe('ONLINE_PROVIDER_NOT_CONNECTED');
    await connectGoogle({ serviceAccountJson: '', enabled: true });
    expect((await a('principal', 'POST', '/events', evBody({ onlineMeeting: { provider: 'teams' } }))).status).toBe(422);
    // no provider calls were made for any of these
    expect(zoom.calls.filter(zoomApi)).toHaveLength(0);
    // no change to an event without an online meeting: all-day events stay as they were
    const plain = await a('principal', 'POST', '/events', evBody({ allDay: true, startTime: null, endTime: null, onlineMeeting: null }));
    expect(plain.status).toBe(201);
    expect(plain.body.onlineMeeting).toBeNull();
    expect(plain.body.onlineProvider).toBeNull();
  });

  it('the event form is offered only the providers that are connected and switched on', async () => {
    const parent = guardianOf(s.ctx, s.ctx.students[0]!).username;
    expect((await a(parent, 'GET', '/events/online-providers')).status).toBe(403);
    expect((await a(s.ctx.students[0]!.username, 'GET', '/events/online-providers')).status).toBe(403);
    expect((await a(null, 'GET', '/events/online-providers')).status).toBe(401);
    for (const who of ['principal', 't001', ADMIN]) expect((await a(who, 'GET', '/events/online-providers')).body, who).toEqual({ providers: ['zoom', 'google'], defaultProvider: 'zoom' });
    await connectGoogle({ serviceAccountJson: '', enabled: false });
    expect((await a('principal', 'GET', '/events/online-providers')).body).toEqual({ providers: ['zoom'], defaultProvider: 'zoom' });
    await connectGoogle({ serviceAccountJson: '', enabled: true });
    // the answer is per school
    expect((await call(b, 'principal', 'GET', '/events/online-providers')).body).toEqual({ providers: ['zoom'], defaultProvider: 'zoom' }); // B connected Zoom above
  });

  it('a draft creates nothing; publishing creates the meeting for that day and time', async () => {
    const draft = await mkEvent({ publish: false });
    expect(draft.status).toBe('draft');
    expect(draft.onlineMeeting).toBeNull(); // nothing exists yet
    expect(draft.onlineProvider).toBe('zoom'); // but the choice is remembered for the form
    expect(zoom.calls.filter(zoomApi)).toHaveLength(0);
    expect(zoom.meetings.size).toBe(0);
    // editing the draft still creates nothing
    await a('principal', 'PATCH', `/events/${draft.id}`, { title: 'Science fair (draft edit)' });
    expect(zoom.calls.filter(zoomApi)).toHaveLength(0);

    const pub = await a('principal', 'POST', `/events/${draft.id}/publish`);
    expect(pub.status).toBe(200);
    expect(pub.body.onlineMeeting).toMatchObject({ provider: 'zoom', status: 'scheduled', passcode: '123456' });
    expect(pub.body.onlineMeeting.joinUrl).toMatch(/^https:\/\/zoom\.example\/j\/\d+/);
    expect(pub.body.onlineMeeting.startUrl).toContain('zak=HOSTSECRET'); // the editor gets the host link

    const created = zoom.calls.filter(zoomCreate);
    expect(created).toHaveLength(1);
    expect(created[0]!.path).toBe('/v2/users/host%40school.test/meetings');
    expect(created[0]!.body).toMatchObject({ topic: 'Science fair (draft edit)', type: 2, start_time: `${ymd(12)}T10:00:00`, timezone: 'Asia/Kolkata', duration: 90, settings: { join_before_host: false, waiting_room: true } });

    // the audience sees the join link and passcode, but never the host link
    const parentName = guardianOf(s.ctx, s.ctx.students[0]!).username;
    for (const who of [parentName, s.ctx.students[0]!.username]) {
      const seenBy = await a(who, 'GET', `/events/${draft.id}`);
      expect(seenBy.status, who).toBe(200);
      expect(seenBy.body.onlineMeeting).toEqual({ provider: 'zoom', status: 'scheduled', joinUrl: pub.body.onlineMeeting.joinUrl, passcode: '123456' });
      expect('startUrl' in seenBy.body.onlineMeeting).toBe(false);
    }
    // a teacher who may not edit this event does not get it either
    expect('startUrl' in (await a('t001', 'GET', `/events/${draft.id}`)).body.onlineMeeting).toBe(false);
    // the list items and the calendar carry it too
    const list = await a(parentName, 'GET', `/events?from=${ymd(11)}&to=${ymd(13)}`);
    expect(list.body.data.find((e: any) => e.id === draft.id).onlineMeeting.joinUrl).toBe(pub.body.onlineMeeting.joinUrl);
    const cal = await a(parentName, 'GET', `/calendar?from=${ymd(11)}&to=${ymd(13)}`);
    expect(cal.body.data.find((i: any) => i.entityId === draft.id).joinUrl).toBe(pub.body.onlineMeeting.joinUrl);
    // the host link is sealed in the database
    const row = await dbEvent(draft.id);
    expect(row.onlineStartUrlEnc).toMatch(/^v1\./);
    expect(row.onlineStartUrlEnc).not.toContain('HOSTSECRET');
    expect(row).toMatchObject({ onlineStatus: 'scheduled', onlineRemoteProvider: 'zoom', onlineError: null });
  });

  it('creating with publish: true creates the meeting at once', async () => {
    const ev = await mkEvent();
    expect(ev.onlineMeeting.status).toBe('scheduled');
    expect(zoom.calls.filter(zoomCreate)).toHaveLength(1);
  });

  it('keeps one token for many calls, and fetches a new one when Zoom drops it', async () => {
    clearZoomTokens();
    zoom.calls.length = 0;
    const t0 = zoom.tokenCalls;
    await mkEvent({ title: 'Token A' });
    await mkEvent({ title: 'Token B' });
    expect(zoom.tokenCalls - t0).toBe(1);
    expect(zoom.calls[0]!.path).toBe('/oauth/token'); // account credentials grant, Basic auth, account id in the query
    expect(zoom.calls[0]!.query.get('grant_type')).toBe('account_credentials');
    expect(zoom.calls[0]!.query.get('account_id')).toBe('acct-1');
    expect(zoom.calls[0]!.headers.authorization).toBe(`Basic ${Buffer.from('cid-1:csec-1').toString('base64')}`);
    // Zoom forgets the token (revoked / expired early): one 401, one new token, the call goes through
    zoom.tokens.clear();
    const ev = await mkEvent({ title: 'Token C' });
    expect(ev.onlineMeeting.status).toBe('scheduled');
    expect(zoom.tokenCalls - t0).toBe(2);
  });

  it('updates the provider meeting when the title, day or time change, and only then', async () => {
    const ev = await mkEvent();
    const meetingId = (await dbEvent(ev.id)).onlineMeetingId!;
    zoom.calls.length = 0;
    const moved = await a('principal', 'PATCH', `/events/${ev.id}`, { title: 'Science fair 2027', startDate: ymd(14), startTime: '11:00', endTime: '12:00' });
    expect(moved.status).toBe(200);
    const patches = zoom.calls.filter((c) => c.method === 'PATCH');
    expect(patches).toHaveLength(1);
    expect(patches[0]!.path).toBe(`/v2/meetings/${meetingId}`);
    expect(patches[0]!.body).toMatchObject({ topic: 'Science fair 2027', start_time: `${ymd(14)}T11:00:00`, timezone: 'Asia/Kolkata', duration: 60 });
    expect(moved.body.onlineMeeting.joinUrl).toBe(ev.onlineMeeting.joinUrl); // same room
    expect(zoom.calls.filter(zoomCreate)).toHaveLength(0);

    zoom.calls.length = 0;
    await a('principal', 'PATCH', `/events/${ev.id}`, { registrationRequired: true }); // not part of the meeting
    expect(zoom.calls.filter(zoomApi)).toHaveLength(0);
    await a('principal', 'PATCH', `/events/${ev.id}`, { location: 'Main hall' }); // shown in the meeting agenda
    expect(zoom.calls.filter((c) => c.method === 'PATCH')).toHaveLength(1);
    expect(zoom.meetings.get(meetingId)!.body.agenda).toContain('Main hall');
  });

  it('refuses to turn a meeting event into an all-day or multi-day one while the online option is on', async () => {
    const ev = await mkEvent();
    const zid = (await dbEvent(ev.id)).onlineMeetingId!;
    const r = await a('principal', 'PATCH', `/events/${ev.id}`, { endDate: ymd(13) });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('ONLINE_MEETING_MULTI_DAY');
    expect((await a('principal', 'PATCH', `/events/${ev.id}`, { allDay: true, startTime: null, endTime: null })).body.code).toBe('ONLINE_MEETING_NEEDS_TIME');
    // switching the online option off in the same save is fine, and removes the meeting
    zoom.calls.length = 0;
    const ok = await a('principal', 'PATCH', `/events/${ev.id}`, { endDate: ymd(13), onlineMeeting: null });
    expect(ok.status).toBe(200);
    expect(ok.body.onlineMeeting).toBeNull();
    expect(ok.body.onlineProvider).toBeNull();
    expect(zoom.calls.filter(zoomDelete)).toHaveLength(1);
    expect(zoom.meetings.has(zid)).toBe(false);
  });

  it('switching the online option off cancels the meeting; switching provider moves it', async () => {
    const ev = await mkEvent();
    const zid = (await dbEvent(ev.id)).onlineMeetingId!;
    zoom.calls.length = 0;
    const g = await a('principal', 'PATCH', `/events/${ev.id}`, { onlineMeeting: { provider: 'google' } });
    expect(g.status).toBe(200);
    expect(g.body.onlineMeeting).toMatchObject({ provider: 'google', status: 'scheduled' });
    expect(g.body.onlineMeeting.joinUrl).toMatch(/^https:\/\/meet\.google\.com\//);
    expect(zoom.calls.filter(zoomDelete).map((c) => c.path)).toEqual([`/v2/meetings/${zid}`]);
    expect(zoom.meetings.has(zid)).toBe(false);
    const made = google.calls.filter(gCreate);
    expect(made).toHaveLength(1);
    expect(made[0]!.query.get('conferenceDataVersion')).toBe('1');
    expect(made[0]!.query.get('sendUpdates')).toBe('none');
    expect(made[0]!.body).toMatchObject({ summary: 'Science fair', start: { dateTime: `${ymd(12)}T10:00:00`, timeZone: 'Asia/Kolkata' }, end: { dateTime: `${ymd(12)}T11:30:00`, timeZone: 'Asia/Kolkata' }, conferenceData: { createRequest: { conferenceSolutionKey: { type: 'hangoutsMeet' } } } });
    expect(made[0]!.body.conferenceData.createRequest.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(g.body.onlineMeeting.startUrl).toBeNull(); // Meet has no separate host link

    google.calls.length = 0;
    const gid = (await dbEvent(ev.id)).onlineMeetingId!;
    expect(google.events.has(gid)).toBe(true);
    const off = await a('principal', 'PATCH', `/events/${ev.id}`, { onlineMeeting: null });
    expect(off.body.onlineMeeting).toBeNull();
    expect(google.calls.filter(gDelete)).toHaveLength(1);
    expect(google.events.has(gid)).toBe(false);
    expect(await dbEvent(ev.id)).toMatchObject({ onlineStatus: 'none', onlineProvider: null, onlineRemoteProvider: null, onlineMeetingId: null, onlineJoinUrl: null, onlineStartUrlEnc: null });
  });

  it('cancelling the event cancels the meeting; the audience sees it as cancelled with no link', async () => {
    const ev = await mkEvent();
    const zid = (await dbEvent(ev.id)).onlineMeetingId!;
    zoom.calls.length = 0;
    const c = await a('principal', 'POST', `/events/${ev.id}/cancel`);
    expect(c.status).toBe(200);
    expect(c.body.status).toBe('cancelled');
    expect(c.body.onlineMeeting).toMatchObject({ provider: 'zoom', status: 'cancelled', joinUrl: null, passcode: null });
    expect(zoom.calls.filter(zoomDelete)).toHaveLength(1);
    expect(zoom.meetings.has(zid)).toBe(false);
    const parent = await a(guardianOf(s.ctx, s.ctx.students[0]!).username, 'GET', `/events/${ev.id}`);
    expect(parent.body.onlineMeeting).toEqual({ provider: 'zoom', status: 'cancelled', joinUrl: null, passcode: null });
    expect((await dbEvent(ev.id)).onlineMeetingId).toBeNull();
  });

  it('deleting a published event cancels its meeting and leaves nothing behind', async () => {
    const ev = await mkEvent();
    const zid = (await dbEvent(ev.id)).onlineMeetingId!;
    zoom.calls.length = 0;
    expect((await a('principal', 'DELETE', `/events/${ev.id}`)).status).toBe(403); // only events:delete may delete a published event
    const del = await a(ADMIN, 'DELETE', `/events/${ev.id}`);
    expect(del.status).toBe(200);
    expect(zoom.calls.filter(zoomDelete)).toHaveLength(1);
    expect(zoom.meetings.has(zid)).toBe(false);
    expect(await s.db.select().from(onlineMeetingCleanup)).toHaveLength(0);
  });

  it('Google Meet: the link is polled for while the conference is pending', async () => {
    google.pendingPolls = 2;
    const ev = await mkEvent({ onlineMeeting: { provider: 'google' } });
    expect(ev.onlineMeeting).toMatchObject({ provider: 'google', status: 'scheduled' });
    expect(ev.onlineMeeting.joinUrl).toMatch(/^https:\/\/meet\.google\.com\//);
    const polls = google.calls.filter((c) => c.method === 'GET' && /\/events\/gev\d+$/.test(c.path));
    expect(polls).toHaveLength(2);
    expect(polls.every((c) => c.query.get('conferenceDataVersion') === '1')).toBe(true);
  });

  it('Google Meet: a link that never becomes ready is a recoverable failure, and a retry finishes the SAME event', async () => {
    google.pendingPolls = 99;
    const before = google.events.size;
    const ev = await mkEvent({ onlineMeeting: { provider: 'google' } });
    expect(ev.status).toBe('published');
    expect(ev.onlineMeeting).toMatchObject({ provider: 'google', status: 'failed', joinUrl: null, error: 'Google Meet is still preparing the link. It will be tried again.' });
    expect(google.events.size).toBe(before + 1);
    expect(google.calls.filter((c) => c.method === 'GET' && /\/events\/gev\d+$/.test(c.path))).toHaveLength(5); // about a second apart, 5 tries
    // Google finishes the conference
    for (const e of google.events.values()) e.pollsLeft = 0;
    const retry = await a('principal', 'POST', `/events/${ev.id}/online-meeting/retry`);
    expect(retry.status).toBe(200);
    expect(retry.body.onlineMeeting.status).toBe('scheduled');
    expect(retry.body.onlineMeeting.joinUrl).toMatch(/^https:\/\/meet\.google\.com\//);
    expect(google.events.size).toBe(before + 1); // no second event was created
  });

  it('Google Meet: signs a delegated-access JWT and caches the token', async () => {
    clearGoogleTokens();
    const t0 = google.tokenCalls;
    await mkEvent({ onlineMeeting: { provider: 'google' }, title: 'G1' });
    await mkEvent({ onlineMeeting: { provider: 'google' }, title: 'G2' });
    expect(google.tokenCalls - t0).toBe(1);
    const claims = google.claims.at(-1);
    expect(claims).toMatchObject({ iss: google.clientEmail, sub: 'office@school.test', scope: 'https://www.googleapis.com/auth/calendar.events', alg: 'RS256' });
    expect(claims.exp - claims.iat).toBeGreaterThanOrEqual(3600);
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(3601);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('provider failures never block the school, and are retried', () => {
  const CASES: { name: string; arrange: () => void; message: string }[] = [
    { name: 'Zoom refuses the token request', arrange: () => { clearZoomTokens(); zoom.tokens.clear(); zoom.fail((c) => c.path === '/oauth/token', 400); }, message: 'Zoom did not accept the saved credentials. Check them in Settings → Online meetings.' },
    { name: 'Zoom token endpoint is down', arrange: () => { clearZoomTokens(); zoom.fail((c) => c.path === '/oauth/token', 503); }, message: 'Zoom is not reachable right now. It will be tried again.' },
    { name: '401 on the API even with a fresh token', arrange: () => zoom.fail(zoomCreate, 401), message: 'Zoom refused the sign-in. Check the credentials in Settings → Online meetings.' },
    { name: '403 (missing scope)', arrange: () => zoom.fail(zoomCreate, 403), message: 'Zoom does not allow this app to manage meetings. Check the app’s scopes and that the app is activated.' },
    { name: '404 (unknown host user)', arrange: () => zoom.fail(zoomCreate, 404), message: 'Zoom could not find the host user or the meeting. Check the host email.' },
    { name: '429', arrange: () => zoom.fail(zoomCreate, 429), message: 'Zoom is limiting requests right now. It will be tried again.' },
    { name: '500', arrange: () => zoom.fail(zoomCreate, 500), message: 'Zoom is not reachable right now. It will be tried again.' },
    { name: 'no answer within the timeout', arrange: () => zoom.hang(zoomCreate), message: 'Zoom did not answer in time. It will be tried again.' },
  ];

  for (const c of CASES) {
    it(`saving and publishing still work when: ${c.name}`, async () => {
      c.arrange();
      const ev = await a('principal', 'POST', '/events', evBody({ title: `Fails: ${c.name}` }));
      expect(ev.status).toBe(201); // the event is saved and published
      expect(ev.body.status).toBe('published');
      expect(ev.body.onlineMeeting).toMatchObject({ provider: 'zoom', status: 'failed', joinUrl: null, passcode: null, error: c.message });
      expect(JSON.stringify(ev.body)).not.toContain('SENTINEL');
      expect(await dbEvent(ev.body.id)).toMatchObject({ onlineStatus: 'failed', onlineError: c.message });
      // the audience is told nothing about the failure and gets no link
      const parent = await a(guardianOf(s.ctx, s.ctx.students[0]!).username, 'GET', `/events/${ev.body.id}`);
      expect(parent.body.onlineMeeting).toEqual({ provider: 'zoom', status: 'failed', joinUrl: null, passcode: null });
      await park(ev.body.id);
      zoom.heal();
      clearZoomTokens();
    });
  }

  it('saving works even when the provider cannot be reached at all', async () => {
    const saved = config.ZOOM_API_BASE;
    config.ZOOM_API_BASE = 'http://127.0.0.1:1/v2';
    try {
      const ev = await a('principal', 'POST', '/events', evBody({ title: 'Provider down' }));
      expect(ev.status).toBe(201);
      expect(ev.body.onlineMeeting.status).toBe('failed');
      expect(ev.body.onlineMeeting.error).toBe('Zoom is not reachable right now. It will be tried again.');
      await park(ev.body.id);
    } finally {
      config.ZOOM_API_BASE = saved;
    }
  });

  it('Retry creates the meeting once the problem is fixed; only editors may press it, and only while failed', async () => {
    zoom.fail(zoomCreate, 500);
    const ev = (await a('principal', 'POST', '/events', evBody({ title: 'Retry me' }))).body;
    expect(ev.onlineMeeting.status).toBe('failed');
    const again = await a('principal', 'POST', `/events/${ev.id}/online-meeting/retry`);
    expect(again.status).toBe(200);
    expect(again.body.onlineMeeting.status).toBe('failed'); // still down: a fresh safe error, not an exception
    zoom.heal();
    const parent = guardianOf(s.ctx, s.ctx.students[0]!).username;
    expect((await a(parent, 'POST', `/events/${ev.id}/online-meeting/retry`)).status).toBe(403);
    expect([403, 404]).toContain((await a('t001', 'POST', `/events/${ev.id}/online-meeting/retry`)).status); // a teacher who cannot manage this event
    expect((await a(null, 'POST', `/events/${ev.id}/online-meeting/retry`)).status).toBe(401);
    const ok = await a('principal', 'POST', `/events/${ev.id}/online-meeting/retry`);
    expect(ok.status).toBe(200);
    expect(ok.body.onlineMeeting).toMatchObject({ status: 'scheduled' });
    expect(ok.body.onlineMeeting.error).toBeUndefined();
    const second = await a('principal', 'POST', `/events/${ev.id}/online-meeting/retry`);
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('ONLINE_MEETING_NOT_FAILED');
    expect(zoom.meetings.size).toBeGreaterThan(0);
  });

  it('a failed cancellation is recorded and the background job finishes it', async () => {
    const ev = await mkEvent({ title: 'Cancel later' });
    const id = (await dbEvent(ev.id)).onlineMeetingId!;
    zoom.fail(zoomDelete, 500);
    const c = await a('principal', 'POST', `/events/${ev.id}/cancel`);
    expect(c.status).toBe(200); // the cancellation itself stands
    expect(c.body.status).toBe('cancelled');
    expect(c.body.onlineMeeting).toMatchObject({ status: 'failed', joinUrl: null });
    expect(zoom.meetings.has(id)).toBe(true);
    zoom.heal();
    await runJob();
    expect(zoom.meetings.has(id)).toBe(false);
    const after = await a('principal', 'GET', `/events/${ev.id}`);
    expect(after.body.onlineMeeting).toMatchObject({ provider: 'zoom', status: 'cancelled', joinUrl: null });
    expect(after.body.onlineMeeting.error).toBeUndefined();
  });

  it('the job retries a failed creation, but gives up a day after the first failure', async () => {
    zoom.fail(zoomCreate, 500);
    const ev = (await a('principal', 'POST', '/events', evBody({ title: 'Job retry' }))).body;
    const old = (await a('principal', 'POST', '/events', evBody({ title: 'Too old' }))).body;
    await s.db.update(events).set({ onlineFailedAt: new Date(Date.now() - 2 * DAY) }).where(eq(events.id, old.id));
    zoom.heal();
    zoom.calls.length = 0;
    await runJob();
    expect((await dbEvent(ev.id)).onlineStatus).toBe('scheduled');
    expect((await dbEvent(old.id)).onlineStatus).toBe('failed'); // left alone; a person can still press Retry
    expect(zoom.calls.filter(zoomCreate)).toHaveLength(1);
    expect((await a('principal', 'POST', `/events/${old.id}/online-meeting/retry`)).body.onlineMeeting.status).toBe('scheduled');
  });

  it('the job creates a published event whose meeting was never made (for example a crash)', async () => {
    const [row] = await s.db.insert(events).values({ title: 'Never created', startDate: ymd(20), endDate: ymd(20), startTime: '09:00', endTime: '10:00', allDay: false, status: 'published', onlineProvider: 'zoom' }).returning();
    await runJob();
    expect((await dbEvent(row!.id)).onlineStatus).toBe('scheduled');
    expect(zoom.calls.filter(zoomCreate)).toHaveLength(1);
  });

  it('two workers on the same event create ONE meeting', async () => {
    const [row] = await s.db.insert(events).values({ title: 'Race', startDate: ymd(21), endDate: ymd(21), startTime: '09:00', endTime: '10:00', allDay: false, status: 'published', onlineProvider: 'zoom' }).returning();
    zoom.delay(zoomCreate, 250);
    const [x, y] = await Promise.all([syncOnline(s.tenant, s.db, 'event', row!.id), syncOnline(s.tenant, s.db, 'event', row!.id)]);
    expect([x, y].sort()).toEqual(['busy', 'done']);
    expect(zoom.calls.filter(zoomCreate)).toHaveLength(1);
    expect((await dbEvent(row!.id)).onlineLeaseUntil).toBeNull(); // the lease is released
  });

  it('an edit made while the provider is being called is not lost', async () => {
    const [row] = await s.db.insert(events).values({ title: 'Edited during', startDate: ymd(22), endDate: ymd(22), startTime: '09:00', endTime: '10:00', allDay: false, status: 'published', onlineProvider: 'zoom' }).returning();
    zoom.delay(zoomCreate, 300);
    const running = syncOnline(s.tenant, s.db, 'event', row!.id);
    await sleep(100);
    await s.db.update(events).set({ title: 'Edited during (new title)' }).where(eq(events.id, row!.id));
    expect(await syncOnline(s.tenant, s.db, 'event', row!.id)).toBe('busy'); // the other worker holds the row ...
    await running; // ... and looks again before it lets go
    const meetingId = (await dbEvent(row!.id)).onlineMeetingId!;
    expect(zoom.meetings.get(meetingId)!.body.topic).toBe('Edited during (new title)');
    expect(zoom.calls.filter(zoomCreate)).toHaveLength(1);
  });

  it('a deleted event whose meeting cannot be cancelled is remembered and cleaned up later; “already gone” counts as done', async () => {
    const ev = await mkEvent({ title: 'Delete with outage' });
    const id = (await dbEvent(ev.id)).onlineMeetingId!;
    zoom.fail(zoomDelete, 500);
    expect((await a(ADMIN, 'DELETE', `/events/${ev.id}`)).status).toBe(200); // not blocked
    const waiting = await s.db.select().from(onlineMeetingCleanup);
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toMatchObject({ provider: 'zoom', remoteMeetingId: id, source: 'event' });
    expect(waiting[0]!.lastError).toBe('Zoom is not reachable right now. It will be tried again.');
    zoom.heal();
    await runJob();
    expect(await s.db.select().from(onlineMeetingCleanup)).toHaveLength(0);
    expect(zoom.meetings.has(id)).toBe(false);

    const gone = await mkEvent({ title: 'Already gone' });
    zoom.meetings.clear(); // someone deleted it in Zoom already
    expect((await a(ADMIN, 'DELETE', `/events/${gone.id}`)).status).toBe(200);
    expect(await s.db.select().from(onlineMeetingCleanup)).toHaveLength(0);
  });

  it('disconnecting a provider leaves existing meetings; cancelling them needs the connection again', async () => {
    const ev = await mkEvent({ title: 'Before disconnect', onlineMeeting: { provider: 'google' } });
    const dis = await a(ADMIN, 'DELETE', '/settings/meetings/google');
    expect(dis.status).toBe(200);
    const audit = (await s.db.select().from(auditLogs).where(eq(auditLogs.action, 'meeting_integration.disconnect')).orderBy(auditLogs.at)).at(-1)!;
    expect(audit.after).toMatchObject({ provider: 'google', liveMeetings: expect.any(Number) });
    expect((audit.after as any).liveMeetings).toBeGreaterThan(0);
    const c = await a('principal', 'POST', `/events/${ev.id}/cancel`);
    expect(c.status).toBe(200);
    expect(c.body.onlineMeeting).toMatchObject({ status: 'failed', error: 'Google Meet is not connected. Connect it in Settings → Online meetings.' });
    await connectGoogle();
    await runJob();
    expect((await a('principal', 'GET', `/events/${ev.id}`)).body.onlineMeeting.status).toBe('cancelled');
  });

  it('editing an event after its provider was disconnected still saves; reconnecting and retrying fixes the meeting', async () => {
    const ev = await mkEvent({ title: 'Edit after disconnect' });
    await a(ADMIN, 'DELETE', '/settings/meetings/zoom');
    const r = await a('principal', 'PATCH', `/events/${ev.id}`, { title: 'Edit after disconnect (renamed)', onlineMeeting: { provider: 'zoom' } });
    expect(r.status).toBe(200); // the same provider is not re-checked: only a newly chosen one has to be connected
    expect(r.body.title).toBe('Edit after disconnect (renamed)');
    expect(r.body.onlineMeeting).toMatchObject({ status: 'failed', error: 'Zoom is not connected. Connect it in Settings → Online meetings.' });
    // a provider that was never connected cannot be newly chosen
    expect((await a('principal', 'PATCH', `/events/${ev.id}`, { onlineMeeting: { provider: 'zoom' } })).status).toBe(200); // unchanged choice
    const other = await a('principal', 'POST', '/events', evBody({ title: 'New with disconnected Zoom' }));
    expect(other.status).toBe(422);
    expect(other.body.code).toBe('ONLINE_PROVIDER_NOT_CONNECTED');
    await connectZoom();
    await a(ADMIN, 'PUT', '/settings/meetings/default', { provider: 'zoom' }); // disconnecting Zoom had moved the default to Google
    clearZoomTokens();
    const retry = await a('principal', 'POST', `/events/${ev.id}/online-meeting/retry`);
    expect(retry.body.onlineMeeting.status).toBe('scheduled');
    const meetingId = (await dbEvent(ev.id)).onlineMeetingId!;
    expect(zoom.meetings.get(meetingId)!.body.topic).toBe('Edit after disconnect (renamed)'); // the retry also brought the rename across
  });

  it('the organiser of an event gets its host link; nobody else without edit rights does', async () => {
    const sec = s.ctx.sections[0]!.id;
    const owner = s.ctx.teachers.find((t) => t.id === s.ctx.sections[0]!.classTeacherId)!.username;
    const r = await a(owner, 'POST', '/events', evBody({ title: 'Class talk', audience: [{ type: 'section', id: sec }] }));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.onlineMeeting.startUrl).toContain('HOSTSECRET');
    const parent = studentsIn(s.ctx, sec)[0]!;
    const seenByParent = await a(guardianOf(s.ctx, parent).username, 'GET', `/events/${r.body.id}`);
    expect(seenByParent.body.onlineMeeting.joinUrl).toBe(r.body.onlineMeeting.joinUrl);
    expect('startUrl' in seenByParent.body.onlineMeeting).toBe(false);
    // another teacher with events:edit (assigned) who did not create it is not its organiser
    const other = s.ctx.teachers.find((t) => t.username !== owner && t.username !== 't001')?.username;
    if (other) expect('startUrl' in ((await a(other, 'GET', `/events/${r.body.id}`)).body.onlineMeeting ?? {})).toBe(false);
  });

  it('a school that changed its encryption key must re-enter the credentials, and meanwhile nothing crashes', async () => {
    const [row] = await s.db.select().from(meetingIntegrations).where(eq(meetingIntegrations.provider, 'zoom'));
    await s.db.update(meetingIntegrations).set({ credentialsEnc: 'v1.AAAA.AAAA.AAAA' }).where(eq(meetingIntegrations.id, row!.id));
    const ev = await a('principal', 'POST', '/events', evBody({ title: 'Broken key' }));
    expect(ev.status).toBe(201);
    expect(ev.body.onlineMeeting.error).toBe('Zoom did not accept the saved credentials. Check them in Settings → Online meetings.');
    await park(ev.body.id);
    await connectZoom(); // enter them again
    clearZoomTokens();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('parent–teacher meetings', () => {
  const clsTeacher = () => s.ctx.teachers.find((t) => t.id === s.ctx.sections[0]!.classTeacherId)!.username;
  const child = () => studentsIn(s.ctx, s.ctx.sections[0]!.id)[0]!;
  const parentOf = () => guardianOf(s.ctx, child()).username;
  let n = 0;
  const slot = (daysAhead: number, hour = 4, minute = 30) => new Date(Date.UTC(2027, 5, 15 + daysAhead, hour, minute)).toISOString(); // 2027-06-15 04:30Z = 10:00 in Asia/Kolkata

  /** a pending request from the child's parent to the class teacher */
  async function request() {
    const staffId = s.ctx.sections[0]!.classTeacherId!;
    // one open request per child and teacher: close any left over by a test that stopped at a refusal
    for (const m of (await a(parentOf(), 'GET', '/meetings?status=requested')).body.data) await a(parentOf(), 'POST', `/meetings/${m.id}/cancel`);
    const r = await a(parentOf(), 'POST', '/meetings', { studentId: child().id, staffId, topic: `Progress talk ${++n}` });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.onlineMeeting).toBeNull();
    return r.body.id as string;
  }
  const confirm = (id: string, body: Record<string, unknown>) => a(clsTeacher(), 'POST', `/meetings/${id}/confirm`, body);

  it('confirming an online meeting creates it at the default provider and puts its link in locationOrLink', async () => {
    const id = await request();
    const r = await confirm(id, { scheduledAt: slot(0), durationMin: 30, mode: 'online' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.status).toBe('confirmed');
    expect(r.body.onlineMeeting).toMatchObject({ provider: 'zoom', status: 'scheduled', passcode: '123456' });
    expect(r.body.onlineMeeting.startUrl).toContain('HOSTSECRET'); // the teacher is the host
    expect(r.body.locationOrLink).toBe(r.body.onlineMeeting.joinUrl);
    const c = zoom.calls.filter(zoomCreate).at(-1)!;
    expect(c.body).toMatchObject({ start_time: '2027-06-15T10:00:00', timezone: 'Asia/Kolkata', duration: 30 });
    // no child name and no parent-written topic is sent to the provider
    expect(JSON.stringify(c.body)).not.toContain(child().name);
    expect(JSON.stringify(c.body)).not.toContain('Progress talk');
    expect(c.body.topic).toMatch(/^Parent–teacher meeting with /);

    // the parent can join; the host link is for deciders only
    const mine = await a(parentOf(), 'GET', `/meetings/${id}`);
    expect(mine.body.onlineMeeting).toEqual({ provider: 'zoom', status: 'scheduled', joinUrl: r.body.onlineMeeting.joinUrl, passcode: '123456' });
    expect('startUrl' in mine.body.onlineMeeting).toBe(false);
    const list = await a(parentOf(), 'GET', '/meetings');
    expect(list.body.data.find((m: any) => m.id === id).onlineMeeting.joinUrl).toBe(r.body.onlineMeeting.joinUrl);
    const up = await a(parentOf(), 'GET', '/meetings/upcoming');
    expect(up.body.data.find((m: any) => m.id === id).onlineMeeting.status).toBe('scheduled');
    // the child never sees it
    expect((await a(child().username, 'GET', `/meetings/${id}`)).status).toBe(404);
    // the office, with approval rights, sees the host link too
    expect((await a('principal', 'GET', `/meetings/${id}`)).body.onlineMeeting.startUrl).toContain('HOSTSECRET');
  });

  it('can use Google Meet instead, or a link typed by the teacher, or refuse to guess', async () => {
    const g = await confirm(await request(), { scheduledAt: slot(1), mode: 'online', provider: 'google' });
    expect(g.body.onlineMeeting).toMatchObject({ provider: 'google', status: 'scheduled' });
    expect(g.body.locationOrLink).toMatch(/^https:\/\/meet\.google\.com\//);

    zoom.calls.length = 0;
    google.calls.length = 0;
    const manual = await confirm(await request(), { scheduledAt: slot(2), mode: 'online', provider: null, locationOrLink: 'https://meet.example.org/typed' });
    expect(manual.body.onlineMeeting).toBeNull();
    expect(manual.body.locationOrLink).toBe('https://meet.example.org/typed');
    expect(zoom.calls.filter(zoomApi)).toHaveLength(0);
    expect(google.calls.filter((c) => c.path.startsWith('/calendar'))).toHaveLength(0);

    const none = await confirm(await request(), { scheduledAt: slot(3), mode: 'online', provider: null });
    expect(none.status).toBe(422);
    expect(none.body.code).toBe('MEETING_LINK_REQUIRED');
    const inPerson = await confirm(await request(), { scheduledAt: slot(4), mode: 'in_person', locationOrLink: 'Room 6A' });
    expect(inPerson.body.onlineMeeting).toBeNull();
    expect(zoom.calls.filter(zoomApi)).toHaveLength(0);
  });

  it('with no provider connected, online meetings work as before (the teacher types the link)', async () => {
    await a(ADMIN, 'DELETE', '/settings/meetings/zoom');
    await a(ADMIN, 'DELETE', '/settings/meetings/google');
    try {
      const id = await request();
      expect((await confirm(id, { scheduledAt: slot(5), mode: 'online' })).body.code).toBe('MEETING_LINK_REQUIRED');
      const ok = await confirm(id, { scheduledAt: slot(5), mode: 'online', locationOrLink: 'https://meet.example.org/old-way' });
      expect(ok.status).toBe(200);
      expect(ok.body.onlineMeeting).toBeNull();
      const named = await confirm(await request(), { scheduledAt: slot(6), mode: 'online', provider: 'zoom' });
      expect(named.status).toBe(422);
      expect(named.body.code).toBe('ONLINE_PROVIDER_NOT_CONNECTED');
    } finally {
      await connectZoom();
      await connectGoogle();
    }
  });

  it('rescheduling updates the meeting; changing how it is held cancels it; going online again makes a new one', async () => {
    const id = await request();
    const first = await confirm(id, { scheduledAt: slot(10), durationMin: 20, mode: 'online' });
    const meetingId = (await dbMeeting(id)).onlineMeetingId!;
    zoom.calls.length = 0;

    const moved = await a(clsTeacher(), 'POST', `/meetings/${id}/reschedule`, { scheduledAt: slot(11, 5, 0), durationMin: 45 });
    expect(moved.status).toBe(200);
    expect(zoom.calls.filter((c) => c.method === 'PATCH').map((c) => [c.path, c.body.start_time, c.body.duration])).toEqual([[`/v2/meetings/${meetingId}`, '2027-06-26T10:30:00', 45]]);
    expect(moved.body.onlineMeeting.joinUrl).toBe(first.body.onlineMeeting.joinUrl);

    zoom.calls.length = 0;
    const room = await a(clsTeacher(), 'POST', `/meetings/${id}/reschedule`, { scheduledAt: slot(12), mode: 'in_person', locationOrLink: 'Room 4' });
    expect(room.body.onlineMeeting).toBeNull();
    expect(room.body.locationOrLink).toBe('Room 4');
    expect(zoom.calls.filter(zoomDelete)).toHaveLength(1);
    expect(zoom.meetings.has(meetingId)).toBe(false);

    const back = await a(clsTeacher(), 'POST', `/meetings/${id}/reschedule`, { scheduledAt: slot(13), mode: 'online' });
    expect(back.body.onlineMeeting).toMatchObject({ provider: 'zoom', status: 'scheduled' });
    expect(back.body.locationOrLink).toBe(back.body.onlineMeeting.joinUrl);

    // moving to the other provider
    zoom.calls.length = 0;
    const g = await a(clsTeacher(), 'POST', `/meetings/${id}/reschedule`, { scheduledAt: slot(13), provider: 'google' });
    expect(g.body.onlineMeeting.provider).toBe('google');
    expect(g.body.locationOrLink).toBe(g.body.onlineMeeting.joinUrl);
    expect(zoom.calls.filter(zoomDelete)).toHaveLength(1);
  });

  it('completing a meeting removes its room; cancelling it marks the room cancelled and clears the dead link', async () => {
    const done = await request();
    await confirm(done, { scheduledAt: slot(20), mode: 'online' });
    const mid = (await dbMeeting(done)).onlineMeetingId!;
    const c = await a(clsTeacher(), 'POST', `/meetings/${done}/complete`, { outcomeNotes: 'Agreed a plan.' });
    expect(c.status).toBe(200);
    expect(c.body.onlineMeeting).toBeNull();
    expect(zoom.meetings.has(mid)).toBe(false);

    const cancelled = await request();
    await confirm(cancelled, { scheduledAt: slot(21), mode: 'online' });
    const cid = (await dbMeeting(cancelled)).onlineMeetingId!;
    const x = await a(parentOf(), 'POST', `/meetings/${cancelled}/cancel`, { reason: 'Cannot make it' });
    expect(x.status).toBe(200);
    expect(x.body.onlineMeeting).toMatchObject({ provider: 'zoom', status: 'cancelled', joinUrl: null, passcode: null });
    expect(x.body.locationOrLink).toBeNull();
    expect(zoom.meetings.has(cid)).toBe(false);
    expect((await a(clsTeacher(), 'GET', `/meetings/${cancelled}`)).body.onlineMeeting.status).toBe('cancelled');

    // a request that was declined or cancelled before it was scheduled never touched a provider
    const early = await request();
    zoom.calls.length = 0;
    expect((await a(parentOf(), 'POST', `/meetings/${early}/cancel`)).status).toBe(200);
    expect(zoom.calls.filter(zoomApi)).toHaveLength(0);
  });

  it('a provider failure never blocks confirming; the teacher can retry, a parent cannot', async () => {
    zoom.fail(zoomCreate, 500);
    const id = await request();
    const r = await confirm(id, { scheduledAt: slot(30), mode: 'online' });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('confirmed');
    expect(r.body.onlineMeeting).toMatchObject({ provider: 'zoom', status: 'failed', joinUrl: null, error: 'Zoom is not reachable right now. It will be tried again.' });
    expect(r.body.locationOrLink).toBeNull();
    const parent = await a(parentOf(), 'GET', `/meetings/${id}`);
    expect(parent.body.onlineMeeting).toEqual({ provider: 'zoom', status: 'failed', joinUrl: null, passcode: null });

    expect((await a(parentOf(), 'POST', `/meetings/${id}/online-meeting/retry`)).status).toBe(403);
    expect((await a(child().username, 'POST', `/meetings/${id}/online-meeting/retry`)).status).toBe(403);
    zoom.heal();
    const retry = await a(clsTeacher(), 'POST', `/meetings/${id}/online-meeting/retry`);
    expect(retry.status).toBe(200);
    expect(retry.body.onlineMeeting.status).toBe('scheduled');
    expect(retry.body.locationOrLink).toBe(retry.body.onlineMeeting.joinUrl);
    expect((await a(clsTeacher(), 'POST', `/meetings/${id}/online-meeting/retry`)).body.code).toBe('ONLINE_MEETING_NOT_FAILED');

    // a typed link survives a failed creation as the fallback
    zoom.fail(zoomCreate, 500);
    const fb = await confirm(await request(), { scheduledAt: slot(31), mode: 'online', locationOrLink: 'https://meet.example.org/fallback' });
    expect(fb.body.onlineMeeting.status).toBe('failed');
    expect(fb.body.locationOrLink).toBe('https://meet.example.org/fallback');
  });

  it('the job finishes meetings whose room failed', async () => {
    zoom.fail(zoomCreate, 500);
    const id = await request();
    await confirm(id, { scheduledAt: slot(40), mode: 'online' });
    zoom.heal();
    await runJob();
    const row = await dbMeeting(id);
    expect(row.onlineStatus).toBe('scheduled');
    expect(row.locationOrLink).toBe(row.onlineJoinUrl);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('schools are isolated, and a school with daylight saving gets the right times', () => {
  it('another school sees none of this school’s connections or meetings, and cannot use its credentials', async () => {
    const mine = await call(s, ADMIN, 'GET', '/settings/meetings');
    expect(mine.body.providers.every((p: any) => p.connected)).toBe(true);
    // school B connected Zoom only (in the test above); Google is not connected there
    const theirs = await call(b, ADMIN, 'GET', '/settings/meetings');
    expect(theirs.body.providers.map((p: any) => [p.provider, p.connected])).toEqual([['zoom', true], ['google', false]]);
    expect((await call(b, 'principal', 'POST', '/events', evBody({ onlineMeeting: { provider: 'google' } }))).body.code).toBe('ONLINE_PROVIDER_NOT_CONNECTED');
    // the sealed credentials of A, copied into B's row, do not open
    const [aRow] = await s.db.select().from(meetingIntegrations).where(eq(meetingIntegrations.provider, 'zoom'));
    const [bRow] = await b.db.select().from(meetingIntegrations).where(eq(meetingIntegrations.provider, 'zoom'));
    await b.db.update(meetingIntegrations).set({ credentialsEnc: aRow!.credentialsEnc }).where(eq(meetingIntegrations.id, bRow!.id));
    const broken = await call(b, 'principal', 'POST', '/events', evBody({ title: 'Cross school' }));
    expect(broken.body.onlineMeeting).toMatchObject({ status: 'failed', error: 'Zoom did not accept the saved credentials. Check them in Settings → Online meetings.' });
    await call(b, ADMIN, 'PUT', '/settings/meetings/zoom', ZOOM_CREDS); // sealed afresh with B's own key
    expect(await b.db.select().from(events).where(eq(events.title, 'Science fair'))).toHaveLength(0);
  });

  it('sends the school’s own time zone, across a clock change', async () => {
    await controlDb().update(tenants).set({ timezone: 'America/New_York' }).where(eq(tenants.code, b.tenant.code));
    invalidateTenant(b.tenant.code);
    clearZoomTokens();
    zoom.calls.length = 0;
    // spring forward: 02:00 → 03:00 on 14 March 2027, so 01:00–04:00 is two hours of real time
    const dst = await call(b, 'principal', 'POST', '/events', evBody({ title: 'Spring forward', startDate: '2027-03-14', startTime: '01:00', endTime: '04:00' }));
    expect(dst.status, JSON.stringify(dst.body)).toBe(201);
    expect(dst.body.onlineMeeting.status).toBe('scheduled');
    const sent = zoom.calls.filter(zoomCreate).at(-1)!;
    expect(sent.body).toMatchObject({ start_time: '2027-03-14T01:00:00', timezone: 'America/New_York', duration: 120 });
    // an ordinary winter and summer day: same wall-clock time, same zone name (the provider applies the offset)
    const winter = await call(b, 'principal', 'POST', '/events', evBody({ title: 'Winter', startDate: '2027-03-09', startTime: '10:00', endTime: '11:00' }));
    const summer = await call(b, 'principal', 'POST', '/events', evBody({ title: 'Summer', startDate: '2027-03-16', startTime: '10:00', endTime: '11:00' }));
    expect(winter.status).toBe(201);
    expect(summer.status).toBe(201);
    const bodies = zoom.calls.filter(zoomCreate).slice(-2).map((c) => c.body);
    expect(bodies.map((x) => [x.start_time, x.timezone, x.duration])).toEqual([['2027-03-09T10:00:00', 'America/New_York', 60], ['2027-03-16T10:00:00', 'America/New_York', 60]]);
    // fall back: 00:30–03:30 on 7 November 2027 is four real hours
    await call(b, 'principal', 'POST', '/events', evBody({ title: 'Fall back', startDate: '2027-11-07', startTime: '00:30', endTime: '03:30' }));
    expect(zoom.calls.filter(zoomCreate).at(-1)!.body.duration).toBe(240);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('nothing secret ever leaves the API', () => {
  it('no response body to anyone contains a credential, the key, or a raw provider answer', () => {
    const everything = seen.map((x) => x.text).join('\n');
    expect(everything).not.toMatch(/csec-1|PRIVATE KEY|SENTINEL|kid-1|"credentialsEnc"|credentials_enc|online_start_url_enc|"onlineStartUrlEnc"/);
  });

  it('the host link only ever went to people who can edit', () => {
    const leaks = seen.filter((x) => x.text.includes('HOSTSECRET') && !['principal', 'admin@test.school', 't001', 'accounts', 'hr'].includes(x.who) && !/^t\d+$/.test(x.who));
    // parents and students (their usernames are phone numbers / admission numbers) never received the host link
    expect(leaks.map((x) => `${x.who} ${x.path}`)).toEqual([]);
  });

  it('audit rows, stored settings and queue rows contain no secrets either', async () => {
    const audit = await s.db.select().from(auditLogs);
    const text = JSON.stringify(audit.map((r) => [r.action, r.summary, r.before, r.after]));
    expect(text).not.toMatch(/csec-1|PRIVATE KEY|HOSTSECRET|SENTINEL|wrong-secret/);
    const integ = await s.db.select().from(meetingIntegrations);
    for (const r of integ) expect(JSON.stringify(r.settings) + (r.lastTestError ?? '')).not.toMatch(/csec-1|PRIVATE KEY|SENTINEL/);
    const evs = await s.db.select().from(events).where(and(sql`${events.onlineStartUrlEnc} is not null`));
    for (const e of evs) expect(e.onlineStartUrlEnc).not.toContain('HOSTSECRET');
    for (const e of await s.db.select().from(events)) expect(e.onlineError ?? '').not.toContain('SENTINEL');
  });
});
