// Layout audit: crawls a role's navigation (plus tabs, a detail page and the first drawer of each list) and reports visual breakage as TEXT:
//   • overlapping text blocks (e.g. a heading with its description on top of it)
//   • text clipped without an ellipsis, controls whose content overflows their box
//   • horizontal page overflow
//   flock -w 3600 /tmp/schoolsync-smoke.lock scripts/dev/heavy.sh -m 1500M -- node scripts/audit-layout.mjs --role=admin [--width=1440]
import puppeteer from 'puppeteer-core';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const ROLE = arg('role', 'admin');
const WIDTH = Number(arg('width', '1440'));
const BASE = process.env.BASE_URL ?? 'http://demo.localhost:3000';
const LOGINS = { admin: 'admin@greenvalley.edu', teacher: 't001', student: 'gv20260001', parent: '9000000001' };
const MAX_ROUTES = Number(arg('max', '90'));

const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] });
let page = await browser.newPage();
await page.setViewport({ width: WIDTH, height: 900 });

/** runs in the page; `rootSel` limits the check to a dialog when one is open */
const inspect = (rootSel) =>
  page.evaluate((rootSel) => {
    const root = document.querySelector(rootSel) ?? document.body;
    const out = [];
    const vis = (el) => {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
      if (el.closest('details:not([open])') && !el.closest('summary')) return false; // collapsed <details> content is not on screen
      const r = el.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    };
    const label = (el) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.split(/\s+/).filter((c) => !/^(t-|tr-|bg-|text-|border-|px-|py-|flex|grid|min-|max-|w-|h-|gap-|space-|items-|justify-)/.test(c)).slice(0, 2).join('.') : ''} "${(el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 42)}"`;

    // 1. overlapping text blocks (neither contains the other)
    const texts = [...root.querySelectorAll('h1,h2,h3,h4,h5,legend,label,p,th,li,figcaption,[class*="t-section"],[class*="t-caption"],[class*="t-label"]')].filter((el) => vis(el) && (el.textContent ?? '').trim().length > 1 && ![...el.children].some((c) => /^(H[1-6]|P|LABEL)$/.test(c.tagName)));
    const rects = texts.map((el) => ({ el, r: el.getBoundingClientRect() }));
    // a sticky / fixed bar (form footer, bottom nav) is meant to sit over scrolled content
    const floats = (el) => { for (let n = el; n && n !== root.parentElement; n = n.parentElement) { const p = getComputedStyle(n).position; if (p === 'sticky' || p === 'fixed') return true; } return false; };
    for (const r of rects) r.float = floats(r.el);
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i], b = rects[j];
        if (a.float !== b.float) continue;
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
        const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (w > 4 && h > 4 && (w * h) / Math.min(a.r.width * a.r.height, b.r.width * b.r.height) > 0.25) out.push(`OVERLAP  ${label(a.el)}  ⟷  ${label(b.el)}`);
      }

    // 2. text clipped with no ellipsis; fixed-height controls whose content spills out
    for (const el of root.querySelectorAll('*')) {
      if (!vis(el) || !(el.textContent ?? '').trim()) continue;
      const cs = getComputedStyle(el);
      const clipsX = ['hidden', 'clip'].includes(cs.overflowX) && el.scrollWidth > el.clientWidth + 2 && cs.textOverflow !== 'ellipsis' && el.children.length === 0;
      const isControl = el.matches('button, [role=combobox], [role=tab], [role=option], input, select, th, [class*="badge"]');
      const spillsY = isControl && el.scrollHeight > el.clientHeight + 3 && el.clientHeight > 0;
      if (clipsX) out.push(`CLIPPED  ${label(el)} (${el.scrollWidth}px of ${el.clientWidth}px)`);
      else if (spillsY && cs.overflowY !== 'auto' && cs.overflowY !== 'scroll') out.push(`SPILLS   ${label(el)} (content ${el.scrollHeight}px in ${el.clientHeight}px box)`);
    }

    // 3. page-level horizontal overflow
    const de = document.documentElement;
    if (de.scrollWidth > innerWidth + 2) {
      const culprit = [...document.body.querySelectorAll('*')].filter((e) => vis(e) && e.getBoundingClientRect().right > innerWidth + 2).slice(0, 2).map(label);
      out.push(`H-SCROLL page is ${de.scrollWidth}px wide in ${innerWidth}px viewport; e.g. ${culprit.join(' | ')}`);
    }
    return [...new Set(out)];
  }, rootSel);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = [];
const seen = new Set();
async function check(where, rootSel = 'main') {
  const found = await inspect(rootSel).catch((e) => [`SCRIPT ${String(e).slice(0, 80)}`]);
  if (found.length) report.push({ where, found });
}

async function settle() {
  await page.waitForNetworkIdle({ idleTime: 500, timeout: 15000 }).catch(() => {});
  await sleep(250);
}

// ── sign in
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2', timeout: 90000 });
await page.type('#identifier', LOGINS[ROLE]);
await page.type('#password', 'Demo@12345');
await Promise.all([page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 60000 }), page.keyboard.press('Enter')]);
await sleep(1200);
await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /skip tour/i.test(b.textContent ?? ''))?.click());
await sleep(600);

// ── collect routes from the page files on disk (the sidebar's collapsed groups hide most links from the DOM)
const EXP = { admin: 'admin', teacher: 'teacher', student: 'student', parent: 'parent' }[ROLE];
const root = join(fileURLToPath(new URL('../src/app/(app)', import.meta.url)), EXP);
const fsRoutes = [];
(function walk(dir, rel) {
  for (const f of readdirSync(dir)) {
    const full = join(dir, f);
    if (statSync(full).isDirectory()) { if (!f.startsWith('[') && !f.startsWith('(')) walk(full, `${rel}/${f}`); }
    else if (f === 'page.tsx') fsRoutes.push(rel || '/');
  }
})(root, `/${EXP}`);
const hrefs = fsRoutes.map((r) => r.replace(/\/$/, '') || `/${EXP}`).filter((r) => !/\/new$/.test(r) || true);
const queue = hrefs.slice(0, MAX_ROUTES);
console.log(`${ROLE} @ ${WIDTH}px — ${queue.length} routes from disk`);

for (const href of queue) {
  if (seen.has(href)) continue;
  seen.add(href);
  try {
    await page.goto(`${BASE}${href}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await settle();
    await check(href);

    // tabs
    const tabs = await page.$$('[role=tablist] [role=tab]');
    for (let i = 1; i < Math.min(tabs.length, 7); i++) {
      const fresh = await page.$$('[role=tablist] [role=tab]');
      await fresh[i]?.click().catch(() => {});
      await settle();
      await check(`${href}  [tab ${i + 1}: ${await page.evaluate((i) => document.querySelectorAll('[role=tablist] [role=tab]')[i]?.textContent?.trim(), i)}]`);
    }

    // first drawer / dialog opened from a table row
    const row = await page.$('tbody tr[tabindex], tbody tr, ul.divide-y > li [role=button]');
    if (row) {
      await row.click().catch(() => {});
      await sleep(900); // a row either opens a drawer or navigates to the record (phone cards usually navigate)
      if (!new URL(page.url()).pathname.endsWith(href)) {
        await page.goto(`${BASE}${href}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await settle();
      } else if (await page.$('[role=dialog]').catch(() => null)) {
        await check(`${href}  [row drawer]`, '[role=dialog]');
        await page.keyboard.press('Escape');
        await sleep(500);
      }
    }

    // first detail page (a link inside a table row)
    const detail = await page.evaluate(() => document.querySelector('tbody a[href^="/"]')?.getAttribute('href') ?? null);
    if (detail && !seen.has(detail)) {
      seen.add(detail);
      await page.goto(`${BASE}${detail}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await settle();
      await check(`${detail}  [detail]`);
      const dtabs = await page.$$('[role=tablist] [role=tab]');
      for (let i = 1; i < Math.min(dtabs.length, 7); i++) {
        const fresh = await page.$$('[role=tablist] [role=tab]');
        await fresh[i]?.click().catch(() => {});
        await settle();
        await check(`${detail}  [detail tab ${i + 1}]`);
      }
      // edit drawers on the detail page
      const edit = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find((b) => /^(edit|edit details|change)/i.test((b.textContent ?? '').trim()) && !b.disabled) ?? null);
      if (edit.asElement()) {
        await edit.asElement().click().catch(() => {});
        await sleep(800);
        if (await page.$('[role=dialog]')) {
          await check(`${detail}  [edit drawer]`, '[role=dialog]');
          await page.keyboard.press('Escape');
          await sleep(500);
        }
      }
    }
  } catch (e) {
    report.push({ where: href, found: [`SCRIPT ${String(e).slice(0, 100)}`] });
    // a page that went stale must not poison the rest of the crawl: continue on a fresh tab (same session cookies)
    try { await page.close(); } catch {}
    page = await browser.newPage();
    await page.setViewport({ width: WIDTH, height: 900 });
  }
}
await browser.close();

console.log(`\n${report.length} page states with findings:`);
for (const r of report) console.log(`\n▸ ${r.where}\n   ${r.found.slice(0, 6).join('\n   ')}${r.found.length > 6 ? `\n   … +${r.found.length - 6} more` : ''}`);
if (!report.length) console.log('none — clean');
process.exit(0);
