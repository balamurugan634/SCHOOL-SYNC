import { alias } from 'drizzle-orm/pg-core';
import { eq } from 'drizzle-orm';
import type { InvoiceOut, PaymentOut, RefundOut } from '@school-sync/shared';
import type { Executor } from '../../core/tenancy/pools';
import { grades, invoices, payments, refunds, sections, students, users } from '../../db/tenant/schema';
import { invoiceMath } from './billing';

/** Row -> API shape builders shared by invoices, payments and refunds. */

const fullName = (first: string, last: string | null) => [first, last].filter(Boolean).join(' ');

// ── invoices ────────────────────────────────────────────────────────────────────────────────

export function invoiceBase(db: Executor) {
  return db
    .select({ inv: invoices, first: students.firstName, last: students.lastName, admissionNo: students.admissionNo, sectionName: sections.name, gradeName: grades.name })
    .from(invoices)
    .innerJoin(students, eq(students.id, invoices.studentId))
    .leftJoin(sections, eq(sections.id, students.currentSectionId))
    .leftJoin(grades, eq(grades.id, students.currentGradeId));
}
export type InvoiceRow = Awaited<ReturnType<typeof invoiceBase>>[number];

export function toInvoiceOut(r: InvoiceRow, today: string, lateFeePerDayMinor: number): InvoiceOut {
  const m = invoiceMath(r.inv, today, lateFeePerDayMinor);
  return {
    id: r.inv.id,
    invoiceNo: r.inv.invoiceNo,
    studentId: r.inv.studentId,
    studentName: fullName(r.first, r.last),
    admissionNo: r.admissionNo,
    gradeName: r.gradeName,
    sectionName: r.sectionName,
    title: r.inv.title,
    dueDate: r.inv.dueDate,
    status: r.inv.status,
    overdue: m.overdue,
    daysOverdue: m.daysOverdue,
    totalMinor: r.inv.totalMinor,
    discountMinor: r.inv.discountMinor,
    paidMinor: r.inv.paidMinor,
    balanceMinor: m.balanceMinor,
    lateFeeMinor: m.lateFeeMinor,
    amountDueNowMinor: m.amountDueNowMinor,
    notes: r.inv.notes,
    issuedAt: r.inv.issuedAt.toISOString(),
  };
}

// ── payments ────────────────────────────────────────────────────────────────────────────────

export function paymentBase(db: Executor) {
  return db
    .select({ pay: payments, invoiceNo: invoices.invoiceNo, first: students.firstName, last: students.lastName, receivedByName: users.displayName })
    .from(payments)
    .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
    .innerJoin(students, eq(students.id, payments.studentId))
    .leftJoin(users, eq(users.id, payments.receivedBy));
}
export type PaymentRow = Awaited<ReturnType<typeof paymentBase>>[number];

export const toPaymentOut = (r: PaymentRow): PaymentOut => ({
  id: r.pay.id,
  invoiceId: r.pay.invoiceId,
  invoiceNo: r.invoiceNo,
  studentId: r.pay.studentId,
  studentName: fullName(r.first, r.last),
  amountMinor: r.pay.amountMinor,
  refundedMinor: r.pay.refundedMinor,
  method: r.pay.method,
  status: r.pay.status,
  reference: r.pay.reference,
  receiptNo: r.pay.receiptNo,
  gateway: r.pay.gateway,
  paidAt: r.pay.paidAt?.toISOString() ?? null,
  receivedByName: r.receivedByName ?? null,
  notes: r.pay.notes,
  createdAt: r.pay.createdAt.toISOString(),
});

// ── refunds ─────────────────────────────────────────────────────────────────────────────────

const requester = alias(users, 'refund_requester');
const decider = alias(users, 'refund_decider');

export function refundBase(db: Executor) {
  return db
    .select({
      r: refunds,
      receiptNo: payments.receiptNo,
      invoiceId: invoices.id,
      invoiceNo: invoices.invoiceNo,
      studentId: students.id,
      first: students.firstName,
      last: students.lastName,
      requestedByName: requester.displayName,
      decidedByName: decider.displayName,
    })
    .from(refunds)
    .innerJoin(payments, eq(payments.id, refunds.paymentId))
    .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
    .innerJoin(students, eq(students.id, payments.studentId))
    .leftJoin(requester, eq(requester.id, refunds.requestedBy))
    .leftJoin(decider, eq(decider.id, refunds.decidedBy));
}
export type RefundRow = Awaited<ReturnType<typeof refundBase>>[number];

export const toRefundOut = (x: RefundRow): RefundOut => ({
  id: x.r.id,
  paymentId: x.r.paymentId,
  receiptNo: x.receiptNo,
  invoiceId: x.invoiceId,
  invoiceNo: x.invoiceNo,
  studentId: x.studentId,
  studentName: fullName(x.first, x.last),
  amountMinor: x.r.amountMinor,
  reason: x.r.reason,
  status: x.r.status,
  requestedByName: x.requestedByName ?? null,
  decidedByName: x.decidedByName ?? null,
  decidedAt: x.r.decidedAt?.toISOString() ?? null,
  processedAt: x.r.processedAt?.toISOString() ?? null,
  reference: x.r.reference,
  createdAt: x.r.createdAt.toISOString(),
});
