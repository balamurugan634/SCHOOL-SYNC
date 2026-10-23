import type { IncomingHttpHeaders } from 'node:http';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { PayOnlineOut, PaymentOut, ReceiptOut, RefundOut } from '@school-sync/shared';
import { paymentCreateBody, paymentListQuery, refundListQuery } from '@school-sync/shared';
import { audit, type AuditActor } from '../../core/audit';
import { AppError, conflict, forbidden, notFound, unprocessable } from '../../core/errors';
import { ilikeAny, pageArgs, paged as pagedResult, todayIn } from '../../core/http';
import { notify } from '../../core/notify';
import type { Principal } from '../../core/rbac/principal';
import { studentIdScope } from '../../core/rbac/scope';
import { getSetting } from '../../core/settings';
import { tenantDb, type Executor } from '../../core/tenancy/pools';
import { tenantByCode, type TenantInfo } from '../../core/tenancy/registry';
import { feeCategories, grades, invoiceItems, invoices, payments, refunds, sections, students } from '../../db/tenant/schema';
import { formatMoney, pdfSafe, renderPdf, usersWithPermission } from '../exams/common';
import { formatNumber, invoiceMath, reserveNumbers, statusFor, yearToken } from './billing';
import { activeGateway, gatewayByName, mockGateway, type GatewayEvent, type PaymentGateway } from './gateway';
import { paymentBase, refundBase, toPaymentOut, toRefundOut } from './views';

const fullName = (first: string, last: string | null) => [first, last].filter(Boolean).join(' ');
const SETTLED = ['succeeded', 'partially_refunded', 'refunded'] as const;

export async function paymentById(db: Executor, id: string): Promise<PaymentOut> {
  const [r] = await paymentBase(db).where(eq(payments.id, id)).limit(1);
  if (!r) throw notFound('Payment');
  return toPaymentOut(r);
}

/** Add money to an invoice (inside the caller's transaction, invoice row already locked). */
async function creditInvoice(tx: Executor, inv: typeof invoices.$inferSelect, amountMinor: number): Promise<void> {
  const paid = inv.paidMinor + amountMinor;
  await tx.update(invoices).set({ paidMinor: paid, status: statusFor(inv, paid) }).where(eq(invoices.id, inv.id));
}

async function nextReceiptNo(tx: Executor, academicYearId: string): Promise<string> {
  const cfg = await getSetting(tx, 'fees');
  const n = await reserveNumbers(tx, 'receipt', 1);
  return formatNumber(cfg.receiptPrefix, await yearToken(tx, academicYearId), n);
}

// ── listing ─────────────────────────────────────────────────────────────────────────────────

export async function listPayments(db: Executor, p: Principal, tenant: TenantInfo, q: z.infer<typeof paymentListQuery>) {
  const day = sql`(${payments.paidAt} at time zone ${tenant.timezone})::date`;
  const where = and(
    studentIdScope(p, 'payments:view', payments.studentId),
    q.invoiceId ? eq(payments.invoiceId, q.invoiceId) : undefined,
    q.studentId ? eq(payments.studentId, q.studentId) : undefined,
    q.method ? eq(payments.method, q.method) : undefined,
    q.status ? eq(payments.status, q.status) : undefined,
    q.from ? sql`${day} >= ${q.from}::date` : undefined,
    q.to ? sql`${day} <= ${q.to}::date` : undefined,
    q.q ? sql`(${ilikeAny(q.q, payments.receiptNo, payments.reference, students.admissionNo, students.firstName, students.lastName)})` : undefined,
  );
  const [rows, [cnt]] = await Promise.all([
    paymentBase(db).where(where).orderBy(desc(payments.createdAt)).limit(pageArgs(q).limit).offset(pageArgs(q).offset),
    db.select({ n: sql<number>`count(*)::int` }).from(payments).innerJoin(students, eq(students.id, payments.studentId)).where(where),
  ]);
  return pagedResult(rows.map(toPaymentOut), cnt?.n ?? 0, q);
}

export async function getPayment(db: Executor, p: Principal, id: string): Promise<PaymentOut> {
  const [r] = await paymentBase(db).where(and(eq(payments.id, id), studentIdScope(p, 'payments:view', payments.studentId))).limit(1);
  if (!r) throw notFound('Payment');
  return toPaymentOut(r);
}

// ── offline payments ────────────────────────────────────────────────────────────────────────

/**
 * Staff records a payment received at the counter (cash / cheque / bank / UPI / card).
 * - amount must not exceed what is due now (balance + computed late fee); partial payments are fine
 * - `Idempotency-Key` makes retries safe: the same key returns the original payment instead of recording twice
 *   (keys are namespaced per user, and re-using a key for a different invoice/amount is rejected)
 * - receipt number comes from the `counters` sequence; invoice paid/partial status moves in the same transaction
 */
export async function recordPayment(tx: Executor, tenant: TenantInfo, actor: AuditActor, input: z.infer<typeof paymentCreateBody> & { idempotencyKey?: string }): Promise<{ payment: PaymentOut; replay: boolean }> {
  const key = input.idempotencyKey ? `${actor.userId ?? 'system'}:${input.idempotencyKey}` : null;
  const replayOf = async () => {
    if (!key) return null;
    const [ex] = await tx.select().from(payments).where(eq(payments.idempotencyKey, key)).limit(1);
    if (!ex) return null;
    if (ex.invoiceId !== input.invoiceId || ex.amountMinor !== input.amountMinor) throw unprocessable('This Idempotency-Key was already used for a different payment', 'IDEMPOTENCY_KEY_REUSED');
    return { payment: await paymentById(tx, ex.id), replay: true };
  };
  const early = await replayOf();
  if (early) return early;

  const [inv] = await tx.select().from(invoices).where(eq(invoices.id, input.invoiceId)).for('update').limit(1);
  if (!inv) throw notFound('Invoice');
  // a concurrent request with the same key committed while we waited for the invoice lock
  const late = await replayOf();
  if (late) return late;

  if (inv.status === 'void') throw conflict('This invoice is void', 'INVOICE_VOID');
  const cfg = await getSetting(tx, 'fees');
  const m = invoiceMath(inv, todayIn(tenant.timezone), cfg.lateFeePerDayMinor);
  if (inv.status === 'paid' || m.amountDueNowMinor <= 0) throw conflict('This invoice is already paid', 'ALREADY_PAID');
  if (input.amountMinor > m.amountDueNowMinor) throw unprocessable(`The amount exceeds what is due (${m.amountDueNowMinor} minor units)`, 'AMOUNT_EXCEEDS_BALANCE');

  const receiptNo = await nextReceiptNo(tx, inv.academicYearId);
  const [pay] = await tx
    .insert(payments)
    .values({ invoiceId: inv.id, studentId: inv.studentId, amountMinor: input.amountMinor, method: input.method, status: 'succeeded', reference: input.reference ?? null, notes: input.notes ?? null, idempotencyKey: key, receiptNo, paidAt: new Date(), receivedBy: actor.userId ?? null })
    .returning({ id: payments.id });
  await creditInvoice(tx, inv, input.amountMinor);
  await audit(tx, actor, { action: 'payments.record', entity: 'payment', entityId: pay!.id, summary: `${receiptNo} for ${inv.invoiceNo}`, after: { invoiceId: inv.id, invoiceNo: inv.invoiceNo, amountMinor: input.amountMinor, method: input.method, reference: input.reference ?? null, receiptNo, invoiceStatus: statusFor(inv, inv.paidMinor + input.amountMinor) } });
  return { payment: await paymentById(tx, pay!.id), replay: false };
}

// ── receipts ────────────────────────────────────────────────────────────────────────────────

export async function getReceipt(db: Executor, p: Principal, tenant: TenantInfo, paymentId: string): Promise<ReceiptOut> {
  const [r] = await db
    .select({ pay: payments, inv: invoices, first: students.firstName, last: students.lastName, admissionNo: students.admissionNo, sectionName: sections.name, gradeName: grades.name, receivedBy: sql<string | null>`(select u.display_name from users u where u.id = ${payments.receivedBy})` })
    .from(payments)
    .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
    .innerJoin(students, eq(students.id, payments.studentId))
    .leftJoin(sections, eq(sections.id, students.currentSectionId))
    .leftJoin(grades, eq(grades.id, students.currentGradeId))
    .where(and(eq(payments.id, paymentId), inArray(payments.status, [...SETTLED]), studentIdScope(p, 'payments:view', payments.studentId)))
    .limit(1);
  if (!r || !r.pay.receiptNo || !r.pay.paidAt) throw notFound('Receipt');
  const [items, school] = await Promise.all([
    db.select({ i: invoiceItems, categoryName: feeCategories.name }).from(invoiceItems).leftJoin(feeCategories, eq(feeCategories.id, invoiceItems.categoryId)).where(eq(invoiceItems.invoiceId, r.inv.id)),
    getSetting(db, 'school'),
  ]);
  const m = invoiceMath(r.inv, todayIn(tenant.timezone), 0);
  return {
    receiptNo: r.pay.receiptNo,
    paymentId: r.pay.id,
    paidAt: r.pay.paidAt.toISOString(),
    currency: tenant.currency,
    school: { name: tenant.name, address: school.address, phone: school.phone, email: school.email },
    student: { id: r.pay.studentId, name: fullName(r.first, r.last), admissionNo: r.admissionNo, grade: r.gradeName, section: r.sectionName },
    invoice: { id: r.inv.id, invoiceNo: r.inv.invoiceNo, title: r.inv.title, dueDate: r.inv.dueDate, totalMinor: r.inv.totalMinor, discountMinor: r.inv.discountMinor, paidMinor: r.inv.paidMinor, balanceMinor: m.balanceMinor },
    items: items.map((x) => ({ id: x.i.id, categoryId: x.i.categoryId, categoryName: x.categoryName ?? null, description: x.i.description, amountMinor: x.i.amountMinor, discountMinor: x.i.discountMinor })),
    payment: { amountMinor: r.pay.amountMinor, refundedMinor: r.pay.refundedMinor, method: r.pay.method, reference: r.pay.reference, status: r.pay.status },
    receivedBy: r.receivedBy,
  };
}

export function receiptPdf(rc: ReceiptOut): Promise<Buffer> {
  const money = (n: number) => formatMoney(n, rc.currency);
  return renderPdf(
    (doc) => {
      const left = 40;
      const width = doc.page.width - 80;
      doc.font('Helvetica-Bold').fontSize(18).text(pdfSafe(rc.school.name), left, 40, { width, align: 'center' });
      doc.font('Helvetica').fontSize(9).fillColor('#555555').text([rc.school.address, rc.school.phone, rc.school.email].map(pdfSafe).filter(Boolean).join('  |  '), { width, align: 'center' });
      doc.moveDown(0.8).fillColor('#000000').font('Helvetica-Bold').fontSize(14).text('PAYMENT RECEIPT', { width, align: 'center' });
      doc.moveDown(0.6).font('Helvetica').fontSize(10);
      const kv = (k: string, v: string, x: number, y: number) => {
        doc.font('Helvetica').fillColor('#555555').fontSize(9).text(k, x, y, { width: 90 });
        doc.font('Helvetica-Bold').fillColor('#000000').fontSize(10).text(v, x + 92, y, { width: width / 2 - 100 });
      };
      let y = doc.y;
      kv('Receipt no.', rc.receiptNo, left, y);
      kv('Date', rc.paidAt.slice(0, 10), left + width / 2, y);
      kv('Student', pdfSafe(rc.student.name), left, y + 16);
      kv('Admission no.', rc.student.admissionNo, left + width / 2, y + 16);
      kv('Class', [rc.student.grade, rc.student.section].filter(Boolean).join(' ') || '-', left, y + 32);
      kv('Invoice', rc.invoice.invoiceNo, left + width / 2, y + 32);
      y += 62;
      doc.rect(left, y - 3, width, 17).fill('#e5e7eb').fillColor('#000000');
      doc.font('Helvetica-Bold').fontSize(9).text('Description', left + 4, y, { width: width * 0.6 }).text('Amount', left + width * 0.6, y, { width: width * 0.18, align: 'right' }).text('Discount', left + width * 0.78, y, { width: width * 0.2, align: 'right' });
      y += 18;
      doc.font('Helvetica').fontSize(9);
      for (const it of rc.items) {
        doc.text(pdfSafe(it.description), left + 4, y, { width: width * 0.6 - 8, lineBreak: false }).text(money(it.amountMinor), left + width * 0.6, y, { width: width * 0.18, align: 'right' }).text(money(it.discountMinor), left + width * 0.78, y, { width: width * 0.2, align: 'right' });
        y += 15;
      }
      doc.moveTo(left, y).lineTo(left + width, y).strokeColor('#9ca3af').stroke();
      y += 8;
      const line = (k: string, v: string, bold = false) => {
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).fillColor('#000000').text(k, left + width * 0.45, y, { width: width * 0.3 }).text(v, left + width * 0.72, y, { width: width * 0.28, align: 'right' });
        y += 16;
      };
      line('Invoice total', money(rc.invoice.totalMinor));
      if (rc.invoice.discountMinor) line('Discount', `-${money(rc.invoice.discountMinor)}`);
      line(`Paid now (${rc.payment.method.replace('_', ' ')})`, money(rc.payment.amountMinor), true);
      if (rc.payment.refundedMinor) line('Refunded', `-${money(rc.payment.refundedMinor)}`);
      line('Total paid on invoice', money(rc.invoice.paidMinor));
      line('Balance', money(rc.invoice.balanceMinor), true);
      if (rc.payment.reference) {
        y += 6;
        doc.font('Helvetica').fontSize(9).fillColor('#555555').text(`Reference: ${pdfSafe(rc.payment.reference)}`, left, y);
      }
      doc.fillColor('#6b7280').fontSize(8).text(`Received by ${pdfSafe(rc.receivedBy) || 'school office'}  |  Computer generated receipt`, left, doc.page.height - 56, { width, align: 'center' });
    },
    { title: `Receipt ${rc.receiptNo}`, author: rc.school.name },
  );
}

// ── refunds ─────────────────────────────────────────────────────────────────────────────────

export async function listRefunds(db: Executor, q: z.infer<typeof refundListQuery>) {
  const where = and(q.status ? eq(refunds.status, q.status) : undefined);
  const [rows, [cnt]] = await Promise.all([
    refundBase(db).where(where).orderBy(desc(refunds.createdAt)).limit(pageArgs(q).limit).offset(pageArgs(q).offset),
    db.select({ n: sql<number>`count(*)::int` }).from(refunds).where(where),
  ]);
  return pagedResult(rows.map(toRefundOut), cnt?.n ?? 0, q);
}

async function refundById(db: Executor, id: string): Promise<RefundOut> {
  const [r] = await refundBase(db).where(eq(refunds.id, id)).limit(1);
  if (!r) throw notFound('Refund');
  return toRefundOut(r);
}

export async function requestRefund(tx: Executor, actor: AuditActor, paymentId: string, input: { amountMinor: number; reason: string }): Promise<RefundOut> {
  const [pay] = await tx.select().from(payments).where(eq(payments.id, paymentId)).for('update').limit(1);
  if (!pay) throw notFound('Payment');
  if (pay.status !== 'succeeded' && pay.status !== 'partially_refunded') throw conflict(`A ${pay.status} payment cannot be refunded`, 'PAYMENT_NOT_REFUNDABLE');
  const [open] = await tx.select({ total: sql<number>`coalesce(sum(${refunds.amountMinor}), 0)::float8` }).from(refunds).where(and(eq(refunds.paymentId, paymentId), inArray(refunds.status, ['requested', 'approved'])));
  const available = pay.amountMinor - pay.refundedMinor - (open?.total ?? 0);
  if (input.amountMinor > available) throw unprocessable(`At most ${available} minor units can still be refunded on this payment`, 'REFUND_EXCEEDS_PAYMENT');
  const [r] = await tx.insert(refunds).values({ paymentId, amountMinor: input.amountMinor, reason: input.reason, requestedBy: actor.userId ?? null }).returning({ id: refunds.id });
  const out = await refundById(tx, r!.id);
  await audit(tx, actor, { action: 'refunds.request', entity: 'refund', entityId: r!.id, summary: `${pay.receiptNo ?? pay.id}`, after: { paymentId, amountMinor: input.amountMinor, reason: input.reason } });
  return out;
}

export async function notifyRefundRequested(db: Executor, tenant: TenantInfo, refundId: string, requesterId?: string | null) {
  const approvers = (await usersWithPermission(db, 'payments:approve')).filter((u) => u !== requesterId);
  await notify(db, tenant, { userIds: approvers, type: 'fees.refund_requested', title: 'Refund awaiting approval', body: 'A refund request needs your decision.', data: { route: `/payments/refunds`, refundId } });
}

/** For an online payment the gateway must return the money first; offline refunds need no outside call. */
export async function refundGatewayInfo(db: Executor, refundId: string): Promise<{ gateway: PaymentGateway; gatewayPaymentId: string; amountMinor: number } | null> {
  const [x] = await db.select({ amountMinor: refunds.amountMinor, method: payments.method, gw: payments.gateway, gpid: payments.gatewayPaymentId }).from(refunds).innerJoin(payments, eq(payments.id, refunds.paymentId)).where(eq(refunds.id, refundId)).limit(1);
  if (!x || x.method !== 'online' || !x.gpid || !x.gw) return null;
  const gateway = gatewayByName(x.gw);
  if (!gateway?.refund) throw new AppError(503, 'GATEWAY_NOT_CONFIGURED', 'The payment gateway for this refund is not configured');
  return { gateway, gatewayPaymentId: x.gpid, amountMinor: x.amountMinor };
}

export async function rejectRefund(tx: Executor, actor: AuditActor, id: string, note: string): Promise<RefundOut> {
  const [r] = await tx.select().from(refunds).where(eq(refunds.id, id)).for('update').limit(1);
  if (!r) throw notFound('Refund');
  if (r.status !== 'requested') throw conflict(`This refund is already ${r.status}`, 'ALREADY_DECIDED');
  await tx.update(refunds).set({ status: 'rejected', decidedBy: actor.userId ?? null, decidedAt: new Date(), decisionNote: note }).where(eq(refunds.id, id));
  await audit(tx, actor, { action: 'refunds.reject', entity: 'refund', entityId: id, before: { status: 'requested' }, after: { status: 'rejected', note } });
  return refundById(tx, id);
}

async function processCore(tx: Executor, actor: AuditActor, refundId: string, reference: string | null | undefined): Promise<void> {
  const [r] = await tx.select().from(refunds).where(eq(refunds.id, refundId)).limit(1);
  if (!r) throw notFound('Refund');
  const [pay] = await tx.select().from(payments).where(eq(payments.id, r.paymentId)).for('update').limit(1);
  const [inv] = await tx.select().from(invoices).where(eq(invoices.id, pay!.invoiceId)).for('update').limit(1);
  if (r.amountMinor > pay!.amountMinor - pay!.refundedMinor) throw conflict('The payment no longer has that much left to refund', 'REFUND_EXCEEDS_PAYMENT');
  const refunded = pay!.refundedMinor + r.amountMinor;
  await tx.update(payments).set({ refundedMinor: refunded, status: refunded >= pay!.amountMinor ? 'refunded' : 'partially_refunded' }).where(eq(payments.id, pay!.id));
  const paid = Math.max(0, inv!.paidMinor - r.amountMinor);
  await tx.update(invoices).set({ paidMinor: paid, status: statusFor(inv!, paid) }).where(eq(invoices.id, inv!.id));
  await tx.update(refunds).set({ status: 'processed', processedBy: actor.userId ?? null, processedAt: new Date(), reference: reference ?? r.reference }).where(eq(refunds.id, refundId));
  await audit(tx, actor, { action: 'refunds.process', entity: 'refund', entityId: refundId, summary: inv!.invoiceNo, before: { paymentRefunded: pay!.refundedMinor, invoicePaid: inv!.paidMinor, invoiceStatus: inv!.status }, after: { amountMinor: r.amountMinor, paymentRefunded: refunded, invoicePaid: paid, invoiceStatus: statusFor(inv!, paid), reference: reference ?? null } });
}

/** requested -> approved (and, unless `process` is false, processed in the same transaction). */
export async function approveRefund(tx: Executor, actor: AuditActor, id: string, opts: { note?: string | null; reference?: string | null; process: boolean }): Promise<RefundOut> {
  const [r] = await tx.select().from(refunds).where(eq(refunds.id, id)).for('update').limit(1);
  if (!r) throw notFound('Refund');
  if (r.status !== 'requested') throw conflict(`This refund is already ${r.status}`, 'ALREADY_DECIDED');
  await tx.update(refunds).set({ status: 'approved', decidedBy: actor.userId ?? null, decidedAt: new Date(), decisionNote: opts.note ?? null }).where(eq(refunds.id, id));
  await audit(tx, actor, { action: 'refunds.approve', entity: 'refund', entityId: id, before: { status: 'requested' }, after: { status: 'approved', note: opts.note ?? null, amountMinor: r.amountMinor } });
  if (opts.process) await processCore(tx, actor, id, opts.reference);
  return refundById(tx, id);
}

export async function processRefund(tx: Executor, actor: AuditActor, id: string, reference?: string | null): Promise<RefundOut> {
  const [r] = await tx.select().from(refunds).where(eq(refunds.id, id)).for('update').limit(1);
  if (!r) throw notFound('Refund');
  if (r.status !== 'approved') throw conflict(r.status === 'processed' ? 'This refund was already processed' : `Only an approved refund can be processed (this one is ${r.status})`, 'INVALID_REFUND_STATE');
  await processCore(tx, actor, id, reference);
  return refundById(tx, id);
}

// ── online payments ─────────────────────────────────────────────────────────────────────────

const keyIdOf = (gw: PaymentGateway) => (gw.name === 'razorpay' ? (process.env.RAZORPAY_KEY_ID ?? null) : 'mock_key_id');

function onlineOut(pay: typeof payments.$inferSelect, gw: PaymentGateway, currency: string): PayOnlineOut {
  return { paymentId: pay.id, provider: gw.name, orderId: pay.gatewayOrderId ?? '', amountMinor: pay.amountMinor, currency, keyId: keyIdOf(gw), mock: gw.name === 'mock' };
}

/**
 * Parent pays an invoice online: creates a PENDING payment + a gateway order. Nothing is marked paid here — only the
 * signature-verified webhook (or a server-side `sync` against the gateway) settles it, never the client redirect.
 */
export async function startOnlinePayment(db: Executor, tenant: TenantInfo, p: Principal, actor: AuditActor, invoiceId: string, amount: number | undefined, idempotencyKey?: string): Promise<PayOnlineOut> {
  const cfg = await getSetting(db, 'fees');
  if (!tenant.features.onlinePayments || !cfg.parentsCanPayOnline) throw forbidden('Online payment is not enabled for this school', 'ONLINE_PAYMENTS_DISABLED');
  const gw = activeGateway();
  if (!gw) throw new AppError(503, 'GATEWAY_NOT_CONFIGURED', 'No payment gateway is configured');
  const key = idempotencyKey ? `${actor.userId}:${idempotencyKey}` : null;

  const pending = await db.transaction(async (tx) => {
    const [visible] = await tx.select({ id: invoices.id }).from(invoices).where(and(eq(invoices.id, invoiceId), studentIdScope(p, 'payments:create', invoices.studentId))).limit(1);
    if (!visible) throw notFound('Invoice');
    const [inv] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).for('update').limit(1);
    if (key) {
      const [ex] = await tx.select().from(payments).where(eq(payments.idempotencyKey, key)).limit(1);
      if (ex) {
        if (ex.invoiceId !== invoiceId || (amount !== undefined && ex.amountMinor !== amount)) throw unprocessable('This Idempotency-Key was already used for a different payment', 'IDEMPOTENCY_KEY_REUSED');
        return { pay: ex, fresh: false };
      }
    }
    if (inv!.status === 'void') throw conflict('This invoice is void', 'INVOICE_VOID');
    const m = invoiceMath(inv!, todayIn(tenant.timezone), cfg.lateFeePerDayMinor);
    if (inv!.status === 'paid' || m.amountDueNowMinor <= 0) throw conflict('This invoice is already paid', 'ALREADY_PAID');
    const amountMinor = amount ?? m.amountDueNowMinor;
    if (amountMinor > m.amountDueNowMinor) throw unprocessable(`The amount exceeds what is due (${m.amountDueNowMinor} minor units)`, 'AMOUNT_EXCEEDS_BALANCE');
    const [pay] = await tx
      .insert(payments)
      .values({ invoiceId, studentId: inv!.studentId, amountMinor, method: 'online', status: 'pending', gateway: gw.name, payerUserId: actor.userId ?? null, idempotencyKey: key })
      .returning();
    await audit(tx, actor, { action: 'payments.online_start', entity: 'payment', entityId: pay!.id, after: { invoiceId, amountMinor, gateway: gw.name } });
    return { pay: pay!, fresh: true };
  });
  if (!pending.fresh && pending.pay.gatewayOrderId) return onlineOut(pending.pay, gw, tenant.currency);

  try {
    const order = await gw.createOrder({ amountMinor: pending.pay.amountMinor, currency: tenant.currency, receipt: pending.pay.id, notes: { tenant: tenant.code, paymentId: pending.pay.id, invoiceId } });
    const [upd] = await db.update(payments).set({ gatewayOrderId: order.orderId }).where(eq(payments.id, pending.pay.id)).returning();
    return onlineOut(upd!, gw, tenant.currency);
  } catch (err) {
    await db.update(payments).set({ status: 'failed', notes: 'Could not create the gateway order' }).where(eq(payments.id, pending.pay.id));
    throw new AppError(502, 'GATEWAY_ERROR', 'The payment gateway could not start this payment. Please try again.', { detail: err instanceof Error ? err.message.slice(0, 200) : undefined });
  }
}

export type SettleResult = 'succeeded' | 'failed' | 'ignored' | 'duplicate';

/**
 * Apply a gateway outcome to the local pending payment. Idempotent (a second delivery of the same event is a no-op),
 * row-locked, and checks amount + currency against what WE asked the gateway to collect.
 */
export async function settleGatewayEvent(db: Executor, tenant: TenantInfo, ev: GatewayEvent): Promise<{ result: SettleResult; notifyUserId: string | null; invoiceId: string | null }> {
  if (!ev.orderId || ev.kind === 'ignored') return { result: 'ignored', notifyUserId: null, invoiceId: null };
  const system: AuditActor = { userId: null, name: 'payment gateway' };
  return db.transaction(async (tx) => {
    const [pay] = await tx.select().from(payments).where(eq(payments.gatewayOrderId, ev.orderId!)).for('update').limit(1);
    if (!pay) return { result: 'ignored' as const, notifyUserId: null, invoiceId: null };
    if (pay.status === 'succeeded' || pay.status === 'partially_refunded' || pay.status === 'refunded') return { result: 'duplicate' as const, notifyUserId: null, invoiceId: pay.invoiceId };
    if (ev.kind === 'payment.failed') {
      if (pay.status === 'pending') await tx.update(payments).set({ status: 'failed' }).where(eq(payments.id, pay.id));
      await audit(tx, system, { action: 'payments.online_failed', entity: 'payment', entityId: pay.id, after: { gatewayPaymentId: ev.paymentId } });
      return { result: 'failed' as const, notifyUserId: null, invoiceId: pay.invoiceId };
    }
    if (ev.amountMinor !== pay.amountMinor || (ev.currency && ev.currency.toUpperCase() !== tenant.currency.toUpperCase())) {
      await audit(tx, system, { action: 'payments.online_mismatch', entity: 'payment', entityId: pay.id, summary: 'Gateway amount/currency differs from the order; payment NOT recorded', after: { expected: { amountMinor: pay.amountMinor, currency: tenant.currency }, got: { amountMinor: ev.amountMinor, currency: ev.currency }, gatewayPaymentId: ev.paymentId } });
      return { result: 'ignored' as const, notifyUserId: null, invoiceId: pay.invoiceId };
    }
    const [inv] = await tx.select().from(invoices).where(eq(invoices.id, pay.invoiceId)).for('update').limit(1);
    const receiptNo = await nextReceiptNo(tx, inv!.academicYearId);
    const note = inv!.status === 'void' ? 'Received after the invoice was voided - refund required' : inv!.paidMinor + pay.amountMinor > inv!.totalMinor - inv!.discountMinor ? 'Overpayment - refund of the excess may be required' : pay.notes;
    await tx.update(payments).set({ status: 'succeeded', gatewayPaymentId: ev.paymentId, paidAt: new Date(), receiptNo, reference: ev.paymentId ?? pay.reference, notes: note }).where(eq(payments.id, pay.id));
    await creditInvoice(tx, inv!, pay.amountMinor);
    await audit(tx, system, { action: 'payments.online_succeeded', entity: 'payment', entityId: pay.id, summary: `${receiptNo} for ${inv!.invoiceNo}`, after: { invoiceId: inv!.id, amountMinor: pay.amountMinor, gatewayPaymentId: ev.paymentId, receiptNo, note } });
    return { result: 'succeeded' as const, notifyUserId: pay.payerUserId, invoiceId: inv!.id };
  });
}

async function notifyPaid(db: Executor, tenant: TenantInfo, userId: string | null, invoiceId: string | null) {
  if (!userId) return;
  await notify(db, tenant, { userIds: [userId], type: 'fees.paid', title: 'Payment received', body: 'Your payment was received. Open the app for the receipt.', data: { route: invoiceId ? `/fees/invoices/${invoiceId}` : '/fees' } });
}

/**
 * Public webhook entry. Order of operations matters: (1) verify the signature over the RAW body, (2) only then parse
 * it, (3) resolve the school (X-Tenant header, else the `tenant` note we put on the order, else Host), (4) settle.
 * A read-only school still records the payment: the money has already been captured at the gateway.
 */
export async function handleWebhook(input: { provider: string; rawBody: Buffer; headers: IncomingHttpHeaders; host?: string; tenant?: TenantInfo }): Promise<{ result: SettleResult }> {
  const gw = gatewayByName(input.provider);
  if (!gw) throw new AppError(503, 'GATEWAY_NOT_CONFIGURED', `Payment gateway "${input.provider}" is not configured`);
  if (!gw.verifyWebhook(input.rawBody, input.headers)) throw new AppError(400, 'INVALID_SIGNATURE', 'Webhook signature verification failed');
  const ev = gw.parseWebhook(input.rawBody);

  let tenant = input.tenant ?? null;
  const headerCode = (input.headers['x-tenant'] as string | undefined)?.trim().toLowerCase();
  const noteCode = ev.notes.tenant?.trim().toLowerCase();
  if (!tenant) {
    if (headerCode && noteCode && headerCode !== noteCode) throw new AppError(400, 'TENANT_MISMATCH', 'X-Tenant and the order metadata disagree');
    const code = headerCode || noteCode;
    if (code) tenant = await tenantByCode(code);
    if (!tenant && input.host) {
      const { resolveTenant } = await import('../../core/tenancy/registry');
      tenant = await resolveTenant({ host: input.host }).catch(() => null);
    }
  }
  if (!tenant || tenant.status !== 'active') throw new AppError(404, 'SITE_NOT_FOUND', 'School site not found');
  if (!tenant.features.fees) return { result: 'ignored' };

  const db = tenantDb(tenant);
  const r = await settleGatewayEvent(db, tenant, ev);
  if (r.result === 'succeeded') await notifyPaid(db, tenant, r.notifyUserId, r.invoiceId).catch(() => undefined);
  return { result: r.result };
}

/** Reconcile a pending online payment by asking the gateway (server to server) — used when a webhook is late. */
export async function syncOnlinePayment(db: Executor, tenant: TenantInfo, p: Principal, paymentId: string): Promise<PaymentOut> {
  const cur = await getPayment(db, p, paymentId);
  const [pay] = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
  if (pay && pay.method === 'online' && pay.status === 'pending' && pay.gatewayOrderId && pay.gateway) {
    const gw = gatewayByName(pay.gateway);
    const found = gw ? await gw.fetchPayment({ orderId: pay.gatewayOrderId }).catch(() => null) : null;
    if (found?.status === 'captured') {
      const r = await settleGatewayEvent(db, tenant, { kind: 'payment.succeeded', orderId: found.orderId, paymentId: found.paymentId, amountMinor: found.amountMinor, currency: found.currency, notes: {} });
      if (r.result === 'succeeded') await notifyPaid(db, tenant, r.notifyUserId, r.invoiceId).catch(() => undefined);
    } else if (found?.status === 'failed') {
      await settleGatewayEvent(db, tenant, { kind: 'payment.failed', orderId: pay.gatewayOrderId, paymentId: found.paymentId, amountMinor: found.amountMinor, currency: found.currency, notes: {} });
    }
    return getPayment(db, p, paymentId);
  }
  return cur;
}

/** DEV ONLY (mock gateway, never in production): finish a pending mock payment through the real webhook code path. */
export async function mockComplete(db: Executor, tenant: TenantInfo, p: Principal, paymentId: string): Promise<PaymentOut> {
  if (!mockGateway.isConfigured() || activeGateway()?.name !== 'mock') throw notFound('Route');
  const [pay] = await db.select().from(payments).where(and(eq(payments.id, paymentId), studentIdScope(p, 'payments:create', payments.studentId))).limit(1);
  if (!pay || pay.gateway !== 'mock' || !pay.gatewayOrderId) throw notFound('Payment');
  if (pay.status !== 'pending') return getPayment(db, p, paymentId);
  const { body, signature } = mockGateway.capture({ orderId: pay.gatewayOrderId, amountMinor: pay.amountMinor, currency: tenant.currency, notes: { tenant: tenant.code, paymentId: pay.id, invoiceId: pay.invoiceId } });
  await handleWebhook({ provider: 'mock', rawBody: body, headers: { 'x-mock-signature': signature }, tenant });
  return getPayment(db, p, paymentId);
}
