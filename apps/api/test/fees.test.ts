import { createHmac } from 'node:crypto';
import { and, count, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { upsertSubscription } from '../src/core/billing/invoicing';
import { invalidateLicense } from '../src/core/billing/license';
import { addDaysIso, todayIn } from '../src/core/http';
import { putSetting } from '../src/core/settings';
import { controlDb } from '../src/core/tenancy/control-db';
import { invalidateTenant } from '../src/core/tenancy/registry';
import { tenants } from '../src/db/control/schema';
import { auditLogs, feeReminders, invoices, notifications, payments } from '../src/db/tenant/schema';
import { mockGateway } from '../src/modules/fees/gateway';
import { runFeeReminders } from '../src/modules/fees/jobs';
import { createTestSchool, type TestSchool } from './helpers';

let s: TestSchool;
const tok: Record<string, string> = {};
let today = '';

const sec = (i: number) => s.ctx.sections[i]!;
const studentsOf = (i: number) => s.ctx.students.filter((x) => x.sectionId === sec(i).id);
const guardianOf = (studentId: string) => s.ctx.guardians.find((g) => g.studentIds.includes(studentId))!;
const A = () => studentsOf(0)[0]!;
const B = () => studentsOf(0)[1]!;
const C = () => studentsOf(0)[2]!;
const D = () => studentsOf(0)[3]!;
const E = () => studentsOf(0)[4]!;
const money = (n: number) => n; // minor units, readable in tests

let catTuition = '';
let catTransport = '';
let structureId = '';
const inv: Record<string, any[]> = {}; // studentId -> invoices sorted by due date

async function invoicesOf(token: string | undefined, studentId: string) {
  const r = await s.req('GET', `/fees/invoices?studentId=${studentId}&pageSize=100`, token);
  expect(r.status).toBe(200);
  return (r.body.data as any[]).sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
}
async function setFeatures(patch: Record<string, boolean>) {
  const [row] = await controlDb().select().from(tenants).where(eq(tenants.id, s.tenant.id));
  await controlDb().update(tenants).set({ features: { ...row!.features, ...patch } }).where(eq(tenants.id, s.tenant.id));
  invalidateTenant(s.tenant.code);
}
/** a signed gateway webhook as the provider would deliver it */
function webhook(payload: { event?: string; orderId: string; paymentId?: string; amountMinor: number; currency?: string; notes?: Record<string, string> }, opts: { sign?: boolean; signature?: string; tenantHeader?: boolean } = {}) {
  const body = Buffer.from(
    JSON.stringify({ event: payload.event ?? 'payment.captured', payload: { payment: { entity: { id: payload.paymentId ?? `pay_${Math.random().toString(36).slice(2)}`, order_id: payload.orderId, amount: payload.amountMinor, currency: payload.currency ?? 'INR', status: 'captured', notes: payload.notes ?? { tenant: s.tenant.code } } } } }),
  );
  return s.app.inject({
    method: 'POST',
    url: '/api/v1/payments/webhook/mock',
    headers: { 'content-type': 'application/json', ...(opts.tenantHeader === false ? {} : { 'x-tenant': s.tenant.code }), ...(opts.sign === false ? {} : { 'x-mock-signature': opts.signature ?? mockGateway.sign(body) }) },
    payload: body,
  });
}

beforeAll(async () => {
  s = await createTestSchool();
  today = todayIn(s.tenant.timezone);
  for (const u of ['accounts', 'principal', 'office', 't001', 'hr']) tok[u] = await s.login(u);
  tok.admin = await s.login('admin@test.school');
  tok.studentA = await s.login(A().username);
  tok.studentB = await s.login(B().username);
  tok.parentA = await s.login(guardianOf(A().id).username);
  tok.parentB = await s.login(guardianOf(B().id).username);
  tok.parentOther = await s.login(guardianOf(studentsOf(1)[0]!.id).username);
  tok.unverified = await s.login('9099999999');
}, 120_000);

describe('OpenAPI contract', () => {
  it('documents every exams and fees route (the web and mobile clients are generated from it)', async () => {
    const res = await s.app.inject({ method: 'GET', url: '/api/v1/openapi.json' });
    expect(res.statusCode).toBe(200);
    const doc = JSON.parse(res.body);
    const paths = Object.keys(doc.paths);
    for (const p of ['/api/v1/exams', '/api/v1/exams/{id}/papers', '/api/v1/marks/sheets/{id}/entries', '/api/v1/results', '/api/v1/report-cards/{examId}/students/{studentId}/pdf', '/api/v1/grade-scales', '/api/v1/fees/invoices', '/api/v1/fees/dues/generate', '/api/v1/payments', '/api/v1/payments/webhook/{provider}', '/api/v1/payments/refunds/{id}/approve', '/api/v1/fees/invoices/{id}/pay', '/api/v1/expenses', '/api/v1/finance/summary']) {
      expect(paths, p).toContain(p);
    }
    const post = doc.paths['/api/v1/payments'].post;
    expect(post.responses['201']).toBeDefined();
    expect(JSON.stringify(post.parameters)).toContain('idempotency-key');
    for (const [path, ops] of Object.entries<any>(doc.paths)) {
      if (!/\/(exams|marks|results|report-cards|grade-scales|fees|payments|expenses|finance)(\/|$)/.test(path)) continue;
      for (const [method, op] of Object.entries<any>(ops)) expect(op.tags?.length, `${method} ${path} needs tags`).toBeGreaterThan(0);
    }
  });
});

describe('permission matrix (teachers: no fees)', () => {
  it('teachers and HR have no access to any fee, payment, expense or finance route', async () => {
    const reads = ['/fees/categories', '/fees/structures', '/fees/plans', '/fees/invoices', '/fees/concessions', '/payments', '/payments/refunds', '/expenses', '/expenses/summary', '/finance/summary', '/fees/reports/outstanding', '/fees/reports/defaulters', '/fees/reports/collection'];
    for (const path of reads) {
      expect((await s.req('GET', path, tok.t001)).status, `teacher ${path}`).toBe(403);
      expect((await s.req('GET', path, tok.hr)).status, `hr ${path}`).toBe(403);
    }
    expect((await s.req('POST', '/payments', tok.t001, { invoiceId: A().id, amountMinor: 100, method: 'cash' })).status).toBe(403);
    expect((await s.req('POST', '/fees/categories', tok.t001, { code: 'XX', name: 'Nope' })).status).toBe(403);
  });

  it('parents and students may only read their own scope; school-wide config is closed to them', async () => {
    for (const path of ['/fees/categories', '/fees/structures', '/fees/plans', '/payments/refunds', '/expenses', '/finance/summary', '/fees/reports/outstanding', '/fees/reports/defaulters']) {
      expect((await s.req('GET', path, tok.parentA)).status, `parent ${path}`).toBe(403);
      expect((await s.req('GET', path, tok.studentA)).status, `student ${path}`).toBe(403);
    }
    // parents hold payments:create at "linked" scope for online payment only: offline recording is staff-only
    expect((await s.req('POST', '/payments', tok.parentA, { invoiceId: A().id, amountMinor: 100, method: 'cash' })).status).toBe(403);
    expect((await s.req('POST', '/fees/dues/generate', tok.parentA, {})).status).toBe(403);
  });
});

describe('fee set-up, plans and dues', () => {
  it('creates categories and a structure with instalment items (accounts only)', async () => {
    expect((await s.req('POST', '/fees/categories', tok.office, { code: 'TUI', name: 'Tuition' })).status).toBe(403); // administrator has no fees permissions
    const t = await s.req('POST', '/fees/categories', tok.accounts, { code: 'tui', name: 'Tuition' });
    expect(t.status).toBe(201);
    expect(t.body.code).toBe('TUI');
    catTuition = t.body.id;
    catTransport = (await s.req('POST', '/fees/categories', tok.accounts, { code: 'TRN', name: 'Transport' })).body.id;
    expect((await s.req('POST', '/fees/categories', tok.accounts, { code: 'TUI', name: 'Dup' })).status).toBe(409);
    const y = today.slice(0, 4);
    const items = [
      { categoryId: catTuition, label: 'Tuition - Term 1', amountMinor: money(600000), dueDate: `${y}-06-10` },
      { categoryId: catTransport, label: 'Transport - Term 1', amountMinor: money(100000), dueDate: `${y}-06-10` },
      { categoryId: catTuition, label: 'Tuition - Term 2', amountMinor: money(600000), dueDate: addDaysIso(today, 20) },
      { categoryId: catTransport, label: 'Transport - Term 2', amountMinor: money(100000), dueDate: addDaysIso(today, 20) },
      { categoryId: catTuition, label: 'Tuition - Term 3', amountMinor: money(600000), dueDate: addDaysIso(today, 90) },
    ];
    expect((await s.req('POST', '/fees/structures', tok.accounts, { name: 'Grade 6 fees', gradeId: sec(0).gradeId, items: [] })).status).toBe(422);
    const st = await s.req('POST', '/fees/structures', tok.accounts, { name: 'Grade 6 fees', gradeId: sec(0).gradeId, items });
    expect(st.status).toBe(201);
    expect(st.body.totalMinor).toBe(2_000_000);
    expect(st.body.items).toHaveLength(5);
    structureId = st.body.id;
    expect((await s.req('GET', `/fees/structures/${structureId}`, tok.principal)).status).toBe(200);
  });

  it('assigns plans singly and in bulk, rejecting a structure for another grade', async () => {
    const wrong = await s.req('POST', '/fees/plans', tok.accounts, { studentId: studentsOf(1)[0]!.id, structureId });
    expect(wrong.status).toBe(422);
    expect(wrong.body.code).toBe('GRADE_MISMATCH');
    const one = await s.req('POST', '/fees/plans', tok.accounts, { studentId: A().id, structureId });
    expect(one.status).toBe(201);
    expect((await s.req('POST', '/fees/plans', tok.accounts, { studentId: A().id, structureId })).status).toBe(409);
    const bulk = await s.req('POST', '/fees/plans/bulk', tok.accounts, { structureId, sectionId: sec(0).id });
    expect(bulk.body).toEqual({ assigned: 5, alreadyAssigned: 1, notEligible: 0 });
    const wholeSchool = await s.req('POST', '/fees/plans/bulk', tok.accounts, { structureId, gradeId: sec(1).gradeId });
    expect(wholeSchool.body).toMatchObject({ assigned: 0, notEligible: 6 });
    expect((await s.req('GET', `/fees/plans?sectionId=${sec(0).id}`, tok.accounts)).body.meta.total).toBe(6);
  });

  it('applies only APPROVED concessions when generating dues, and generation is idempotent', async () => {
    // B: 10% approved; C: fixed 150000 approved; A: 10% requested but still pending
    const req = (studentId: string, body: object) => s.req('POST', '/fees/concessions', tok.accounts, { studentId, ...body });
    const cb = await req(B().id, { name: 'Sibling discount', type: 'percent', value: 1000 });
    const cc = await req(C().id, { name: 'Merit scholarship', type: 'fixed', value: 150000, reason: 'Top rank' });
    const ca = await req(A().id, { name: 'Staff ward', type: 'percent', value: 1000 });
    expect([cb.status, cc.status, ca.status]).toEqual([201, 201, 201]);
    expect(ca.body.status).toBe('pending');
    // teachers/parents cannot request or approve
    expect((await s.req('POST', `/fees/concessions/${cb.body.id}/approve`, tok.parentB, {})).status).toBe(403);
    expect((await s.req('POST', `/fees/concessions/${cb.body.id}/approve`, tok.principal, {})).status).toBe(403); // principal can view fees, not approve them
    expect((await s.req('POST', '/fees/concessions', tok.parentB, { studentId: B().id, name: 'Please', type: 'percent', value: 5000 })).status).toBe(403);
    expect((await s.req('POST', '/fees/concessions', tok.accounts, { studentId: B().id, name: 'Too big', type: 'percent', value: 20000 })).status).toBe(422);
    expect((await s.req('POST', `/fees/concessions/${cb.body.id}/approve`, tok.accounts, { note: 'ok' })).body.status).toBe('approved');
    expect((await s.req('POST', `/fees/concessions/${cc.body.id}/approve`, tok.accounts, {})).body.status).toBe('approved');
    expect((await s.req('POST', `/fees/concessions/${cb.body.id}/approve`, tok.accounts, {})).status).toBe(409);
    const decided = await s.db.select().from(auditLogs).where(eq(auditLogs.action, 'fees.concession_approve'));
    expect(decided).toHaveLength(2);

    const gen = await s.req('POST', '/fees/dues/generate', tok.accounts, { structureId });
    expect(gen.status).toBe(200);
    expect(gen.body).toMatchObject({ plans: 6, invoicesCreated: 18, invoicesExisting: 0 });
    const again = await s.req('POST', '/fees/dues/generate', tok.accounts, { structureId });
    expect(again.body).toMatchObject({ invoicesCreated: 0, invoicesExisting: 18 });
    expect(await s.db.select({ n: count() }).from(invoices)).toEqual([{ n: 18 }]);

    for (const st of studentsOf(0)) inv[st.id] = await invoicesOf(tok.accounts, st.id);
    // instalments are grouped by due date: tuition + transport on the first two
    expect(inv[A().id]!.map((i) => i.totalMinor)).toEqual([700000, 700000, 600000]);
    expect(inv[A().id]!.every((i) => i.discountMinor === 0)).toBe(true); // pending concession is NOT applied
    expect(inv[B().id]!.map((i) => i.discountMinor)).toEqual([70000, 70000, 60000]); // 10%
    expect(inv[C().id]!.map((i) => i.discountMinor)).toEqual([150000, 0, 0]); // fixed amount drawn down on the first invoice
    const detail = await s.req('GET', `/fees/invoices/${inv[B().id]![0].id}`, tok.accounts);
    expect(detail.body.items.map((i: any) => i.discountMinor)).toEqual(expect.arrayContaining([60000, 10000]));
    expect(detail.body.balanceMinor).toBe(630000);
    // audited
    expect((await s.db.select().from(auditLogs).where(eq(auditLogs.action, 'fees.generate_dues'))).length).toBeGreaterThan(0);

    // approving A's concession later does not rewrite issued bills, but a voided + regenerated bill picks it up
    const caId = ca.body.id;
    await s.req('POST', `/fees/concessions/${caId}/approve`, tok.accounts, {});
    expect((await invoicesOf(tok.accounts, A().id))[0]!.discountMinor).toBe(0);
    const voided = await s.req('POST', `/fees/invoices/${inv[A().id]![1].id}/void`, tok.accounts, { reason: 'Re-issue with scholarship' });
    expect(voided.body.status).toBe('void');
    expect((await s.req('POST', `/fees/invoices/${inv[A().id]![1].id}/void`, tok.accounts, { reason: 'twice' })).status).toBe(409);
    const regen = await s.req('POST', '/fees/dues/generate', tok.accounts, { structureId, studentId: A().id });
    expect(regen.body).toMatchObject({ invoicesCreated: 1, invoicesExisting: 2 });
    const live = (await invoicesOf(tok.accounts, A().id)).filter((i) => i.status !== 'void');
    expect(live).toHaveLength(3);
    expect(live.find((i) => i.dueDate === inv[A().id]![1].dueDate)!.discountMinor).toBe(70000);
    inv[A().id] = live;
  });
});

describe('invoice visibility and derived fields', () => {
  it('scopes invoices: parent = linked children, student = self, unverified guardian = nothing', async () => {
    const mine = await s.req('GET', '/fees/invoices?pageSize=100', tok.parentA);
    expect(mine.body.meta.total).toBe(3);
    expect(new Set(mine.body.data.map((i: any) => i.studentId))).toEqual(new Set([A().id]));
    expect((await s.req('GET', '/fees/invoices?pageSize=100', tok.studentA)).body.meta.total).toBe(3);
    expect((await s.req('GET', '/fees/invoices', tok.parentOther)).body.meta.total).toBe(0);
    expect((await s.req('GET', '/fees/invoices', tok.unverified)).body.meta.total).toBe(0);
    expect((await s.req('GET', `/fees/invoices?studentId=${B().id}`, tok.parentA)).body.meta.total).toBe(0); // filtering by someone else's child yields nothing
    expect((await s.req('GET', '/fees/invoices?pageSize=100', tok.accounts)).body.meta.total).toBe(19); // 18 + the re-issued one (the voided original stays for staff)
    expect((await s.req('GET', '/fees/invoices?pageSize=100', tok.principal)).body.meta.total).toBe(19);
    expect((await s.req('GET', '/fees/invoices?status=void', tok.accounts)).body.meta.total).toBe(1);
    const other = inv[B().id]![0].id;
    for (const who of ['parentA', 'studentA', 'parentOther', 'unverified']) expect((await s.req('GET', `/fees/invoices/${other}`, tok[who])).status, who).toBe(404);
    expect((await s.req('GET', `/fees/invoices/${other}`, tok.parentB)).status).toBe(200);
    expect((await s.req('GET', `/fees/invoices/${other}`, tok.studentB)).status).toBe(200);
    expect((await s.req('GET', `/payments?studentId=${B().id}`, tok.parentA)).body.meta.total).toBe(0);
  });

  it('derives overdue and a late fee from the setting without storing it', async () => {
    await putSetting(s.db, 'fees', { lateFeePerDayMinor: 100 });
    const first = (await invoicesOf(tok.parentA, A().id))[0]!;
    const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${first.dueDate}T00:00:00Z`)) / 86_400_000);
    expect(days).toBeGreaterThan(0);
    expect(first).toMatchObject({ overdue: true, daysOverdue: days, lateFeeMinor: days * 100, balanceMinor: 700000, amountDueNowMinor: 700000 + days * 100 });
    const future = (await invoicesOf(tok.parentA, A().id))[1]!;
    expect(future).toMatchObject({ overdue: false, daysOverdue: 0, lateFeeMinor: 0 });
    expect((await s.req('GET', '/fees/invoices?overdue=true&pageSize=100', tok.accounts)).body.meta.total).toBe(6);
    const [row] = await s.db.select().from(invoices).where(eq(invoices.id, first.id));
    expect(row!.status).toBe('unpaid'); // nothing stored
    await putSetting(s.db, 'fees', { lateFeePerDayMinor: 0 });
  });
});

describe('recording payments', () => {
  it('records a partial offline payment, numbers the receipt and moves the invoice to partial', async () => {
    const invoice = inv[A().id]![0];
    expect((await s.req('POST', '/payments', tok.accounts, { invoiceId: invoice.id, amountMinor: 0, method: 'cash' })).status).toBe(422);
    expect((await s.req('POST', '/payments', tok.accounts, { invoiceId: invoice.id, amountMinor: 700001, method: 'cash' })).body.code).toBe('AMOUNT_EXCEEDS_BALANCE');
    expect((await s.req('POST', '/payments', tok.accounts, { invoiceId: invoice.id, amountMinor: 1000, method: 'bitcoin' })).status).toBe(422);
    const r = await s.req('POST', '/payments', tok.accounts, { invoiceId: invoice.id, amountMinor: 300000, method: 'cheque', reference: 'CHQ-004521' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ status: 'succeeded', amountMinor: 300000, method: 'cheque', reference: 'CHQ-004521', invoiceNo: invoice.invoiceNo });
    expect(r.body.receiptNo).toMatch(/^RCT-\d{4}-000001$/);
    const after = await s.req('GET', `/fees/invoices/${invoice.id}`, tok.parentA);
    expect(after.body).toMatchObject({ status: 'partial', paidMinor: 300000, balanceMinor: 400000 });
    expect(after.body.payments).toHaveLength(1);
    const log = await s.db.select().from(auditLogs).where(and(eq(auditLogs.action, 'payments.record'), eq(auditLogs.entityId, r.body.id)));
    expect(log).toHaveLength(1);
    expect((log[0]!.after as any).amountMinor).toBe(300000);
    // the parent sees it in their payment history; another family does not
    expect((await s.req('GET', '/payments', tok.parentA)).body.data.map((p: any) => p.id)).toContain(r.body.id);
    expect((await s.req('GET', `/payments/${r.body.id}`, tok.parentOther)).status).toBe(404);
    expect((await s.req('GET', `/payments/${r.body.id}`, tok.unverified)).status).toBe(404);
  });

  it('never double-records a retried request with the same Idempotency-Key (even concurrently)', async () => {
    const invoice = inv[B().id]![0]; // payable 630000
    const key = 'retry-key-0001';
    const send = () => s.app.inject({ method: 'POST', url: '/api/v1/payments', headers: { 'x-tenant': s.tenant.code, authorization: `Bearer ${tok.accounts}`, 'content-type': 'application/json', 'idempotency-key': key }, payload: JSON.stringify({ invoiceId: invoice.id, amountMinor: 200000, method: 'upi', reference: 'UPI-1' }) });
    const [r1, r2] = await Promise.all([send(), send()]);
    const bodies = [JSON.parse(r1.body), JSON.parse(r2.body)];
    expect([r1.statusCode, r2.statusCode].sort()).toEqual([200, 201]);
    expect(bodies[0].id).toBe(bodies[1].id);
    const r3 = await send(); // a later retry
    expect(r3.statusCode).toBe(200);
    expect(r3.headers['idempotent-replayed']).toBe('true');
    expect(JSON.parse(r3.body).id).toBe(bodies[0].id);
    expect(await s.db.select({ n: count() }).from(payments).where(eq(payments.invoiceId, invoice.id))).toEqual([{ n: 1 }]);
    expect((await s.req('GET', `/fees/invoices/${invoice.id}`, tok.accounts)).body.paidMinor).toBe(200000);
    // the same key for a different amount is a client bug
    const clash = await s.app.inject({ method: 'POST', url: '/api/v1/payments', headers: { 'x-tenant': s.tenant.code, authorization: `Bearer ${tok.accounts}`, 'content-type': 'application/json', 'idempotency-key': key }, payload: JSON.stringify({ invoiceId: invoice.id, amountMinor: 1, method: 'upi' }) });
    expect(clash.statusCode).toBe(422);
    expect(JSON.parse(clash.body).code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('completes an invoice and then refuses more money; paid invoices cannot be voided', async () => {
    const invoice = inv[A().id]![0];
    const rest = await s.req('POST', '/payments', tok.accounts, { invoiceId: invoice.id, amountMinor: 400000, method: 'cash' });
    expect(rest.status).toBe(201);
    expect(rest.body.receiptNo).toMatch(/000003$|000002$/);
    const done = await s.req('GET', `/fees/invoices/${invoice.id}`, tok.accounts);
    expect(done.body).toMatchObject({ status: 'paid', balanceMinor: 0, paidMinor: 700000 });
    const more = await s.req('POST', '/payments', tok.accounts, { invoiceId: invoice.id, amountMinor: 100, method: 'cash' });
    expect(more.status).toBe(409);
    expect(more.body.code).toBe('ALREADY_PAID');
    expect((await s.req('POST', `/fees/invoices/${invoice.id}/void`, tok.accounts, { reason: 'mistake' })).body.code).toBe('HAS_PAYMENTS');
    expect((await s.req('GET', '/fees/invoices?status=paid', tok.accounts)).body.data.map((i: any) => i.id)).toContain(invoice.id);
  });

  it('adds the computed late fee to what can be paid', async () => {
    await putSetting(s.db, 'fees', { lateFeePerDayMinor: 50 });
    const invoice = inv[C().id]![0]; // payable 550000, long overdue
    const cur = (await s.req('GET', `/fees/invoices/${invoice.id}`, tok.accounts)).body;
    expect(cur.lateFeeMinor).toBeGreaterThan(0);
    expect((await s.req('POST', '/payments', tok.accounts, { invoiceId: invoice.id, amountMinor: cur.amountDueNowMinor + 1, method: 'cash' })).status).toBe(422);
    const ok = await s.req('POST', '/payments', tok.accounts, { invoiceId: invoice.id, amountMinor: cur.amountDueNowMinor, method: 'cash' });
    expect(ok.status).toBe(201);
    expect((await s.req('GET', `/fees/invoices/${invoice.id}`, tok.accounts)).body).toMatchObject({ status: 'paid', balanceMinor: 0 });
    await putSetting(s.db, 'fees', { lateFeePerDayMinor: 0 });
  });

  it('serves receipts as JSON and PDF to the payer’s family only', async () => {
    const [p] = (await s.req('GET', `/payments?invoiceId=${inv[A().id]![0].id}`, tok.parentA)).body.data;
    const rc = await s.req('GET', `/payments/${p.id}/receipt`, tok.parentA);
    expect(rc.status).toBe(200);
    expect(rc.body).toMatchObject({ receiptNo: p.receiptNo, currency: 'INR' });
    expect(rc.body.student.name).toBe(A().name);
    expect((await s.req('GET', `/payments/${p.id}/receipt`, tok.parentOther)).status).toBe(404);
    const pdf = await s.app.inject({ method: 'GET', url: `/api/v1/payments/${p.id}/receipt/pdf`, headers: { 'x-tenant': s.tenant.code, authorization: `Bearer ${tok.parentA}` } });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect((await s.app.inject({ method: 'GET', url: `/api/v1/payments/${p.id}/receipt/pdf`, headers: { 'x-tenant': s.tenant.code, authorization: `Bearer ${tok.parentOther}` } })).statusCode).toBe(404);
  });
});

describe('refunds', () => {
  let paymentId = '';
  let refundId = '';
  it('requests a refund (capped by what is left), approvers are notified', async () => {
    paymentId = (await s.req('GET', `/payments?invoiceId=${inv[A().id]![0].id}&pageSize=10`, tok.accounts)).body.data.find((p: any) => p.amountMinor === 300000).id;
    expect((await s.req('POST', `/payments/${paymentId}/refunds`, tok.parentA, { amountMinor: 1000, reason: 'please' })).status).toBe(403);
    expect((await s.req('POST', `/payments/${paymentId}/refunds`, tok.accounts, { amountMinor: 300001, reason: 'too much' })).body.code).toBe('REFUND_EXCEEDS_PAYMENT');
    const r = await s.req('POST', `/payments/${paymentId}/refunds`, tok.accounts, { amountMinor: 100000, reason: 'Duplicate cheque deposited' });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('requested');
    refundId = r.body.id;
    // open requests count against the available amount
    expect((await s.req('POST', `/payments/${paymentId}/refunds`, tok.accounts, { amountMinor: 250000, reason: 'second' })).status).toBe(422);
    const note = await s.db.select().from(notifications).where(eq(notifications.type, 'fees.refund_requested'));
    expect(note.map((n) => n.userId)).toContain((await s.req('GET', '/auth/me', tok.admin)).body.id);
    expect(note.map((n) => n.userId)).not.toContain((await s.req('GET', '/auth/me', tok.accounts)).body.id); // not the requester
    expect(note.every((n) => n.title === 'Refund awaiting approval')).toBe(true);
  });

  it('only payments:approve decides; approval adjusts payment and invoice in one go; everything is audited', async () => {
    for (const who of ['t001', 'parentA', 'principal', 'office']) expect((await s.req('POST', `/payments/refunds/${refundId}/approve`, tok[who], {})).status, who).toBe(403);
    expect((await s.req('GET', '/payments/refunds?status=requested', tok.accounts)).body.data.map((x: any) => x.id)).toContain(refundId);
    const ok = await s.req('POST', `/payments/refunds/${refundId}/approve`, tok.accounts, { note: 'Verified with bank' });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('processed');
    const pay = await s.req('GET', `/payments/${paymentId}`, tok.accounts);
    expect(pay.body).toMatchObject({ refundedMinor: 100000, status: 'partially_refunded' });
    const invoice = await s.req('GET', `/fees/invoices/${inv[A().id]![0].id}`, tok.accounts);
    expect(invoice.body).toMatchObject({ paidMinor: 600000, balanceMinor: 100000, status: 'partial' });
    expect(invoice.body.refunds).toHaveLength(1);
    expect((await s.req('POST', `/payments/refunds/${refundId}/approve`, tok.accounts, {})).status).toBe(409);
    const actions = (await s.db.select({ a: auditLogs.action }).from(auditLogs).where(eq(auditLogs.entityId, refundId))).map((x) => x.a);
    expect(actions).toEqual(expect.arrayContaining(['refunds.request', 'refunds.approve', 'refunds.process']));
    // the refund shows in the parent’s view of the invoice, not in another family's
    expect((await s.req('GET', `/fees/invoices/${inv[A().id]![0].id}`, tok.parentA)).body.refunds).toHaveLength(1);
  });

  it('can reject a request with a reason, and then the payment is untouched', async () => {
    const r = await s.req('POST', `/payments/${paymentId}/refunds`, tok.accounts, { amountMinor: 50000, reason: 'Parent changed mind' });
    expect((await s.req('POST', `/payments/refunds/${r.body.id}/reject`, tok.accounts, {})).status).toBe(422);
    const rej = await s.req('POST', `/payments/refunds/${r.body.id}/reject`, tok.accounts, { note: 'Not eligible' });
    expect(rej.body.status).toBe('rejected');
    expect((await s.req('GET', `/payments/${paymentId}`, tok.accounts)).body.refundedMinor).toBe(100000);
  });
});

describe('online payments (mock gateway) and the webhook', () => {
  let paymentId = '';
  let orderId = '';
  let invoiceId = '';
  it('is off until the school enables it, and only linked parents can start one', async () => {
    invoiceId = inv[D().id]![0].id;
    const off = await s.req('POST', `/fees/invoices/${invoiceId}/pay`, tok.parentA, {});
    expect(off.status).toBe(403); // wrong child (404 would also be fine) but first the feature gate
    await setFeatures({ onlinePayments: true });
    const stillOff = await s.req('POST', `/fees/invoices/${inv[A().id]![1].id}/pay`, tok.parentA, {});
    expect(stillOff.status).toBe(403);
    expect(stillOff.body.code).toBe('ONLINE_PAYMENTS_DISABLED'); // parentsCanPayOnline is still false
    await putSetting(s.db, 'fees', { parentsCanPayOnline: true });
  });

  it('creates a pending order — nothing is paid until the signed webhook arrives', async () => {
    const mine = inv[A().id]![1].id;
    for (const who of ['parentOther', 'unverified', 'parentB']) expect((await s.req('POST', `/fees/invoices/${mine}/pay`, tok[who], {})).status, who).toBe(404);
    expect((await s.req('POST', `/fees/invoices/${mine}/pay`, tok.t001, {})).status).toBe(403);
    expect((await s.req('POST', `/fees/invoices/${mine}/pay`, tok.studentA, {})).status).toBe(403);
    expect((await s.req('POST', `/fees/invoices/${mine}/pay`, tok.parentA, { amountMinor: 999_999_999 })).body.code).toBe('AMOUNT_EXCEEDS_BALANCE');
    const r = await s.req('POST', `/fees/invoices/${mine}/pay`, tok.parentA, { amountMinor: 250000 });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ provider: 'mock', amountMinor: 250000, currency: 'INR', mock: true });
    expect(r.body.orderId).toMatch(/^order_mock_/);
    paymentId = r.body.paymentId;
    orderId = r.body.orderId;
    invoiceId = mine;
    const pay = await s.req('GET', `/payments/${paymentId}`, tok.parentA);
    expect(pay.body).toMatchObject({ status: 'pending', method: 'online', receiptNo: null });
    expect((await s.req('GET', `/fees/invoices/${mine}`, tok.parentA)).body.paidMinor).toBe(0);
  });

  it('rejects unsigned, badly signed and tampered webhooks without touching anything', async () => {
    const ev = { orderId, amountMinor: 250000 };
    expect((await webhook(ev, { sign: false })).statusCode).toBe(400);
    const bad = await webhook(ev, { signature: 'f'.repeat(64) });
    expect(bad.statusCode).toBe(400);
    expect(JSON.parse(bad.body).code).toBe('INVALID_SIGNATURE');
    // signature computed for a different body (tampered amount)
    const good = Buffer.from(JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_x', order_id: orderId, amount: 1, currency: 'INR', notes: { tenant: s.tenant.code } } } } }));
    const forged = await s.app.inject({ method: 'POST', url: '/api/v1/payments/webhook/mock', headers: { 'content-type': 'application/json', 'x-tenant': s.tenant.code, 'x-mock-signature': mockGateway.sign(good) }, payload: Buffer.from(good.toString().replace('"amount":1', '"amount":250000')) });
    expect(forged.statusCode).toBe(400);
    expect((await s.req('GET', `/payments/${paymentId}`, tok.parentA)).body.status).toBe('pending');
    expect((await s.req('GET', '/payments/webhook/mock', null)).status).toBe(404); // GET is not a route
    expect((await s.app.inject({ method: 'POST', url: '/api/v1/payments/webhook/unknown', headers: { 'content-type': 'application/json' }, payload: '{}' })).statusCode).toBe(422);
  });

  it('ignores a validly signed event whose amount differs from the order (and records why)', async () => {
    const r = await webhook({ orderId, amountMinor: 100 });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).result).toBe('ignored');
    expect((await s.req('GET', `/payments/${paymentId}`, tok.parentA)).body.status).toBe('pending');
    expect((await s.db.select().from(auditLogs).where(eq(auditLogs.action, 'payments.online_mismatch'))).length).toBe(1);
  });

  it('settles on a valid signed webhook: receipt, invoice status, audit, notification — and is idempotent', async () => {
    const ev = { orderId, amountMinor: 250000, paymentId: 'pay_real_0001' };
    const r1 = await webhook(ev, { tenantHeader: false }); // school resolved from the order metadata (notes.tenant)
    expect(r1.statusCode).toBe(200);
    expect(JSON.parse(r1.body)).toEqual({ ok: true, result: 'succeeded' });
    const pay = (await s.req('GET', `/payments/${paymentId}`, tok.parentA)).body;
    expect(pay).toMatchObject({ status: 'succeeded', amountMinor: 250000 });
    expect(pay.receiptNo).toMatch(/^RCT-/);
    const invoice = (await s.req('GET', `/fees/invoices/${invoiceId}`, tok.parentA)).body;
    expect(invoice).toMatchObject({ status: 'partial', paidMinor: 250000, balanceMinor: 700000 - 70000 - 250000 });
    // second delivery of the same event + a concurrent pair: still exactly one credit
    const [r2, r3] = await Promise.all([webhook(ev), webhook(ev)]);
    expect([JSON.parse(r2.body).result, JSON.parse(r3.body).result]).toEqual(['duplicate', 'duplicate']);
    expect((await s.req('GET', `/fees/invoices/${invoiceId}`, tok.parentA)).body.paidMinor).toBe(250000);
    expect((await s.db.select().from(auditLogs).where(and(eq(auditLogs.action, 'payments.online_succeeded'), eq(auditLogs.entityId, paymentId)))).length).toBe(1);
    const n = await s.db.select().from(notifications).where(eq(notifications.type, 'fees.paid'));
    expect(n).toHaveLength(1);
    expect(n[0]!.userId).toBe(guardianOf(A().id).userId);
    expect(n[0]!.title).toBe('Payment received');
    // the receipt is available to the payer
    expect((await s.req('GET', `/payments/${paymentId}/receipt`, tok.parentA)).status).toBe(200);
  });

  it('handles failed events, unknown orders and reconciles a late webhook through the server-side sync', async () => {
    const mk = async (amountMinor: number) => (await s.req('POST', `/fees/invoices/${inv[A().id]![2].id}/pay`, tok.parentA, { amountMinor })).body;
    const f = await mk(100000);
    const fail = await webhook({ event: 'payment.failed', orderId: f.orderId, amountMinor: 100000 });
    expect(JSON.parse(fail.body).result).toBe('failed');
    expect((await s.req('GET', `/payments/${f.paymentId}`, tok.parentA)).body.status).toBe('failed');
    expect(JSON.parse((await webhook({ orderId: 'order_nope', amountMinor: 5 })).body).result).toBe('ignored');

    const late = await mk(120000);
    expect((await s.req('POST', `/payments/${late.paymentId}/sync`, tok.parentA)).body.status).toBe('pending'); // gateway has nothing yet
    mockGateway.capture({ orderId: late.orderId, amountMinor: 120000, currency: 'INR', notes: {} }); // the payer paid; the webhook never arrived
    const synced = await s.req('POST', `/payments/${late.paymentId}/sync`, tok.parentA);
    expect(synced.body.status).toBe('succeeded');
    expect((await s.req('POST', `/payments/${late.paymentId}/sync`, tok.parentOther)).status).toBe(404);
    // dev helper completes through the real webhook path
    const dev = await mk(80000);
    expect((await s.req('POST', `/payments/${dev.paymentId}/mock-complete`, tok.parentA)).body.status).toBe('succeeded');
    expect((await s.req('POST', `/payments/${dev.paymentId}/mock-complete`, tok.parentOther)).status).toBe(404);
  });

  it('online payments can be refunded through the same approval flow', async () => {
    const p = (await s.req('GET', `/payments?invoiceId=${inv[A().id]![2].id}&status=succeeded`, tok.accounts)).body.data[0];
    const r = await s.req('POST', `/payments/${p.id}/refunds`, tok.accounts, { amountMinor: p.amountMinor, reason: 'Paid twice by mistake' });
    const ok = await s.req('POST', `/payments/refunds/${r.body.id}/approve`, tok.accounts, {});
    expect(ok.body.status).toBe('processed');
    expect(ok.body.reference).toMatch(/^rfnd_mock_/); // gateway refund id
    expect((await s.req('GET', `/payments/${p.id}`, tok.accounts)).body.status).toBe('refunded');
  });
});

describe('Razorpay adapter: webhook signature verification (no network)', () => {
  it('accepts only an HMAC-SHA256 signature of the raw body made with the webhook secret', async () => {
    const saved = { ...process.env };
    Object.assign(process.env, { PAYMENT_GATEWAY: 'razorpay', RAZORPAY_KEY_ID: 'rzp_test_key', RAZORPAY_KEY_SECRET: 'rzp_test_secret', RAZORPAY_WEBHOOK_SECRET: 'whsec_unit_test' });
    try {
      const invoice = inv[D().id]![1]!;
      const [pending] = await s.db.insert(payments).values({ invoiceId: invoice.id, studentId: D().id, amountMinor: 100000, method: 'online', status: 'pending', gateway: 'razorpay', gatewayOrderId: 'order_rzp_unit_1' }).returning();
      const body = Buffer.from(JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_rzp_unit_1', order_id: 'order_rzp_unit_1', amount: 100000, currency: 'INR', status: 'captured', notes: { tenant: s.tenant.code } } } } }));
      const post = (sig: string | null) => s.app.inject({ method: 'POST', url: '/api/v1/payments/webhook/razorpay', headers: { 'content-type': 'application/json', ...(sig ? { 'x-razorpay-signature': sig } : {}) }, payload: body });
      const sign = (secret: string, b: Buffer) => createHmac('sha256', secret).update(b).digest('hex');
      expect((await post(null)).statusCode).toBe(400);
      expect((await post(sign('some-other-secret', body))).statusCode).toBe(400); // signed with the wrong secret
      expect((await post(sign('whsec_unit_test', Buffer.from(`${body.toString()} `)))).statusCode).toBe(400); // body changed after signing
      expect((await s.db.select().from(payments).where(eq(payments.id, pending!.id)))[0]!.status).toBe('pending');
      const ok = await post(sign('whsec_unit_test', body)); // school resolved from the order notes, no X-Tenant header
      expect(ok.statusCode).toBe(200);
      expect(JSON.parse(ok.body).result).toBe('succeeded');
      expect((await s.db.select().from(payments).where(eq(payments.id, pending!.id)))[0]).toMatchObject({ status: 'succeeded', gatewayPaymentId: 'pay_rzp_unit_1' });
      expect(JSON.parse((await post(sign('whsec_unit_test', body))).body).result).toBe('duplicate');
      // without configured keys the Razorpay endpoint refuses to act at all
      delete process.env.RAZORPAY_WEBHOOK_SECRET;
      expect((await post(sign('whsec_unit_test', body))).statusCode).toBe(503);
    } finally {
      for (const k of ['PAYMENT_GATEWAY', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET']) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
  });
});

describe('reports, expenses and the finance summary', () => {
  it('ages outstanding fees into buckets and lists defaulters with a guardian phone', async () => {
    const r = await s.req('GET', '/fees/reports/outstanding?groupBy=grade', tok.accounts);
    expect(r.status).toBe(200);
    const sum = Object.values(r.body.buckets as Record<string, number>).reduce((a, b) => a + b, 0);
    expect(sum).toBe(r.body.outstandingMinor);
    expect(r.body.overdueMinor).toBe(r.body.buckets.d1to30 + r.body.buckets.d31to60 + r.body.buckets.d61to90 + r.body.buckets.d90plus);
    expect(r.body.buckets.d90plus).toBeGreaterThan(0);
    expect(r.body.buckets.notDue).toBeGreaterThan(0);
    expect(r.body.rows).toHaveLength(1);
    expect((await s.req('GET', `/fees/reports/outstanding?groupBy=section&asOf=${addDaysIso(today, 365)}`, tok.principal)).body.buckets.notDue).toBe(0);

    const d = await s.req('GET', '/fees/reports/defaulters', tok.accounts);
    expect(d.status).toBe(200);
    expect(d.body.meta.total).toBeGreaterThanOrEqual(4);
    const row = d.body.data.find((x: any) => x.studentId === E().id);
    expect(row.overdueMinor).toBeGreaterThan(0);
    expect(row.guardianPhone).toBe(guardianOf(E().id).username);
    expect(d.body.data[0].overdueMinor).toBeGreaterThanOrEqual(d.body.data[d.body.data.length - 1].overdueMinor);
    // fully paid students are not defaulters
    expect(d.body.data.map((x: any) => x.studentId)).not.toContain(C().id);
  });

  it('summarises collection by day/month, method and category', async () => {
    const r = await s.req('GET', `/fees/reports/collection?from=${today.slice(0, 7)}-01&to=${today}&groupBy=day`, tok.principal);
    expect(r.status).toBe(200);
    expect(r.body.collectedMinor).toBeGreaterThan(0);
    expect(r.body.refundedMinor).toBeGreaterThanOrEqual(100000);
    expect(r.body.netMinor).toBe(r.body.collectedMinor - r.body.refundedMinor);
    expect(r.body.series.reduce((t: number, x: any) => t + x.collectedMinor, 0)).toBe(r.body.collectedMinor);
    expect(r.body.byMethod.map((m: any) => m.method)).toEqual(expect.arrayContaining(['cash', 'cheque', 'upi', 'online']));
    expect(r.body.byMethod.reduce((t: number, x: any) => t + x.collectedMinor, 0)).toBe(r.body.collectedMinor);
    const cats = r.body.byCategory.map((c: any) => c.category);
    expect(cats).toEqual(expect.arrayContaining(['Tuition', 'Transport']));
    const monthly = await s.req('GET', `/fees/reports/collection?groupBy=month&from=${today.slice(0, 4)}-01-01&to=${today}`, tok.accounts);
    expect(monthly.body.series.every((x: any) => /^\d{4}-\d{2}$/.test(x.period))).toBe(true);
  });

  it('exports CSV only to fees:export holders (accounts), not to the principal or teachers', async () => {
    for (const path of ['/fees/reports/outstanding/export?groupBy=grade', '/fees/reports/defaulters/export', '/fees/reports/collection/export', '/payments/export', '/expenses/export']) {
      const ok = await s.app.inject({ method: 'GET', url: `/api/v1${path}`, headers: { 'x-tenant': s.tenant.code, authorization: `Bearer ${tok.accounts}` } });
      expect(ok.statusCode, path).toBe(200);
      expect(ok.headers['content-type'], path).toContain('text/csv');
      expect((await s.req('GET', path, tok.principal)).status, `principal ${path}`).toBe(403);
      expect((await s.req('GET', path, tok.t001)).status, `teacher ${path}`).toBe(403);
      expect((await s.req('GET', path, tok.parentA)).status, `parent ${path}`).toBe(403);
    }
    const csv = await s.app.inject({ method: 'GET', url: '/api/v1/fees/reports/defaulters/export', headers: { 'x-tenant': s.tenant.code, authorization: `Bearer ${tok.accounts}` } });
    expect(csv.body.replace(/^﻿/, '').split(/\r?\n/)[0]).toBe('Student,Admission no,Class,Section,Overdue invoices,Overdue (minor),Oldest due date,Max days overdue,Guardian,Guardian phone');
  });

  it('records expenses; amounts over the threshold wait for approval', async () => {
    const y = today;
    const small = await s.req('POST', '/expenses', tok.accounts, { category: 'Stationery', description: 'Chalk and markers', amountMinor: 250000, spentOn: y, paidTo: 'Ravi Stores' });
    expect(small.status).toBe(201);
    expect(small.body.status).toBe('approved');
    const big = await s.req('POST', '/expenses', tok.accounts, { category: 'Maintenance', description: 'Roof repair, block B', amountMinor: 4_500_000, spentOn: y });
    expect(big.body.status).toBe('pending');
    for (const who of ['t001', 'parentA', 'principal', 'office']) {
      const r = await s.req('POST', '/expenses', tok[who], { category: 'Misc', description: 'nope', amountMinor: 100, spentOn: y });
      expect(r.status, who).toBe(403);
    }
    expect((await s.req('GET', '/expenses', tok.principal)).status).toBe(200); // principal may view
    expect((await s.req('POST', `/expenses/${big.body.id}/approve`, tok.principal, {})).status).toBe(403);
    expect((await s.req('POST', `/expenses/${big.body.id}/approve`, tok.accounts, { note: 'Quote verified' })).body.status).toBe('approved');
    expect((await s.req('POST', `/expenses/${big.body.id}/approve`, tok.accounts, {})).status).toBe(409);
    expect((await s.req('POST', '/expenses', tok.accounts, { category: 'Events', description: 'x', amountMinor: 100, spentOn: y, receiptFileId: '019a0000-0000-7000-8000-000000000000' })).status).toBe(422); // unknown file
    const upd = await s.req('PATCH', `/expenses/${small.body.id}`, tok.accounts, { description: 'Chalk, markers, dusters' });
    expect(upd.body.description).toBe('Chalk, markers, dusters');
    // raising an approved expense above the threshold sends it back
    expect((await s.req('PATCH', `/expenses/${small.body.id}`, tok.accounts, { amountMinor: 3_000_000 })).body.status).toBe('pending');
    const sum = await s.req('GET', `/expenses/summary?from=${y.slice(0, 4)}-01-01&to=${y}`, tok.accounts);
    expect(sum.body.totalMinor).toBe(4_500_000);
    expect(sum.body.pendingMinor).toBe(3_000_000);
    expect(sum.body.byCategory.map((c: any) => c.category)).toContain('Maintenance');
    expect((await s.req('DELETE', `/expenses/${small.body.id}`, tok.accounts)).status).toBe(200);
    expect((await s.db.select().from(auditLogs).where(eq(auditLogs.action, 'expenses.delete'))).length).toBe(1);
  });

  it('gives management the collected / expenses / outstanding picture; expenses stay hidden without expenses:view', async () => {
    const r = await s.req('GET', '/finance/summary', tok.accounts);
    expect(r.status).toBe(200);
    expect(r.body.collectedMinor).toBeGreaterThan(0);
    expect(r.body.expensesMinor).toBe(4_500_000);
    expect(r.body.netPositionMinor).toBe(r.body.netCollectedMinor - 4_500_000);
    expect(r.body.outstandingMinor).toBeGreaterThan(0);
    expect(r.body.overdueMinor).toBeLessThanOrEqual(r.body.outstandingMinor);
    expect(r.body.collectionRatePercent).not.toBeNull();
    expect(r.body.pending).toMatchObject({ refunds: 0, concessions: 0 });
    expect((await s.req('GET', '/finance/summary', tok.principal)).body.expensesMinor).toBe(4_500_000);
    expect((await s.req('GET', '/finance/summary', tok.office)).status).toBe(403);
    expect((await s.req('GET', '/finance/summary', tok.parentA)).status).toBe(403);
  });
});

describe('reminders job', () => {
  it('reminds verified guardians once about invoices due in 3 days and overdue ones, idempotently', async () => {
    const created = await s.req('POST', '/fees/invoices', tok.accounts, { studentId: E().id, title: 'Annual day contribution', dueDate: addDaysIso(today, 3), items: [{ description: 'Annual day', amountMinor: 50000 }] });
    expect(created.status).toBe(201);
    const first = await runFeeReminders(s.tenant, s.db);
    expect(first.dueSoon).toBe(1);
    expect(first.overdue).toBeGreaterThanOrEqual(3);
    const notes = await s.db.select().from(notifications).where(eq(notifications.type, 'fees.due'));
    expect(notes.length).toBeGreaterThanOrEqual(4);
    expect(notes.every((n) => /^Fee payment (due soon|overdue)$/.test(n.title) && !/\d/.test(`${n.title}${n.body ?? ''}`))).toBe(true);
    const users = new Set(notes.map((n) => n.userId));
    expect(users.has(guardianOf(E().id).userId)).toBe(true);
    expect(users.has(E().userId)).toBe(false); // guardians only
    const pending = s.ctx.guardians.length; // unverified guardian is separate from ctx.guardians
    expect(pending).toBeGreaterThan(0);
    const unverifiedUser = (await s.req('GET', '/auth/me', tok.unverified)).body.id;
    expect(users.has(unverifiedUser)).toBe(false);
    // paid-in-full families (C) get nothing
    expect(users.has(guardianOf(C().id).userId)).toBe(false);
    const before = notes.length;
    const second = await runFeeReminders(s.tenant, s.db);
    expect(second).toEqual({ dueSoon: 0, overdue: 0 });
    expect((await s.db.select().from(notifications).where(eq(notifications.type, 'fees.due'))).length).toBe(before);
    // a week later the overdue ones are announced again, the due-soon one is not
    const week = await runFeeReminders(s.tenant, s.db, new Date(Date.now() + 8 * 86_400_000));
    expect(week.dueSoon).toBe(0);
    expect(week.overdue).toBeGreaterThanOrEqual(3);
    expect((await s.db.select({ n: count() }).from(feeReminders))[0]!.n).toBeGreaterThan(before - 1);
  });
});

describe('feature flag and read-only school', () => {
  it('answers 403 FEATURE_DISABLED on every fees route when the module is off for the school', async () => {
    await setFeatures({ fees: false });
    for (const [m, path] of [['GET', '/fees/invoices'], ['GET', '/fees/structures'], ['GET', '/payments'], ['POST', '/payments'], ['GET', '/expenses'], ['GET', '/finance/summary'], ['GET', '/fees/reports/outstanding']] as const) {
      for (const who of ['accounts', 'parentA', 'admin']) {
        const r = await s.req(m, path, tok[who], m === 'POST' ? { invoiceId: A().id, amountMinor: 1, method: 'cash' } : undefined);
        expect(r.status, `${who} ${m} ${path}`).toBe(403);
        expect(r.body.code).toBe('FEATURE_DISABLED');
      }
    }
    // other modules are unaffected
    expect((await s.req('GET', '/auth/me', tok.parentA)).status).toBe(200);
    // the webhook does not 500 or record anything for a school without fees
    const r = await webhook({ orderId: 'order_x', amountMinor: 1 });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).result).toBe('ignored');
    // the reminders job skips the school
    expect(await runFeeReminders({ ...s.tenant, features: { ...s.tenant.features, fees: false } }, s.db)).toEqual({ dueSoon: 0, overdue: 0 });
    await setFeatures({ fees: true });
    expect((await s.req('GET', '/fees/invoices', tok.accounts)).status).toBe(200);
  });

  it('refuses writes with 402 once the subscription has lapsed, but reads still work', async () => {
    await upsertSubscription({ tenantCode: s.tenant.code, academicYear: '2020-21', startsOn: '2020-04-01', endsOn: '2021-03-31', pricePerStudent: 100, licensedStudents: 12, graceDays: 10 });
    await upsertSubscription({ tenantCode: s.tenant.code, academicYear: s.ctx.yearName, startsOn: '2000-01-01', endsOn: '2001-01-01', pricePerStudent: 100, licensedStudents: 12, graceDays: 10 });
    invalidateLicense(s.tenant.id);
    const w = await s.req('POST', '/payments', tok.accounts, { invoiceId: inv[E().id]![0].id, amountMinor: 100, method: 'cash' });
    expect(w.status).toBe(402);
    expect(w.body.code).toBe('SUBSCRIPTION_EXPIRED');
    expect((await s.req('POST', '/fees/dues/generate', tok.accounts, {})).status).toBe(402);
    expect((await s.req('POST', '/expenses', tok.accounts, { category: 'x', description: 'blocked', amountMinor: 1, spentOn: today })).status).toBe(402);
    expect((await s.req('GET', '/fees/invoices', tok.parentA)).status).toBe(200);
    expect((await s.req('GET', '/payments', tok.accounts)).status).toBe(200);
  });
});
