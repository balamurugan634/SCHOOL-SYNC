// Text-only check of dialog / sheet / command-palette motion. No screenshots: it samples the element's on-screen box every frame.
//   flock -w 3600 /tmp/schoolsync-smoke.lock scripts/dev/heavy.sh -m 1500M -- pnpm --filter @school-sync/web verify:dialogs
// Guards two regressions:
//   1. an open animation that stacks with the centring transform (starts off-centre, then snaps) → horizontal offset must stay ~0 at EVERY frame
//   2. a panel that disappears instantly on close → it must stay mounted for the exit animation
import puppeteer from 'puppeteer-core';

const BASE = process.env.BASE_URL ?? 'http://demo.localhost:3000';
const USER = process.env.USER_LOGIN ?? 'accounts';
const PASSWORD = process.env.PASSWORD ?? 'Demo@12345';

const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] });
const failures = [];
const fmt = (n) => (Math.round(n * 10) / 10).toString();

/** Run in the page: watch `selector` frame by frame; resolves with samples once `done()` is true or the time is up. */
const watchOpen = (page, selector, ms) =>
  page.evaluate(
    (selector, ms) =>
      new Promise((resolve) => {
        const samples = [];
        const t0 = performance.now();
        const tick = () => {
          const all = [...document.querySelectorAll(selector)];
          const el = all.at(-1) ?? null; // the TOPMOST match: a later dialog is appended after any dialog already open
          const t = performance.now() - t0;
          if (el) {
            const r = el.getBoundingClientRect();
            const cs = getComputedStyle(el);
            samples.push({ t, bottom: innerHeight - r.bottom, cx: r.left + r.width / 2 - innerWidth / 2, cy: r.top + r.height / 2 - innerHeight / 2, right: innerWidth - r.right, left: r.left, w: r.width, h: r.height, opacity: Number(cs.opacity) });
          }
          if (t < ms) requestAnimationFrame(tick);
          else resolve(samples);
        };
        requestAnimationFrame(tick);
      }),
    selector,
    ms,
  );

/** After pressing Escape: how long does the panel stay in the DOM (the exit animation) and does its content stay put? */
const watchClose = (page, selector, ms) =>
  page.evaluate(
    (selector, ms) =>
      new Promise((resolve) => {
        const t0 = performance.now();
        let firstMissing = null;
        let minTextLen = Infinity;
        const tick = () => {
          const t = performance.now() - t0;
          const el = [...document.querySelectorAll(selector)].at(-1) ?? null;
          if (el) minTextLen = Math.min(minTextLen, (el.textContent ?? '').trim().length);
          else if (firstMissing === null) firstMissing = t;
          if (firstMissing === null && t < ms) requestAnimationFrame(tick);
          else resolve({ removedAfterMs: firstMissing, minTextLen });
        };
        requestAnimationFrame(tick);
      }),
    selector,
    ms,
  );

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2', timeout: 90000 });
  await page.type('#identifier', USER);
  await page.type('#password', PASSWORD);
  await Promise.all([page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 60000 }), page.keyboard.press('Enter')]);
  await dismissTour(page);
}

/** The first-login welcome tour is itself a centred dialog; close it so it doesn't get measured instead of the dialog under test. */
async function dismissTour(page) {
  for (let i = 0; i < 6; i++) {
    const skipped = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => /skip tour|^skip$/i.test((x.textContent ?? '').trim()));
      if (b) { b.click(); return true; }
      return false;
    });
    if (skipped) { await new Promise((r) => setTimeout(r, 700)); return; }
    await new Promise((r) => setTimeout(r, 400));
  }
}

async function clickByText(page, re) {
  const ok = await page.evaluate((src) => {
    const re = new RegExp(src, 'i');
    const btn = [...document.querySelectorAll('button, a[role=button]')].find((b) => re.test(b.textContent ?? '') && !b.disabled);
    if (!btn) return false;
    btn.click();
    return true;
  }, re.source);
  if (!ok) throw new Error(`no enabled button matching ${re}`);
}

function judgeCentered(name, samples, { maxStartDy, verticalCentre = true, sheet = false }) {
  if (!samples.length) return failures.push(`${name}: never appeared`);
  const worstDx = Math.max(...samples.map((s) => Math.abs(s.cx)));
  const end = samples.at(-1);
  const startDy = Math.abs(samples[0].cy);
  console.log(`  ${name.padEnd(26)} frames ${String(samples.length).padStart(3)} | worst horizontal offset ${fmt(worstDx)} px | start vertical offset ${fmt(startDy)} px | final offset (${fmt(end.cx)}, ${fmt(end.cy)}) px`);
  if (worstDx > 1.5) failures.push(`${name}: horizontal offset reached ${fmt(worstDx)} px during the open animation (should stay ~0)`);
  if (Math.abs(end.cx) > 1.5) failures.push(`${name}: not horizontally centred when settled (${fmt(end.cx)})`);
  if (verticalCentre) {
    if (Math.abs(end.cy) > 1.5) failures.push(`${name}: not vertically centred when settled (${fmt(end.cy)})`);
    if (startDy > maxStartDy) failures.push(`${name}: starts ${fmt(startDy)} px from centre vertically (expected a small rise)`);
  } else if (!sheet && Math.abs(samples[0].cy - end.cy) > 16) failures.push(`${name}: travels ${fmt(Math.abs(samples[0].cy - end.cy))} px vertically while opening (expected a short rise)`);
}

try {
  const page = await browser.newPage();
  for (const [label, size] of [['desktop 1280x800', { width: 1280, height: 800 }], ['tablet 820x1180', { width: 820, height: 1180 }], ['phone 390x844', { width: 390, height: 844 }]]) {
    await page.setViewport(size);
    console.log(`\n${label}`);
    if (label.startsWith('desktop')) await login(page);

    // 1. command palette (Ctrl+K)
    await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle2', timeout: 90000 });
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyK');
    await page.keyboard.up('Control');
    judgeCentered('command palette', await watchOpen(page, '[cmdk-root]', 600).then(async (s) => (s.length ? s : watchOpen(page, '[role=dialog]', 600))), { maxStartDy: 400, verticalCentre: false });
    await page.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 400));

    // 2. a real dialog: "new category" on the fee setup page
    await page.goto(`${BASE}/admin/finance/structures?tab=categories`, { waitUntil: 'networkidle2', timeout: 90000 });
    await clickByText(page, /(new|add|create)\s+category/);
    const phone = size.width < 640;
    const dlg = await watchOpen(page, '[role=dialog]', 700);
    judgeCentered('dialog (new category)', dlg, { maxStartDy: 40, verticalCentre: !phone, sheet: phone }); // phone: a bottom sheet that slides up from the edge
    if (phone && Math.abs(dlg.at(-1)?.bottom ?? 99) > 1.5) failures.push(`phone dialog does not rest on the bottom edge (gap ${fmt(dlg.at(-1)?.bottom ?? NaN)} px)`);
    await page.keyboard.press('Escape');
    const closeDlg = await watchClose(page, '[role=dialog]', 1200);
    console.log(`  dialog exit: stays in the DOM ${closeDlg.removedAfterMs === null ? '>1200' : fmt(closeDlg.removedAfterMs)} ms, content kept (${closeDlg.minTextLen} chars)`);
    if (closeDlg.removedAfterMs !== null && closeDlg.removedAfterMs < 120) failures.push(`dialog vanished instantly on close (${fmt(closeDlg.removedAfterMs)} ms): no exit animation`);
    if (closeDlg.minTextLen === 0) failures.push('dialog content blanked while closing');

    // 3. a drawer: "new invoice"
    await page.goto(`${BASE}/admin/finance/invoices`, { waitUntil: 'networkidle2', timeout: 90000 });
    await page.waitForSelector('tbody tr', { timeout: 60000 });
    await page.evaluate(() => document.querySelector('tbody tr')?.click());
    const drawer = await watchOpen(page, '[role=dialog]', 800);
    const dEnd = drawer.at(-1);
    const rightEdge = drawer.length ? Math.min(...drawer.map((s) => s.right)) : NaN;
    console.log(`  drawer (invoice details)   frames ${String(drawer.length).padStart(3)} | settles at right gap ${fmt(dEnd?.right ?? NaN)} px, width ${fmt(dEnd?.w ?? NaN)} px, opacity ${dEnd?.opacity}`);
    if (!drawer.length) failures.push('drawer never appeared');
    else if (size.width >= 640 && Math.abs(dEnd.right) > 1.5) failures.push(`drawer does not end flush with the right edge (gap ${fmt(dEnd.right)} px)`);
    else if (size.width < 640 && (Math.abs(dEnd.bottom) > 1.5 || Math.abs(dEnd.cx) > 1.5)) failures.push(`phone drawer is not a full-width bottom sheet (bottom gap ${fmt(dEnd.bottom)} px, horizontal offset ${fmt(dEnd.cx)} px)`);
    void rightEdge;
    await page.keyboard.press('Escape');
    const closeDrawer = await watchClose(page, '[role=dialog]', 1200);
    console.log(`  drawer exit: stays in the DOM ${closeDrawer.removedAfterMs === null ? '>1200' : fmt(closeDrawer.removedAfterMs)} ms, content kept (${closeDrawer.minTextLen} chars)`);
    if (closeDrawer.removedAfterMs !== null && closeDrawer.removedAfterMs < 120) failures.push(`drawer vanished instantly on close (${fmt(closeDrawer.removedAfterMs)} ms)`);
    if (closeDrawer.minTextLen === 0) failures.push('drawer content blanked while closing');
  }
} catch (e) {
  failures.push(`script error: ${e instanceof Error ? e.message : e}`);
} finally {
  await browser.close();
}

console.log(failures.length ? `\nFAILED\n - ${failures.join('\n - ')}` : '\nALL PASSED');
process.exit(failures.length ? 1 : 0);
