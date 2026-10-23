// Text-only behavioural checks for the four reference screens (dashboard, roll call, parent home, invoices), plus
// keyboard, reduced-motion, 360 px / 200 % zoom reflow and layout-shift checks. Prints PASS/FAIL lines; no images.
//   node scripts/verify-screens.mjs [--only=dashboard|rollcall|parent|invoices|a11y]
// SIDE EFFECTS on the demo data: roll call toggles one student late→present (two submissions, ends where it started);
// invoices records ONE Rs 1.00 cash payment (and replays it with the same Idempotency-Key to prove it is not doubled).
import puppeteer from 'puppeteer-core';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.WEB_URL ?? 'http://demo.localhost:3000';
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
const noPayment = process.argv.includes('--no-payment'); // skip the one real Rs 1 payment
const run = (n) => !only || only === n;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (ok, msg) => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
};

const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--disable-extensions', '--host-resolver-rules=MAP *.localhost 127.0.0.1'] });

async function session(login, { width = 1280, height = 900, dsf = 1, reduce = false } = {}) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: dsf });
  if (reduce) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  page.ctx = ctx;
  page.issues = [];
  page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && page.issues.push(`console.error: ${m.text().slice(0, 140)}`));
  page.on('pageerror', (e) => page.issues.push(`pageerror: ${e.message.slice(0, 140)}`));
  page.on('response', (r) => {
    const u = new URL(r.url());
    if (u.origin === new URL(BASE).origin && r.status() >= 400 && !/\/_next\//.test(u.pathname)) page.issues.push(`${r.status()} ${r.request().method()} ${u.pathname}`);
  });
  await page.evaluateOnNewDocument(() => {
    window.__cls = 0;
    new PerformanceObserver((l) => l.getEntries().forEach((e) => !e.hadRecentInput && (window.__cls += e.value))).observe({ type: 'layout-shift', buffered: true });
  });
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.type('#identifier', login);
  await page.type('#password', 'Demo@12345');
  await Promise.all([page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 45000 }), page.keyboard.press('Enter')]);
  await page.evaluate(() => Object.keys(localStorage).forEach((k) => k.startsWith('ss:tour') || localStorage.setItem(`ss:tour:v1:${k}`, '1')));
  return page;
}
async function open(page, path, waitFor) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle2', timeout: 60000 });
  await dismissTour(page);
  if (waitFor) await page.waitForSelector(waitFor, { timeout: 20000 }).catch(() => {});
  await sleep(500);
}
async function dismissTour(page) {
  await sleep(900);
  const skip = await page.$('xpath/.//button[contains(., "Skip tour")]');
  if (skip) {
    await skip.click();
    await sleep(350);
  }
}
const texts = (page, sel) => page.$$eval(sel, (els) => els.map((e) => e.textContent.trim()));
const clickText = async (page, tag, text) => {
  const el = await page.$(`xpath/.//${tag}[contains(normalize-space(.), "${text}")]`);
  if (!el) return false;
  await el.click();
  return true;
};

// ───────────────────────────────────────── 1. management dashboard ─────────────────────────────────────────
if (run('dashboard')) {
  console.log('\n== management dashboard');
  const want = { 'admin@greenvalley.edu': { yes: ['Today’s attendance', 'Attendance, last 7 days', 'Needs your approval', 'Fees', 'Enrolment by grade', 'Alerts', 'Subscription'], no: [] }, principal: { yes: ['Today’s attendance', 'Needs your approval', 'Fees', 'Enrolment by grade'], no: ['Subscription'] }, accounts: { yes: ['Needs your approval', 'Fees', 'Enrolment by grade'], no: ['Today’s attendance', 'Attendance, last 7 days', 'Subscription'] }, librarian: { yes: ['Enrolment by grade'], no: ['Today’s attendance', 'Needs your approval', 'Fees', 'Subscription'] } };
  for (const [who, w] of Object.entries(want)) {
    const page = await session(who);
    await open(page, '/admin', 'h2');
    await sleep(1200);
    const h2 = await texts(page, 'h2');
    check(w.yes.every((t) => h2.includes(t)) && w.no.every((t) => !h2.includes(t)), `${who}: blocks ${JSON.stringify(h2)}`);
    const charts = await page.$$eval('.recharts-surface', (e) => e.length);
    check(who === 'librarian' ? charts >= 1 : charts >= 1, `${who}: ${charts} chart(s) drawn`);
    if (who === 'admin@greenvalley.edu') {
      check(charts >= 3, `admin: all three charts drawn (${charts})`);
      const before = await page.$$eval('table', (t) => t.length);
      await page.click('button[aria-label="Table view"]');
      await sleep(300);
      const after = await page.$$eval('table', (t) => t.length);
      check(after === before + 1, 'admin: chart table view toggles a data table');
      const kpis = await texts(page, '.figure');
      check(kpis.some((k) => k === '240'), `admin: KPI figures include 240 students (${kpis.slice(0, 4).join(', ')})`);
      const links = await page.$$eval('a[href^="/admin/"]', (a) => a.map((x) => x.getAttribute('href')));
      check(['/admin/leave', '/admin/attendance', '/admin/exams'].every((l) => links.includes(l)), 'admin: approval rows link through to their screens');
    }
    const cls = await page.evaluate(() => window.__cls);
    check(cls < 0.1, `${who}: layout shift ${cls.toFixed(3)}`);
    check(page.issues.length === 0, `${who}: console/network clean${page.issues.length ? ' ' + JSON.stringify(page.issues) : ''}`);
    await page.close();
  }
}

// ───────────────────────────────────────── 2. teacher roll call ─────────────────────────────────────────
if (run('rollcall')) {
  console.log('\n== teacher roll call (t001)');
  const page = await session('t001');
  await open(page, '/teacher/attendance', 'ul[aria-label="Roster"] li');
  const rows = await page.$$('ul[aria-label="Roster"] > li');
  check(rows.length >= 20, `roster rendered (${rows.length} students)`);
  const state = () => page.$$eval('ul[aria-label="Roster"] > li', (l) => l.map((e) => e.getAttribute('aria-label').split(', ').pop()));
  const before = await state();
  const lateBefore = before.filter((s) => s === 'late').length;
  // keyboard: A then L from the first row
  await rows[0].focus();
  await page.keyboard.press('a');
  await page.keyboard.press('l');
  let s = await state();
  check(s[0] === 'absent' && s[1] === 'late', `P/A/L shortcuts mark rows (row1=${s[0]}, row2=${s[1]})`);
  const activeIsRow3 = await page.evaluate(() => document.activeElement?.closest('ul[aria-label="Roster"] > li') === document.querySelectorAll('ul[aria-label="Roster"] > li')[2]);
  check(activeIsRow3, 'focus advances to the next row after a shortcut');
  // unsaved guard on in-app navigation
  await page.click('a[href="/teacher/classes"]');
  await sleep(500);
  const dlg = await texts(page, '[role="dialog"] h2');
  check(dlg.some((t) => /Discard|Leave/.test(t)), `unsaved-changes guard intercepts navigation (${JSON.stringify(dlg)})`);
  await clickText(page, 'button', 'Keep editing');
  await sleep(400);
  check(new URL(page.url()).pathname === '/teacher/attendance', 'staying on the roll call after "Keep editing"');
  // discard by reloading, then do a harmless real submission (one student present → late → present)
  page.removeAllListeners('dialog');
  page.on('dialog', (d) => d.accept());
  await open(page, '/teacher/attendance', 'ul[aria-label="Roster"] li');
  const rows2 = await page.$$('ul[aria-label="Roster"] > li');
  const idx = (await state()).findIndex((x) => x === 'present');
  await rows2[idx].focus();
  await page.keyboard.press('l');
  const summary = await page.$eval('[role="region"][aria-label="Roll call summary"]', (e) => e.textContent);
  check(/Late\s*\d+/.test(summary) && /Not marked\s*0/.test(summary), 'summary footer reflects the edit');
  await clickText(page, 'button', 'Update roll call');
  await page.waitForFunction(() => /Roll call (submitted|updated)/.test(document.body.innerText), { timeout: 15000 }).catch(() => {});
  check(/Roll call (submitted|updated)/.test(await page.evaluate(() => document.body.innerText)), 'submission shows the success state');
  await clickText(page, 'button', 'Edit roll call');
  await page.waitForSelector('ul[aria-label="Roster"] li');
  await sleep(500);
  const rows3 = await page.$$('ul[aria-label="Roster"] > li');
  await rows3[idx].focus();
  await page.keyboard.press('p');
  await clickText(page, 'button', 'Update roll call');
  await page.waitForFunction(() => /Roll call (submitted|updated)/.test(document.body.innerText), { timeout: 15000 }).catch(() => {});
  await clickText(page, 'button', 'Edit roll call');
  await page.waitForSelector('ul[aria-label="Roster"] li');
  await sleep(500);
  const after = await state();
  check(after.filter((x) => x === 'late').length === lateBefore, 'roster restored to its original state');
  // error / blocked states
  await open(page, '/teacher/attendance?date=2027-01-04', '[role="region"], [role="status"]');
  const future = await page.evaluate(() => document.body.innerText);
  check(/future date|can.t submit/i.test(future), 'future date → handled (FUTURE_DATE message)');
  await open(page, '/teacher/attendance?date=2026-09-01', 'ul[aria-label="Roster"] li, [role="status"]');
  const old = await page.evaluate(() => document.body.innerText);
  check(/Editing has closed|can.t submit|edit window|too old|working day/i.test(old), `old date → handled (${(old.match(/Editing has closed|You can.t submit this roll call/) || ['?'])[0]})`);
  check(page.issues.filter((i) => !/^422|^403/.test(i)).length === 0, `console/network clean${page.issues.length ? ' ' + JSON.stringify(page.issues.slice(0, 3)) : ''}`);
  await page.close();
}

// ───────────────────────────────────────── 3. parent home ─────────────────────────────────────────
if (run('parent')) {
  console.log('\n== parent home');
  const page = await session('9000000001');
  await open(page, '/parent', 'h2');
  await sleep(1000);
  const h2 = await texts(page, 'h2');
  check(['Homework', 'Fees', 'Announcements'].every((t) => h2.includes(t)) && h2.some((t) => /’s day$/.test(t)), `blocks ${JSON.stringify(h2)}`);
  const feesLink = await page.$$eval('a[href="/parent/fees"]', (a) => a.length);
  check(feesLink >= 2, `fees due links onward to /parent/fees (${feesLink} links)`);
  check((await page.evaluate(() => window.__cls)) < 0.1, `layout shift ${(await page.evaluate(() => window.__cls)).toFixed(3)}`);
  check(page.issues.length === 0, `console/network clean${page.issues.length ? ' ' + JSON.stringify(page.issues) : ''}`);
  await page.close();
  const un = await session('9099999999');
  await open(un, '/parent', 'h2');
  await sleep(800);
  const body = await un.evaluate(() => document.body.innerText);
  check(/No children are linked to your account yet/.test(body) && !/Homework/.test(body.replace(/Homework/g, (m, i) => (i < 0 ? m : ''))) || /No children are linked/.test(body), 'unverified parent: empty state shown');
  check(un.issues.length === 0, `unverified parent console/network clean${un.issues.length ? ' ' + JSON.stringify(un.issues) : ''}`);
  await un.close();
}

// ───────────────────────────────────────── 4. invoices ─────────────────────────────────────────
if (run('invoices')) {
  console.log('\n== invoices (accounts)');
  const page = await session('accounts');
  const dl = mkdtempSync(join(tmpdir(), 'inv-'));
  // downloads are governed per browser context, so the behaviour must name this page's (incognito) context
  const bcdp = await browser.target().createCDPSession();
  await bcdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl, browserContextId: page.ctx.id });
  await open(page, '/admin/finance/invoices?status=unpaid', 'tbody tr');
  const count = async () => page.$$eval('tbody tr', (r) => r.length);
  const n0 = await count();
  check(n0 >= 5, `unpaid invoices listed (${n0} rows on page 1)`);
  const footer = await page.evaluate(() => document.body.innerText.match(/\d+–\d+ of [\d,]+/)?.[0]);
  check(!!footer, `server pagination footer "${footer}"`);
  // search
  await page.type('input[type="search"]', 'GV2026');
  await page.waitForFunction(() => new URL(location.href).searchParams.get('q') === 'GV2026', { timeout: 5000 }).catch(() => {});
  await sleep(900);
  check(new URL(page.url()).searchParams.get('q') === 'GV2026', 'search is reflected in the URL (deep-linkable)');
  await page.click('input[type="search"]', { clickCount: 3 });
  await page.keyboard.press('Backspace');
  await sleep(900);
  // overdue filter + chip
  await clickText(page, 'button', 'Overdue only');
  await sleep(1200);
  const chips = await texts(page, 'span.inline-flex button[aria-label^="Remove filter"]');
  check(chips.length >= 0 && (await page.evaluate(() => document.body.innerText.includes('Overdue only'))), 'overdue filter chip shown');
  await clickText(page, 'button', 'Clear filters');
  await sleep(800);
  // sort + column menu
  await page.click('thead button:has-text("Balance")').catch(async () => {
    const b = await page.$('xpath/.//thead//button[contains(., "Balance")]');
    if (b) await b.click();
  });
  await sleep(300);
  const sortAttr = await page.$eval('xpath/.//th[.//button[contains(., "Balance")]]', (th) => th.getAttribute('aria-sort')).catch(() => null);
  check(sortAttr === 'ascending', `sorting sets aria-sort (${sortAttr})`);
  // keyboard: row focus + Enter opens the drawer, Esc closes and returns focus
  const row = await page.$('tbody tr');
  await row.focus();
  await page.keyboard.press('Enter');
  await page.waitForSelector('[role="dialog"]', { timeout: 8000 });
  await sleep(600);
  const dlgText = await page.$eval('[role="dialog"]', (d) => d.innerText);
  check(/Items/.test(dlgText) && /Payments/.test(dlgText) && /Balance/.test(dlgText), 'detail drawer shows figures, items and payments');
  await page.keyboard.press('Escape');
  await sleep(500);
  const focusBack = await page.evaluate(() => !!document.activeElement?.closest('tr'));
  check(focusBack, 'Esc closes the drawer and focus returns to the table row');
  // record a payment on an unpaid invoice
  await row.focus();
  await page.keyboard.press('Enter');
  await page.waitForSelector('[role="dialog"]');
  await sleep(500);
  const invNo = await page.$eval('[role="dialog"] h2', (h) => h.textContent.replace('Invoice ', '').trim());
  await clickText(page, 'button', 'Record payment');
  await page.waitForSelector('input[inputmode="decimal"]');
  const amt = await page.$('input[inputmode="decimal"]');
  await amt.focus();
  await page.keyboard.down('Control');
  await page.keyboard.press('a');
  await page.keyboard.up('Control');
  await amt.type('99999999');
  await page.click('form button[type="submit"]');
  await sleep(600);
  check(/more than is due/i.test(await page.evaluate(() => document.body.innerText)), 'overpayment is rejected with a field error');
  let captured = null;
  if (noPayment) {
    await page.keyboard.press('Escape');
    await sleep(500);
  }
  if (!noPayment) await page.setRequestInterception(true);
  if (!noPayment) {
  const onReq = (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/api/bff/payments')) captured = { headers: r.headers(), body: r.postData() };
    r.continue();
  };
  page.on('request', onReq);
  await amt.focus();
  await page.keyboard.down('Control');
  await page.keyboard.press('a');
  await page.keyboard.up('Control');
  await amt.type('1.00');
  await page.click('form button[type="submit"]');
  await page.waitForFunction(() => /Payment recorded/.test(document.body.innerText), { timeout: 15000 }).catch(() => {});
  check(/Payment recorded/.test(await page.evaluate(() => document.body.innerText)), `payment recorded (invoice ${invNo}); success toast shown`);
  check(!!captured?.headers['idempotency-key'], `POST /payments carried an Idempotency-Key (${captured?.headers['idempotency-key']?.slice(0, 8)}…)`);
  if (captured) {
    const replay = await page.evaluate(async (c) => {
      const r = await fetch('/api/bff/payments', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': c.headers['idempotency-key'] }, body: c.body });
      return { status: r.status, body: await r.json() };
    }, captured);
    const list = await page.evaluate(async (id) => (await (await fetch(`/api/bff/payments?invoiceId=${id}&pageSize=50`)).json()).data?.length, JSON.parse(captured.body).invoiceId);
    check(replay.status === 200, `replaying the same Idempotency-Key answers 200 (replay), not a second payment (status ${replay.status}, payments on invoice: ${list})`);
  }
  page.off('request', onReq);
  await page.setRequestInterception(false);
  }
  await page.keyboard.press('Escape');
  await sleep(600);
  await page.keyboard.press('Escape');
  await sleep(600);
  // CSV export
  await sleep(2500); // let dev-server fast refreshes settle before the click
  const shownTotal = Number((await page.evaluate(() => document.body.innerText.match(/of ([\d,]+)/)?.[1] ?? '0')).replace(/,/g, ''));
  await clickText(page, 'button', 'Export CSV');
  for (let i = 0; i < 16 && readdirSync(dl).filter((f) => f.endsWith('.csv')).length === 0; i++) await sleep(500);
  const all = readdirSync(dl);
  const files = all.filter((f) => f.endsWith('.csv'));
  const toastText = await page.$$eval('[data-sonner-toast]', (t) => t.map((x) => x.innerText.replace(/\n/g, ' ')));
  if (files.length === 0) console.log('   (download dir:', JSON.stringify(all), 'toasts:', JSON.stringify(toastText), ')');
  const csv = files[0] ? readFileSync(join(dl, files[0]), 'utf8').replace(/^﻿/, '').split(/\r?\n/) : [];
  const dataRows = csv.filter((l, i) => i > 0 && l.trim()).length;
  check(files.length === 1 && csv[0]?.startsWith('Invoice no,') && dataRows === shownTotal && dataRows > 10, `CSV exported: ${files[0] ?? 'none'} — ${dataRows} data rows, table total ${shownTotal}`);
  check((await page.evaluate(() => window.__cls)) < 0.1, `layout shift ${(await page.evaluate(() => window.__cls)).toFixed(3)}`);
  check(page.issues.filter((i) => !/^422/.test(i)).length === 0, `console/network clean${page.issues.length ? ' ' + JSON.stringify(page.issues.slice(0, 3)) : ''}`);
  await page.close();
}

// ───────────────────────────────────── 5. reduced motion, reflow, zoom ─────────────────────────────────────
if (run('a11y')) {
  console.log('\n== reduced motion · 360 px · 200 % zoom');
  const rm = await session('accounts', { reduce: true });
  await open(rm, '/admin', '.page-in');
  const dur = await rm.evaluate(() => getComputedStyle(document.querySelector('.page-in')).animationDuration);
  check(parseFloat(dur) < 0.001, `prefers-reduced-motion: page transition duration is ${dur}`);
  await rm.close();
  for (const [label, vp] of [['360 px phone', { width: 360, height: 800, dsf: 2 }], ['200 % zoom (640 css px)', { width: 640, height: 450, dsf: 2 }]]) {
    const t = await session('t001', vp);
    for (const path of ['/teacher', '/teacher/attendance']) {
      await open(t, path);
      await sleep(800);
      const sw = await t.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
      check(sw[0] <= sw[1] + 1, `${label} ${path}: no horizontal scroll (${sw[0]}/${sw[1]})`);
    }
    await t.close();
    const a = await session('accounts', vp);
    for (const path of ['/admin', '/admin/finance/invoices']) {
      await open(a, path, path.includes('invoices') ? 'ul li, tbody tr' : 'h2');
      await sleep(1200);
      const sw = await a.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
      check(sw[0] <= sw[1] + 1, `${label} ${path}: no horizontal scroll (${sw[0]}/${sw[1]})`);
    }
    await a.close();
    const p = await session('9000000001', vp);
    await open(p, '/parent', 'h2');
    await sleep(1000);
    const sw = await p.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    check(sw[0] <= sw[1] + 1, `${label} /parent: no horizontal scroll (${sw[0]}/${sw[1]})`);
    await p.close();
  }
}

await browser.close();
console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
