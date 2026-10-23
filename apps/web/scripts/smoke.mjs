// Text-only smoke test: signs in as the demo users, visits routes in headless Chrome and prints, per route, the HTTP status,
// console errors / page errors and failing same-origin requests. No screenshots. Exit code 1 when anything fails.
//   node scripts/smoke.mjs                 all users
//   node scripts/smoke.mjs --only=teacher  one user (name from USERS)
// Needs the dev server (or `next start`) on WEB_URL (default http://demo.localhost:3000) and the API. Run via heavy.sh -m 1500M.
import puppeteer from 'puppeteer-core';

const BASE = process.env.WEB_URL ?? 'http://demo.localhost:3000';
const PASSWORD = 'Demo@12345';
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);

const USERS = {
  public: { login: null, routes: ['/', '/login', '/login?as=student', '/find-school', '/forgot-password', '/reset-password?token=' + 'a'.repeat(40), '/unavailable?reason=suspended', '/definitely-not-a-page'], expect404: ['/definitely-not-a-page'] },
  admin: { login: 'admin@greenvalley.edu', routes: ['/admin', '/admin/setup', '/admin/finance/invoices', '/admin/academics/years', '/account', '/account/sessions'], api: ['/dashboard/management', '/license', '/fees/invoices?page=1&pageSize=5', '/finance/summary'] },
  principal: { login: 'principal', routes: ['/admin', '/admin/setup'], api: ['/dashboard/management'] },
  accounts: { login: 'accounts', routes: ['/admin', '/admin/finance/invoices'], api: ['/dashboard/management', '/fees/invoices?page=1&pageSize=5', '/academics/grades'] },
  librarian: { login: 'librarian', routes: ['/admin'], api: ['/dashboard/management'] },
  teacher: { login: 't001', routes: ['/teacher', '/teacher/attendance', '/teacher/classes'], api: ['/attendance/today', '/dashboard/teacher'] },
  parent: { login: '9000000001', routes: ['/parent', '/parent/fees'], api: ['/dashboard/parent'] },
  unlinked: { login: '9099999999', routes: ['/parent'], api: ['/dashboard/parent'] },
  student: { login: 'gv20260001', routes: ['/student', '/student/tasks'], api: ['/dashboard/student'] },
};

const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--disable-extensions', '--host-resolver-rules=MAP *.localhost 127.0.0.1'] });
let failures = 0;
const log = (ok, msg) => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
};

for (const [name, cfg] of Object.entries(USERS)) {
  if (only && only !== name) continue;
  console.log(`\n== ${name}${cfg.login ? ` (${cfg.login})` : ''}`);
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
    if (cfg.login) {
      await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2', timeout: 60000 });
      await page.type('#identifier', cfg.login);
      await page.type('#password', PASSWORD);
      await Promise.all([page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 45000 }), page.keyboard.press('Enter')]);
      log(true, `sign-in → ${new URL(page.url()).pathname}`);
      await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('ss:tour')).length === 0);
    }
    for (const route of cfg.routes) {
      issues = [];
      const res = await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle2', timeout: 60000 });
      await new Promise((r) => setTimeout(r, 600));
      const status = res?.status() ?? 0;
      const want404 = cfg.expect404?.includes(route);
      const h1 = await page.$$eval('h1', (els) => els.map((e) => e.textContent?.trim()).filter(Boolean));
      const hscroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
      const real = issues.filter((i) => !(want404 && i.startsWith('404 GET')));
      log((want404 ? status === 404 : status === 200) && real.length === 0 && !hscroll && (want404 || h1.length === 1), `${status} ${route}  h1=${JSON.stringify(h1)}${hscroll ? '  HORIZONTAL SCROLL' : ''}${real.length ? '\n        ' + real.join('\n        ') : ''}`);
    }
    for (const path of cfg.api ?? []) {
      const r = await page.evaluate(async (p) => {
        const res = await fetch(`/api/bff${p}`, { credentials: 'same-origin' });
        const body = await res.text();
        return { status: res.status, bytes: body.length };
      }, path);
      log(r.status === 200, `${r.status} BFF ${path} (${r.bytes} bytes)`);
    }
  } catch (e) {
    log(false, `${name}: ${e.message.slice(0, 200)}`);
  }
  await ctx.close();
}
await browser.close();
console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
