import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { ExpenseOut, FinanceSummaryOut } from '@school-sync/shared';
import { collectionQuery, defaultersQuery, expenseCreateBody, expenseListQuery, expenseUpdateBody, outstandingQuery } from '@school-sync/shared';
import { audit, type AuditActor } from '../../core/audit';
import { assertFilesExist } from '../../core/files';
import { conflict, notFound } from '../../core/errors';
import { pageArgs, paged as pagedResult, todayIn } from '../../core/http';
import type { Principal } from '../../core/rbac/principal';
import { getSetting } from '../../core/settings';
import type { Executor } from '../../core/tenancy/pools';
import type { TenantInfo } from '../../core/tenancy/registry';
import { academicYears, concessions, expenses, grades, guardians, invoices, payments, refunds, sections, studentGuardians, students, users } from '../../db/tenant/schema';
import { round2 } from '../exams/common';

const SETTLED = ['succeeded', 'partially_refunded', 'refunded'] as const;
const OPEN = sql`${invoices.status} in ('unpaid','partial')`;
const BAL = sql`(${invoices.totalMinor} - ${invoices.discountMinor} - ${invoices.paidMinor})`;

/** `col` as a calendar date in the school's timezone. The zone is inlined (validated) so it can appear in GROUP BY too. */
function localDay(col: SQL | { getSQL(): SQL } | object, tz: string): SQL {
  if (!/^[A-Za-z0-9_/+-]+$/.test(tz)) throw new Error('Invalid timezone');
  return sql`((${col as SQL}) at time zone ${sql.raw(`'${tz}'`)})::date`;
}
const monthKey = (day: SQL) => sql<string>`to_char(${day}, ${sql.raw(`'YYYY-MM'`)})`;
const dayKey = (day: SQL) => sql<string>`to_char(${day}, ${sql.raw(`'YYYY-MM-DD'`)})`;
const monthStart = (d: string) => `${d.slice(0, 7)}-01`;

async function yearRange(db: Executor, today: string): Promise<{ from: string; to: string }> {
  const [y] = await db.select({ s: academicYears.startDate }).from(academicYears).where(eq(academicYears.isCurrent, true)).limit(1);
  return { from: y?.s ?? monthStart(today), to: today };
}

// ── outstanding & aging ─────────────────────────────────────────────────────────────────────

const bucketCols = (asOf: string) => {
  const days = sql`(${asOf}::date - ${invoices.dueDate})`;
  const sumWhere = (cond: SQL) => sql<number>`coalesce(sum(${BAL}) filter (where ${cond}), 0)::float8`;
  return {
    outstanding: sql<number>`coalesce(sum(${BAL}), 0)::float8`,
    overdue: sumWhere(sql`${days} > 0`),
    notDue: sumWhere(sql`${days} <= 0`),
    d1to30: sumWhere(sql`${days} between 1 and 30`),
    d31to60: sumWhere(sql`${days} between 31 and 60`),
    d61to90: sumWhere(sql`${days} between 61 and 90`),
    d90plus: sumWhere(sql`${days} > 90`),
    n: sql<number>`count(*)::int`,
  };
};

export async function outstandingReport(db: Executor, tenant: TenantInfo, q: z.infer<typeof outstandingQuery>) {
  const asOf = q.asOf ?? todayIn(tenant.timezone);
  const base = and(
    OPEN,
    sql`${BAL} > 0`,
    q.gradeId ? eq(students.currentGradeId, q.gradeId) : undefined,
    q.sectionId ? eq(students.currentSectionId, q.sectionId) : undefined,
    q.academicYearId ? eq(invoices.academicYearId, q.academicYearId) : undefined,
  );
  const cols = bucketCols(asOf);
  const [total] = await db.select(cols).from(invoices).innerJoin(students, eq(students.id, invoices.studentId)).where(base);
  const toBuckets = (r: { notDue: number; d1to30: number; d31to60: number; d61to90: number; d90plus: number }) => ({ notDue: r.notDue, d1to30: r.d1to30, d31to60: r.d31to60, d61to90: r.d61to90, d90plus: r.d90plus });
  let rows: { id: string | null; name: string; invoices: number; outstandingMinor: number; overdueMinor: number; buckets: ReturnType<typeof toBuckets> }[] = [];
  if (q.groupBy === 'grade') {
    const r = await db
      .select({ id: grades.id, name: grades.name, ordinal: grades.ordinal, ...cols })
      .from(invoices)
      .innerJoin(students, eq(students.id, invoices.studentId))
      .innerJoin(grades, eq(grades.id, students.currentGradeId))
      .where(base)
      .groupBy(grades.id, grades.name, grades.ordinal)
      .orderBy(asc(grades.ordinal));
    rows = r.map((x) => ({ id: x.id, name: x.name, invoices: x.n, outstandingMinor: x.outstanding, overdueMinor: x.overdue, buckets: toBuckets(x) }));
  } else if (q.groupBy === 'section') {
    const r = await db
      .select({ id: sections.id, name: sql<string>`${grades.name} || ' ' || ${sections.name}`, ordinal: grades.ordinal, sec: sections.name, ...cols })
      .from(invoices)
      .innerJoin(students, eq(students.id, invoices.studentId))
      .innerJoin(sections, eq(sections.id, students.currentSectionId))
      .innerJoin(grades, eq(grades.id, sections.gradeId))
      .where(base)
      .groupBy(sections.id, sections.name, grades.name, grades.ordinal)
      .orderBy(asc(grades.ordinal), asc(sections.name));
    rows = r.map((x) => ({ id: x.id, name: x.name, invoices: x.n, outstandingMinor: x.outstanding, overdueMinor: x.overdue, buckets: toBuckets(x) }));
  }
  const t = total ?? { outstanding: 0, overdue: 0, notDue: 0, d1to30: 0, d31to60: 0, d61to90: 0, d90plus: 0, n: 0 };
  return { asOf, currency: tenant.currency, invoices: t.n, outstandingMinor: t.outstanding, overdueMinor: t.overdue, buckets: toBuckets(t), rows };
}

// ── defaulters ──────────────────────────────────────────────────────────────────────────────

export async function defaultersReport(db: Executor, tenant: TenantInfo, q: z.infer<typeof defaultersQuery>, opts: { all?: boolean } = {}) {
  const asOf = q.asOf ?? todayIn(tenant.timezone);
  const days = sql`(${asOf}::date - ${invoices.dueDate})`;
  const where = and(
    OPEN,
    sql`${BAL} > 0`,
    sql`${days} >= ${q.minOverdueDays}`,
    q.gradeId ? eq(students.currentGradeId, q.gradeId) : undefined,
    q.sectionId ? eq(students.currentSectionId, q.sectionId) : undefined,
    q.q ? sql`(${sql.join([students.firstName, students.lastName, students.admissionNo].map((c) => sql`${c} ilike ${`%${q.q!.replace(/[\\%_]/g, '\\$&')}%`}`), sql` or `)})` : undefined,
  );
  const grouped = db
    .select({
      studentId: students.id,
      first: students.firstName,
      last: students.lastName,
      admissionNo: students.admissionNo,
      gradeName: grades.name,
      sectionName: sections.name,
      ordinal: grades.ordinal,
      overdueInvoices: sql<number>`count(*)::int`,
      overdueMinor: sql<number>`sum(${BAL})::float8`,
      oldest: sql<string>`min(${invoices.dueDate})::text`,
      maxDays: sql<number>`max(${days})::int`,
    })
    .from(invoices)
    .innerJoin(students, eq(students.id, invoices.studentId))
    .leftJoin(sections, eq(sections.id, students.currentSectionId))
    .leftJoin(grades, eq(grades.id, students.currentGradeId))
    .where(where)
    .groupBy(students.id, students.firstName, students.lastName, students.admissionNo, grades.name, sections.name, grades.ordinal)
    .orderBy(desc(sql`sum(${BAL})`), asc(students.firstName));
  const [rows, [cnt]] = await Promise.all([
    opts.all ? grouped.limit(5000) : grouped.limit(pageArgs(q).limit).offset(pageArgs(q).offset),
    db.select({ n: sql<number>`count(distinct ${students.id})::int` }).from(invoices).innerJoin(students, eq(students.id, invoices.studentId)).where(where),
  ]);
  // primary verified guardian per student (one batched query)
  const ids = rows.map((r) => r.studentId);
  const gs = ids.length
    ? await db
        .selectDistinctOn([studentGuardians.studentId], { studentId: studentGuardians.studentId, first: guardians.firstName, last: guardians.lastName, phone: guardians.phone })
        .from(studentGuardians)
        .innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId))
        .where(and(inArray(studentGuardians.studentId, ids), sql`${studentGuardians.verifiedAt} is not null`))
        .orderBy(studentGuardians.studentId, desc(studentGuardians.isPrimary), asc(studentGuardians.createdAt))
    : [];
  const gmap = new Map(gs.map((g) => [g.studentId, g]));
  const data = rows.map((r) => {
    const g = gmap.get(r.studentId);
    return {
      studentId: r.studentId,
      studentName: [r.first, r.last].filter(Boolean).join(' '),
      admissionNo: r.admissionNo,
      gradeName: r.gradeName,
      sectionName: r.sectionName,
      overdueInvoices: r.overdueInvoices,
      overdueMinor: r.overdueMinor,
      oldestDueDate: r.oldest,
      maxDaysOverdue: r.maxDays,
      guardianName: g ? [g.first, g.last].filter(Boolean).join(' ') : null,
      guardianPhone: g?.phone ?? null,
    };
  });
  return opts.all ? { data, total: cnt?.n ?? 0 } : pagedResult(data, cnt?.n ?? 0, q);
}

// ── collection ──────────────────────────────────────────────────────────────────────────────

export async function collectionReport(db: Executor, tenant: TenantInfo, q: z.infer<typeof collectionQuery>) {
  const today = todayIn(tenant.timezone);
  const from = q.from ?? monthStart(today);
  const to = q.to ?? today;
  const payDay = localDay(payments.paidAt, tenant.timezone);
  const refDay = localDay(refunds.processedAt, tenant.timezone);
  const key = (d: SQL) => (q.groupBy === 'month' ? monthKey(d) : dayKey(d));
  const payKey = key(payDay);
  const refKey = key(refDay);
  const settled = and(inArray(payments.status, [...SETTLED]), sql`${payDay} between ${from}::date and ${to}::date`);

  const [series, refSeries, byMethod, byCategory] = await Promise.all([
    db.select({ period: payKey, amount: sql<number>`sum(${payments.amountMinor})::float8`, n: sql<number>`count(*)::int` }).from(payments).where(settled).groupBy(payKey).orderBy(payKey),
    db.select({ period: refKey, amount: sql<number>`sum(${refunds.amountMinor})::float8` }).from(refunds).where(and(eq(refunds.status, 'processed'), sql`${refDay} between ${from}::date and ${to}::date`)).groupBy(refKey),
    db.select({ method: payments.method, amount: sql<number>`sum(${payments.amountMinor})::float8`, n: sql<number>`count(*)::int` }).from(payments).where(settled).groupBy(payments.method).orderBy(desc(sql`sum(${payments.amountMinor})`)),
    // each payment is spread over its invoice's items in proportion to their net amounts
    db.execute<{ category_id: string | null; category: string | null; amount: number }>(sql`
      select ii.category_id, c.name as category,
             round(sum((p.amount_minor - p.refunded_minor)::numeric * (ii.amount_minor - ii.discount_minor) / nullif(t.net, 0)))::float8 as amount
        from payments p
        join invoice_items ii on ii.invoice_id = p.invoice_id
        join (select invoice_id, sum(amount_minor - discount_minor) as net from invoice_items group by invoice_id) t on t.invoice_id = p.invoice_id
        left join fee_categories c on c.id = ii.category_id
       where p.status in ('succeeded','partially_refunded','refunded')
         and ${localDay(sql`p.paid_at`, tenant.timezone)} between ${from}::date and ${to}::date
       group by ii.category_id, c.name
       order by amount desc nulls last`),
  ]);
  const refBy = new Map(refSeries.map((r) => [r.period, r.amount]));
  const periods = new Set([...series.map((s) => s.period), ...refSeries.map((r) => r.period)]);
  const pMap = new Map(series.map((s) => [s.period, s]));
  const merged = [...periods].sort().map((period) => ({ period, collectedMinor: pMap.get(period)?.amount ?? 0, refundedMinor: refBy.get(period) ?? 0, count: pMap.get(period)?.n ?? 0 }));
  const collected = series.reduce((t, s) => t + s.amount, 0);
  const refunded = refSeries.reduce((t, s) => t + s.amount, 0);
  return {
    from,
    to,
    currency: tenant.currency,
    collectedMinor: collected,
    refundedMinor: refunded,
    netMinor: collected - refunded,
    count: series.reduce((t, s) => t + s.n, 0),
    series: merged,
    byMethod: byMethod.map((m) => ({ method: m.method, collectedMinor: m.amount, count: m.n })),
    byCategory: byCategory.rows.map((c) => ({ categoryId: c.category_id, category: c.category ?? 'Other', collectedMinor: Number(c.amount ?? 0) })),
  };
}

// ── expenses ────────────────────────────────────────────────────────────────────────────────

const expenseSelect = (db: Executor) =>
  db
    .select({
      e: expenses,
      createdByName: sql<string | null>`(select u.display_name from ${users} u where u.id = ${expenses.createdBy})`,
      approvedByName: sql<string | null>`(select u.display_name from ${users} u where u.id = ${expenses.approvedBy})`,
    })
    .from(expenses);
const toExpenseOut = (r: Awaited<ReturnType<typeof expenseSelect>>[number]): ExpenseOut => ({
  id: r.e.id,
  category: r.e.category,
  description: r.e.description,
  amountMinor: r.e.amountMinor,
  spentOn: r.e.spentOn,
  paidTo: r.e.paidTo,
  reference: r.e.reference,
  receiptFileId: r.e.receiptFileId,
  status: r.e.status,
  createdByName: r.createdByName,
  approvedByName: r.approvedByName,
  createdAt: r.e.createdAt.toISOString(),
});
async function expenseById(db: Executor, id: string): Promise<ExpenseOut> {
  const [r] = await expenseSelect(db).where(eq(expenses.id, id)).limit(1);
  if (!r) throw notFound('Expense');
  return toExpenseOut(r);
}
const expenseWhere = (q: z.infer<typeof expenseListQuery>) =>
  and(
    q.category ? eq(expenses.category, q.category) : undefined,
    q.status ? eq(expenses.status, q.status) : undefined,
    q.from ? sql`${expenses.spentOn} >= ${q.from}` : undefined,
    q.to ? sql`${expenses.spentOn} <= ${q.to}` : undefined,
    q.q ? sql`(${expenses.description} ilike ${`%${q.q.replace(/[\\%_]/g, '\\$&')}%`} or ${expenses.paidTo} ilike ${`%${q.q.replace(/[\\%_]/g, '\\$&')}%`})` : undefined,
  );

export async function listExpenses(db: Executor, q: z.infer<typeof expenseListQuery>, opts: { all?: boolean } = {}) {
  const where = expenseWhere(q);
  const query = expenseSelect(db).where(where).orderBy(desc(expenses.spentOn), desc(expenses.createdAt));
  const [rows, [cnt]] = await Promise.all([opts.all ? query.limit(5000) : query.limit(pageArgs(q).limit).offset(pageArgs(q).offset), db.select({ n: sql<number>`count(*)::int` }).from(expenses).where(where)]);
  return opts.all ? rows.map(toExpenseOut) : pagedResult(rows.map(toExpenseOut), cnt?.n ?? 0, q);
}
export const getExpense = expenseById;

export async function createExpense(tx: Executor, actor: AuditActor, body: z.infer<typeof expenseCreateBody>): Promise<ExpenseOut> {
  if (body.receiptFileId) await assertFilesExist(tx, [body.receiptFileId]);
  const cfg = await getSetting(tx, 'fees');
  const needsApproval = body.amountMinor > cfg.expenseApprovalThresholdMinor;
  const [e] = await tx
    .insert(expenses)
    .values({ category: body.category, description: body.description, amountMinor: body.amountMinor, spentOn: body.spentOn, paidTo: body.paidTo ?? null, reference: body.reference ?? null, receiptFileId: body.receiptFileId ?? null, status: needsApproval ? 'pending' : 'approved', createdBy: actor.userId ?? null })
    .returning({ id: expenses.id });
  const out = await expenseById(tx, e!.id);
  await audit(tx, actor, { action: 'expenses.create', entity: 'expense', entityId: e!.id, after: { ...out, needsApproval } });
  return out;
}

export async function updateExpense(tx: Executor, actor: AuditActor, id: string, body: z.infer<typeof expenseUpdateBody>): Promise<ExpenseOut> {
  const [cur] = await tx.select().from(expenses).where(eq(expenses.id, id)).for('update').limit(1);
  if (!cur) throw notFound('Expense');
  if (body.receiptFileId) await assertFilesExist(tx, [body.receiptFileId]);
  const cfg = await getSetting(tx, 'fees');
  const amount = body.amountMinor ?? cur.amountMinor;
  // a rejected expense is resubmitted by editing it; raising an approved one above the threshold sends it back for approval
  const status = cur.status === 'rejected' ? (amount > cfg.expenseApprovalThresholdMinor ? 'pending' : 'approved') : cur.status === 'approved' && amount > cur.amountMinor && amount > cfg.expenseApprovalThresholdMinor ? 'pending' : cur.status;
  await tx
    .update(expenses)
    .set({ ...(body.category !== undefined ? { category: body.category } : {}), ...(body.description !== undefined ? { description: body.description } : {}), amountMinor: amount, ...(body.spentOn !== undefined ? { spentOn: body.spentOn } : {}), ...(body.paidTo !== undefined ? { paidTo: body.paidTo ?? null } : {}), ...(body.reference !== undefined ? { reference: body.reference ?? null } : {}), ...(body.receiptFileId !== undefined ? { receiptFileId: body.receiptFileId ?? null } : {}), status, approvedBy: status === 'pending' ? null : cur.approvedBy })
    .where(eq(expenses.id, id));
  const out = await expenseById(tx, id);
  await audit(tx, actor, { action: 'expenses.update', entity: 'expense', entityId: id, before: { category: cur.category, description: cur.description, amountMinor: cur.amountMinor, spentOn: cur.spentOn, status: cur.status }, after: { ...body, status } });
  return out;
}

export async function decideExpense(tx: Executor, actor: AuditActor, id: string, decision: 'approved' | 'rejected', note?: string | null): Promise<ExpenseOut> {
  const [cur] = await tx.select().from(expenses).where(eq(expenses.id, id)).for('update').limit(1);
  if (!cur) throw notFound('Expense');
  if (cur.status !== 'pending') throw conflict(`This expense is already ${cur.status}`, 'ALREADY_DECIDED');
  await tx.update(expenses).set({ status: decision, approvedBy: actor.userId ?? null, decidedAt: new Date(), decisionNote: note ?? null }).where(eq(expenses.id, id));
  await audit(tx, actor, { action: decision === 'approved' ? 'expenses.approve' : 'expenses.reject', entity: 'expense', entityId: id, before: { status: 'pending' }, after: { status: decision, note: note ?? null, amountMinor: cur.amountMinor, category: cur.category } });
  return expenseById(tx, id);
}

export async function deleteExpense(tx: Executor, actor: AuditActor, id: string): Promise<void> {
  const [cur] = await tx.select().from(expenses).where(eq(expenses.id, id)).limit(1);
  if (!cur) throw notFound('Expense');
  await tx.delete(expenses).where(eq(expenses.id, id));
  await audit(tx, actor, { action: 'expenses.delete', entity: 'expense', entityId: id, before: cur });
}

export async function expenseSummary(db: Executor, tenant: TenantInfo, q: { from?: string; to?: string }) {
  const today = todayIn(tenant.timezone);
  const range = q.from && q.to ? { from: q.from, to: q.to } : { ...(await yearRange(db, today)), ...(q.from ? { from: q.from } : {}), ...(q.to ? { to: q.to } : {}) };
  const inRange = sql`${expenses.spentOn} between ${range.from}::date and ${range.to}::date`;
  const month = sql<string>`to_char(${expenses.spentOn}, ${sql.raw(`'YYYY-MM'`)})`;
  const [byMonth, byCategory, [pending]] = await Promise.all([
    db.select({ month, total: sql<number>`sum(${expenses.amountMinor})::float8` }).from(expenses).where(and(eq(expenses.status, 'approved'), inRange)).groupBy(month).orderBy(month),
    db.select({ category: expenses.category, total: sql<number>`sum(${expenses.amountMinor})::float8`, n: sql<number>`count(*)::int` }).from(expenses).where(and(eq(expenses.status, 'approved'), inRange)).groupBy(expenses.category).orderBy(desc(sql`sum(${expenses.amountMinor})`)),
    db.select({ total: sql<number>`coalesce(sum(${expenses.amountMinor}), 0)::float8` }).from(expenses).where(and(eq(expenses.status, 'pending'), inRange)),
  ]);
  return { from: range.from, to: range.to, totalMinor: byMonth.reduce((t, m) => t + m.total, 0), pendingMinor: pending?.total ?? 0, byMonth: byMonth.map((m) => ({ month: m.month, totalMinor: m.total })), byCategory: byCategory.map((c) => ({ category: c.category, totalMinor: c.total, count: c.n })) };
}

// ── finance summary ─────────────────────────────────────────────────────────────────────────

/** Management dashboard: collected vs expenses vs outstanding for a period (default: current academic year to date). */
export async function financeSummary(db: Executor, tenant: TenantInfo, p: Principal, q: { from?: string; to?: string }): Promise<FinanceSummaryOut> {
  const today = todayIn(tenant.timezone);
  const def = await yearRange(db, today);
  const from = q.from ?? def.from;
  const to = q.to ?? def.to;
  const seesExpenses = p.can('expenses:view', 'school');
  const payDay = localDay(payments.paidAt, tenant.timezone);
  const refDay = localDay(refunds.processedAt, tenant.timezone);
  const payMonth = monthKey(payDay);
  const [inv, coll, ref, collMonths, open, pend, exp, expMonths, expPending] = await Promise.all([
    db
      .select({ payable: sql<number>`coalesce(sum(${invoices.totalMinor} - ${invoices.discountMinor}), 0)::float8`, paid: sql<number>`coalesce(sum(${invoices.paidMinor}), 0)::float8` })
      .from(invoices)
      .where(and(sql`${invoices.status} <> 'void'`, sql`${invoices.dueDate} between ${from}::date and ${to}::date`)),
    db.select({ total: sql<number>`coalesce(sum(${payments.amountMinor}), 0)::float8` }).from(payments).where(and(inArray(payments.status, [...SETTLED]), sql`${payDay} between ${from}::date and ${to}::date`)),
    db.select({ total: sql<number>`coalesce(sum(${refunds.amountMinor}), 0)::float8` }).from(refunds).where(and(eq(refunds.status, 'processed'), sql`${refDay} between ${from}::date and ${to}::date`)),
    db.select({ month: payMonth, total: sql<number>`sum(${payments.amountMinor})::float8` }).from(payments).where(and(inArray(payments.status, [...SETTLED]), sql`${payDay} between ${from}::date and ${to}::date`)).groupBy(payMonth).orderBy(payMonth),
    db.select({ outstanding: sql<number>`coalesce(sum(${BAL}), 0)::float8`, overdue: sql<number>`coalesce(sum(${BAL}) filter (where ${invoices.dueDate} < ${today}::date), 0)::float8` }).from(invoices).where(OPEN),
    Promise.all([
      db.select({ n: sql<number>`count(*)::int` }).from(refunds).where(eq(refunds.status, 'requested')),
      db.select({ n: sql<number>`count(*)::int` }).from(concessions).where(eq(concessions.status, 'pending')),
    ]),
    seesExpenses ? db.select({ total: sql<number>`coalesce(sum(${expenses.amountMinor}), 0)::float8` }).from(expenses).where(and(eq(expenses.status, 'approved'), sql`${expenses.spentOn} between ${from}::date and ${to}::date`)) : Promise.resolve(null),
    seesExpenses
      ? db.select({ month: sql<string>`to_char(${expenses.spentOn}, ${sql.raw(`'YYYY-MM'`)})`, total: sql<number>`sum(${expenses.amountMinor})::float8` }).from(expenses).where(and(eq(expenses.status, 'approved'), sql`${expenses.spentOn} between ${from}::date and ${to}::date`)).groupBy(sql`1`)
      : Promise.resolve(null),
    seesExpenses ? db.select({ n: sql<number>`count(*)::int` }).from(expenses).where(eq(expenses.status, 'pending')) : Promise.resolve(null),
  ]);
  const collected = coll[0]?.total ?? 0;
  const refunded = ref[0]?.total ?? 0;
  const expensesTotal = exp ? (exp[0]?.total ?? 0) : null;
  const months = new Set([...collMonths.map((m) => m.month), ...(expMonths ?? []).map((m) => m.month)]);
  const cm = new Map(collMonths.map((m) => [m.month, m.total]));
  const em = new Map((expMonths ?? []).map((m) => [m.month, m.total]));
  const payable = inv[0]?.payable ?? 0;
  return {
    from,
    to,
    currency: tenant.currency,
    invoicedMinor: payable,
    collectedMinor: collected,
    refundedMinor: refunded,
    netCollectedMinor: collected - refunded,
    expensesMinor: expensesTotal,
    netPositionMinor: expensesTotal == null ? null : collected - refunded - expensesTotal,
    outstandingMinor: open[0]?.outstanding ?? 0,
    overdueMinor: open[0]?.overdue ?? 0,
    collectionRatePercent: payable > 0 ? round2(Math.min(100, ((inv[0]?.paid ?? 0) / payable) * 100)) : null,
    byMonth: [...months].sort().map((month) => ({ month, collectedMinor: cm.get(month) ?? 0, expensesMinor: seesExpenses ? (em.get(month) ?? 0) : null })),
    pending: { refunds: pend[0][0]?.n ?? 0, concessions: pend[1][0]?.n ?? 0, expenses: expPending ? (expPending[0]?.n ?? 0) : null },
  };
}

