// Front-end performance probe: how long does a page take to become usable, how much main-thread work does it cost, and how
// responsive is it once there? CPU is throttled to mimic a modest laptop. Text output only.
//   flock -w 3600 /tmp/schoolsync-smoke.lock scripts/dev/heavy.sh -m 1500M -- node scripts/perf-pages.mjs --base=http://big.localhost:3400 --cpu=4
import puppeteer from 'puppeteer-core';

const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const BASE = arg('base', 'http://big.localhost:3400');
const CPU = Number(arg('cpu', '4'));
const USER = arg('user', 'admin@big.school');
const only = arg('only', '')?.split(',').filter(Boolean);

const ROUTES = [
  ['dashboard', '/admin'],
  ['students 25/page', '/admin/people/students'],
  ['students 100/page', '/admin/people/students?pageSize=100'],
  ['guardians 100/page', '/admin/people/guardians?pageSize=100'],
  ['invoices 100/page', '/admin/finance/invoices?pageSize=100'],
  ['school attendance', '/admin/attendance'],
  ['teaching assignments (48×8 grid)', '/admin/academics/assignments'],
  ['timetable editor', '/admin/academics/timetable'],
  ['roles list', '/admin/settings/roles'],
  ['fee reports', '/admin/reports/fees'],
  ['audit log', '/admin/settings/audit'],
];

const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const cdp = await page.createCDPSession();
await cdp.send('Performance.enable');

// collect long tasks (> 50 ms main-thread blocks) on every page load
await page.evaluateOnNewDocument(() => {
  window.__long = [];
  try {
    new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__long.push(e.duration))).observe({ type: 'longtask', buffered: true });
  } catch {}
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// sign in once (un-throttled)
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2', timeout: 120000 });
await page.type('#identifier', USER);
await page.type('#password', 'Demo@12345');
await Promise.all([page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 90000 }), page.keyboard.press('Enter')]);
await sleep(1500);
await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /skip tour/i.test(b.textContent ?? ''))?.click());
await sleep(500);

await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
console.log(`${BASE}   CPU ${CPU}× slower   (${USER})\n`);
console.log(`${'page'.padEnd(34)} ${'usable'.padStart(8)} ${'blocking'.padStart(9)} ${'longest'.padStart(8)} ${'DOM nodes'.padStart(10)} ${'JS heap'.padStart(8)} ${'rows'.padStart(5)}`);

for (const [name, path] of ROUTES) {
  if (only.length && !only.some((o) => name.includes(o))) continue;
  try {
    const t0 = Date.now();
    await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    // "usable" = the main landmark has content, no skeleton/busy placeholders, and the network has been quiet briefly
    await page.waitForFunction(() => !!document.querySelector('main h1') && !document.querySelector('.skeleton, [class*="skeleton"], [aria-busy="true"]'), { timeout: 60000 }).catch(() => {});
    await page.waitForNetworkIdle({ idleTime: 400, timeout: 30000 }).catch(() => {});
    const usable = Date.now() - t0;
    await sleep(600);
    const long = await page.evaluate(() => window.__long ?? []);
    const blocking = long.reduce((a, d) => a + Math.max(0, d - 50), 0);
    const m = await cdp.send('Performance.getMetrics');
    const heap = (m.metrics.find((x) => x.name === 'JSHeapUsedSize')?.value ?? 0) / 1048576;
    const stats = await page.evaluate(() => ({ nodes: document.querySelectorAll('*').length, rows: document.querySelectorAll('tbody tr').length }));
    console.log(`${name.padEnd(34)} ${(usable + 'ms').padStart(8)} ${(Math.round(blocking) + 'ms').padStart(9)} ${(Math.round(Math.max(0, ...long)) + 'ms').padStart(8)} ${String(stats.nodes).padStart(10)} ${(Math.round(heap) + 'MB').padStart(8)} ${String(stats.rows).padStart(5)}`);
  } catch (e) {
    console.log(`${name.padEnd(34)} ERROR ${String(e).slice(0, 90)}`);
  }
}

// interaction latency on the biggest table: type in search, change sort
await page.goto(`${BASE}/admin/people/students?pageSize=100`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('tbody tr', { timeout: 60000 }).catch(() => {});
await page.waitForNetworkIdle({ idleTime: 500, timeout: 20000 }).catch(() => {});
const input = await page.$('input[type=search], input[placeholder*="earch"]');
if (input) {
  const latency = await page.evaluate(async () => {
    const el = document.querySelector('input[type=search], input[placeholder*="earch"]');
    const t = performance.now();
    el.focus();
    return new Promise((res) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      set.call(el, 'a');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      requestAnimationFrame(() => requestAnimationFrame(() => res(performance.now() - t)));
    });
  });
  console.log(`\nkeystroke → next painted frame in the search box (100-row table): ${Math.round(latency)} ms`);
}
const th = await page.$('thead th button, thead th[aria-sort]');
if (th) {
  const t = await page.evaluate(async () => {
    const el = document.querySelector('thead th button') ?? document.querySelector('thead th[aria-sort]');
    const t0 = performance.now();
    el.click();
    return new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => res(performance.now() - t0))));
  });
  console.log(`click on a column header → next painted frame: ${Math.round(t)} ms`);
}
await browser.close();
