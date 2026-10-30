// Browser check of Zoom / Google Meet integration (Settings → Online meetings, event form + detail, calendar, meetings).
// Drives the real UI in headless Chrome. The providers are LOCAL STUBS (apps/api/test/stub-meetings.ts): this script never talks to Zoom or Google.
//
// The web app's backend-for-frontend normally forwards /api/bff/* to the shared API (:4000), which uses the real provider hosts.
// To point the school at the stubs without touching the shared stack, this script answers every /api/bff/* call itself from a SECOND API
// instance (API2_URL) that was started with ZOOM_OAUTH_BASE / ZOOM_API_BASE / GOOGLE_TOKEN_URL / GOOGLE_CALENDAR_BASE set to the stubs.
//
//   API2_URL=http://127.0.0.1:4101 STUBS_JSON=/path/stubs.json OUT_DIR=/path/shots \
//   flock -w 3600 /tmp/schoolsync-smoke.lock scripts/dev/heavy.sh -m 1500M -- node apps/web/scripts/verify-online-meetings.mjs
//
// STUBS_JSON is written by a runner that starts the stubs (zoomOauth, zoomApi, …, `admin` = a tiny endpoint with /state, /fail-zoom, /heal, `keyFile`).
import { mkdirSync, readFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const BASE = process.env.WEB_URL ?? 'http://demo.localhost:3000';
const API2 = (process.env.API2_URL ?? 'http://127.0.0.1:4101').replace(/\/$/, '');
const OUT = process.env.OUT_DIR ?? '/tmp/online-meetings-shots';
const stubs = JSON.parse(readFileSync(process.env.STUBS_JSON ?? '/tmp/stubs.json', 'utf8'));
const PASSWORD = 'Demo@12345';
const ADMIN = 'admin@greenvalley.edu';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const log = (ok, msg) => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
};
mkdirSync(OUT, { recursive: true });

const stubState = async () => (await fetch(`${stubs.admin}/state`)).json();

// ── token for the second API ─────────────────────────────────────────────────────────────────────
let token = '';
async function login() {
  const r = await fetch(`${API2}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-tenant': 'demo' }, body: JSON.stringify({ identifier: ADMIN, password: PASSWORD }) });
  token = (await r.json()).accessToken;
}
async function api2(path, method = 'GET', body) {
  const go = () => fetch(`${API2}/api/v1${path}`, { method, headers: { 'x-tenant': 'demo', authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let r = await go();
  if (r.status === 401) {
    await login();
    r = await go();
  }
  const t = await r.text();
  return { status: r.status, body: t ? JSON.parse(t) : null };
}

const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--disable-extensions', '--host-resolver-rules=MAP *.localhost 127.0.0.1'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 200)}`));
page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|favicon/.test(m.text()) && errors.push(`console.error: ${m.text().slice(0, 200)}`));

await login();
// start from a school with nothing connected (a previous run may have left connections behind)
for (const p of ['zoom', 'google']) await api2(`/settings/meetings/${p}`, 'DELETE');
await page.setRequestInterception(true);
page.on('request', async (req) => {
  const url = new URL(req.url());
  if (!url.pathname.startsWith('/api/bff/')) return req.continue();
  try {
    const path = url.pathname.replace('/api/bff', '/api/v1') + url.search;
    const method = req.method();
    const go = () => fetch(API2 + path, { method, headers: { 'x-tenant': 'demo', authorization: `Bearer ${token}`, ...(req.headers()['content-type'] ? { 'content-type': req.headers()['content-type'] } : {}) }, body: ['GET', 'HEAD'].includes(method) ? undefined : req.postData() });
    let r = await go();
    if (r.status === 401) {
      await login();
      r = await go();
    }
    await req.respond({ status: r.status, headers: { 'content-type': r.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' }, body: Buffer.from(await r.arrayBuffer()) });
  } catch (e) {
    await req.respond({ status: 502, contentType: 'application/json', body: JSON.stringify({ code: 'API_UNREACHABLE', title: String(e) }) });
  }
});

// ── helpers ──────────────────────────────────────────────────────────────────────────────────────
const goto = async (path) => {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(500);
};
const bodyText = () => page.evaluate(() => document.body.innerText);
const waitText = async (text, timeout = 15000) => {
  try {
    await page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, text);
  } catch (e) {
    await page.screenshot({ path: `${OUT}/timeout.png` }).catch(() => undefined);
    console.log(`TIMEOUT waiting for "${text}". Page text (start): ${(await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 600)}`);
    throw e;
  }
};
const waitIn = (root, text, timeout = 15000) => page.waitForFunction((r, t) => (document.querySelector(r)?.innerText ?? '').includes(t), { timeout }, root, text);
async function has(text) {
  return (await bodyText()).includes(text);
}
async function byText(sel, text, { exact = true, root, last = false } = {}) {
  const h = await page.evaluateHandle(
    (s, t, ex, r, l) => {
      const scope = r ? (document.querySelector(r) ?? document) : document;
      const hits = [...scope.querySelectorAll(s)].filter((e) => {
        const x = (e.textContent ?? '').replace(/\s+/g, ' ').trim();
        return ex ? x === t : x.includes(t);
      });
      return l ? hits[hits.length - 1] : hits[0];
    },
    sel,
    text,
    exact,
    root ?? null,
    last,
  );
  return h.asElement();
}
async function clickText(sel, text, opts) {
  for (let i = 0; i < 30; i++) {
    const el = await byText(sel, text, opts);
    if (el) {
      await el.evaluate((e) => e.scrollIntoView({ block: 'center' }));
      await el.click();
      return;
    }
    await sleep(200);
  }
  throw new Error(`no ${sel} with text "${text}"`);
}
async function inputByLabel(label, root = 'body') {
  for (let i = 0; i < 30; i++) {
    const h = await page.evaluateHandle(
      (t, r) => {
        const scope = document.querySelector(r) ?? document;
        for (const l of scope.querySelectorAll('label')) {
          if ((l.textContent ?? '').replace(/\s+/g, ' ').trim().startsWith(t)) {
            const id = l.getAttribute('for');
            const el = id ? document.getElementById(id) : null;
            if (el) return el;
          }
        }
        return null;
      },
      label,
      root,
    );
    const el = h.asElement();
    if (el) return el;
    await sleep(200);
  }
  throw new Error(`no field labelled "${label}"`);
}
/** set a value the way React sees it (native setter + input/change/blur) */
async function setValue(el, value) {
  await el.evaluate((e, v) => {
    const proto = e instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(e, v);
    e.dispatchEvent(new Event('input', { bubbles: true }));
    e.dispatchEvent(new Event('change', { bubbles: true }));
    e.dispatchEvent(new Event('blur', { bubbles: true }));
  }, value);
}
async function fill(label, value, root) {
  await setValue(await inputByLabel(label, root), value);
}
/** open a Radix select (the trigger carries the label's id or an aria-label) and pick an option */
async function pick(trigger, optionText) {
  const el = typeof trigger === 'string' ? await page.waitForSelector(trigger) : trigger;
  await el.evaluate((e) => e.scrollIntoView({ block: 'center' }));
  await el.click();
  await page.waitForSelector('[role="option"]');
  await clickText('[role="option"]', optionText, { exact: false });
  await sleep(300);
}
const shot = async (name, full = true) => {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
};
const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const attr = (sel, a) => page.$eval(sel, (e, x) => e.getAttribute(x), a).catch(() => null);

const ZOOM = '[aria-labelledby="zoom-title"]';
const GOOGLE = '[aria-labelledby="google-title"]';

// ── sign in ──────────────────────────────────────────────────────────────────────────────────────
await goto('/login');
await page.type('#identifier', ADMIN);
await page.type('#password', PASSWORD);
await Promise.all([page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 45000 }), page.keyboard.press('Enter')]);
await sleep(1500);
await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /Skip tour/.test(b.textContent ?? ''))?.click());
log(!(await page.url()).includes('/login'), 'signed in as the school administrator');

// ── 1. settings: nothing connected yet ───────────────────────────────────────────────────────────
await goto('/admin/settings/school?tab=meetings');
await waitText('Online meetings');
log((await has('Zoom')) && (await has('Google Meet')) && (await has('Not connected')), 'Settings → Online meetings shows Zoom and Google Meet cards, both Not connected');
log(await has('Needs Google Workspace'), 'the Google card says a personal Gmail cannot be used');
await shot('01-settings-empty-1280');

// ── 2. connect Zoom ──────────────────────────────────────────────────────────────────────────────
await clickText('button', 'Connect Zoom').catch(() => undefined); // empty form: shows the inline errors
await sleep(400);
log(await has('Enter the Account ID'), 'an empty Zoom form shows inline errors instead of calling the server');
await fill('Account ID', 'acct-1', ZOOM);
await fill('Client ID', 'cid-1', ZOOM);
await fill('Client secret', 'csec-1', ZOOM);
await fill('Host email', 'host@school.test', ZOOM);
await clickText('button', 'Connect Zoom');
await waitText('Zoom settings saved.');
await sleep(600);
log((await byText('span', 'Connected', { root: ZOOM })) !== null, 'Zoom shows Connected after saving');
log((await has('Hidden for your security')) && !(await has('csec-1')), 'the client secret is shown as Saved and its value is nowhere on the page');
log((await byText('span', 'Default', { root: ZOOM })) !== null, 'the first provider connected becomes the default');
await shot('02-zoom-connected-1280');

// ── 3. test connection (no object created) ───────────────────────────────────────────────────────
const before = (await stubState()).zoom.meetings.length;
await clickText('button', 'Test connection', { root: ZOOM });
await waitIn(ZOOM, 'The connection works');
log((await stubState()).zoom.meetings.length === before, 'Test connection signs in and reads, and creates no meeting at Zoom');

// ── 4. connect Google Meet ───────────────────────────────────────────────────────────────────────
await setValue(await inputByLabel('Service-account key', GOOGLE), stubs.keyFile);
await fill('Organizer email', 'office@school.test', GOOGLE);
await clickText('button', 'Connect Google Meet');
await waitText('Google Meet settings saved.');
await sleep(600);
log((await has('Saved service account')) && (await has('meet-sa@school-project.iam.gserviceaccount.com')) && (await has('112233445566778899001')), 'Google shows the service account email and the Client ID to authorise');
log(!(await has('PRIVATE KEY')), 'the service-account key is nowhere on the page');
await clickText('button', 'Test connection', { root: GOOGLE });
await waitIn(GOOGLE, 'The connection works');
log(true, 'Google Test connection works');

// ── 5. default provider ──────────────────────────────────────────────────────────────────────────
await clickText('span', 'Google Meet', { root: '[role="radiogroup"]' });
await waitText('is now the default');
log(await page.$eval('[role="radiogroup"] label:nth-child(2) input', (e) => e.checked), 'choosing Google Meet as default marks it');
await clickText('span', 'Zoom', { root: '[role="radiogroup"]' });
await sleep(800);

// ── 6. unsaved-changes guard ─────────────────────────────────────────────────────────────────────
await fill('Account ID', 'acct-changed', ZOOM);
await clickText('[role="tab"]', 'Features');
await waitText('Leave without saving?').catch(() => undefined);
log(await has('Leave without saving?'), 'leaving the tab with unsaved changes asks first');
await page.keyboard.press('Escape');
await sleep(300);
await fill('Account ID', 'acct-1', ZOOM);
await shot('03-settings-both-1280');

// ── 7. phone width ───────────────────────────────────────────────────────────────────────────────
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
await goto('/admin/settings/school?tab=meetings');
await waitText('Online meetings');
log((await overflow()) <= 1, `settings tab fits a 390 px phone without sideways scrolling (overflow ${await overflow()}px)`);
await shot('04-settings-390');
await page.setViewport({ width: 1280, height: 900 });

// ── 8. event form: online meeting selector ───────────────────────────────────────────────────────
await goto('/admin/communication/events/new');
await waitText('Online meeting');
log((await has('An online meeting needs a start and end time, and this event is marked all-day.')) && (await byText('button', 'Set a time')) !== null, 'the form explains why the selector is off for an all-day event and offers “Set a time”');
await clickText('button', 'Set a time');
await sleep(300);
await fill('Title', 'Online science fair');
await fill('Starts at', '10:00');
await fill('Ends at', '11:30');
await pick('button[aria-label="Online meeting"]', 'Zoom');
log(await has('A Zoom meeting is created for that day and time when the event is published.'), 'choosing Zoom explains what will happen');
await clickText('button', 'Add'); // audience: Everyone
await sleep(300);
await shot('05-event-form-1280');
await clickText('button', 'Publish');
await page.waitForFunction(() => /\/communication\/events\/[0-9a-f-]{36}/.test(location.pathname), { timeout: 30000 });
await sleep(1200);
const eventId = (await page.url()).match(/events\/([0-9a-f-]{36})/)[1];
await waitText('Online meeting · Zoom');
log((await has('Link ready')) && (await has('Join Zoom')) && (await has('Start as host')), 'the published event shows the Join card with the link, passcode and host link');
const join = await page.$eval('a[aria-label^="Join the Zoom meeting"], a[href*="zoom.example"]', (a) => ({ href: a.href, target: a.target, rel: a.rel })).catch(() => null);
log(!!join && join.target === '_blank' && /noopener/.test(join.rel) && /noreferrer/.test(join.rel), `Join opens in a new tab with rel="noopener noreferrer" (${join?.href ?? 'no link'})`);
let st = await stubState();
const made = st.zoom.calls.filter((c) => c.method === 'POST' && /meetings$/.test(c.path)).at(-1);
log(!!made && made.body.topic === 'Online science fair' && made.body.timezone === 'Asia/Kolkata' && made.body.duration === 90 && /T10:00:00$/.test(made.body.start_time), `Zoom received the meeting for that day and time (${made?.body.start_time}, ${made?.body.timezone}, ${made?.body.duration} min)`);
await shot('06-event-detail-1280');

// ── 9. Join shows in the lists and on the calendar ───────────────────────────────────────────────
await goto('/admin/communication/events?tab=list');
await waitText('Online science fair');
log(await page.evaluate(() => [...document.querySelectorAll('a')].some((a) => /Join the Zoom meeting/.test(a.getAttribute('aria-label') ?? ''))), 'the Manage events table has a Join button');
await shot('07-events-list-1280');
await goto('/admin/communication/events?tab=calendar&cal=agenda');
await waitText('Online science fair');
log(await page.evaluate(() => [...document.querySelectorAll('a')].some((a) => /^Join the .*meeting/.test(a.getAttribute('aria-label') ?? ''))), 'the calendar agenda shows a Join button next to the event');
await shot('08-calendar-agenda-1280');

// ── 10. editing the time updates the meeting ─────────────────────────────────────────────────────
await goto(`/admin/communication/events/${eventId}`);
await waitText('Online meeting · Zoom');
await fill('Ends at', '12:00');
await clickText('button', 'Save changes');
await waitText('Changes saved');
await sleep(800);
st = await stubState();
const patched = st.zoom.calls.filter((c) => c.method === 'PATCH').at(-1);
log(!!patched && patched.body.duration === 120, `changing the end time updated the Zoom meeting (duration ${patched?.body.duration})`);

// ── 11. cancel: the confirm dialog mentions the meeting, and the stub sees the delete ────────────
await clickText('button', 'Cancel event');
await waitText('Cancel “Online science fair”?');
log(await has('The Zoom meeting is cancelled too'), 'the cancel dialog says the Zoom meeting is cancelled too');
await clickText('button', 'Cancel the event');
await waitText('Event cancelled');
await sleep(1000);
st = await stubState();
log(st.zoom.calls.some((c) => c.method === 'DELETE') && !st.zoom.meetings.some((m) => m.body?.topic === 'Online science fair'), 'Zoom received the DELETE and no longer has the meeting');
log(await has('This online meeting was cancelled'), 'the event shows the online meeting as cancelled');
await shot('09-event-cancelled-1280');

// ── 12. a provider failure never blocks, and Retry recovers ──────────────────────────────────────
await fetch(`${stubs.admin}/fail-zoom`);
const failed = await api2('/events', 'POST', { title: 'Parents evening', startDate: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10), startTime: '17:00', endTime: '18:00', allDay: false, audience: [{ type: 'all' }], onlineMeeting: { provider: 'zoom' }, publish: true });
log(failed.status === 201 && failed.body.onlineMeeting?.status === 'failed', 'with Zoom down the event is still published (the meeting shows failed)');
await goto(`/admin/communication/events/${failed.body.id}`);
await waitText('could not be set up');
log((await has('Zoom is not reachable right now')) && (await byText('button', 'Retry')) !== null, 'the detail page shows the safe reason and a Retry button');
await shot('10-event-failed-1280');
await fetch(`${stubs.admin}/heal`);
await clickText('button', 'Retry');
await waitText('The online meeting is set up');
await waitText('Link ready');
log(true, 'Retry creates the meeting once Zoom is back');
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
await goto(`/admin/communication/events/${failed.body.id}`);
await waitText('Online meeting · Zoom');
log((await overflow()) <= 1, `event detail fits a 390 px phone (overflow ${await overflow()}px)`);
await shot('11-event-detail-390');
await goto('/admin/communication/events/new');
await waitText('Online meeting');
log((await overflow()) <= 1, `event form fits a 390 px phone (overflow ${await overflow()}px)`);
await shot('12-event-form-390');
await page.setViewport({ width: 1280, height: 900 });

// ── 13. parent–teacher meeting: provider selector ────────────────────────────────────────────────
const gBefore = (await stubState()).google.events.length;
const requested = await api2('/meetings?status=requested&pageSize=5');
const m = requested.body.data[0];
if (!m) {
  log(false, 'no requested meeting to confirm in the test school');
} else {
  await goto(`/admin/communication/meetings?meeting=${m.id}`);
  await waitText('Meeting');
  await clickText('button', 'Confirm');
  await waitText('Confirm this meeting');
  // the "How" select is the dialog's second combobox (it currently reads "In person")
  const triggers = await page.$$('[role="dialog"] button[role="combobox"]');
  const how = (await Promise.all(triggers.map(async (t) => ((await t.evaluate((e) => e.textContent)) ?? '').includes('In person') ? t : null))).find(Boolean);
  await pick(how, 'Online');
  await waitText('Meeting service');
  log(await has('Meeting service'), 'the confirm dialog offers a Meeting service when the meeting is online');
  await shot('13-meeting-confirm-1280', false);
  await pick('button[aria-label="Meeting service"]', 'Google Meet');
  log(!(await has('Meeting link')), 'with a service chosen the teacher no longer has to type a link');
  await clickText('[role="dialog"] button', 'Confirm meeting', { last: true });
  await waitText('Meeting confirmed');
  await sleep(1200);
  await goto(`/admin/communication/meetings?meeting=${m.id}`);
  await waitText('Online meeting · Google Meet');
  log((await has('Link ready')) && (await has('Join Google Meet')), 'the confirmed meeting shows its Google Meet link');
  st = await stubState();
  log(st.google.calls.some((c) => c.method === 'POST' && c.path.endsWith('/events')) && st.google.events.length === gBefore + 1, 'Google received the calendar event with a Meet conference request');
  await shot('14-meeting-drawer-1280', false);
  await clickText('button', 'Cancel meeting');
  await waitText('Cancel this meeting?');
  await clickText('[role="dialog"] button', 'Cancel meeting', { last: true });
  await waitText('Meeting cancelled');
  await sleep(1000);
  st = await stubState();
  log(st.google.calls.some((c) => c.method === 'DELETE') && st.google.events.length === gBefore, 'cancelling the meeting cancelled the Google event');
}

// ── 14. disconnect ───────────────────────────────────────────────────────────────────────────────
await goto('/admin/settings/school?tab=meetings');
await waitText('Online meetings');
await clickText('button', 'Disconnect', { root: GOOGLE });
await waitText('Disconnect Google Meet?');
await clickText('[role="dialog"] button', 'Disconnect');
await sleep(1200);
log((await byText('span', 'Not connected', { root: GOOGLE })) !== null, 'Disconnect removes the Google connection');

log(errors.length === 0, `no console errors${errors.length ? `: ${errors.slice(0, 4).join(' | ')}` : ''}`);
await browser.close();
console.log(failures ? `\n${failures} check(s) FAILED. Screenshots: ${OUT}` : `\nAll checks passed. Screenshots: ${OUT}`);
process.exit(failures ? 1 : 0);
