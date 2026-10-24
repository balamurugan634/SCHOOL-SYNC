// Text-only end-to-end check of the operator console (/platform): sign-in, forced password change, create a school,
// renew the subscription, meter, issue an invoice, mark it paid, billing / operators / audit pages, and a layout audit at 1280 and 390 px.
// No screenshots; it prints what it measured. Needs the dev stack (web :3000, API :4000) and an operator:
//   pnpm platform:operator --email operator@schoolsync.dev --password 'Console#Dev2026x'
//   flock -w 3600 /tmp/schoolsync-smoke.lock scripts/dev/heavy.sh -m 1500M -- node apps/web/scripts/verify-platform.mjs
// It creates the school `consoletestbrowser` and drops it again at the end (pnpm site:drop).
import { spawnSync } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const EMAIL = process.env.OPERATOR_EMAIL ?? 'operator@schoolsync.dev';
const PW1 = process.env.OPERATOR_PASSWORD ?? 'Console#Dev2026x';
const PW2 = process.env.OPERATOR_NEW_PASSWORD ?? 'Console#Dev2026y';
const CODE = 'consoletestbrowser';

const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: 'new', protocolTimeout: 180_000, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
page.setDefaultTimeout(90_000);

const failures = [];
const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(`${m.text()} @ ${page.url()}`);
});
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message} @ ${page.url()}`));

const log = (...a) => console.log(...a);
async function step(name, fn) {
  const t0 = Date.now();
  try {
    const out = await fn();
    log(`  ok   ${name}${out ? ` — ${out}` : ''} (${Date.now() - t0} ms)`);
  } catch (e) {
    failures.push(`${name}: ${e.message}`);
    log(`  FAIL ${name} — ${e.message}`);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const expectTrue = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

/** The form control that a <label> points to (labels start with `text`). */
async function control(text) {
  const h = await page.evaluateHandle((text) => {
    const l = [...document.querySelectorAll('label')].find((x) => x.textContent.trim().replace(/\s*\*$/, '').startsWith(text));
    return l ? (l.htmlFor ? document.getElementById(l.htmlFor) : l.control) : null;
  }, text);
  const el = h.asElement();
  if (!el) throw new Error(`no field labelled "${text}"`);
  return el;
}
async function fill(label, value) {
  const el = await control(label);
  await el.focus();
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  await el.type(value, { delay: 5 });
}
async function clickText(text, selector = 'button, a, [role=tab], [role=menuitem]', root = 'document') {
  // while a dialog is open or still animating out, Radix keeps body `pointer-events: none`; a click then goes nowhere
  if (root !== 'dialog') await page.waitForFunction(() => document.body.style.pointerEvents !== 'none', { timeout: 8000 }).catch(() => {});
  // a real mouse click (Radix tabs activate on mousedown, which a synthetic element.click() does not send)
  const h = await page.evaluateHandle(
    (text, selector, root) => {
      const scope = root === 'dialog' ? [...document.querySelectorAll('[role=dialog]')].at(-1) : document;
      return [...(scope?.querySelectorAll(selector) ?? [])].find((e) => e.textContent.replace(/\s+/g, ' ').trim().startsWith(text) && !e.disabled && e.offsetParent !== null) ?? null;
    },
    text,
    selector,
    root,
  );
  const el = h.asElement();
  if (!el) throw new Error(`nothing to click: "${text}"`);
  await el.click();
}
const waitText = (text, timeout = 90_000) => page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, text);
const h1 = () => page.evaluate(() => [...document.querySelectorAll('h1')].map((h) => h.textContent.trim()));
async function go(path, expectH1) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  if (expectH1) await page.waitForFunction((t) => [...document.querySelectorAll('h1')].some((h) => h.textContent.includes(t)), {}, expectH1);
}

log(`Operator console check against ${BASE}`);

await step('signed-out visit is sent to sign-in with ?next', async () => {
  await go('/platform/schools', 'Operator sign-in');
  expectTrue(page.url().includes('/platform/sign-in') && page.url().includes('next='), `url ${page.url()}`);
  const heads = await h1();
  expectTrue(heads.length === 1, `h1 count ${heads.length}`);
});

await step('school-style sign-in cookies are not accepted (a tenant cookie does not open the console)', async () => {
  await page.setCookie({ name: 'ss_at', value: 'x.y.z', url: BASE }, { name: 'ss_rt', value: 'a.b', url: BASE });
  await go('/platform/schools', 'Operator sign-in');
  await page.deleteCookie({ name: 'ss_at', url: BASE }, { name: 'ss_rt', url: BASE });
});

await step('wrong password shows a generic error', async () => {
  await go('/platform/sign-in', 'Operator sign-in');
  await fill('Email', EMAIL);
  await fill('Password', 'Not-the-password-1');
  await clickText('Sign in', 'button[type=submit]');
  await waitText('We couldn’t sign you in');
});

await step('sign in (forced password change on first use)', async () => {
  await go('/platform/sign-in', 'Operator sign-in');
  const attempt = async (pw) => {
    await fill('Email', EMAIL);
    await fill('Password', pw);
    await clickText('Sign in', 'button[type=submit]');
    await page.waitForFunction(() => !location.pathname.endsWith('/sign-in') || document.body.innerText.includes('We couldn’t sign you in'), { timeout: 60_000 });
    return !page.url().endsWith('/sign-in');
  };
  let ok = await attempt(PW1);
  let pw = PW1;
  if (!ok) {
    await go('/platform/sign-in', 'Operator sign-in');
    ok = await attempt(PW2);
    pw = PW2;
  }
  expectTrue(ok, 'could not sign in with either password');
  if (page.url().includes('/platform/change-password')) {
    await page.waitForFunction(() => document.body.innerText.includes('Choose a new password'));
    await fill('Temporary password', pw);
    await fill('New password', PW2);
    await fill('Confirm new password', PW2);
    await clickText('Save and continue', 'button[type=submit]');
    await page.waitForFunction(() => location.pathname.startsWith('/platform/schools'), { timeout: 60_000 });
  }
  await page.waitForFunction(() => [...document.querySelectorAll('h1')].some((h) => h.textContent.trim() === 'Schools'));
});

await step('cookies are HttpOnly and separate from school cookies', async () => {
  const cookies = await page.cookies();
  const names = cookies.map((c) => `${c.name}${c.httpOnly ? '(httpOnly)' : '(JS-visible)'}`);
  const op = cookies.filter((c) => c.name.startsWith('ss_p'));
  expectTrue(op.length >= 2 && op.every((c) => c.httpOnly), `cookies: ${names.join(', ')}`);
  expectTrue(!cookies.some((c) => c.name === 'ss_at' || c.name === 'ss_rt'), 'school cookies present');
  const leak = await page.evaluate(() => document.cookie);
  expectTrue(!/ss_p/.test(leak), 'operator cookie visible to JS');
  return names.join(', ');
});

await step('schools list renders (tiles, table, filters)', async () => {
  await page.waitForFunction(() => document.querySelector('table, ul.divide-y') !== null);
  const text = await page.evaluate(() => document.body.innerText);
  expectTrue(/Subscribed/.test(text) && /Need attention/.test(text), 'tiles missing');
  return `${(await page.$$('tbody tr')).length} rows`;
});

await step('create-school wizard: validation, code check, three steps', async () => {
  await clickText('Create school', 'a');
  await page.waitForFunction(() => [...document.querySelectorAll('h1')].some((h) => h.textContent.includes('Create a school')));
  // empty first step is refused
  await clickText('Continue', 'button');
  await waitText('Enter the school’s name');
  await fill('School name', 'Console Browser Test School');
  await fill('Site code', CODE);
  await waitText('This code is free', 30_000).catch(async () => {
    const t = await page.evaluate(() => document.querySelector('[role=status]')?.textContent);
    throw new Error(`code check says: ${t}`);
  });
  await clickText('Continue', 'button');
  await page.waitForFunction(() => document.body.innerText.includes('First administrator'));
  await fill('Full name', 'Browser Principal');
  await fill('Email', `principal@${CODE}.test`);
  await clickText('Continue', 'button');
  await page.waitForFunction(() => document.body.innerText.includes('Set up the subscription now'));
  await fill('Price per student', '150');
  await fill('Committed seats', '5');
  await sleep(200);
  const summary = await page.evaluate(() => document.querySelector('section[aria-label=Summary]')?.innerText ?? '');
  expectTrue(/₹/.test(summary) && /5 seats/.test(summary), `summary: ${summary.replace(/\s+/g, ' ')}`);
  return summary.replace(/\s+/g, ' ').slice(0, 140);
});

let oneTimePassword = '';
await step('create the school: the temporary password is shown once, with a copy button', async () => {
  await clickText('Create school', 'button[type=submit]');
  await page.waitForSelector('[data-testid=one-time-password]', { timeout: 120_000 });
  oneTimePassword = await page.$eval('[data-testid=one-time-password]', (e) => e.textContent.trim());
  expectTrue(oneTimePassword.length >= 12, `password "${oneTimePassword}"`);
  const copy = await page.$$eval('[role=dialog] button', (bs) => bs.filter((b) => /Copy password/.test(b.getAttribute('aria-label') ?? '')).length);
  expectTrue(copy === 1, 'copy button missing');
  const warn = await page.evaluate(() => document.querySelector('[role=dialog]').innerText.includes('shown only once'));
  expectTrue(warn, 'no one-time warning');
  return `password length ${oneTimePassword.length}`;
});

await step('closing the dialog opens the school; the password is gone for good', async () => {
  await clickText('I have copied it', 'button');
  await page.waitForFunction((c) => location.pathname === `/platform/schools/${c}`, {}, CODE);
  await page.waitForFunction(() => document.body.innerText.includes('Seats used'));
  const text = await page.evaluate(() => document.body.innerText);
  expectTrue(!text.includes(oneTimePassword), 'password still on the page');
  expectTrue(text.includes('Active'), 'no Active chip');
  const token = await page.evaluate((p) => JSON.stringify(Object.assign({}, localStorage, sessionStorage)).includes(p), oneTimePassword);
  expectTrue(!token, 'password in browser storage');
});

await step('the school really can sign in with it (school API, own database)', async () => {
  const r = await fetch('http://localhost:4000/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-tenant': CODE }, body: JSON.stringify({ identifier: `principal@${CODE}.test`, password: oneTimePassword }) });
  const j = await r.json();
  expectTrue(r.status === 200 && j.user?.mustChangePassword === true, `status ${r.status}`);
});

await step('subscription tab: renew for next year', async () => {
  await clickText('Subscription', '[role=tab]');
  await waitText('Current subscription');
  await clickText('Renew for next year', 'button');
  await page.waitForSelector('[role=dialog]');
  const year = await (await control('Academic year')).evaluate((e) => e.value);
  await clickText('Save subscription', 'button', 'dialog');
  await page.waitForFunction(() => !document.querySelector('[role=dialog]'), { timeout: 30_000 });
  await page.waitForFunction((y) => document.body.innerText.includes(y), {}, year);
  const rows = (await page.$$('tbody tr')).length;
  expectTrue(rows === 2, `history rows ${rows}`);
  return `renewed for ${year}`;
});

await step('usage tab: meter now and see the chart area', async () => {
  await clickText('Usage', '[role=tab]');
  await waitText('Billable students');
  await clickText('Meter now', 'button', 'document');
  await page.waitForFunction(() => document.body.innerText.includes('billable students on') || document.body.innerText.includes('Chart view'), { timeout: 60_000 });
  const has = await page.evaluate(() => !!document.querySelector('.recharts-wrapper, [aria-label="Chart view"]'));
  expectTrue(has, 'no chart / chart toggle');
});

await step('invoices tab: issue the seats invoice, then mark it paid with a reference', async () => {
  await clickText('Invoices', '[role=tab]');
  await waitText('No invoices yet');
  await clickText('Issue invoice', 'button', 'document');
  await page.waitForSelector('[role=dialog]');
  await waitText('This will bill 5 seats');
  await clickText('Issue invoice', 'button[type=submit]', 'dialog');
  await page.waitForFunction(() => document.body.innerText.includes('BIL-'), { timeout: 30_000 });
  await page.waitForFunction(() => !document.querySelector('[role=dialog]'));
  const row = await page.evaluate(() => document.querySelector('tbody tr')?.innerText.replace(/\s+/g, ' ') ?? '');
  expectTrue(/₹750(?!,)/.test(row), `row: ${row}`); // 5 seats x 150.00 = 750.00 (money is integer minor units: 75000)
  await clickText('Mark paid', 'button');
  await page.waitForSelector('[role=dialog]');
  await fill('Reference', 'NEFT-BROWSER-1');
  await clickText('Mark as paid', 'button[type=submit]', 'dialog');
  await page.waitForFunction(() => document.querySelector('tbody tr')?.innerText.includes('NEFT-BROWSER-1'), { timeout: 30_000 });
  return row.slice(0, 120);
});

await step('settings tab: feature switch is saved; suspend and resume', async () => {
  let stage = 'open tab';
  try {
    let attempts = 0;
    for (; attempts < 3; attempts++) {
      await clickText('Settings', '[role=tab]');
      const ok = await page.waitForFunction(() => document.body.innerText.includes('Feature switches'), { timeout: 4000 }).then(() => true, () => false);
      if (ok) break;
    }
    stage = 'wait Feature switches';
    await waitText('Feature switches', 15_000);
    log(`       (Settings tab needed ${attempts + 1} click${attempts ? 's' : ''})`);
    stage = 'toggle library';
    await page.click('#feat-library');
    stage = 'save switches';
    await clickText('Save switches', 'button');
    await waitText('School updated', 30_000);
    stage = 'open suspend dialog';
    await clickText('Suspend school', 'button');
    await page.waitForSelector('[role=dialog]', { timeout: 20_000 });
    stage = 'confirm suspend';
    await clickText('Suspend school', 'button', 'dialog');
    stage = 'wait suspended panel';
    await waitText('This school is suspended', 30_000);
    await page.waitForFunction(() => !document.querySelector('[role=dialog]'), { timeout: 10_000 });
    const r = await fetch('http://localhost:4000/api/v1/site/info', { headers: { 'x-tenant': CODE } });
    expectTrue(r.status === 403, `suspended school answered ${r.status}`);
    stage = 'open resume dialog';
    await clickText('Resume school', 'button');
    await page.waitForSelector('[role=dialog]', { timeout: 20_000 });
    stage = 'confirm resume';
    await clickText('Resume school', 'button', 'dialog');
    stage = 'wait resumed panel';
    await page.waitForFunction(() => document.body.innerText.includes('Suspend access'), { timeout: 30_000 });
    const r2 = await fetch('http://localhost:4000/api/v1/site/info', { headers: { 'x-tenant': CODE } });
    const j = await r2.json();
    expectTrue(r2.status === 200 && j.features.library === false, `resumed status ${r2.status}, library ${j.features?.library}`);
  } catch (e) {
    const t = (await page.evaluate(() => document.body.innerText).catch(() => '')).replace(/\s+/g, ' ').slice(0, 600);
    throw new Error(`at "${stage}": ${e.message}; page: ${t}`);
  }
});

await step('billing page: totals, school row, invoices tab', async () => {
  await go('/platform/billing', 'Billing');
  await page.waitForFunction(() => document.body.innerText.includes('Committed this year'));
  await waitText('Console Browser Test School');
  await clickText('Invoices', '[role=tab]');
  await waitText('BIL-');
  const t = await page.evaluate(() => document.body.innerText);
  expectTrue(/Paid/.test(t), 'no Paid chip');
});

await step('operators page lists me; audit log shows the actions with names', async () => {
  await go('/platform/operators', 'Operators');
  await waitText('Dev Operator');
  await go('/platform/audit', 'Audit log');
  await waitText('School created');
  const t = await page.evaluate(() => document.body.innerText);
  for (const w of ['Subscription saved', 'Invoice issued', 'Invoice marked paid', 'School suspended', 'School resumed']) expectTrue(t.includes(w), `audit missing "${w}"`);
  expectTrue(t.includes('Dev Operator'), 'audit does not name the operator');
});

// ── layout audit: no horizontal scroll, one h1, nothing wider than the viewport ──
const PAGES = [
  ['/platform/schools', 'Schools'],
  ['/platform/schools/new', 'Create a school'],
  [`/platform/schools/${CODE}`, 'Console Browser Test School'],
  [`/platform/schools/${CODE}?tab=subscription`, 'Console Browser Test School'],
  [`/platform/schools/${CODE}?tab=usage`, 'Console Browser Test School'],
  [`/platform/schools/${CODE}?tab=invoices`, 'Console Browser Test School'],
  [`/platform/schools/${CODE}?tab=settings`, 'Console Browser Test School'],
  ['/platform/billing', 'Billing'],
  ['/platform/billing?tab=invoices', 'Billing'],
  ['/platform/operators', 'Operators'],
  ['/platform/audit', 'Audit log'],
];
for (const width of [1280, 390]) {
  await page.setViewport({ width, height: width > 500 ? 900 : 800, isMobile: width < 500, hasTouch: width < 500 });
  for (const [path, title] of PAGES) {
    await step(`layout ${width}px ${path}`, async () => {
      await go(path, title);
      await page.waitForFunction(() => !document.querySelector('[aria-busy=true]') && !document.querySelector('.skeleton'), { timeout: 60_000 }).catch(() => {});
      await sleep(400);
      const m = await page.evaluate(() => {
        const w = innerWidth;
        const wide = [...document.querySelectorAll('body *')]
          .filter((e) => {
            const r = e.getBoundingClientRect();
            const cs = getComputedStyle(e);
            return r.width > 0 && r.right > w + 1 && cs.position !== 'fixed' && !e.closest('[data-radix-popper-content-wrapper], .recharts-wrapper, [class*="overflow-x-auto"], [class*="overflow-auto"]');
          })
          .slice(0, 4)
          .map((e) => `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 50)} right=${Math.round(e.getBoundingClientRect().right)}`);
        // WCAG 2.5.8: targets are at least 24x24 CSS px; exempt: the skip link (visually hidden until focused), inline breadcrumb text links and the shared 18 px checkbox (its label is the real target)
        const small = [...document.querySelectorAll('button, a[href], [role=tab], input:not([type=hidden])')]
          .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.height < 24 || r.width < 24) && !e.classList.contains('sr-only') && !e.closest('nav[aria-label=Breadcrumb]') && e.getAttribute('role') !== 'checkbox' && e.type !== 'checkbox'; })
          .map((e) => `${e.tagName.toLowerCase()}[${e.getAttribute('aria-label') ?? e.textContent.trim().slice(0, 18)}] ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`);
        return { scrollW: document.documentElement.scrollWidth, w, h1: document.querySelectorAll('h1').length, wide, small, title: document.title };
      });
      expectTrue(m.scrollW <= m.w + 1, `horizontal scroll: scrollWidth ${m.scrollW} > ${m.w}; wide: ${m.wide.join(' | ')}`);
      expectTrue(m.h1 === 1, `h1 count ${m.h1}`);
      expectTrue(m.wide.length === 0, `elements past the edge: ${m.wide.join(' | ')}`);
      expectTrue(m.small.length === 0, `controls smaller than 24x24: ${m.small.join(', ')}`);
      return `scrollWidth ${m.scrollW}/${m.w}, title "${m.title}"`;
    });
  }
}

await step('sign out ends the session', async () => {
  await page.setViewport({ width: 1280, height: 900 });
  await go('/platform/schools', 'Schools');
  await page.click('button[aria-label^="Account menu"]');
  await clickText('Sign out', '[role=menuitem]');
  await page.waitForFunction(() => location.pathname.endsWith('/sign-in'), { timeout: 30_000 });
  await go('/platform/billing', 'Operator sign-in');
});

await browser.close();

// cleanup: remove the test school (database + control rows)
const drop = spawnSync('pnpm', ['--filter', '@school-sync/api', 'exec', 'tsx', 'src/cli/site-drop.ts', '--code', CODE, '--yes'], { cwd: new URL('../../..', import.meta.url).pathname, encoding: 'utf8' });
log(drop.status === 0 ? `cleanup: dropped ${CODE}` : `cleanup FAILED for ${CODE}: ${drop.stderr}`);

const real = consoleErrors.filter((e) => !/favicon|Failed to load resource: the server responded with a status of (401|403|404|409|422|423)/.test(e));
log(`\nconsole errors (excluding expected 4xx): ${real.length}`);
for (const e of real.slice(0, 10)) log('  -', e.slice(0, 220));
log(failures.length ? `\n${failures.length} FAILED:\n  - ${failures.join('\n  - ')}` : '\nAll checks passed.');
process.exit(failures.length || real.length ? 1 : 0);
