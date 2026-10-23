// Text-only smoke test for the TEACHER experience: signs in as t001 (class teacher) and t012 (subject teacher), visits every
// teacher route (ids resolved from the live API), waits for the data to render, and prints per route the HTTP status, the h1,
// console errors / failing same-origin requests, error-state text and horizontal scroll. No screenshots. Exit code 1 on any failure.
//   node scripts/smoke-teacher.mjs               both users
//   node scripts/smoke-teacher.mjs --only=t012   one user
// Needs the dev server (or `next start`) on WEB_URL (default http://demo.localhost:3000) and the API. Run via heavy.sh -m 1500M.
import puppeteer from 'puppeteer-core';

const BASE = process.env.WEB_URL ?? 'http://demo.localhost:3000';
const PASSWORD = 'Demo@12345';
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);

/** `expect`: regex the rendered text must match (proves live data arrived); `forbid` defaults to the error-state wording. */
const STATIC = [
  { path: '/teacher', expect: /Attendance|Homework/ },
  { path: '/teacher/classes', expect: /My classes/ },
  { path: '/teacher/attendance' },
  { path: '/teacher/attendance/history', expect: /Attendance history/ },
  { path: '/teacher/attendance/corrections', expect: /corrections/i },
  { path: '/teacher/attendance/leave', expect: /Student leave/ },
  { path: '/teacher/homework', expect: /Homework/ },
  { path: '/teacher/homework/new', expect: /New homework|Set homework|homework/i },
  { path: '/teacher/marks', expect: /Mark sheets|Marks/ },
  { path: '/teacher/marks/exams', expect: /Exam/ },
  { path: '/teacher/marks/results', expect: /Results/ },
  { path: '/teacher/marks/remarks', expect: /emarks/ },
  { path: '/teacher/timetable', expect: /Timetable/ },
  { path: '/teacher/syllabus', expect: /Syllabus/ },
  { path: '/teacher/syllabus/materials', expect: /Study materials/ },
  { path: '/teacher/messages', expect: /Announcements|Messages/ },
  { path: '/teacher/messages/events', expect: /Events|Agenda/i },
  { path: '/teacher/messages/meetings', expect: /Meetings|meeting/i },
  { path: '/teacher/messages/notifications', expect: /Notifications|Inbox/ },
  { path: '/teacher/me', expect: /Attendance|Check/ },
  { path: '/teacher/me/leave', expect: /Leave/ },
  { path: '/teacher/me/profile', expect: /Profile|profile/ },
];

const USERS = {
  t001: { login: 't001', label: 'class teacher' },
  t012: { login: 't012', label: 'subject teacher' },
};

const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--disable-extensions', '--host-resolver-rules=MAP *.localhost 127.0.0.1'] });
let failures = 0;
const log = (ok, msg) => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
};

for (const [name, cfg] of Object.entries(USERS)) {
  if (only && only !== name) continue;
  console.log(`\n== ${name} (${cfg.label})`);
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  let issues = [];
  page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && issues.push(`console.error: ${m.text().slice(0, 160)}`));
  page.on('pageerror', (e) => issues.push(`pageerror: ${e.message.slice(0, 160)}`));
  page.on('response', (r) => {
    const u = new URL(r.url());
    if (u.origin === new URL(BASE).origin && r.status() >= 400 && !/\/_next\//.test(u.pathname)) issues.push(`${r.status()} ${r.request().method()} ${u.pathname}${u.search.slice(0, 80)}`);
  });
  try {
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.type('#identifier', cfg.login);
    await page.type('#password', PASSWORD);
    await Promise.all([page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 45000 }), page.keyboard.press('Enter')]);
    log(true, `sign-in → ${new URL(page.url()).pathname}`);

    // resolve ids from the live API through the BFF (same cookies as the app)
    const api = (p) => page.evaluate(async (path) => (await fetch(`/api/bff${path}`, { credentials: 'same-origin' })).json(), p);
    const sections = (await api('/academics/sections?mine=true')).data ?? [];
    const hw = (await api('/homework?mine=true&pageSize=5')).data ?? [];
    const sheets = (await api('/marks/sheets?mine=true&pageSize=5')).data ?? [];
    const sec = sections[0];
    const students = sec ? ((await api(`/students?sectionId=${sec.id}&pageSize=2`)).data ?? []) : [];
    const routes = [...STATIC];
    if (sec) {
      routes.push({ path: `/teacher/classes/${sec.id}`, expect: /Students/ });
      routes.push({ path: `/teacher/classes/${sec.id}?tab=subjects`, expect: /Subjects/ });
      routes.push({ path: `/teacher/classes/${sec.id}?tab=attendance`, expect: /Daily attendance|Present/ });
      routes.push({ path: `/teacher/classes/${sec.id}?tab=homework`, expect: /Homework/ });
      routes.push({ path: `/teacher/attendance/history?section=${sec.id}&view=students`, expect: /Attendance history/ });
      routes.push({ path: `/teacher/syllabus?section=${sec.id}`, expect: /Syllabus covered/ });
      routes.push({ path: `/teacher/homework?scope=class&section=${sec.id}`, expect: /Homework/ });
      routes.push({ path: `/teacher/classes/00000000-0000-4000-8000-000000000000`, expect: /available|couldn.t/i, allowErrorText: true, allow404Api: true });
    }
    if (sec && students[0]) routes.push({ path: `/teacher/classes/${sec.id}/students/${students[0].id}`, expect: /Attendance/ });
    if (hw[0]) {
      routes.push({ path: `/teacher/homework/${hw[0].id}`, expect: /Overview|Roster/ });
      routes.push({ path: `/teacher/homework/${hw[0].id}?tab=roster`, expect: /Roster|Missing|Submitted/ });
      routes.push({ path: `/teacher/homework/${hw[0].id}?tab=review` });
      routes.push({ path: `/teacher/homework/${hw[0].id}/edit` });
    }
    if (sheets[0]) routes.push({ path: `/teacher/marks/sheets/${sheets[0].id}`, expect: /Save|Marks|marks/ });
    log(true, `resolved ${sections.length} classes, ${hw.length} homework, ${sheets.length} sheets, ${students.length} students`);

    for (const r of routes) {
      issues = [];
      const res = await page.goto(`${BASE}${r.path}`, { waitUntil: 'networkidle2', timeout: 60000 });
      // wait for the data: no skeleton left (max 20 s)
      let stillLoading = false;
      try {
        await page.waitForFunction(() => document.querySelectorAll('.skeleton').length === 0, { timeout: 20000 });
      } catch {
        stillLoading = true;
      }
      await new Promise((x) => setTimeout(x, 300));
      const status = res?.status() ?? 0;
      const h1 = await page.$$eval('h1', (els) => els.map((e) => e.textContent?.trim()).filter(Boolean));
      const text = await page.evaluate(() => document.body.innerText);
      const hscroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
      const errText = !r.allowErrorText && /We couldn.t load|Something went wrong|Application error/i.test(text);
      const missing = r.expect && !r.expect.test(text);
      const real = issues.filter((i) => !(r.allow404Api && /^40[34] /.test(i)));
      const ok = status === 200 && real.length === 0 && !hscroll && h1.length === 1 && !errText && !missing && !stillLoading;
      log(ok, `${status} ${r.path}  h1=${JSON.stringify(h1)}${hscroll ? '  HORIZONTAL SCROLL' : ''}${stillLoading ? '  STILL LOADING' : ''}${errText ? '  ERROR TEXT' : ''}${missing ? `  MISSING ${r.expect}` : ''}${real.length ? '\n        ' + real.join('\n        ') : ''}`);
    }

    // phone width: no horizontal scroll on the main screens
    await page.setViewport({ width: 375, height: 800, isMobile: true });
    for (const p of ['/teacher', '/teacher/classes', '/teacher/homework', '/teacher/marks', '/teacher/timetable', '/teacher/attendance/leave', ...(sheets[0] ? [`/teacher/marks/sheets/${sheets[0].id}`] : [])]) {
      issues = [];
      await page.goto(`${BASE}${p}`, { waitUntil: 'networkidle2', timeout: 60000 });
      await page.waitForFunction(() => document.querySelectorAll('.skeleton').length === 0, { timeout: 20000 }).catch(() => {});
      await new Promise((x) => setTimeout(x, 300));
      const hscroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
      log(!hscroll && issues.length === 0, `375px ${p}${hscroll ? '  HORIZONTAL SCROLL' : ''}${issues.length ? '\n        ' + issues.join('\n        ') : ''}`);
    }
  } catch (e) {
    log(false, `${name}: ${e.message.slice(0, 240)}`);
  }
  await ctx.close();
}
await browser.close();
console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
