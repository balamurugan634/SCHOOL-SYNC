import { sql } from 'drizzle-orm';
import { bigint, boolean, date, index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { INVOICE_STATUSES, PAYMENT_METHODS, PAYMENT_STATUSES } from '@school-sync/shared';
import { createdAt, pk, ts, updatedAt } from './_helpers';
import { academicYears, grades } from './academics';
import { students } from './people';

/** All money is stored as integer minor units (paise / cents). Currency comes from school settings. */
const money = (name: string) => bigint(name, { mode: 'number' });

export const feeCategories = pgTable(
  'fee_categories',
  {
    id: pk(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('fee_categories_code_uq').on(t.code)],
);

export const feeStructures = pgTable('fee_structures', {
  id: pk(),
  name: text('name').notNull(),
  academicYearId: uuid('academic_year_id')
    .notNull()
    .references(() => academicYears.id),
  /** NULL = applies to every grade */
  gradeId: uuid('grade_id').references(() => grades.id),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Each row is one instalment-level charge, e.g. "Tuition – Term 1", due 10 Jun. */
export const feeStructureItems = pgTable(
  'fee_structure_items',
  {
    id: pk(),
    structureId: uuid('structure_id')
      .notNull()
      .references(() => feeStructures.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => feeCategories.id),
    label: text('label').notNull(),
    amountMinor: money('amount_minor').notNull(),
    dueDate: date('due_date', { mode: 'string' }).notNull(),
    ordinal: integer('ordinal').notNull().default(0),
  },
  (t) => [index('fee_structure_items_structure_idx').on(t.structureId, t.dueDate)],
);

export const studentFeePlans = pgTable(
  'student_fee_plans',
  {
    id: pk(),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    structureId: uuid('structure_id')
      .notNull()
      .references(() => feeStructures.id),
    academicYearId: uuid('academic_year_id')
      .notNull()
      .references(() => academicYears.id),
    notes: text('notes'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('student_fee_plans_uq').on(t.studentId, t.academicYearId), index('student_fee_plans_structure_idx').on(t.structureId)],
);

/** Scholarships / discounts. Only `approved` concessions are applied when dues are generated. */
export const concessions = pgTable(
  'concessions',
  {
    id: pk(),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    academicYearId: uuid('academic_year_id')
      .notNull()
      .references(() => academicYears.id),
    name: text('name').notNull(),
    type: text('type', { enum: ['percent', 'fixed'] }).notNull(),
    /** percent: basis points (1000 = 10.00%); fixed: minor units */
    value: money('value').notNull(),
    categoryId: uuid('category_id').references(() => feeCategories.id),
    reason: text('reason'),
    status: text('status', { enum: ['pending', 'approved', 'rejected'] })
      .notNull()
      .default('pending'),
    requestedBy: uuid('requested_by'),
    decidedBy: uuid('decided_by'),
    decidedAt: ts('decided_at'),
    decisionNote: text('decision_note'),
    createdAt: createdAt(),
  },
  (t) => [index('concessions_student_idx').on(t.studentId, t.academicYearId)],
);

export const invoices = pgTable(
  'invoices',
  {
    id: pk(),
    invoiceNo: text('invoice_no').notNull(),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id),
    academicYearId: uuid('academic_year_id')
      .notNull()
      .references(() => academicYears.id),
    title: text('title').notNull(),
    dueDate: date('due_date', { mode: 'string' }).notNull(),
    totalMinor: money('total_minor').notNull(),
    discountMinor: money('discount_minor').notNull().default(0),
    /** running total of succeeded payments minus refunds (maintained in the payment transaction) */
    paidMinor: money('paid_minor').notNull().default(0),
    status: text('status', { enum: INVOICE_STATUSES }).notNull().default('unpaid'),
    notes: text('notes'),
    /** the student plan this invoice was generated from (NULL = manual one-off invoice) */
    planId: uuid('plan_id').references(() => studentFeePlans.id),
    voidedAt: ts('voided_at'),
    voidedBy: uuid('voided_by'),
    voidReason: text('void_reason'),
    createdBy: uuid('created_by'),
    issuedAt: ts('issued_at').notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('invoices_no_uq').on(t.invoiceNo),
    // idempotent dues generation: one live invoice per plan and due date
    uniqueIndex('invoices_plan_due_uq').on(t.planId, t.dueDate).where(sql`${t.planId} is not null and ${t.status} <> 'void'`),
    index('invoices_student_idx').on(t.studentId, t.dueDate),
    index('invoices_status_due_idx').on(t.status, t.dueDate),
  ],
);

export const invoiceItems = pgTable(
  'invoice_items',
  {
    id: pk(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id').references(() => feeCategories.id),
    /** the structure item this charge came from (NULL for manual invoices) */
    structureItemId: uuid('structure_item_id').references(() => feeStructureItems.id, { onDelete: 'set null' }),
    description: text('description').notNull(),
    amountMinor: money('amount_minor').notNull(),
    discountMinor: money('discount_minor').notNull().default(0),
  },
  (t) => [index('invoice_items_invoice_idx').on(t.invoiceId), index('invoice_items_structure_item_idx').on(t.structureItemId)],
);

export const payments = pgTable(
  'payments',
  {
    id: pk(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id),
    amountMinor: money('amount_minor').notNull(),
    refundedMinor: money('refunded_minor').notNull().default(0),
    method: text('method', { enum: PAYMENT_METHODS }).notNull(),
    status: text('status', { enum: PAYMENT_STATUSES }).notNull().default('pending'),
    reference: text('reference'),
    gateway: text('gateway'),
    gatewayOrderId: text('gateway_order_id'),
    gatewayPaymentId: text('gateway_payment_id'),
    /** client-supplied key → retries can never double-charge / double-record */
    idempotencyKey: text('idempotency_key'),
    receiptNo: text('receipt_no'),
    paidAt: ts('paid_at'),
    receivedBy: uuid('received_by'),
    payerUserId: uuid('payer_user_id'),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('payments_receipt_uq').on(t.receiptNo),
    uniqueIndex('payments_idem_uq').on(t.idempotencyKey),
    uniqueIndex('payments_gateway_payment_uq').on(t.gatewayPaymentId),
    uniqueIndex('payments_gateway_order_uq').on(t.gatewayOrderId),
    index('payments_invoice_idx').on(t.invoiceId),
    index('payments_student_idx').on(t.studentId, t.createdAt.desc()),
    index('payments_paid_at_idx').on(t.paidAt),
  ],
);

export const refunds = pgTable(
  'refunds',
  {
    id: pk(),
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => payments.id),
    amountMinor: money('amount_minor').notNull(),
    reason: text('reason').notNull(),
    status: text('status', { enum: ['requested', 'approved', 'rejected', 'processed'] })
      .notNull()
      .default('requested'),
    requestedBy: uuid('requested_by'),
    decidedBy: uuid('decided_by'),
    decidedAt: ts('decided_at'),
    decisionNote: text('decision_note'),
    processedBy: uuid('processed_by'),
    processedAt: ts('processed_at'),
    /** how the money went back (cheque no., UTR, gateway refund id) */
    reference: text('reference'),
    createdAt: createdAt(),
  },
  (t) => [index('refunds_payment_idx').on(t.paymentId), index('refunds_status_idx').on(t.status)],
);

export const expenses = pgTable(
  'expenses',
  {
    id: pk(),
    category: text('category').notNull(),
    description: text('description').notNull(),
    amountMinor: money('amount_minor').notNull(),
    spentOn: date('spent_on', { mode: 'string' }).notNull(),
    paidTo: text('paid_to'),
    reference: text('reference'),
    receiptFileId: uuid('receipt_file_id'),
    status: text('status', { enum: ['pending', 'approved', 'rejected'] })
      .notNull()
      .default('approved'),
    createdBy: uuid('created_by'),
    approvedBy: uuid('approved_by'),
    decidedAt: ts('decided_at'),
    decisionNote: text('decision_note'),
    createdAt: createdAt(),
  },
  (t) => [index('expenses_spent_idx').on(t.spentOn), index('expenses_category_idx').on(t.category, t.spentOn)],
);

/** Which approved concession reduced which invoice, and by how much (drives "fixed" concession balances + voiding). */
export const concessionApplications = pgTable(
  'concession_applications',
  {
    id: pk(),
    concessionId: uuid('concession_id')
      .notNull()
      .references(() => concessions.id, { onDelete: 'cascade' }),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    amountMinor: money('amount_minor').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('concession_applications_concession_idx').on(t.concessionId), index('concession_applications_invoice_idx').on(t.invoiceId)],
);

/** Reminder ledger: makes the daily `fees.reminders` job idempotent (one row per invoice, kind and day). */
export const feeReminders = pgTable(
  'fee_reminders',
  {
    id: pk(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['due_soon', 'overdue'] }).notNull(),
    sentOn: date('sent_on', { mode: 'string' }).notNull(),
    recipients: integer('recipients').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('fee_reminders_uq').on(t.invoiceId, t.kind, t.sentOn)],
);
