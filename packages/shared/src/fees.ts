/**
 * Fees & finance: categories, fee structures, student plans, concessions, invoices, payments (offline + online),
 * refunds, expenses, reports. All money is an integer in minor units (paise) in the school currency.
 * The whole module is gated by the school's `features.fees` flag (403 `FEATURE_DISABLED` when off).
 */
import { z } from 'zod';
import { dateStr, isoDateTime, pageQuery, uuid } from './common';
import { INVOICE_STATUSES, PAYMENT_METHODS, PAYMENT_STATUSES } from './enums';

/** minor units, never negative */
export const moneyMinor = z.number().int().min(0).max(1_000_000_000_000);
const positiveMinor = z.number().int().positive().max(1_000_000_000_000);
const text = (max: number) => z.string().trim().max(max);
const optText = (max: number) => text(max).nullable().optional();

export const CONCESSION_TYPES = ['percent', 'fixed'] as const;
export const CONCESSION_STATUSES = ['pending', 'approved', 'rejected'] as const;
export const REFUND_STATUSES = ['requested', 'approved', 'rejected', 'processed'] as const;
export const EXPENSE_STATUSES = ['pending', 'approved', 'rejected'] as const;
export const PAYMENT_GATEWAYS = ['mock', 'razorpay'] as const;
/** suggested expense categories (free text is accepted) */
export const EXPENSE_CATEGORIES = ['Salaries', 'Utilities', 'Maintenance', 'Stationery', 'Events', 'Transport', 'Supplies', 'Software', 'Sports', 'Miscellaneous'] as const;

// ── categories ──────────────────────────────────────────────────────────────────────────────

export const feeCategoryCreateBody = z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,20}$/, 'Use 2-20 letters, digits, - or _'), name: text(80).min(2) });
export const feeCategoryUpdateBody = z.object({ name: text(80).min(2).optional(), isActive: z.boolean().optional() });
export const feeCategoryOut = z.object({ id: uuid, code: z.string(), name: z.string(), isActive: z.boolean() });
export type FeeCategoryOut = z.infer<typeof feeCategoryOut>;

// ── structures ──────────────────────────────────────────────────────────────────────────────

export const structureItemIn = z.object({
  categoryId: uuid,
  label: text(120).min(1),
  amountMinor: positiveMinor,
  dueDate: dateStr,
  ordinal: z.number().int().min(0).max(100).optional(),
});
export const structureItemOut = z.object({ id: uuid, categoryId: uuid, categoryName: z.string(), label: z.string(), amountMinor: z.number(), dueDate: dateStr, ordinal: z.number() });
export type StructureItemOut = z.infer<typeof structureItemOut>;

export const structureCreateBody = z.object({
  name: text(120).min(2),
  /** defaults to the current academic year */
  academicYearId: uuid.optional(),
  /** null / omitted = applies to every grade */
  gradeId: uuid.nullable().optional(),
  items: z.array(structureItemIn).min(1).max(60),
});
export const structureUpdateBody = z.object({ name: text(120).min(2).optional(), isActive: z.boolean().optional() });
export const structureListQuery = pageQuery.extend({ academicYearId: uuid.optional(), gradeId: uuid.optional(), active: z.stringbool().optional() });
export const structureOut = z.object({
  id: uuid,
  name: z.string(),
  academicYearId: uuid,
  academicYearName: z.string().nullable(),
  gradeId: uuid.nullable(),
  gradeName: z.string().nullable(),
  isActive: z.boolean(),
  totalMinor: z.number(),
  planCount: z.number(),
  items: z.array(structureItemOut),
  createdAt: isoDateTime,
});
export type StructureOut = z.infer<typeof structureOut>;

// ── plans & dues generation ─────────────────────────────────────────────────────────────────

export const planCreateBody = z.object({ studentId: uuid, structureId: uuid, notes: optText(300) });
export const planBulkBody = z
  .object({
    structureId: uuid,
    gradeId: uuid.optional(),
    sectionId: uuid.optional(),
    studentIds: z.array(uuid).min(1).max(1000).optional(),
  })
  .refine((b) => b.gradeId || b.sectionId || b.studentIds?.length, { message: 'Give gradeId, sectionId or studentIds' });
export const planBulkOut = z.object({ assigned: z.number(), alreadyAssigned: z.number(), notEligible: z.number() });
export const planListQuery = pageQuery.extend({ studentId: uuid.optional(), sectionId: uuid.optional(), structureId: uuid.optional() });
export const planOut = z.object({
  id: uuid,
  studentId: uuid,
  studentName: z.string(),
  admissionNo: z.string(),
  sectionName: z.string().nullable(),
  gradeName: z.string().nullable(),
  structureId: uuid,
  structureName: z.string(),
  academicYearId: uuid,
  notes: z.string().nullable(),
  invoiceCount: z.number(),
  createdAt: isoDateTime,
});
export type PlanOut = z.infer<typeof planOut>;

export const generateDuesBody = z.object({
  structureId: uuid.optional(),
  gradeId: uuid.optional(),
  sectionId: uuid.optional(),
  studentId: uuid.optional(),
  /** only instalments due on or before this date; default = all instalments of the plan */
  dueOnOrBefore: dateStr.optional(),
});
export const generateDuesOut = z.object({ plans: z.number(), invoicesCreated: z.number(), invoicesExisting: z.number(), totalMinor: z.number(), discountMinor: z.number() });

// ── concessions ─────────────────────────────────────────────────────────────────────────────

export const concessionCreateBody = z
  .object({
    studentId: uuid,
    /** defaults to the current academic year */
    academicYearId: uuid.optional(),
    name: text(120).min(2),
    type: z.enum(CONCESSION_TYPES),
    /** percent: basis points (1000 = 10.00%, max 10000); fixed: minor units for the whole academic year */
    value: positiveMinor,
    categoryId: uuid.nullable().optional(),
    reason: optText(500),
  })
  .refine((c) => c.type !== 'percent' || c.value <= 10_000, { message: 'A percent concession is in basis points and cannot exceed 10000', path: ['value'] });
export const concessionDecisionBody = z.object({ note: optText(300) }).default({});
export const concessionListQuery = pageQuery.extend({ studentId: uuid.optional(), status: z.enum(CONCESSION_STATUSES).optional(), academicYearId: uuid.optional() });
export const concessionOut = z.object({
  id: uuid,
  studentId: uuid,
  studentName: z.string(),
  admissionNo: z.string(),
  academicYearId: uuid,
  name: z.string(),
  type: z.enum(CONCESSION_TYPES),
  value: z.number(),
  categoryId: uuid.nullable(),
  categoryName: z.string().nullable(),
  reason: z.string().nullable(),
  status: z.enum(CONCESSION_STATUSES),
  /** discount actually applied to invoices so far (minor units) */
  appliedMinor: z.number(),
  decidedAt: isoDateTime.nullable(),
  createdAt: isoDateTime,
});
export type ConcessionOut = z.infer<typeof concessionOut>;

// ── invoices ────────────────────────────────────────────────────────────────────────────────

export const invoiceListQuery = pageQuery.extend({
  studentId: uuid.optional(),
  sectionId: uuid.optional(),
  gradeId: uuid.optional(),
  status: z.enum(INVOICE_STATUSES).optional(),
  /** true = only overdue (unpaid/partial and past due date) */
  overdue: z.stringbool().optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
});

export const invoiceItemOut = z.object({ id: uuid, categoryId: uuid.nullable(), categoryName: z.string().nullable(), description: z.string(), amountMinor: z.number(), discountMinor: z.number() });

export const invoiceOut = z.object({
  id: uuid,
  invoiceNo: z.string(),
  studentId: uuid,
  studentName: z.string(),
  admissionNo: z.string(),
  gradeName: z.string().nullable(),
  sectionName: z.string().nullable(),
  title: z.string(),
  dueDate: dateStr,
  status: z.enum(INVOICE_STATUSES),
  /** unpaid/partial and the due date has passed */
  overdue: z.boolean(),
  daysOverdue: z.number(),
  totalMinor: z.number(),
  discountMinor: z.number(),
  paidMinor: z.number(),
  /** total - discount - paid (never negative) */
  balanceMinor: z.number(),
  /** `fees.lateFeePerDayMinor` x days overdue; computed on read, not stored. Payable together with the balance. */
  lateFeeMinor: z.number(),
  /** balance + late fee: the most that can be paid right now */
  amountDueNowMinor: z.number(),
  notes: z.string().nullable(),
  issuedAt: isoDateTime,
});
export type InvoiceOut = z.infer<typeof invoiceOut>;

export const paymentOut = z.object({
  id: uuid,
  invoiceId: uuid,
  invoiceNo: z.string(),
  studentId: uuid,
  studentName: z.string(),
  amountMinor: z.number(),
  refundedMinor: z.number(),
  method: z.enum(PAYMENT_METHODS),
  status: z.enum(PAYMENT_STATUSES),
  reference: z.string().nullable(),
  receiptNo: z.string().nullable(),
  gateway: z.string().nullable(),
  paidAt: isoDateTime.nullable(),
  receivedByName: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: isoDateTime,
});
export type PaymentOut = z.infer<typeof paymentOut>;

export const refundOut = z.object({
  id: uuid,
  paymentId: uuid,
  receiptNo: z.string().nullable(),
  invoiceId: uuid,
  invoiceNo: z.string(),
  studentId: uuid,
  studentName: z.string(),
  amountMinor: z.number(),
  reason: z.string(),
  status: z.enum(REFUND_STATUSES),
  requestedByName: z.string().nullable(),
  decidedByName: z.string().nullable(),
  decidedAt: isoDateTime.nullable(),
  processedAt: isoDateTime.nullable(),
  reference: z.string().nullable(),
  createdAt: isoDateTime,
});
export type RefundOut = z.infer<typeof refundOut>;

export const invoiceDetailOut = invoiceOut.extend({
  items: z.array(invoiceItemOut),
  payments: z.array(paymentOut),
  refunds: z.array(refundOut),
  voidReason: z.string().nullable(),
});
export type InvoiceDetailOut = z.infer<typeof invoiceDetailOut>;

export const invoiceCreateBody = z.object({
  studentId: uuid,
  title: text(150).min(2),
  dueDate: dateStr,
  items: z.array(z.object({ categoryId: uuid.nullable().optional(), description: text(200).min(1), amountMinor: positiveMinor })).min(1).max(30),
  notes: optText(300),
});
export const invoiceVoidBody = z.object({ reason: text(300).min(3) });

// ── payments ────────────────────────────────────────────────────────────────────────────────

export const OFFLINE_METHODS = ['cash', 'cheque', 'bank_transfer', 'upi', 'card'] as const;
export const paymentCreateBody = z.object({
  invoiceId: uuid,
  amountMinor: positiveMinor,
  method: z.enum(OFFLINE_METHODS),
  /** cheque / UTR / transaction reference */
  reference: optText(100),
  notes: optText(300),
});
export const paymentListQuery = pageQuery.extend({
  invoiceId: uuid.optional(),
  studentId: uuid.optional(),
  method: z.enum(PAYMENT_METHODS).optional(),
  status: z.enum(PAYMENT_STATUSES).optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
});

export const receiptOut = z.object({
  receiptNo: z.string(),
  paymentId: uuid,
  paidAt: isoDateTime,
  currency: z.string(),
  school: z.object({ name: z.string(), address: z.string(), phone: z.string(), email: z.string() }),
  student: z.object({ id: uuid, name: z.string(), admissionNo: z.string(), grade: z.string().nullable(), section: z.string().nullable() }),
  invoice: z.object({ id: uuid, invoiceNo: z.string(), title: z.string(), dueDate: dateStr, totalMinor: z.number(), discountMinor: z.number(), paidMinor: z.number(), balanceMinor: z.number() }),
  items: z.array(invoiceItemOut),
  payment: z.object({ amountMinor: z.number(), refundedMinor: z.number(), method: z.enum(PAYMENT_METHODS), reference: z.string().nullable(), status: z.enum(PAYMENT_STATUSES) }),
  receivedBy: z.string().nullable(),
});
export type ReceiptOut = z.infer<typeof receiptOut>;

// ── refunds ─────────────────────────────────────────────────────────────────────────────────

export const refundCreateBody = z.object({ amountMinor: positiveMinor, reason: text(300).min(3) });
export const refundListQuery = pageQuery.extend({ status: z.enum(REFUND_STATUSES).optional() });
export const refundApproveBody = z.object({ note: optText(300), reference: optText(100), process: z.boolean().default(true) }).default({ process: true });
export const refundRejectBody = z.object({ note: text(300).min(3) });
export const refundProcessBody = z.object({ reference: optText(100) }).default({});

// ── online payments ─────────────────────────────────────────────────────────────────────────

export const payOnlineBody = z.object({ amountMinor: positiveMinor.optional() }).default({});
export const payOnlineOut = z.object({
  paymentId: uuid,
  provider: z.enum(PAYMENT_GATEWAYS),
  orderId: z.string(),
  amountMinor: z.number(),
  currency: z.string(),
  /** public key id for the provider's checkout widget (never a secret) */
  keyId: z.string().nullable(),
  /** dev/mock gateway only */
  mock: z.boolean(),
});
export type PayOnlineOut = z.infer<typeof payOnlineOut>;
export const webhookProviderParam = z.object({ provider: z.enum(PAYMENT_GATEWAYS) });
export const webhookOut = z.object({ ok: z.literal(true), result: z.enum(['succeeded', 'failed', 'ignored', 'duplicate']) });

// ── expenses ────────────────────────────────────────────────────────────────────────────────

export const expenseCreateBody = z.object({
  category: text(60).min(2),
  description: text(300).min(2),
  amountMinor: positiveMinor,
  spentOn: dateStr,
  paidTo: optText(120),
  reference: optText(100),
  /** uploaded file id (POST /files) of the bill / receipt */
  receiptFileId: uuid.nullable().optional(),
});
export const expenseUpdateBody = expenseCreateBody.partial();
export const expenseListQuery = pageQuery.extend({ category: z.string().trim().max(60).optional(), status: z.enum(EXPENSE_STATUSES).optional(), from: dateStr.optional(), to: dateStr.optional() });
export const expenseDecisionBody = z.object({ note: optText(300) }).default({});
export const expenseOut = z.object({
  id: uuid,
  category: z.string(),
  description: z.string(),
  amountMinor: z.number(),
  spentOn: dateStr,
  paidTo: z.string().nullable(),
  reference: z.string().nullable(),
  receiptFileId: uuid.nullable(),
  status: z.enum(EXPENSE_STATUSES),
  createdByName: z.string().nullable(),
  approvedByName: z.string().nullable(),
  createdAt: isoDateTime,
});
export type ExpenseOut = z.infer<typeof expenseOut>;
export const expenseSummaryQuery = z.object({ from: dateStr.optional(), to: dateStr.optional() });
export const expenseSummaryOut = z.object({
  from: dateStr,
  to: dateStr,
  totalMinor: z.number(),
  pendingMinor: z.number(),
  byMonth: z.array(z.object({ month: z.string(), totalMinor: z.number() })),
  byCategory: z.array(z.object({ category: z.string(), totalMinor: z.number(), count: z.number() })),
});

// ── reports ─────────────────────────────────────────────────────────────────────────────────

export const agingBuckets = z.object({ notDue: z.number(), d1to30: z.number(), d31to60: z.number(), d61to90: z.number(), d90plus: z.number() });
export const outstandingQuery = z.object({ asOf: dateStr.optional(), gradeId: uuid.optional(), sectionId: uuid.optional(), academicYearId: uuid.optional(), groupBy: z.enum(['none', 'grade', 'section']).default('none') });
export const outstandingOut = z.object({
  asOf: dateStr,
  currency: z.string(),
  invoices: z.number(),
  outstandingMinor: z.number(),
  overdueMinor: z.number(),
  buckets: agingBuckets,
  rows: z.array(z.object({ id: uuid.nullable(), name: z.string(), invoices: z.number(), outstandingMinor: z.number(), overdueMinor: z.number(), buckets: agingBuckets })),
});
export const defaultersQuery = pageQuery.extend({ gradeId: uuid.optional(), sectionId: uuid.optional(), minOverdueDays: z.coerce.number().int().min(0).max(3650).default(1), asOf: dateStr.optional() });
export const defaulterOut = z.object({
  studentId: uuid,
  studentName: z.string(),
  admissionNo: z.string(),
  gradeName: z.string().nullable(),
  sectionName: z.string().nullable(),
  overdueInvoices: z.number(),
  overdueMinor: z.number(),
  oldestDueDate: dateStr,
  maxDaysOverdue: z.number(),
  guardianName: z.string().nullable(),
  guardianPhone: z.string().nullable(),
});
export const collectionQuery = z.object({ from: dateStr.optional(), to: dateStr.optional(), groupBy: z.enum(['day', 'month']).default('day') });
export const collectionOut = z.object({
  from: dateStr,
  to: dateStr,
  currency: z.string(),
  collectedMinor: z.number(),
  refundedMinor: z.number(),
  netMinor: z.number(),
  count: z.number(),
  series: z.array(z.object({ period: z.string(), collectedMinor: z.number(), refundedMinor: z.number(), count: z.number() })),
  byMethod: z.array(z.object({ method: z.enum(PAYMENT_METHODS), collectedMinor: z.number(), count: z.number() })),
  byCategory: z.array(z.object({ categoryId: uuid.nullable(), category: z.string(), collectedMinor: z.number() })),
});
export const financeSummaryQuery = z.object({ from: dateStr.optional(), to: dateStr.optional() });
export const financeSummaryOut = z.object({
  from: dateStr,
  to: dateStr,
  currency: z.string(),
  invoicedMinor: z.number(),
  collectedMinor: z.number(),
  refundedMinor: z.number(),
  netCollectedMinor: z.number(),
  /** null when the caller may not see expenses */
  expensesMinor: z.number().nullable(),
  netPositionMinor: z.number().nullable(),
  outstandingMinor: z.number(),
  overdueMinor: z.number(),
  collectionRatePercent: z.number().nullable(),
  byMonth: z.array(z.object({ month: z.string(), collectedMinor: z.number(), expensesMinor: z.number().nullable() })),
  pending: z.object({ refunds: z.number(), concessions: z.number(), expenses: z.number().nullable() }),
});
export type FinanceSummaryOut = z.infer<typeof financeSummaryOut>;
