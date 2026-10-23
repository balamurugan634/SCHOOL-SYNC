// Text-only smoke test for the STUDENT and PARENT screens (no screenshots).
// For every route: HTTP status, exactly one <h1>, no console / page errors, no failing same-origin requests,
// loading finished (no aria-busy left), no "couldn't load" error state, and no horizontal scroll at 1280 px and 360 px.
//   node scripts/smoke-learner.mjs                  all three users
//   node scripts/smoke-learner.mjs --only=parent    student | parent | unlinked
// Needs the dev server (or `next start`) on WEB_URL (default http://demo.localhost:3000) and the API.
// Run ONE browser script at a time, system-wide:
//   flock -w 3600 /tmp/schoolsync-smoke.lock scripts/dev/heavy.sh -m 1500M -- pnpm --filter @school-sync/web smoke:learner
import puppeteer from 'puppeteer-core';

const BASE = process.env.WEB_URL ?? 'http://demo.localhost:3000';
const PASSWORD = 'Demo@12345';
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);

/** Ids are looked up through the BFF after sign-in so the script survives re-seeding. */
const IDS = {
  homework: ['/homework?pageSize=1', (j) => j.data?.[0]?.id],
  exam: ['/results', (j) => j.data?.[0]?.examId],
  invoice: ['/fees/invoices?pageSize=1', (j) => j.data?.[0]?.id],
};

const USERS = {
  student: {
    login: 'gv20260001',
    routes: (id) => [
      '/student', '/student/tasks', '/student/calendar', '/student/calendar?view=agenda',
      '/student/learning', '/student/learning?tab=timetable', '/student/learning?tab=materials', '/student/learning?tab=syllabus', '/student/learning?tab=results', '/student/learning?tab=exams',
      `/student/learning/homework/${id.homework}`, `/student/learning/results/${id.exam}`,
      '/student/profile', '/student/attendance', '/student/attendance?tab=records', '/student/attendance?tab=leave',
      '/student/fees', `/student/fees/${id.invoice}`, '/student/announcements', '/student/events', '/student/notifications', '/student/notifications/preferences', '/student/library', '/student/transport',
    ],
  },
  parent: {
    login: '9000000001',
    routes: (id) => [
      '/parent', '/parent/attendance', '/parent/attendance?tab=records', '/parent/attendance?tab=leave',
      '/parent/academics', '/parent/academics?tab=timetable', '/parent/academics?tab=materials', '/parent/academics?tab=syllabus', '/parent/academics?tab=results', '/parent/academics?tab=exams',
      `/parent/academics/homework/${id.homework}`, `/parent/academics/results/${id.exam}`,
      '/parent/fees', `/parent/fees/${id.invoice}`, '/parent/fees/payments',
      '/parent/communication', '/parent/communication?tab=events', '/parent/communication?tab=calendar', '/parent/communication?tab=meetings', '/parent/communication?tab=notifications', '/parent/communication/preferences',
      '/parent/more', '/parent/more/transport', '/parent/more/library', '/parent/more/corrections', '/parent/more/profile',
    ],
  },
  // a parent whose child link is not verified yet: must see "no verified children", never a crash or another child's data
  unlinked: {
    login: '9099999999',
    routes: () => ['/parent', '/parent/attendance', '/parent/academics', '/parent/fees', '/parent/communication', '/parent/communication?tab=meetings', '/parent/more', '/parent/more/library', '/parent/more/profile'],
  },
};

const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--disable-extensions', '--host-resolver-rules=MAP *.localhost 127.0.0.1'] });
let failures = 0;
const log = (ok, msg) => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
};

try {
  for (const [name, cfg] of Object.entries(USERS)) {
    if (only && only !== name) continue;
    console.log(`\n== ${name} (${cfg.login})`);
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    let issues = [];
    page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && issues.push(`console.error: ${m.text().slice(0, 160)}`));
    page.on('pageerror', (e) => issues.push(`pageerror: ${e.message.slice(0, 160)}`));
    page.on('response', (r) => {
      const u = new URL(r.url());
      if (u.origin === new URL(BASE).origin && r.status() >= 400 && !/\/_next\//.test(u.pathname)) issues.push(`${r.status()} ${r.request().method()} ${u.pathname}${u.search.slice(0, 60)}`);
    });
    try {
      await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2', timeout: 60000 });
      await page.type('#identifier', cfg.login);
      await page.type('#password', PASSWORD);
      await Promise.all([page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 45000 }), page.keyboard.press('Enter')]);
      log(true, `sign-in → ${new URL(page.url()).pathname}`);
      const id = {};
      for (const [k, [path, pick]] of Object.entries(IDS)) {
        id[k] = await page.evaluate(async (p) => {
          try {
            const r = await fetch(`/api/bff${p}`, { credentials: 'same-origin' });
            return r.ok ? await r.json() : null;
          } catch {
            return null;
          }
        }, path).then((j) => (j ? pick(j) : null)).catch(() => null);
        id[k] ??= '00000000-0000-4000-8000-000000000000';
      }
      for (const route of cfg.routes(id)) {
        for (const [w, h] of [[1280, 800], [360, 740]]) {
          await page.setViewport({ width: w, height: h });
          issues = [];
          const res = await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle2', timeout: 60000 });
          await new Promise((r) => setTimeout(r, 500));
          const info = await page.evaluate(() => ({
            h1: [...document.querySelectorAll('h1')].map((e) => e.textContent?.trim()).filter(Boolean),
            busy: document.querySelectorAll('[aria-busy="true"]').length,
            error: /We couldn[’']t (load|open)|This isn[’']t available to you/.test(document.querySelector('main')?.textContent ?? ''),
            hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
          }));
          const status = res?.status() ?? 0;
          const expectErr = false;
          const ok = status === 200 && issues.length === 0 && !info.hscroll && info.h1.length === 1 && info.busy === 0 && (!info.error || expectErr);
          log(ok, `${status} ${route} @${w}  h1=${JSON.stringify(info.h1)}${info.hscroll ? '  HORIZONTAL SCROLL' : ''}${info.busy ? `  STILL LOADING (${info.busy})` : ''}${info.error ? '  ERROR STATE SHOWN' : ''}${issues.length ? '\n        ' + issues.join('\n        ') : ''}`);
        }
      }
    } catch (e) {
      log(false, `${name}: ${e.message.slice(0, 200)}`);
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
