// Text-only smoke for the management screens, part 2 (finance, communication, operations, reports). No screenshots.
// Route lists live in scripts/smoke-routes-mgmt2/<area>.mjs (finance, communication, operations, reports):
//   export default { accounts: { routes: ['/admin/finance', { path: '/admin/reports', expect: 403 }], api: ['/finance/summary'] } }
// For each route: HTTP status, exactly one <h1>, console errors / page errors, failing same-origin requests, horizontal scroll, error text.
// A route object may set { expect: 200 | 403 | 404, allow: ['substring of an allowed failing request'] } (403 = the NoAccess / FeatureOff page: still a heading).
//   node scripts/smoke-mgmt2.mjs [--area=finance] [--only=accounts] [--width=390]
// Run through heavy.sh (-m 1500M). Needs the dev server on WEB_URL (default http://demo.localhost:3000) and the API.
import { readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const BASE = process.env.WEB_URL ?? 'http://demo.localhost:3000';
const PASSWORD = 'Demo@12345';
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const onlyUser = arg('only');
const onlyArea = arg('area');
const width = Number(arg('width') ?? 1280);
const dump = process.argv.includes('--dump');
const LOGINS = { admin: 'admin@greenvalley.edu', office: 'office', principal: 'principal', accounts: 'accounts', librarian: 'librarian', transport: 'transport' };

const dir = join(dirname(fileURLToPath(import.meta.url)), 'smoke-routes-mgmt2');
const plan = {}; // user -> { routes: [], api: [] }
for (const f of readdirSync(dir).filter((f) => f.endsWith('.mjs')).sort()) {
  if (onlyArea && f !== `${onlyArea}.mjs`) continue;
  const cfg = (await import(pathToFileURL(join(dir, f)).href)).default;
  for (const [user, c] of Object.entries(cfg)) {
    plan[user] ??= { routes: [], api: [] };
    plan[user].routes.push(...(c.routes ?? []).map((r) => ({ area: f.replace('.mjs', ''), r })));
    plan[user].api.push(...(c.api ?? []).map((a) => ({ area: f.replace('.mjs', ''), a })));
  }
}

const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--disable-extensions', '--host-resolver-rules=MAP *.localhost 127.0.0.1'] });
let failures = 0;
const log = (ok, msg) => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
};

for (const [user, cfg] of Object.entries(plan)) {
  if (onlyUser && onlyUser !== user) continue;
  console.log(`\n== ${user} (${LOGINS[user]})`);
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width, height: 800 });
  let issues = [];
  page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && issues.push(`console.error: ${m.text().slice(0, 200)}`));
  page.on('pageerror', (e) => issues.push(`pageerror: ${e.message.slice(0, 200)}`));
  page.on('response', (r) => {
    const u = new URL(r.url());
    if (u.origin === new URL(BASE).origin && r.status() >= 400 && !/\/_next\//.test(u.pathname)) issues.push(`${r.status()} ${r.request().method()} ${u.pathname}${u.search.slice(0, 80)}`);
  });
  const api = (p) => page.evaluate(async (path) => { const res = await fetch(`/api/bff${path}`, { credentials: 'same-origin' }); return res.json(); }, p);
  try {
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.type('#identifier', LOGINS[user]);
    await page.type('#password', PASSWORD);
    await Promise.all([page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 45000 }), page.keyboard.press('Enter')]);
    log(true, `sign-in → ${new URL(page.url()).pathname}`);
    for (const { area, r } of cfg.routes) {
      issues = [];
      const route = typeof r === 'string' ? r : r.resolve ? await r.resolve(api) : r.path;
      const expect = typeof r === 'object' ? (r.expect ?? 200) : 200;
      const res = await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle2', timeout: 60000 });
      await new Promise((x) => setTimeout(x, 800));
      const status = res?.status() ?? 0;
      const h1 = await page.$$eval('h1', (els) => els.map((e) => e.textContent?.trim()).filter(Boolean));
      const hscroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
      const real = issues.filter((i) => !(expect === 404 && i.startsWith('404 GET')) && !(typeof r === 'object' && r.allow?.some((a) => i.includes(a))));
      const main = await page.evaluate(() => (document.querySelector('main') ?? document.body).innerText);
      // a failed query shows "We couldn’t load …"; a screen must never ship that on demo data
      const bodyErr = /Application error|Something went wrong|Unhandled Runtime Error|We couldn.t load/i.test(main);
      if (dump) console.log(`        ${main.replace(/\s+/g, ' ').slice(0, 420)}`);
      const expectedStatus = expect === 403 ? 200 : expect;
      log(status === expectedStatus && real.length === 0 && !hscroll && !bodyErr && (expect === 404 || h1.length === 1), `[${area}] ${status} ${route}  h1=${JSON.stringify(h1)}${hscroll ? '  HORIZONTAL SCROLL' : ''}${bodyErr ? '  ERROR TEXT ON PAGE' : ''}${real.length ? '\n        ' + real.join('\n        ') : ''}`);
    }
    for (const { area, a } of cfg.api) {
      const path = typeof a === 'string' ? a : a.path;
      const want = typeof a === 'object' ? (a.expect ?? 200) : 200;
      const r = await page.evaluate(async (p) => { const res = await fetch(`/api/bff${p}`, { credentials: 'same-origin' }); const body = await res.text(); return { status: res.status, bytes: body.length }; }, path);
      log(r.status === want, `[${area}] ${r.status} BFF ${path} (${r.bytes} bytes)`);
    }
  } catch (e) {
    log(false, `${user}: ${e.message.slice(0, 240)}`);
  }
  await ctx.close();
}
await browser.close();
console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
