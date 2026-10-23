// Text-only smoke for the management screens (part 1: academics, people, attendance, exams, settings). No screenshots.
// Route lists live in scripts/smoke-routes/<area>.mjs (one file per area, so agents never edit the same file):
//   export default { admin: { routes: ['/admin/academics/years', { resolve: async (api) => `/admin/people/students/${(await api('/students?pageSize=1')).data[0].id}` }], api: ['/academics/years'] }, hr: { ... } }
// For each route: HTTP status, exactly one <h1>, console errors / page errors, failing same-origin requests, horizontal scroll.
// A route object may set { expect: 200 | 403 | 404 } (default 200; a 403 page is the NoAccess screen and must still render a heading).
//   node scripts/smoke-mgmt1.mjs                 all areas, all users
//   node scripts/smoke-mgmt1.mjs --area=people   one area file
//   node scripts/smoke-mgmt1.mjs --only=hr      one user
//   node scripts/smoke-mgmt1.mjs --width=390     phone viewport (checks horizontal scroll)
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
const LOGINS = { admin: 'admin@greenvalley.edu', office: 'office', principal: 'principal', hr: 'hr' };

const dir = join(dirname(fileURLToPath(import.meta.url)), 'smoke-routes');
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
  let lastRoute = '(sign-in)';
  // an untouched screen must never raise the browser's leave-page prompt (a spurious unsaved-changes guard)
  page.on('dialog', (d) => { issues.push(`unexpected ${d.type()} dialog when leaving ${lastRoute}`); void d.accept(); });
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
      lastRoute = route;
      const status = res?.status() ?? 0;
      const h1 = await page.$$eval('h1', (els) => els.map((e) => e.textContent?.trim()).filter(Boolean));
      const hscroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
      const real = issues.filter((i) => !(expect === 404 && i.startsWith('404 GET')) && !(typeof r === 'object' && r.allow?.some((a) => i.includes(a))));
      const bodyErr = await page.evaluate(() => /Application error|Something went wrong|Unhandled Runtime Error/i.test(document.body.innerText.slice(0, 2000)));
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
