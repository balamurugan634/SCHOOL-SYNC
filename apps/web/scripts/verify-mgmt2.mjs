// Text-only interaction check for the management screens, part 2 (finance, communication, operations). No screenshots.
// Drives the real UI in headless Chrome (click / type), reads toasts and the API afterwards, and cleans up what it creates
// (records are prefixed "zz-v2"). Run ONE at a time, under the shared lock:
//   flock -w 3600 /tmp/schoolsync-smoke.lock scripts/dev/heavy.sh -m 1500M -- node apps/web/scripts/verify-mgmt2.mjs [--flow=invoice]
import puppeteer from 'puppeteer-core';

const BASE = process.env.WEB_URL ?? 'http://demo.localhost:3000';
const PASSWORD = 'Demo@12345';
const only = process.argv.find((a) => a.startsWith('--flow='))?.slice(7);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const log = (ok, msg) => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
};

const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--disable-extensions', '--host-resolver-rules=MAP *.localhost 127.0.0.1'] });

async function session(login) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 160)}`));
  page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && errors.push(`console.error: ${m.text().slice(0, 160)}`));
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.type('#identifier', login);
  await page.type('#password', PASSWORD);
  await Promise.all([page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 45000 }), page.keyboard.press('Enter')]);
  await sleep(1200);
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /Skip tour/.test(b.textContent ?? ''))?.click());
  await sleep(300);
  const api = (path, method = 'GET', body) =>
    page.evaluate(async (p, m, b) => {
      const res = await fetch(`/api/bff${p}`, { method: m, credentials: 'same-origin', headers: b ? { 'content-type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined });
      const t = await res.text();
      return { status: res.status, body: t ? JSON.parse(t) : null };
    }, path, method, body);
  return { ctx, page, api, errors };
}

const goto = async (page, path) => {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(400);
};
/** the first element (of `sel`) whose visible text equals / starts with `text` */
async function byText(page, sel, text, { exact = true, root, last = false } = {}) {
  const h = await page.evaluateHandle(
    (s, t, ex, r, l) => {
      const scope = r ? document.querySelector(r) ?? document : document;
      const hits = [...scope.querySelectorAll(s)].filter((e) => {
        const x = (e.textContent ?? '').replace(/\s+/g, ' ').trim();
        return ex ? x === t : x.includes(t);
      });
      return l ? hits[hits.length - 1] : hits[0];
    },
    sel,
    text,
    exact,
    root ?? null,
    last,
  );
  return h.asElement();
}
async function clickText(page, sel, text, opts) {
  for (let i = 0; i < 25; i++) {
    const el = await byText(page, sel, text, opts);
    if (el) {
      await el.click();
      return;
    }
    await sleep(200);
  }
  throw new Error(`no ${sel} with text "${text}"`);
}
const waitText = (page, text, timeout = 12000) => page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, text);
/** input / select trigger / date button belonging to the <label> that starts with `label` */
async function fieldHandle(page, label, root = 'body') {
  const sel = await page.evaluate((l, r) => {
    const scope = document.querySelector(r) ?? document;
    const lab = [...scope.querySelectorAll('label')].find((e) => (e.textContent ?? '').replace(/[*\s]+/g, ' ').trim().startsWith(l));
    return lab?.htmlFor ? `#${CSS.escape(lab.htmlFor)}` : null;
  }, label, root);
  if (!sel) throw new Error(`no labelled field "${label}"`);
  await page.waitForSelector(sel, { timeout: 8000 });
  return page.$(sel);
}
const fill = async (page, label, text, root) => {
  const h = await fieldHandle(page, label, root);
  await h.click({ clickCount: 3 });
  await page.keyboard.press('Backspace');
  await h.type(text);
};
const choose = async (page, label, option, root) => {
  const h = await fieldHandle(page, label, root);
  await h.click();
  await page.waitForSelector('[role="option"]', { timeout: 8000 });
  await clickText(page, '[role="option"]', option, { exact: false });
  await sleep(150);
};
const pickDate = async (page, label, iso, root) => {
  const h = await fieldHandle(page, label, root);
  await h.click();
  await page.waitForSelector(`[data-day="${iso}"]`, { timeout: 8000 });
  await page.click(`[data-day="${iso}"]`);
  await sleep(150);
};
const pickStudent = async (page, q, root = 'body') => {
  await sleep(600); // let the dialog's open animation finish
  const btn = await page.$(`${root} button[aria-haspopup="listbox"]`);
  await btn.click();
  await page.keyboard.type(q);
  await page.waitForSelector('[role="listbox"] [role="option"] button', { timeout: 10000 });
  await page.click('[role="listbox"] [role="option"] button');
  await sleep(200);
};

async function flow(name, user, fn) {
  if (only && only !== name) return;
  console.log(`\n== ${name} (${user})`);
  let s;
  try {
    s = await session(user);
    await fn(s);
    const real = s.errors.filter((e) => !/Encountered two children/.test(e) || true);
    log(real.length === 0, `no console / page errors${real.length ? `: ${real.join(' | ')}` : ''}`);
  } catch (e) {
    log(false, `${name}: ${String(e.message).slice(0, 300)}\n        ${String(e.stack).split('\n').slice(1, 4).join('\n        ')}`);
  } finally {
    await s?.ctx.close();
  }
}

// ── finance ─────────────────────────────────────────────────────────────────────────────────
await flow('invoice', 'accounts', async ({ page, api }) => {
  await goto(page, '/admin/finance/invoices');
  await clickText(page, 'button', 'New invoice');
  await page.waitForSelector('[role="dialog"] form');
  await pickStudent(page, 'Ishaan', '[role="dialog"]');
  await fill(page, 'Title', 'zz-v2 test invoice', '[role="dialog"]');
  await pickDate(page, 'Due date', '2026-10-30', '[role="dialog"]');
  await fill(page, 'Description', 'zz-v2 charge', '[role="dialog"]');
  await fill(page, 'Amount', '125.50', '[role="dialog"]');
  await clickText(page, 'button', 'Create invoice');
  await waitText(page, 'created');
  log(true, 'one-off invoice created from the form (toast shown)');
  const list = await api('/fees/invoices?q=GV20260001&pageSize=100');
  const inv = list.body.data.filter((i) => i.title === 'zz-v2 test invoice' && i.status !== 'void').pop();
  log(!!inv && inv.totalMinor === 12550, `API has the invoice with total ${inv?.totalMinor} (12550 expected)`);
  // the drawer for the new invoice opens: void it with a reason
  await waitText(page, 'Void invoice');
  await clickText(page, 'button', 'Void invoice');
  await page.waitForSelector('[role="dialog"] textarea');
  await page.type('[role="dialog"] textarea', 'zz-v2 cleanup');
  await clickText(page, '[role="dialog"] button', 'Void invoice', { last: true });
  await page.waitForFunction(() => /Invoice INV-[\d-]+ voided/.test(document.body.innerText), { timeout: 12000 });
  const after = await api(`/fees/invoices/${inv.id}`);
  log(after.body.status === 'void', `invoice voided (status ${after.body.status}, reason "${after.body.voidReason}")`);
});

await flow('dues', 'accounts', async ({ page }) => {
  await goto(page, '/admin/finance/structures?tab=dues');
  await clickText(page, 'button', 'Preview what will be created', { exact: false });
  await waitText(page, 'Plans in scope');
  const t = await page.evaluate(() => document.querySelector('main').innerText.replace(/\s+/g, ' '));
  log(/Plans in scope \d+/.test(t) && /New invoices \(est\.\)/.test(t), `dues preview rendered: ${t.slice(t.indexOf('What will be created'), t.indexOf('What will be created') + 160)}`);
});

await flow('category-concession', 'accounts', async ({ page, api }) => {
  await goto(page, '/admin/finance/structures?tab=categories');
  await clickText(page, 'button', 'New category');
  await page.waitForSelector('[role="dialog"] form');
  // empty submit: inline validation (nothing is sent)
  await clickText(page, '[role="dialog"] button', 'Add category');
  await page.waitForFunction(() => /Use 2-20 letters|Too small|at least 2/i.test(document.querySelector('[role="dialog"]')?.innerText ?? ''), { timeout: 8000 });
  log(true, 'empty category form shows inline validation');
  // duplicate code: the API's refusal is shown in the form
  await fill(page, 'Code', 'ZZV2', '[role="dialog"]');
  await fill(page, 'Name', 'zz-v2 category', '[role="dialog"]');
  await clickText(page, '[role="dialog"] button', 'Add category');
  await page.waitForFunction(() => /already|exists/i.test(document.querySelector('[role="dialog"]')?.innerText ?? ''), { timeout: 10000 });
  log(true, 'duplicate category code is refused and the message is shown in the dialog');
  await page.keyboard.press('Escape');
  const cats = await api('/fees/categories');
  const cat = cats.body.data.find((c) => c.code === 'ZZV2');
  // concession: request then reject
  await goto(page, '/admin/finance/structures?tab=concessions');
  await clickText(page, 'button', 'Request a concession');
  await page.waitForSelector('[role="dialog"] form');
  await pickStudent(page, 'Ishaan', '[role="dialog"]');
  await fill(page, 'Concession name', 'zz-v2 concession', '[role="dialog"]');
  await fill(page, 'Percent', '5', '[role="dialog"]');
  await clickText(page, 'button', 'Send request');
  await waitText(page, 'Concession requested');
  const con = (await api('/fees/concessions?q=zz-v2&pageSize=5')).body.data.find((c) => c.name === 'zz-v2 concession');
  log(!!con && con.type === 'percent' && con.value === 500 && con.status === 'pending', `concession pending, 5% stored as ${con?.value} basis points`);
  if (con) {
    await goto(page, '/admin/finance/structures?tab=concessions&status=pending&q=zz-v2');
    await waitText(page, 'zz-v2 concession');
    await clickText(page, 'button', 'Reject', { root: 'main' });
    await page.waitForSelector('[role="dialog"]');
    await clickText(page, '[role="dialog"] button', 'Reject concession');
    await waitText(page, 'Concession rejected');
    const after = (await api('/fees/concessions?q=zz-v2&pageSize=5')).body.data.find((c) => c.id === con.id);
    log(after?.status === 'rejected', `concession rejected via the dialog (${after?.status})`);
  }
});

await flow('expense', 'accounts', async ({ page, api }) => {
  await goto(page, '/admin/finance/expenses');
  await clickText(page, 'button', 'New expense');
  await page.waitForSelector('[role="dialog"] form');
  await fill(page, 'Category', 'zz-v2', '[role="dialog"]');
  await fill(page, 'Amount', '321', '[role="dialog"]');
  await fill(page, 'What was it for', 'zz-v2 expense', '[role="dialog"]');
  // receipt upload: multipart POST /files (purpose=receipt) through the BFF
  const fileInput = await page.$('[role="dialog"] input[type="file"]');
  await fileInput.uploadFile('/tmp/claude-1000/-home-bala-SCHOOL-SYNC/7ee7c632-1dc9-4e9b-baf4-5a83fabfb252/scratchpad/mine/zz-v2.png');
  await page.waitForFunction(() => (document.querySelector('[role="dialog"]')?.innerText ?? '').includes('zz-v2.png'), { timeout: 15000 });
  log(true, 'receipt uploaded and listed in the form');
  await clickText(page, 'button', 'Record expense');
  await waitText(page, 'Expense recorded');
  const ex = (await api('/expenses?q=zz-v2&pageSize=5')).body.data.find((e) => e.description === 'zz-v2 expense');
  log(!!ex && ex.amountMinor === 32100 && ex.status === 'approved', `expense recorded (${ex?.amountMinor}, ${ex?.status})`);
  log(!!ex?.receiptFileId, `receipt attached to the expense (file ${ex?.receiptFileId?.slice(0, 8)})`);
  if (ex) {
    await goto(page, `/admin/finance/expenses?expense=${ex.id}`);
    await waitText(page, 'Delete');
    await clickText(page, '[role="dialog"] button', 'Delete', { exact: false });
    await page.waitForSelector('[role="alertdialog"], [role="dialog"] button');
    await sleep(300);
    await clickText(page, '[role="dialog"] button', 'Delete expense', { last: true });
    await waitText(page, 'Expense deleted');
    const gone = await api(`/expenses/${ex.id}`);
    log(gone.status === 404, `expense deleted (GET now ${gone.status})`);
  }
});

await flow('structure-form', 'accounts', async ({ page }) => {
  await goto(page, '/admin/finance/structures');
  await clickText(page, 'button', 'New fee structure', { root: 'main' });
  await page.waitForSelector('[role="dialog"] form');
  await sleep(500);
  await clickText(page, '[role="dialog"] button', 'Create structure');
  await page.waitForFunction(() => /Give the structure a name/.test(document.querySelector('[role="dialog"]')?.innerText ?? ''), { timeout: 8000 });
  const msgs = await page.evaluate(() => document.querySelector('[role="dialog"]').innerText);
  log(/Choose a category/.test(msgs) && /Name this fee/.test(msgs) && /Pick a due date/.test(msgs), 'empty structure form shows inline errors for name, category, fee name, amount and due date');
  await clickText(page, '[role="dialog"] button', 'Add instalment');
  const n = await page.$$eval('[role="dialog"] fieldset', (f) => f.length);
  log(n >= 2, `Add instalment adds a row (${n} fieldsets)`);
  await clickText(page, '[role="dialog"] button', 'Cancel');
  await waitText(page, 'Leave without saving?');
  log(true, 'unsaved-changes guard asks before discarding a dirty form');
  await clickText(page, '[role="dialog"] button', 'Discard and leave');
  await sleep(500);
  log((await page.$('[role="dialog"]')) === null, 'drawer closes after discarding');
});

await flow('refund-guard', 'principal', async ({ page }) => {
  // the principal can see refunds / concessions but every approve control is disabled with a reason
  await goto(page, '/admin/finance/payments?tab=refunds&rstatus=requested');
  await waitText(page, 'Approve');
  const disabled = await page.evaluate(() => [...document.querySelectorAll('main button')].filter((b) => /^(Approve|Reject)$/.test((b.textContent ?? '').trim())).every((b) => b.disabled));
  log(disabled, 'refund Approve / Reject are disabled for the principal');
  await goto(page, '/admin/reports/fees?tab=defaulters');
  await waitText(page, 'Export CSV');
  const exp = await page.evaluate(() => [...document.querySelectorAll('main button')].find((b) => /Export CSV/.test(b.textContent ?? ''))?.disabled);
  log(exp === true, 'CSV export is disabled for the principal (no export permission)');
});

// ── communication ───────────────────────────────────────────────────────────────────────────
await flow('announcement', 'office', async ({ page, api }) => {
  await goto(page, '/admin/communication/announcements/new');
  await fill(page, 'Title', 'zz-v2 announcement');
  await fill(page, 'Message', 'zz-v2 body');
  await clickText(page, 'button', 'Add', { root: 'form' });
  await clickText(page, 'button', 'Save draft');
  await page.waitForFunction(() => /announcements\/[0-9a-f-]{36}/.test(location.pathname), { timeout: 15000 });
  const id = page.url().match(/announcements\/([0-9a-f-]{36})/)[1];
  const a = (await api(`/announcements/${id}`)).body;
  log(a.state === 'draft' && a.audience[0]?.type === 'all', `draft saved with audience ${a.audience.map((x) => x.label)}`);
  await clickText(page, 'button', 'Schedule…', { exact: false, root: 'main' });
  await page.waitForSelector('[role="dialog"]');
  log(true, 'schedule dialog opens');
  await page.keyboard.press('Escape');
  await sleep(300);
  await clickText(page, 'button', 'Delete draft', { exact: false, root: 'main' });
  await page.waitForSelector('[role="dialog"]');
  await clickText(page, '[role="dialog"] button', 'Delete draft');
  await page.waitForFunction(() => location.pathname.endsWith('/communication/announcements'), { timeout: 15000 });
  const gone = await api(`/announcements/${id}`);
  log(gone.status === 404, `draft deleted (GET ${gone.status})`);
});

await flow('event', 'office', async ({ page, api }) => {
  await goto(page, '/admin/communication/events/new');
  await fill(page, 'Title', 'zz-v2 event');
  await clickText(page, 'button', 'Add', { root: 'form' });
  await clickText(page, 'button', 'Save draft');
  await page.waitForFunction(() => /events\/[0-9a-f-]{36}/.test(location.pathname), { timeout: 15000 });
  const id = page.url().match(/events\/([0-9a-f-]{36})/)[1];
  const e = (await api(`/events/${id}`)).body;
  log(e.status === 'draft' && e.allDay === true, `event draft saved (${e.startDate}, all day ${e.allDay})`);
  await clickText(page, 'button', 'Delete', { exact: true, root: 'main' }).catch(async () => clickText(page, 'button', 'Delete', { exact: false, root: 'main' }));
  await page.waitForSelector('[role="dialog"]');
  await clickText(page, '[role="dialog"] button', 'Delete event');
  await page.waitForFunction(() => location.pathname.endsWith('/communication/events'), { timeout: 15000 });
  const gone = await api(`/events/${id}`);
  log(gone.status === 404, `event deleted (GET ${gone.status})`);
});

// ── operations ──────────────────────────────────────────────────────────────────────────────
await flow('stops', 'transport', async ({ page, api }) => {
  const routes = (await api('/transport/routes?pageSize=1')).body.data[0];
  await goto(page, `/admin/operations/transport/routes/${routes.id}`);
  const before = (await api(`/transport/routes/${routes.id}`)).body.stops.map((s) => s.name);
  await clickText(page, 'button', `Move ${before[0]} down`, { exact: false }).catch(async () => page.click(`button[aria-label="Move ${before[0]} down"]`));
  await waitText(page, 'Stop order saved');
  const mid = (await api(`/transport/routes/${routes.id}`)).body.stops.map((s) => s.name);
  log(mid[0] === before[1] && mid[1] === before[0], `reorder saved: ${mid.slice(0, 2).join(' > ')}`);
  await page.click(`button[aria-label="Move ${before[0]} up"]`);
  await sleep(1500);
  const back = (await api(`/transport/routes/${routes.id}`)).body.stops.map((s) => s.name);
  log(back[0] === before[0], 'order restored');
  // add + delete a stop
  await clickText(page, 'button', 'Add stop', { exact: false, root: 'main' });
  await page.waitForSelector('[role="dialog"] form');
  await fill(page, 'Stop name', 'zz-v2 stop', '[role="dialog"]');
  await clickText(page, '[role="dialog"] button', 'Add stop');
  await waitText(page, 'Stop added');
  const st = (await api(`/transport/routes/${routes.id}`)).body.stops.find((s) => s.name === 'zz-v2 stop');
  log(!!st, 'stop added');
  if (st) await api(`/transport/stops/${st.id}`, 'DELETE');
});

await flow('book', 'librarian', async ({ page, api }) => {
  await goto(page, '/admin/operations/library');
  await clickText(page, 'button', 'Add book');
  await page.waitForSelector('[role="dialog"] form');
  await fill(page, 'Title', 'zz-v2 book', '[role="dialog"]');
  const acc = `ZZV2-${Date.now() % 1000000}`;
  await fill(page, 'Accession number', acc, '[role="dialog"]');
  await clickText(page, '[role="dialog"] button', 'Add book');
  await waitText(page, 'Book added');
  const b = (await api('/library/books?q=zz-v2&pageSize=5')).body.data.find((x) => x.accessionNo === acc);
  log(!!b && b.totalCopies === 1, 'book added to the catalogue');
  if (b) {
    // issue it to a student from the loans tab, then return it
    await goto(page, '/admin/operations/library?tab=loans');
    await clickText(page, 'button', 'Issue a book', { exact: false, root: 'main' });
    await page.waitForSelector('[role="dialog"]');
    const pick = await page.$$('[role="dialog"] button[aria-haspopup="listbox"]');
    await pick[0].click();
    await page.keyboard.type('zz-v2');
    await page.waitForSelector('[role="listbox"] [role="option"] button', { timeout: 10000 });
    await page.click('[role="listbox"] [role="option"] button');
    await sleep(300);
    const pick2 = await page.$$('[role="dialog"] button[aria-haspopup="listbox"]');
    await pick2[1].click();
    await page.keyboard.type('Ishaan');
    await page.waitForSelector('[role="listbox"] [role="option"] button', { timeout: 10000 });
    await page.click('[role="listbox"] [role="option"] button');
    await sleep(300);
    await clickText(page, '[role="dialog"] button', 'Issue book');
    await waitText(page, 'Book issued');
    const loan = (await api(`/library/issues?bookId=${b.id}&status=active`)).body.data[0];
    log(!!loan, `loan created, due ${loan?.dueOn}`);
    if (loan) {
      await goto(page, '/admin/operations/library?tab=loans&q=zz-v2');
      await page.waitForFunction(() => document.body.innerText.includes('zz-v2 book'));
      await clickText(page, 'button', 'Return', { root: 'main' });
      await page.waitForSelector('[role="dialog"]');
      await clickText(page, '[role="dialog"] button', 'Return book');
      await waitText(page, 'Book returned');
      const r = (await api(`/library/issues?bookId=${b.id}&status=all`)).body.data[0];
      log(r?.status === 'returned', `loan returned (${r?.status})`);
    }
    await api(`/library/books/${b.id}`, 'DELETE');
  }
});

await browser.close();
console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
