import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { PromotionApplyOut, PromotionBody, PromotionPreviewOut } from '@school-sync/shared';
import { audit, type AuditActor } from '../../core/audit';
import { assertSeatAvailable } from '../../core/billing/license';
import { AppError, notFound, unprocessable } from '../../core/errors';
import { todayIn } from '../../core/http';
import type { Executor } from '../../core/tenancy/pools';
import type { TenantInfo } from '../../core/tenancy/registry';
import { academicYears, devices, enrollments, grades, sections, sessions, students, users } from '../../db/tenant/schema';

/**
 * Year-end promotion.
 *
 *   preview(from, to, mapping, decisions) → who goes where, how many new seats, problems to fix first
 *   apply(...)                            → one transaction: new-year enrollments, old ones closed (promoted / retained / left),
 *                                           students' current section/grade moved, last-grade students become alumni.
 *
 * History is never rewritten: the old enrollment rows stay (with their final status), the new ones are added.
 * Applying twice is harmless — a student whose old enrollment is no longer `enrolled` is simply not eligible any more.
 */

type Outcome = 'promote' | 'retain' | 'leave' | 'graduate';

interface Move {
  enrollmentId: string;
  studentId: string;
  userId: string | null;
  firstName: string;
  lastName: string | null;
  fromGradeId: string;
  fromSectionId: string;
  outcome: Outcome;
  toGradeId: string | null;
  toSectionId: string | null;
  rollNo?: number;
}

interface Plan {
  fromYear: typeof academicYears.$inferSelect;
  toYear: typeof academicYears.$inferSelect;
  moves: Move[];
  totals: PromotionPreviewOut['totals'];
  byGrade: PromotionPreviewOut['byGrade'];
  bySection: PromotionPreviewOut['bySection'];
  problems: PromotionPreviewOut['problems'];
  warnings: PromotionPreviewOut['warnings'];
  existingMaxRoll: Map<string, number>;
}

const byName = (a: { firstName: string; lastName: string | null; studentId: string }, b: { firstName: string; lastName: string | null; studentId: string }) =>
  a.firstName.localeCompare(b.firstName) || (a.lastName ?? '').localeCompare(b.lastName ?? '') || a.studentId.localeCompare(b.studentId);

async function buildPlan(db: Executor, input: PromotionBody): Promise<Plan> {
  const [[fromYear], [toYear]] = await Promise.all([db.select().from(academicYears).where(eq(academicYears.id, input.fromYearId)).limit(1), db.select().from(academicYears).where(eq(academicYears.id, input.toYearId)).limit(1)]);
  if (!fromYear || !toYear) throw notFound('Academic year');
  if (fromYear.id === toYear.id) throw unprocessable('Pick two different academic years', 'SAME_YEAR');
  if (toYear.startDate <= fromYear.startDate) throw unprocessable('The year you promote into must come after the year you promote from', 'INVALID_YEAR_ORDER');

  const problems: Plan['problems'] = [];
  const warnings: Plan['warnings'] = [];

  // ── grade ladder: default = next higher ordinal, the highest grade graduates ──
  const gradeRows = await db.select().from(grades).orderBy(asc(grades.ordinal), asc(grades.name));
  const gradeById = new Map(gradeRows.map((g) => [g.id, g]));
  const active = gradeRows.filter((g) => g.isActive);
  const mapping = new Map<string, string | null>(gradeRows.map((g) => [g.id, active.find((x) => x.ordinal > g.ordinal)?.id ?? null]));
  for (const m of input.gradeMapping ?? []) {
    if (!gradeById.has(m.fromGradeId) || (m.toGradeId && !gradeById.has(m.toGradeId))) problems.push({ code: 'GRADE_NOT_FOUND', message: 'The grade mapping refers to a grade that does not exist' });
    else mapping.set(m.fromGradeId, m.toGradeId);
  }

  // ── who is eligible ──
  const eligible = await db
    .select({ enrollmentId: enrollments.id, studentId: students.id, userId: students.userId, firstName: students.firstName, lastName: students.lastName, gradeId: enrollments.gradeId, sectionId: enrollments.sectionId })
    .from(enrollments)
    .innerJoin(students, eq(students.id, enrollments.studentId))
    .where(and(eq(enrollments.academicYearId, fromYear.id), eq(enrollments.status, 'enrolled'), inArray(students.status, ['active', 'suspended']), isNull(students.archivedAt)));
  const inNewYear = new Set((await db.select({ id: enrollments.studentId }).from(enrollments).where(eq(enrollments.academicYearId, toYear.id))).map((r) => r.id));
  const todo = eligible.filter((e) => !inNewYear.has(e.studentId));
  const alreadyEnrolled = eligible.length - todo.length;

  const secRows = await db.select({ id: sections.id, gradeId: sections.gradeId, name: sections.name, capacity: sections.capacity, yearId: sections.academicYearId }).from(sections).where(inArray(sections.academicYearId, [fromYear.id, toYear.id]));
  const secById = new Map(secRows.map((s) => [s.id, s]));
  const targetSections = secRows.filter((s) => s.yearId === toYear.id);
  const targetByGrade = Map.groupBy(targetSections, (s) => s.gradeId);

  const existingRows = await db
    .select({ sectionId: enrollments.sectionId, n: sql<number>`count(*)::int`, maxRoll: sql<number>`coalesce(max(${enrollments.rollNo}), 0)::int` })
    .from(enrollments)
    .where(eq(enrollments.academicYearId, toYear.id))
    .groupBy(enrollments.sectionId);
  const load = new Map(existingRows.map((r) => [r.sectionId, r.n]));
  const existingMaxRoll = new Map(existingRows.map((r) => [r.sectionId, r.maxRoll]));
  const existing = new Map(load);

  const decisions = new Map((input.decisions ?? []).map((d) => [d.studentId, d]));
  const todoIds = new Set(todo.map((t) => t.studentId));
  for (const d of input.decisions ?? []) if (!todoIds.has(d.studentId)) warnings.push({ code: 'DECISION_IGNORED', message: 'A decision was given for a student who is not eligible for promotion (already moved, left, or not enrolled in the source year)', studentId: d.studentId });
  const sectionMap = new Map((input.sectionMapping ?? []).map((m) => [m.fromSectionId, m.toSectionId]));

  const ordered = [...todo].sort((a, b) => (secById.get(a.sectionId)?.name ?? '').localeCompare(secById.get(b.sectionId)?.name ?? '') || byName(a, b));
  const moves: Move[] = [];
  const missingSection = new Map<string, number>();

  for (const t of ordered) {
    const d = decisions.get(t.studentId);
    const decision = d?.decision ?? 'promote';
    const base = { enrollmentId: t.enrollmentId, studentId: t.studentId, userId: t.userId, firstName: t.firstName, lastName: t.lastName, fromGradeId: t.gradeId, fromSectionId: t.sectionId };
    if (decision === 'leave') {
      moves.push({ ...base, outcome: 'leave', toGradeId: null, toSectionId: null });
      continue;
    }
    const targetGradeId = decision === 'retain' ? t.gradeId : (mapping.get(t.gradeId) ?? null);
    if (decision === 'promote' && targetGradeId === null) {
      moves.push({ ...base, outcome: 'graduate', toGradeId: null, toSectionId: null });
      continue;
    }
    const outcome: Outcome = decision;
    let toSectionId: string | null = null;
    const explicit = d?.toSectionId ?? (decision === 'promote' ? sectionMap.get(t.sectionId) : undefined);
    if (explicit) {
      const s = secById.get(explicit);
      if (!s || s.yearId !== toYear.id) problems.push({ code: 'TARGET_SECTION_INVALID', message: `A chosen section does not belong to ${toYear.name}`, studentId: t.studentId });
      else {
        toSectionId = s.id;
        if (targetGradeId && s.gradeId !== targetGradeId) warnings.push({ code: 'SECTION_GRADE_MISMATCH', message: 'The chosen section is in a different grade than the promotion ladder implies', studentId: t.studentId });
      }
    } else {
      const candidates = targetByGrade.get(targetGradeId!) ?? [];
      if (!candidates.length) missingSection.set(targetGradeId!, (missingSection.get(targetGradeId!) ?? 0) + 1);
      else {
        const sameName = candidates.find((c) => c.name.toLowerCase() === (secById.get(t.sectionId)?.name ?? '').toLowerCase());
        toSectionId = (sameName ?? [...candidates].sort((a, b) => (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0) || a.name.localeCompare(b.name))[0]!).id;
      }
    }
    if (toSectionId) load.set(toSectionId, (load.get(toSectionId) ?? 0) + 1);
    moves.push({ ...base, outcome, toGradeId: toSectionId ? secById.get(toSectionId)!.gradeId : targetGradeId, toSectionId });
  }
  for (const [gid, n] of missingSection) problems.push({ code: 'NO_TARGET_SECTION', message: `${gradeById.get(gid)?.name ?? 'The next grade'} has no sections in ${toYear.name} (${n} student${n === 1 ? '' : 's'} cannot be placed). Create them first, e.g. by copying the sections of ${fromYear.name}.` });

  // ── summaries ──
  const count = (o: Outcome) => moves.filter((m) => m.outcome === o).length;
  const totals = { eligible: moves.length, promote: count('promote'), retain: count('retain'), leave: count('leave'), graduate: count('graduate'), newSeats: count('promote') + count('retain'), alreadyEnrolled };

  const byGrade: Plan['byGrade'] = [];
  for (const [gid, group] of Map.groupBy(moves, (m) => m.fromGradeId)) {
    const g = gradeById.get(gid)!;
    const toId = mapping.get(gid) ?? null;
    byGrade.push({
      fromGradeId: gid,
      fromGradeName: g.name,
      toGradeId: toId,
      toGradeName: toId ? (gradeById.get(toId)?.name ?? null) : null,
      students: group.length,
      promote: group.filter((m) => m.outcome === 'promote').length,
      retain: group.filter((m) => m.outcome === 'retain').length,
      leave: group.filter((m) => m.outcome === 'leave').length,
      graduate: group.filter((m) => m.outcome === 'graduate').length,
    });
  }
  byGrade.sort((a, b) => (gradeById.get(a.fromGradeId)?.ordinal ?? 0) - (gradeById.get(b.fromGradeId)?.ordinal ?? 0));

  const bySection: Plan['bySection'] = [];
  for (const [sid, group] of Map.groupBy(
    moves.filter((m) => m.toSectionId),
    (m) => m.toSectionId!,
  )) {
    const s = secById.get(sid)!;
    const over = s.capacity != null && (existing.get(sid) ?? 0) + group.length > s.capacity;
    bySection.push({ sectionId: sid, gradeId: s.gradeId, gradeName: gradeById.get(s.gradeId)?.name ?? '', name: s.name, incoming: group.length, existing: existing.get(sid) ?? 0, capacity: s.capacity, overCapacity: over });
    if (over) warnings.push({ code: 'SECTION_OVER_CAPACITY', message: `${gradeById.get(s.gradeId)?.name ?? ''} ${s.name} would hold ${(existing.get(sid) ?? 0) + group.length} students but its capacity is ${s.capacity}` });
  }
  bySection.sort((a, b) => a.gradeName.localeCompare(b.gradeName, undefined, { numeric: true }) || a.name.localeCompare(b.name));

  return { fromYear, toYear, moves, totals, byGrade, bySection, problems, warnings, existingMaxRoll };
}

async function seatCheck(tenant: Pick<TenantInfo, 'id'>, db: Executor, adding: number, academicYear: string): Promise<PromotionPreviewOut['seat']> {
  try {
    await assertSeatAvailable(tenant, db, adding, { academicYear });
    return { ok: true };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, code: e.code, message: e.message };
    throw e;
  }
}

export async function previewPromotion(db: Executor, tenant: Pick<TenantInfo, 'id'>, input: PromotionBody): Promise<PromotionPreviewOut> {
  const plan = await buildPlan(db, input);
  const seat = await seatCheck(tenant, db, plan.totals.newSeats, plan.toYear.name);
  const nothing = plan.moves.length === 0;
  return {
    fromYear: { id: plan.fromYear.id, name: plan.fromYear.name },
    toYear: { id: plan.toYear.id, name: plan.toYear.name },
    totals: plan.totals,
    byGrade: plan.byGrade,
    bySection: plan.bySection,
    problems: plan.problems,
    warnings: plan.warnings,
    seat,
    canApply: !nothing && plan.problems.length === 0 && seat.ok,
  };
}

const chunks = <T>(rows: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
};

/** Run inside a transaction. The caller invalidates all cached principals after the commit. */
export async function applyPromotion(tx: Executor, tenant: TenantInfo, actor: AuditActor, input: PromotionBody): Promise<PromotionApplyOut> {
  // two admins pressing "apply" at once: the second waits, then finds nothing left to do
  await tx.execute(sql`select pg_advisory_xact_lock(727020)`);
  const plan = await buildPlan(tx, input);
  if (plan.problems.length) throw new AppError(422, 'PROMOTION_HAS_PROBLEMS', 'Fix the problems found in the preview before applying the promotion', { problems: plan.problems });
  if (!plan.moves.length) throw new AppError(409, 'NOTHING_TO_PROMOTE', 'There are no students left to move from the source year (they may already have been promoted)');
  await assertSeatAvailable(tenant, tx, plan.totals.newSeats, { academicYear: plan.toYear.name });

  const today = todayIn(tenant.timezone);
  const placed = plan.moves.filter((m) => m.toSectionId);
  // roll numbers continue after whatever is already in the section, alphabetical for the newcomers
  for (const group of Map.groupBy(placed, (m) => m.toSectionId!).values()) {
    group.sort(byName);
    let roll = plan.existingMaxRoll.get(group[0]!.toSectionId!) ?? 0;
    for (const m of group) m.rollNo = ++roll;
  }

  // 1. new-year enrollments
  for (const c of chunks(placed, 500)) {
    await tx.insert(enrollments).values(c.map((m) => ({ studentId: m.studentId, academicYearId: plan.toYear.id, gradeId: m.toGradeId!, sectionId: m.toSectionId!, rollNo: m.rollNo!, status: 'enrolled' as const, startedAt: plan.toYear.startDate })));
  }

  // 2. close the old enrollments (history stays)
  const closing: [Outcome[], 'promoted' | 'retained' | 'left'][] = [
    [['promote', 'graduate'], 'promoted'],
    [['retain'], 'retained'],
    [['leave'], 'left'],
  ];
  for (const [outcomes, status] of closing) {
    const ids = plan.moves.filter((m) => outcomes.includes(m.outcome)).map((m) => m.enrollmentId);
    for (const c of chunks(ids, 1000)) await tx.update(enrollments).set({ status, endedAt: today }).where(inArray(enrollments.id, c));
  }

  // 3. students: denormalised current section/grade (promote, retain)
  for (const c of chunks(placed, 500)) {
    const rows = sql.join(
      c.map((m) => sql`(${m.studentId}::uuid, ${m.toSectionId}::uuid, ${m.toGradeId}::uuid, ${m.rollNo}::int)`),
      sql`, `,
    );
    await tx.execute(sql`update ${students} set current_section_id = v.section_id, current_grade_id = v.grade_id, roll_no = v.roll_no, updated_at = now() from (values ${rows}) as v(id, section_id, grade_id, roll_no) where ${students.id} = v.id`);
  }
  // …graduates become alumni, leavers are withdrawn: archived, no longer in any section, login switched off
  const graduates = plan.moves.filter((m) => m.outcome === 'graduate');
  const leavers = plan.moves.filter((m) => m.outcome === 'leave');
  const now = new Date();
  for (const [group, status] of [[graduates, 'alumni'], [leavers, 'withdrawn']] as const) {
    for (const c of chunks(group, 1000)) await tx.update(students).set({ status, archivedAt: now, currentSectionId: null }).where(inArray(students.id, c.map((m) => m.studentId)));
  }
  const accountIds = [...graduates, ...leavers].map((m) => m.userId).filter((x): x is string => !!x);
  for (const c of chunks(accountIds, 1000)) {
    await tx.update(users).set({ status: 'deactivated', authVersion: sql`${users.authVersion} + 1` }).where(inArray(users.id, c));
    await tx.update(sessions).set({ revokedAt: now, revokedReason: 'student_left' }).where(and(inArray(sessions.userId, c), isNull(sessions.revokedAt)));
    await tx.update(devices).set({ enabled: false }).where(inArray(devices.userId, c));
  }

  const result: PromotionApplyOut = {
    fromYear: { id: plan.fromYear.id, name: plan.fromYear.name },
    toYear: { id: plan.toYear.id, name: plan.toYear.name },
    totals: plan.totals,
    enrolled: placed.length,
    alumni: graduates.length,
    withdrawn: leavers.length,
    appliedAt: now.toISOString(),
  };
  await audit(tx, actor, {
    action: 'promotion.apply',
    entity: 'academic_year',
    entityId: plan.toYear.id,
    summary: `Promoted ${plan.fromYear.name} → ${plan.toYear.name}: ${plan.totals.promote} promoted, ${plan.totals.retain} retained, ${plan.totals.graduate} graduated, ${plan.totals.leave} left`,
    after: { fromYear: plan.fromYear.name, toYear: plan.toYear.name, totals: plan.totals, byGrade: plan.byGrade },
  });
  return result;
}
