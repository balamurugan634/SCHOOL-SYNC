import { and, asc, desc, eq, inArray, notInArray, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { ConcessionOut, FeeCategoryOut, InvoiceDetailOut, PlanOut, StructureItemOut, StructureOut } from '@school-sync/shared';
import {
  concessionCreateBody,
  concessionListQuery,
  feeCategoryCreateBody,
  feeCategoryUpdateBody,
  generateDuesBody,
  invoiceCreateBody,
  invoiceListQuery,
  planBulkBody,
  planCreateBody,
  planListQuery,
  structureCreateBody,
  structureItemIn,
  structureListQuery,
} from '@school-sync/shared';
import { audit, type AuditActor } from '../../core/audit';
import { conflict, notFound, unprocessable } from '../../core/errors';
import { ilikeAny, pageArgs, paged as pagedResult, todayIn } from '../../core/http';
import type { Principal } from '../../core/rbac/principal';
import { studentIdScope } from '../../core/rbac/scope';
import { getSetting } from '../../core/settings';
import type { Executor } from '../../core/tenancy/pools';
import type { TenantInfo } from '../../core/tenancy/registry';
import {
  academicYears,
  concessionApplications,
  concessions,
  feeCategories,
  feeStructureItems,
  feeStructures,
  grades,
  invoiceItems,
  invoices,
  payments,
  refunds,
  sections,
  studentFeePlans,
  students,
} from '../../db/tenant/schema';
import { formatNumber, reserveNumbers, yearToken } from './billing';
import { invoiceBase, paymentBase, refundBase, toInvoiceOut, toPaymentOut, toRefundOut } from './views';

const ACTIVE_STUDENT = [notInArray(students.status, ['transferred', 'withdrawn', 'alumni']), sql`${students.archivedAt} is null`] as const;
const name = (first: string, last: string | null) => [first, last].filter(Boolean).join(' ');

async function currentYearId(db: Executor): Promise<string> {
  const [y] = await db.select({ id: academicYears.id }).from(academicYears).where(eq(academicYears.isCurrent, true)).limit(1);
  if (!y) throw unprocessable('No current academic year is set up', 'NO_ACADEMIC_YEAR');
  return y.id;
}

// ── categories ──────────────────────────────────────────────────────────────────────────────

export async function listCategories(db: Executor): Promise<FeeCategoryOut[]> {
  return (await db.select().from(feeCategories).orderBy(desc(feeCategories.isActive), asc(feeCategories.name))).map((c) => ({ id: c.id, code: c.code, name: c.name, isActive: c.isActive }));
}

export async function createCategory(tx: Executor, actor: AuditActor, body: z.infer<typeof feeCategoryCreateBody>): Promise<FeeCategoryOut> {
  const [dup] = await tx.select({ id: feeCategories.id }).from(feeCategories).where(eq(feeCategories.code, body.code)).limit(1);
  if (dup) throw conflict(`A category with code ${body.code} already exists`, 'CATEGORY_EXISTS');
  const [c] = await tx.insert(feeCategories).values({ code: body.code, name: body.name }).returning();
  const out = { id: c!.id, code: c!.code, name: c!.name, isActive: c!.isActive };
  await audit(tx, actor, { action: 'fees.category_create', entity: 'fee_category', entityId: c!.id, after: out });
  return out;
}

export async function updateCategory(tx: Executor, actor: AuditActor, id: string, body: z.infer<typeof feeCategoryUpdateBody>): Promise<FeeCategoryOut> {
  const [before] = await tx.select().from(feeCategories).where(eq(feeCategories.id, id)).limit(1);
  if (!before) throw notFound('Fee category');
  const [c] = await tx.update(feeCategories).set(body).where(eq(feeCategories.id, id)).returning();
  const out = { id: c!.id, code: c!.code, name: c!.name, isActive: c!.isActive };
  await audit(tx, actor, { action: 'fees.category_update', entity: 'fee_category', entityId: id, before: { name: before.name, isActive: before.isActive }, after: body });
  return out;
}

// ── structures ──────────────────────────────────────────────────────────────────────────────

async function hydrateStructures(db: Executor, rows: (typeof feeStructures.$inferSelect)[]): Promise<StructureOut[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const gradeIds = rows.map((r) => r.gradeId).filter((x): x is string => !!x);
  const [items, plans, ys, gs] = await Promise.all([
    db
      .select({ i: feeStructureItems, categoryName: feeCategories.name })
      .from(feeStructureItems)
      .innerJoin(feeCategories, eq(feeCategories.id, feeStructureItems.categoryId))
      .where(inArray(feeStructureItems.structureId, ids))
      .orderBy(asc(feeStructureItems.dueDate), asc(feeStructureItems.ordinal)),
    db.select({ structureId: studentFeePlans.structureId, n: sql<number>`count(*)::int` }).from(studentFeePlans).where(inArray(studentFeePlans.structureId, ids)).groupBy(studentFeePlans.structureId),
    db.select({ id: academicYears.id, name: academicYears.name }).from(academicYears).where(inArray(academicYears.id, [...new Set(rows.map((r) => r.academicYearId))])),
    gradeIds.length ? db.select({ id: grades.id, name: grades.name }).from(grades).where(inArray(grades.id, gradeIds)) : Promise.resolve([]),
  ]);
  const byStructure = Map.groupBy(items, (x) => x.i.structureId);
  const planCount = new Map(plans.map((p) => [p.structureId, p.n]));
  const yn = new Map(ys.map((y) => [y.id, y.name]));
  const gn = new Map(gs.map((g) => [g.id, g.name]));
  return rows.map((s) => {
    const its: StructureItemOut[] = (byStructure.get(s.id) ?? []).map((x) => ({ id: x.i.id, categoryId: x.i.categoryId, categoryName: x.categoryName, label: x.i.label, amountMinor: x.i.amountMinor, dueDate: x.i.dueDate, ordinal: x.i.ordinal }));
    return {
      id: s.id,
      name: s.name,
      academicYearId: s.academicYearId,
      academicYearName: yn.get(s.academicYearId) ?? null,
      gradeId: s.gradeId,
      gradeName: s.gradeId ? (gn.get(s.gradeId) ?? null) : null,
      isActive: s.isActive,
      totalMinor: its.reduce((t, x) => t + x.amountMinor, 0),
      planCount: planCount.get(s.id) ?? 0,
      items: its,
      createdAt: s.createdAt.toISOString(),
    };
  });
}

export async function listStructures(db: Executor, q: z.infer<typeof structureListQuery>) {
  const where = and(
    q.academicYearId ? eq(feeStructures.academicYearId, q.academicYearId) : undefined,
    q.gradeId ? sql`(${feeStructures.gradeId} = ${q.gradeId} or ${feeStructures.gradeId} is null)` : undefined,
    q.active === undefined ? undefined : eq(feeStructures.isActive, q.active),
    q.q ? ilikeAny(q.q, feeStructures.name) : undefined,
  );
  const [rows, [cnt]] = await Promise.all([
    db.select().from(feeStructures).where(where).orderBy(desc(feeStructures.createdAt)).limit(pageArgs(q).limit).offset(pageArgs(q).offset),
    db.select({ n: sql<number>`count(*)::int` }).from(feeStructures).where(where),
  ]);
  return pagedResult(await hydrateStructures(db, rows), cnt?.n ?? 0, q);
}

export async function getStructure(db: Executor, id: string): Promise<StructureOut> {
  const [s] = await db.select().from(feeStructures).where(eq(feeStructures.id, id)).limit(1);
  if (!s) throw notFound('Fee structure');
  return (await hydrateStructures(db, [s]))[0]!;
}

async function assertCategories(db: Executor, ids: string[]) {
  const unique = [...new Set(ids)];
  const found = await db.select({ id: feeCategories.id, active: feeCategories.isActive }).from(feeCategories).where(inArray(feeCategories.id, unique));
  if (found.length !== unique.length) throw unprocessable('A fee category was not found', 'CATEGORY_NOT_FOUND');
  if (found.some((f) => !f.active)) throw unprocessable('A fee category is inactive', 'CATEGORY_INACTIVE');
}

export async function createStructure(tx: Executor, actor: AuditActor, body: z.infer<typeof structureCreateBody>): Promise<StructureOut> {
  const yearId = body.academicYearId ?? (await currentYearId(tx));
  const [year] = await tx.select({ id: academicYears.id }).from(academicYears).where(eq(academicYears.id, yearId)).limit(1);
  if (!year) throw unprocessable('Academic year not found', 'ACADEMIC_YEAR_NOT_FOUND');
  if (body.gradeId) {
    const [g] = await tx.select({ id: grades.id }).from(grades).where(eq(grades.id, body.gradeId)).limit(1);
    if (!g) throw unprocessable('Grade not found', 'GRADE_NOT_FOUND');
  }
  await assertCategories(tx, body.items.map((i) => i.categoryId));
  const [s] = await tx.insert(feeStructures).values({ name: body.name, academicYearId: yearId, gradeId: body.gradeId ?? null }).returning();
  await tx.insert(feeStructureItems).values(body.items.map((i, idx) => ({ structureId: s!.id, categoryId: i.categoryId, label: i.label, amountMinor: i.amountMinor, dueDate: i.dueDate, ordinal: i.ordinal ?? idx })));
  const out = await getStructure(tx, s!.id);
  await audit(tx, actor, { action: 'fees.structure_create', entity: 'fee_structure', entityId: s!.id, after: out });
  return out;
}

export async function updateStructure(tx: Executor, actor: AuditActor, id: string, body: { name?: string; isActive?: boolean }): Promise<StructureOut> {
  const before = await getStructure(tx, id);
  await tx.update(feeStructures).set(body).where(eq(feeStructures.id, id));
  await audit(tx, actor, { action: 'fees.structure_update', entity: 'fee_structure', entityId: id, before: { name: before.name, isActive: before.isActive }, after: body });
  return getStructure(tx, id);
}

async function isBilled(db: Executor, itemId: string): Promise<boolean> {
  const [x] = await db.select({ id: invoiceItems.id }).from(invoiceItems).where(eq(invoiceItems.structureItemId, itemId)).limit(1);
  return !!x;
}

export async function addStructureItem(tx: Executor, actor: AuditActor, structureId: string, body: z.infer<typeof structureItemIn>): Promise<StructureOut> {
  await getStructure(tx, structureId);
  await assertCategories(tx, [body.categoryId]);
  const [row] = await tx.insert(feeStructureItems).values({ structureId, categoryId: body.categoryId, label: body.label, amountMinor: body.amountMinor, dueDate: body.dueDate, ordinal: body.ordinal ?? 0 }).returning({ id: feeStructureItems.id });
  await audit(tx, actor, { action: 'fees.structure_item_add', entity: 'fee_structure', entityId: structureId, after: { itemId: row!.id, ...body } });
  return getStructure(tx, structureId);
}

export async function updateStructureItem(tx: Executor, actor: AuditActor, structureId: string, itemId: string, body: Partial<z.infer<typeof structureItemIn>>): Promise<StructureOut> {
  const [cur] = await tx.select().from(feeStructureItems).where(and(eq(feeStructureItems.id, itemId), eq(feeStructureItems.structureId, structureId))).limit(1);
  if (!cur) throw notFound('Fee structure item');
  const money = body.amountMinor !== undefined || body.dueDate !== undefined || body.categoryId !== undefined;
  if (money && (await isBilled(tx, itemId))) throw conflict('Invoices were already generated from this item, so its amount, due date and category cannot change', 'ITEM_BILLED');
  if (body.categoryId) await assertCategories(tx, [body.categoryId]);
  await tx.update(feeStructureItems).set(body).where(eq(feeStructureItems.id, itemId));
  await audit(tx, actor, { action: 'fees.structure_item_update', entity: 'fee_structure', entityId: structureId, before: cur, after: body });
  return getStructure(tx, structureId);
}

export async function deleteStructureItem(tx: Executor, actor: AuditActor, structureId: string, itemId: string): Promise<StructureOut> {
  const [cur] = await tx.select().from(feeStructureItems).where(and(eq(feeStructureItems.id, itemId), eq(feeStructureItems.structureId, structureId))).limit(1);
  if (!cur) throw notFound('Fee structure item');
  if (await isBilled(tx, itemId)) throw conflict('Invoices were already generated from this item', 'ITEM_BILLED');
  const [left] = await tx.select({ n: sql<number>`count(*)::int` }).from(feeStructureItems).where(eq(feeStructureItems.structureId, structureId));
  if ((left?.n ?? 0) <= 1) throw conflict('A structure needs at least one item', 'LAST_ITEM');
  await tx.delete(feeStructureItems).where(eq(feeStructureItems.id, itemId));
  await audit(tx, actor, { action: 'fees.structure_item_delete', entity: 'fee_structure', entityId: structureId, before: cur });
  return getStructure(tx, structureId);
}

// ── plans ───────────────────────────────────────────────────────────────────────────────────

export async function listPlans(db: Executor, q: z.infer<typeof planListQuery>) {
  const where = and(
    q.studentId ? eq(studentFeePlans.studentId, q.studentId) : undefined,
    q.structureId ? eq(studentFeePlans.structureId, q.structureId) : undefined,
    q.sectionId ? eq(students.currentSectionId, q.sectionId) : undefined,
    q.q ? sql`(${ilikeAny(q.q, students.firstName, students.lastName, students.admissionNo)})` : undefined,
  );
  const [rows, [cnt]] = await Promise.all([
    db
      .select({
        plan: studentFeePlans,
        first: students.firstName,
        last: students.lastName,
        admissionNo: students.admissionNo,
        sectionName: sections.name,
        gradeName: grades.name,
        structureName: feeStructures.name,
        invoiceCount: sql<number>`(select count(*)::int from ${invoices} i where i.plan_id = ${studentFeePlans.id} and i.status <> 'void')`,
      })
      .from(studentFeePlans)
      .innerJoin(students, eq(students.id, studentFeePlans.studentId))
      .innerJoin(feeStructures, eq(feeStructures.id, studentFeePlans.structureId))
      .leftJoin(sections, eq(sections.id, students.currentSectionId))
      .leftJoin(grades, eq(grades.id, students.currentGradeId))
      .where(where)
      .orderBy(asc(grades.ordinal), asc(sections.name), asc(students.rollNo), asc(students.firstName))
      .limit(pageArgs(q).limit)
      .offset(pageArgs(q).offset),
    db.select({ n: sql<number>`count(*)::int` }).from(studentFeePlans).innerJoin(students, eq(students.id, studentFeePlans.studentId)).where(where),
  ]);
  const data: PlanOut[] = rows.map((r) => ({
    id: r.plan.id,
    studentId: r.plan.studentId,
    studentName: name(r.first, r.last),
    admissionNo: r.admissionNo,
    sectionName: r.sectionName,
    gradeName: r.gradeName,
    structureId: r.plan.structureId,
    structureName: r.structureName,
    academicYearId: r.plan.academicYearId,
    notes: r.plan.notes,
    invoiceCount: r.invoiceCount,
    createdAt: r.plan.createdAt.toISOString(),
  }));
  return pagedResult(data, cnt?.n ?? 0, q);
}

export async function createPlan(tx: Executor, actor: AuditActor, body: z.infer<typeof planCreateBody>): Promise<PlanOut> {
  const [structure] = await tx.select().from(feeStructures).where(eq(feeStructures.id, body.structureId)).limit(1);
  if (!structure) throw notFound('Fee structure');
  if (!structure.isActive) throw conflict('That fee structure is inactive', 'STRUCTURE_INACTIVE');
  const [stu] = await tx.select({ id: students.id, gradeId: students.currentGradeId }).from(students).where(and(eq(students.id, body.studentId), ...ACTIVE_STUDENT)).limit(1);
  if (!stu) throw notFound('Student');
  if (structure.gradeId && structure.gradeId !== stu.gradeId) throw unprocessable('This fee structure is for a different grade', 'GRADE_MISMATCH');
  const [dup] = await tx.select({ id: studentFeePlans.id }).from(studentFeePlans).where(and(eq(studentFeePlans.studentId, body.studentId), eq(studentFeePlans.academicYearId, structure.academicYearId))).limit(1);
  if (dup) throw conflict('This student already has a fee plan for that academic year', 'PLAN_EXISTS');
  const [plan] = await tx.insert(studentFeePlans).values({ studentId: body.studentId, structureId: structure.id, academicYearId: structure.academicYearId, notes: body.notes ?? null, createdBy: actor.userId ?? null }).returning({ id: studentFeePlans.id });
  await audit(tx, actor, { action: 'fees.plan_assign', entity: 'student_fee_plan', entityId: plan!.id, after: { studentId: body.studentId, structureId: structure.id } });
  const found = await listPlans(tx, { page: 1, pageSize: 1, studentId: body.studentId });
  return found.data[0]!;
}

export async function bulkAssignPlans(tx: Executor, actor: AuditActor, body: z.infer<typeof planBulkBody>) {
  const [structure] = await tx.select().from(feeStructures).where(eq(feeStructures.id, body.structureId)).limit(1);
  if (!structure) throw notFound('Fee structure');
  if (!structure.isActive) throw conflict('That fee structure is inactive', 'STRUCTURE_INACTIVE');
  const pool = await tx
    .select({ id: students.id, gradeId: students.currentGradeId })
    .from(students)
    .where(
      and(
        ...ACTIVE_STUDENT,
        body.gradeId ? eq(students.currentGradeId, body.gradeId) : undefined,
        body.sectionId ? eq(students.currentSectionId, body.sectionId) : undefined,
        body.studentIds ? inArray(students.id, body.studentIds) : undefined,
      ),
    );
  const eligible = pool.filter((s) => !structure.gradeId || s.gradeId === structure.gradeId);
  let assigned = 0;
  for (let i = 0; i < eligible.length; i += 500) {
    const rows = await tx
      .insert(studentFeePlans)
      .values(eligible.slice(i, i + 500).map((s) => ({ studentId: s.id, structureId: structure.id, academicYearId: structure.academicYearId, createdBy: actor.userId ?? null })))
      .onConflictDoNothing()
      .returning({ id: studentFeePlans.id });
    assigned += rows.length;
  }
  const out = { assigned, alreadyAssigned: eligible.length - assigned, notEligible: pool.length - eligible.length };
  await audit(tx, actor, { action: 'fees.plan_bulk_assign', entity: 'fee_structure', entityId: structure.id, summary: `${assigned} assigned`, after: out });
  return out;
}

export async function deletePlan(tx: Executor, actor: AuditActor, id: string): Promise<void> {
  const [plan] = await tx.select().from(studentFeePlans).where(eq(studentFeePlans.id, id)).limit(1);
  if (!plan) throw notFound('Fee plan');
  const [live] = await tx.select({ id: invoices.id }).from(invoices).where(and(eq(invoices.planId, id), sql`${invoices.status} <> 'void'`)).limit(1);
  if (live) throw conflict('Invoices exist for this plan; void them first', 'PLAN_HAS_INVOICES');
  // voided invoices keep their history: detach them from the plan before it goes
  await tx.update(invoices).set({ planId: null }).where(eq(invoices.planId, id));
  await tx.delete(studentFeePlans).where(eq(studentFeePlans.id, id));
  await audit(tx, actor, { action: 'fees.plan_remove', entity: 'student_fee_plan', entityId: id, before: plan });
}

// ── dues generation ─────────────────────────────────────────────────────────────────────────

interface ConcessionLite {
  id: string;
  type: 'percent' | 'fixed';
  value: number;
  categoryId: string | null;
  /** fixed concessions: what is still unspent for the year */
  remaining: number;
}
interface LineIn {
  categoryId: string;
  structureItemId: string;
  description: string;
  amountMinor: number;
}

/**
 * Apply approved concessions to the lines of ONE invoice.
 * Percent (basis points) first, per matching line; then fixed concessions, which draw down a yearly balance.
 * A line can never be discounted below zero. Mutates `remaining` of fixed concessions.
 */
export function applyConcessions(lines: LineIn[], cons: ConcessionLite[]): { discounts: number[]; applied: Map<string, number> } {
  const discounts = lines.map(() => 0);
  const applied = new Map<string, number>();
  const give = (c: ConcessionLite, idx: number, want: number) => {
    const d = Math.max(0, Math.min(want, lines[idx]!.amountMinor - discounts[idx]!, c.type === 'fixed' ? c.remaining : Number.MAX_SAFE_INTEGER));
    if (d <= 0) return;
    discounts[idx]! += d;
    if (c.type === 'fixed') c.remaining -= d;
    applied.set(c.id, (applied.get(c.id) ?? 0) + d);
  };
  for (const c of cons.filter((x) => x.type === 'percent')) lines.forEach((l, i) => (!c.categoryId || c.categoryId === l.categoryId) && give(c, i, Math.round((l.amountMinor * c.value) / 10_000)));
  for (const c of cons.filter((x) => x.type === 'fixed')) lines.forEach((l, i) => (!c.categoryId || c.categoryId === l.categoryId) && give(c, i, c.remaining));
  return { discounts, applied };
}

/**
 * One invoice per (plan, due date) from the plan's structure items. Idempotent: an instalment that already has a live
 * (non-void) invoice is skipped, so running this twice — or concurrently — never duplicates a bill. Only APPROVED
 * concessions are applied.
 */
export async function generateDues(tx: Executor, actor: AuditActor, body: z.infer<typeof generateDuesBody>) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('fees.generate_dues'))`);
  const feeCfg = await getSetting(tx, 'fees');
  const plans = await tx
    .select({ plan: studentFeePlans, structureName: feeStructures.name })
    .from(studentFeePlans)
    .innerJoin(feeStructures, and(eq(feeStructures.id, studentFeePlans.structureId), eq(feeStructures.isActive, true)))
    .innerJoin(students, eq(students.id, studentFeePlans.studentId))
    .where(
      and(
        ...ACTIVE_STUDENT,
        body.structureId ? eq(studentFeePlans.structureId, body.structureId) : undefined,
        body.studentId ? eq(studentFeePlans.studentId, body.studentId) : undefined,
        body.gradeId ? eq(students.currentGradeId, body.gradeId) : undefined,
        body.sectionId ? eq(students.currentSectionId, body.sectionId) : undefined,
      ),
    );
  const totals = { plans: plans.length, invoicesCreated: 0, invoicesExisting: 0, totalMinor: 0, discountMinor: 0 };
  if (!plans.length) return totals;

  const items = await tx
    .select()
    .from(feeStructureItems)
    .where(and(inArray(feeStructureItems.structureId, [...new Set(plans.map((p) => p.plan.structureId))]), body.dueOnOrBefore ? sql`${feeStructureItems.dueDate} <= ${body.dueOnOrBefore}` : undefined))
    .orderBy(asc(feeStructureItems.dueDate), asc(feeStructureItems.ordinal));
  const itemsByStructure = Map.groupBy(items, (i) => i.structureId);
  const yearTokens = new Map<string, string>();

  for (let i = 0; i < plans.length; i += 400) {
    const chunk = plans.slice(i, i + 400);
    const planIds = chunk.map((p) => p.plan.id);
    const [existing, cons] = await Promise.all([
      tx.select({ planId: invoices.planId, dueDate: invoices.dueDate }).from(invoices).where(and(inArray(invoices.planId, planIds), sql`${invoices.status} <> 'void'`)),
      tx
        .select()
        .from(concessions)
        .where(and(inArray(concessions.studentId, chunk.map((p) => p.plan.studentId)), eq(concessions.status, 'approved')))
        .orderBy(asc(concessions.createdAt)),
    ]);
    const have = new Set(existing.map((e) => `${e.planId}:${e.dueDate}`));
    const used = cons.length
      ? await tx
          .select({ concessionId: concessionApplications.concessionId, total: sql<number>`coalesce(sum(${concessionApplications.amountMinor}), 0)::float8` })
          .from(concessionApplications)
          .innerJoin(invoices, eq(invoices.id, concessionApplications.invoiceId))
          .where(and(inArray(concessionApplications.concessionId, cons.map((c) => c.id)), sql`${invoices.status} <> 'void'`))
          .groupBy(concessionApplications.concessionId)
      : [];
    const usedBy = new Map(used.map((u) => [u.concessionId, u.total]));
    const consByStudent = Map.groupBy(cons, (c) => c.studentId);

    interface Spec {
      row: typeof invoices.$inferInsert;
      lines: (LineIn & { discount: number })[];
      apps: { concessionId: string; amountMinor: number }[];
    }
    const specs: Spec[] = [];
    for (const { plan, structureName } of chunk) {
      const planCons: ConcessionLite[] = (consByStudent.get(plan.studentId) ?? [])
        .filter((c) => c.academicYearId === plan.academicYearId)
        .map((c) => ({ id: c.id, type: c.type, value: c.value, categoryId: c.categoryId, remaining: c.type === 'fixed' ? Math.max(0, c.value - (usedBy.get(c.id) ?? 0)) : 0 }));
      const byDue = Map.groupBy(itemsByStructure.get(plan.structureId) ?? [], (it) => it.dueDate);
      for (const [dueDate, group] of [...byDue.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
        if (have.has(`${plan.id}:${dueDate}`)) {
          totals.invoicesExisting++;
          continue;
        }
        const lines: LineIn[] = group.map((g) => ({ categoryId: g.categoryId, structureItemId: g.id, description: g.label, amountMinor: g.amountMinor }));
        const { discounts, applied } = applyConcessions(lines, planCons);
        const total = lines.reduce((t, l) => t + l.amountMinor, 0);
        const discount = discounts.reduce((t, d) => t + d, 0);
        specs.push({
          row: { invoiceNo: '', studentId: plan.studentId, academicYearId: plan.academicYearId, planId: plan.id, title: group.length === 1 ? group[0]!.label : `${structureName} - due ${dueDate}`, dueDate, totalMinor: total, discountMinor: discount, status: total - discount <= 0 ? 'paid' : 'unpaid', createdBy: actor.userId ?? null },
          lines: lines.map((l, idx) => ({ ...l, discount: discounts[idx]! })),
          apps: [...applied.entries()].map(([concessionId, amountMinor]) => ({ concessionId, amountMinor })),
        });
      }
    }
    if (!specs.length) continue;

    const first = await reserveNumbers(tx, 'invoice', specs.length);
    for (const [idx, s] of specs.entries()) {
      let tok = yearTokens.get(s.row.academicYearId!);
      if (!tok) {
        tok = await yearToken(tx, s.row.academicYearId!);
        yearTokens.set(s.row.academicYearId!, tok);
      }
      s.row.invoiceNo = formatNumber(feeCfg.invoicePrefix, tok, first + idx);
    }
    const inserted = await tx.insert(invoices).values(specs.map((s) => s.row)).onConflictDoNothing().returning({ id: invoices.id, planId: invoices.planId, dueDate: invoices.dueDate });
    const specBy = new Map(specs.map((s) => [`${s.row.planId}:${s.row.dueDate}`, s]));
    const itemRows: (typeof invoiceItems.$inferInsert)[] = [];
    const appRows: (typeof concessionApplications.$inferInsert)[] = [];
    for (const ins of inserted) {
      const s = specBy.get(`${ins.planId}:${ins.dueDate}`)!;
      totals.invoicesCreated++;
      totals.totalMinor += s.row.totalMinor;
      totals.discountMinor += s.row.discountMinor ?? 0;
      for (const l of s.lines) itemRows.push({ invoiceId: ins.id, categoryId: l.categoryId, structureItemId: l.structureItemId, description: l.description, amountMinor: l.amountMinor, discountMinor: l.discount });
      for (const a of s.apps) appRows.push({ invoiceId: ins.id, concessionId: a.concessionId, amountMinor: a.amountMinor });
    }
    totals.invoicesExisting += specs.length - inserted.length;
    for (let j = 0; j < itemRows.length; j += 500) await tx.insert(invoiceItems).values(itemRows.slice(j, j + 500));
    for (let j = 0; j < appRows.length; j += 500) await tx.insert(concessionApplications).values(appRows.slice(j, j + 500));
  }
  await audit(tx, actor, { action: 'fees.generate_dues', entity: 'fee_structure', entityId: body.structureId ?? null, summary: `${totals.invoicesCreated} invoices created, ${totals.invoicesExisting} already existed`, after: { ...totals, filter: body } });
  return totals;
}

// ── concessions ─────────────────────────────────────────────────────────────────────────────

const concessionSelect = (db: Executor) =>
  db
    .select({
      c: concessions,
      first: students.firstName,
      last: students.lastName,
      admissionNo: students.admissionNo,
      categoryName: feeCategories.name,
      applied: sql<number>`coalesce((select sum(ca.amount_minor) from ${concessionApplications} ca join ${invoices} i on i.id = ca.invoice_id where ca.concession_id = ${concessions.id} and i.status <> 'void'), 0)::float8`,
    })
    .from(concessions)
    .innerJoin(students, eq(students.id, concessions.studentId))
    .leftJoin(feeCategories, eq(feeCategories.id, concessions.categoryId));

const toConcessionOut = (r: Awaited<ReturnType<typeof concessionSelect>>[number]): ConcessionOut => ({
  id: r.c.id,
  studentId: r.c.studentId,
  studentName: name(r.first, r.last),
  admissionNo: r.admissionNo,
  academicYearId: r.c.academicYearId,
  name: r.c.name,
  type: r.c.type,
  value: r.c.value,
  categoryId: r.c.categoryId,
  categoryName: r.categoryName,
  reason: r.c.reason,
  status: r.c.status,
  appliedMinor: r.applied,
  decidedAt: r.c.decidedAt?.toISOString() ?? null,
  createdAt: r.c.createdAt.toISOString(),
});

export async function listConcessions(db: Executor, p: Principal, q: z.infer<typeof concessionListQuery>) {
  const where = and(
    studentIdScope(p, 'fees:view', concessions.studentId),
    q.studentId ? eq(concessions.studentId, q.studentId) : undefined,
    q.status ? eq(concessions.status, q.status) : undefined,
    q.academicYearId ? eq(concessions.academicYearId, q.academicYearId) : undefined,
  );
  const [rows, [cnt]] = await Promise.all([
    concessionSelect(db).where(where).orderBy(desc(concessions.createdAt)).limit(pageArgs(q).limit).offset(pageArgs(q).offset),
    db.select({ n: sql<number>`count(*)::int` }).from(concessions).where(where),
  ]);
  return pagedResult(rows.map(toConcessionOut), cnt?.n ?? 0, q);
}

async function concessionById(db: Executor, id: string): Promise<ConcessionOut> {
  const [r] = await concessionSelect(db).where(eq(concessions.id, id)).limit(1);
  if (!r) throw notFound('Concession');
  return toConcessionOut(r);
}

export async function requestConcession(tx: Executor, actor: AuditActor, body: z.infer<typeof concessionCreateBody>): Promise<ConcessionOut> {
  const [stu] = await tx.select({ id: students.id }).from(students).where(eq(students.id, body.studentId)).limit(1);
  if (!stu) throw notFound('Student');
  if (body.categoryId) await assertCategories(tx, [body.categoryId]);
  const yearId = body.academicYearId ?? (await currentYearId(tx));
  const [c] = await tx
    .insert(concessions)
    .values({ studentId: body.studentId, academicYearId: yearId, name: body.name, type: body.type, value: body.value, categoryId: body.categoryId ?? null, reason: body.reason ?? null, requestedBy: actor.userId ?? null })
    .returning({ id: concessions.id });
  const out = await concessionById(tx, c!.id);
  await audit(tx, actor, { action: 'fees.concession_request', entity: 'concession', entityId: c!.id, after: out });
  return out;
}

export async function decideConcession(tx: Executor, actor: AuditActor, id: string, decision: 'approved' | 'rejected', note?: string | null): Promise<ConcessionOut> {
  const [cur] = await tx.select().from(concessions).where(eq(concessions.id, id)).for('update').limit(1);
  if (!cur) throw notFound('Concession');
  if (cur.status !== 'pending') throw conflict(`This concession is already ${cur.status}`, 'ALREADY_DECIDED');
  await tx.update(concessions).set({ status: decision, decidedBy: actor.userId ?? null, decidedAt: new Date(), decisionNote: note ?? null }).where(eq(concessions.id, id));
  await audit(tx, actor, { action: decision === 'approved' ? 'fees.concession_approve' : 'fees.concession_reject', entity: 'concession', entityId: id, before: { status: 'pending' }, after: { status: decision, note: note ?? null, name: cur.name, type: cur.type, value: cur.value, studentId: cur.studentId } });
  return concessionById(tx, id);
}

// ── invoices ────────────────────────────────────────────────────────────────────────────────

export async function listInvoices(db: Executor, p: Principal, tenant: TenantInfo, q: z.infer<typeof invoiceListQuery>) {
  const today = todayIn(tenant.timezone);
  const cfg = await getSetting(db, 'fees');
  const where = and(
    studentIdScope(p, 'fees:view', invoices.studentId),
    q.studentId ? eq(invoices.studentId, q.studentId) : undefined,
    q.sectionId ? eq(students.currentSectionId, q.sectionId) : undefined,
    q.gradeId ? eq(students.currentGradeId, q.gradeId) : undefined,
    q.status ? eq(invoices.status, q.status) : undefined,
    // families do not need to see bills the school voided (staff can still ask for status=void)
    !q.status && (p.scope('fees:view') === 'own' || p.scope('fees:view') === 'linked') ? sql`${invoices.status} <> 'void'` : undefined,
    q.overdue === true ? sql`${invoices.status} in ('unpaid','partial') and ${invoices.dueDate} < ${today}` : undefined,
    q.overdue === false ? sql`not (${invoices.status} in ('unpaid','partial') and ${invoices.dueDate} < ${today})` : undefined,
    q.from ? sql`${invoices.dueDate} >= ${q.from}` : undefined,
    q.to ? sql`${invoices.dueDate} <= ${q.to}` : undefined,
    q.q ? sql`(${ilikeAny(q.q, invoices.invoiceNo, students.admissionNo, students.firstName, students.lastName)})` : undefined,
  );
  const [rows, [cnt]] = await Promise.all([
    invoiceBase(db).where(where).orderBy(desc(invoices.dueDate), desc(invoices.invoiceNo)).limit(pageArgs(q).limit).offset(pageArgs(q).offset),
    db.select({ n: sql<number>`count(*)::int` }).from(invoices).innerJoin(students, eq(students.id, invoices.studentId)).where(where),
  ]);
  return pagedResult(rows.map((r) => toInvoiceOut(r, today, cfg.lateFeePerDayMinor)), cnt?.n ?? 0, q);
}

/** One invoice the caller may see (404 otherwise), with its items, payments and refunds. */
export async function getInvoiceDetail(db: Executor, p: Principal, tenant: TenantInfo, id: string): Promise<InvoiceDetailOut> {
  const today = todayIn(tenant.timezone);
  const cfg = await getSetting(db, 'fees');
  const [r] = await invoiceBase(db).where(and(eq(invoices.id, id), studentIdScope(p, 'fees:view', invoices.studentId))).limit(1);
  if (!r) throw notFound('Invoice');
  const [items, pays, refs] = await Promise.all([
    db
      .select({ i: invoiceItems, categoryName: feeCategories.name })
      .from(invoiceItems)
      .leftJoin(feeCategories, eq(feeCategories.id, invoiceItems.categoryId))
      .where(eq(invoiceItems.invoiceId, id))
      .orderBy(asc(invoiceItems.id)),
    paymentBase(db).where(eq(payments.invoiceId, id)).orderBy(desc(payments.createdAt)),
    refundBase(db).where(eq(payments.invoiceId, id)).orderBy(desc(refunds.createdAt)),
  ]);
  return {
    ...toInvoiceOut(r, today, cfg.lateFeePerDayMinor),
    items: items.map((x) => ({ id: x.i.id, categoryId: x.i.categoryId, categoryName: x.categoryName ?? null, description: x.i.description, amountMinor: x.i.amountMinor, discountMinor: x.i.discountMinor })),
    payments: pays.map(toPaymentOut),
    refunds: refs.map(toRefundOut),
    voidReason: r.inv.voidReason,
  };
}

export async function createInvoice(tx: Executor, tenant: TenantInfo, p: Principal, actor: AuditActor, body: z.infer<typeof invoiceCreateBody>): Promise<InvoiceDetailOut> {
  const [stu] = await tx.select({ id: students.id }).from(students).where(eq(students.id, body.studentId)).limit(1);
  if (!stu) throw notFound('Student');
  const catIds = body.items.map((i) => i.categoryId).filter((x): x is string => !!x);
  if (catIds.length) await assertCategories(tx, catIds);
  const yearId = await currentYearId(tx);
  const cfg = await getSetting(tx, 'fees');
  const seq = await reserveNumbers(tx, 'invoice', 1);
  const total = body.items.reduce((t, i) => t + i.amountMinor, 0);
  const [inv] = await tx
    .insert(invoices)
    .values({ invoiceNo: formatNumber(cfg.invoicePrefix, await yearToken(tx, yearId), seq), studentId: body.studentId, academicYearId: yearId, title: body.title, dueDate: body.dueDate, totalMinor: total, notes: body.notes ?? null, createdBy: actor.userId ?? null })
    .returning({ id: invoices.id });
  await tx.insert(invoiceItems).values(body.items.map((i) => ({ invoiceId: inv!.id, categoryId: i.categoryId ?? null, description: i.description, amountMinor: i.amountMinor })));
  await audit(tx, actor, { action: 'fees.invoice_create', entity: 'invoice', entityId: inv!.id, after: { studentId: body.studentId, title: body.title, totalMinor: total, dueDate: body.dueDate } });
  return getInvoiceDetail(tx, p, tenant, inv!.id);
}

export async function voidInvoice(tx: Executor, tenant: TenantInfo, p: Principal, actor: AuditActor, id: string, reason: string): Promise<InvoiceDetailOut> {
  const [inv] = await tx.select().from(invoices).where(eq(invoices.id, id)).for('update').limit(1);
  if (!inv) throw notFound('Invoice');
  if (inv.status === 'void') throw conflict('This invoice is already void', 'ALREADY_VOID');
  if (inv.paidMinor > 0) throw conflict('Payments were received against this invoice; refund them before voiding', 'HAS_PAYMENTS');
  // online attempts still in flight can no longer be settled against this invoice
  await tx.update(payments).set({ status: 'failed', notes: 'Invoice voided' }).where(and(eq(payments.invoiceId, id), eq(payments.status, 'pending')));
  await tx.update(invoices).set({ status: 'void', voidedAt: new Date(), voidedBy: actor.userId ?? null, voidReason: reason }).where(eq(invoices.id, id));
  await audit(tx, actor, { action: 'fees.invoice_void', entity: 'invoice', entityId: id, summary: inv.invoiceNo, before: { status: inv.status, totalMinor: inv.totalMinor, discountMinor: inv.discountMinor }, after: { status: 'void', reason } });
  return getInvoiceDetail(tx, p, tenant, id);
}

