import { and, asc, eq, gte, inArray, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type {
  TimetableDayResponse,
  TimetableEntry,
  TimetableGridResponse,
  TimetableReplaceBody,
  TimetablePeriod,
  TimetableSetSlotBody,
  TimetableSlotItem,
  TimetableSubstitutionCreateBody,
  TimetableSubstitutionItem,
} from '@school-sync/shared';
import { audit, type AuditActor } from '../../core/audit';
import { AppError, conflict, forbidden, notFound, unprocessable } from '../../core/errors';
import { addDaysIso, isoWeekday, todayIn } from '../../core/http';
import { assertSectionAccess, sectionScope } from '../../core/rbac/scope';
import type { Principal } from '../../core/rbac/principal';
import type { TenantDb } from '../../core/tenancy/pools';
import type { TenantInfo } from '../../core/tenancy/registry';
import { gradeSubjects, grades, periods, sections, staff, subjects, teachingAssignments, timetableSlots, timetableSubstitutions } from '../../db/tenant/schema';
import { fullName, hhmm, iso, localTime, resolveStudent, workingDays } from './common';
import { notifyRows } from './notify';


export async function loadPeriods(db: TenantDb): Promise<TimetablePeriod[]> {
  const rows = await db.select().from(periods).orderBy(asc(periods.ordinal));
  return rows.map((r) => ({ id: r.id, name: r.name, ordinal: r.ordinal, startTime: hhmm(r.startTime), endTime: hhmm(r.endTime), isBreak: r.isBreak }));
}

const slotCols = {
  id: timetableSlots.id,
  sectionId: timetableSlots.sectionId,
  dayOfWeek: timetableSlots.dayOfWeek,
  periodId: timetableSlots.periodId,
  subjectId: timetableSlots.subjectId,
  subjectName: subjects.name,
  subjectCode: subjects.code,
  staffId: timetableSlots.staffId,
  firstName: staff.firstName,
  lastName: staff.lastName,
  room: timetableSlots.room,
};

function slotItem(r: { id: string; sectionId: string; dayOfWeek: number; periodId: string; subjectId: string | null; subjectName: string | null; subjectCode: string | null; staffId: string | null; firstName: string | null; lastName: string | null; room: string | null }, warnings?: string[]): TimetableSlotItem {
  return { id: r.id, sectionId: r.sectionId, dayOfWeek: r.dayOfWeek, periodId: r.periodId, subjectId: r.subjectId, subjectName: r.subjectName, subjectCode: r.subjectCode, staffId: r.staffId, teacherName: fullName(r.firstName, r.lastName), room: r.room, ...(warnings?.length ? { warnings } : {}) };
}

async function sectionSlots(db: TenantDb, sectionId: string): Promise<TimetableSlotItem[]> {
  const rows = await db
    .select(slotCols)
    .from(timetableSlots)
    .leftJoin(subjects, eq(subjects.id, timetableSlots.subjectId))
    .leftJoin(staff, eq(staff.id, timetableSlots.staffId))
    .where(eq(timetableSlots.sectionId, sectionId))
    .orderBy(asc(timetableSlots.dayOfWeek), asc(timetableSlots.periodId));
  return rows.map((r) => slotItem(r));
}

async function loadSection(db: TenantDb, sectionId: string) {
  const ct = alias(staff, 'class_teacher');
  const [s] = await db
    .select({ id: sections.id, name: sections.name, gradeId: sections.gradeId, gradeName: grades.name, room: sections.room, ctFirst: ct.firstName, ctLast: ct.lastName })
    .from(sections)
    .innerJoin(grades, eq(grades.id, sections.gradeId))
    .leftJoin(ct, eq(ct.id, sections.classTeacherId))
    .where(eq(sections.id, sectionId))
    .limit(1);
  if (!s) throw notFound('Section');
  return s;
}

const mondayOf = (date: string) => addDaysIso(date, -(isoWeekday(date) - 1));

// ───────────────────────────── substitutions: queries ─────────────────────────────

const origStaff = alias(staff, 'orig_staff');
const subStaff = alias(staff, 'sub_staff');

function substitutionSelect(db: TenantDb) {
  return db
    .select({
      id: timetableSubstitutions.id,
      slotId: timetableSubstitutions.slotId,
      date: timetableSubstitutions.date,
      dayOfWeek: timetableSlots.dayOfWeek,
      sectionId: timetableSlots.sectionId,
      sectionName: sections.name,
      gradeName: grades.name,
      periodId: timetableSlots.periodId,
      periodName: periods.name,
      startTime: periods.startTime,
      endTime: periods.endTime,
      subjectId: timetableSlots.subjectId,
      subjectName: subjects.name,
      originalStaffId: timetableSlots.staffId,
      origFirst: origStaff.firstName,
      origLast: origStaff.lastName,
      substituteStaffId: timetableSubstitutions.substituteStaffId,
      subFirst: subStaff.firstName,
      subLast: subStaff.lastName,
      reason: timetableSubstitutions.reason,
      createdAt: timetableSubstitutions.createdAt,
    })
    .from(timetableSubstitutions)
    .innerJoin(timetableSlots, eq(timetableSlots.id, timetableSubstitutions.slotId))
    .innerJoin(sections, eq(sections.id, timetableSlots.sectionId))
    .innerJoin(grades, eq(grades.id, sections.gradeId))
    .innerJoin(periods, eq(periods.id, timetableSlots.periodId))
    .leftJoin(subjects, eq(subjects.id, timetableSlots.subjectId))
    .leftJoin(origStaff, eq(origStaff.id, timetableSlots.staffId))
    .innerJoin(subStaff, eq(subStaff.id, timetableSubstitutions.substituteStaffId));
}

type SubRow = Awaited<ReturnType<ReturnType<typeof substitutionSelect>['limit']>>[number];
function subItem(r: SubRow): TimetableSubstitutionItem {
  return {
    id: r.id,
    slotId: r.slotId,
    date: r.date,
    dayOfWeek: r.dayOfWeek,
    sectionId: r.sectionId,
    sectionName: `${r.gradeName} ${r.sectionName}`,
    periodId: r.periodId,
    periodName: r.periodName,
    startTime: hhmm(r.startTime),
    endTime: hhmm(r.endTime),
    subjectId: r.subjectId,
    subjectName: r.subjectName,
    originalStaffId: r.originalStaffId,
    originalTeacherName: fullName(r.origFirst, r.origLast),
    substituteStaffId: r.substituteStaffId,
    substituteTeacherName: fullName(r.subFirst, r.subLast) ?? '',
    reason: r.reason,
    createdAt: iso(r.createdAt),
  };
}

/** Who may see which covers: management all; learners their section(s); teachers covers they give/receive or in their own class. */
function substitutionScope(p: Principal): SQL {
  const sc = p.scope('timetable:view');
  if (sc === 'school') return sql`true`;
  if (p.userType !== 'staff') return sectionScope(p, 'timetable:view', timetableSlots.sectionId);
  if (sc !== 'assigned') return sql`false`;
  const parts: SQL[] = [];
  if (p.staffId) parts.push(eq(timetableSubstitutions.substituteStaffId, p.staffId), eq(timetableSlots.staffId, p.staffId));
  if (p.classTeacherSectionIds.length) parts.push(inArray(timetableSlots.sectionId, p.classTeacherSectionIds));
  return parts.length ? (or(...parts) as SQL) : sql`false`;
}

export async function listSubstitutions(db: TenantDb, tenant: TenantInfo, p: Principal, q: { from?: string; to?: string; sectionId?: string; staffId?: string; page: number; pageSize: number }) {
  const today = todayIn(tenant.timezone);
  const from = q.from ?? today;
  const to = q.to ?? addDaysIso(from, 14);
  const where = and(
    gte(timetableSubstitutions.date, from),
    lte(timetableSubstitutions.date, to),
    substitutionScope(p),
    q.sectionId ? eq(timetableSlots.sectionId, q.sectionId) : undefined,
    q.staffId ? or(eq(timetableSubstitutions.substituteStaffId, q.staffId), eq(timetableSlots.staffId, q.staffId)) : undefined,
  );
  const [rows, counted] = await Promise.all([
    substitutionSelect(db).where(where).orderBy(asc(timetableSubstitutions.date), asc(periods.ordinal)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
    db.select({ n: sql<number>`count(*)::int` }).from(timetableSubstitutions).innerJoin(timetableSlots, eq(timetableSlots.id, timetableSubstitutions.slotId)).where(where),
  ]);
  return { rows: rows.map(subItem), total: counted[0]?.n ?? 0 };
}

// ───────────────────────────── section grid ─────────────────────────────

export async function sectionGrid(db: TenantDb, tenant: TenantInfo, p: Principal, sectionId: string, date?: string): Promise<TimetableGridResponse> {
  assertSectionAccess(p, 'timetable:view', sectionId);
  const sec = await loadSection(db, sectionId);
  const weekOf = mondayOf(date ?? todayIn(tenant.timezone));
  const [pers, slots, working, subs] = await Promise.all([
    loadPeriods(db),
    sectionSlots(db, sectionId),
    workingDays(db),
    substitutionSelect(db)
      .where(and(eq(timetableSlots.sectionId, sectionId), gte(timetableSubstitutions.date, weekOf), lte(timetableSubstitutions.date, addDaysIso(weekOf, 6))))
      .orderBy(asc(timetableSubstitutions.date), asc(periods.ordinal)),
  ]);
  return {
    section: { id: sec.id, name: sec.name, gradeId: sec.gradeId, gradeName: sec.gradeName, room: sec.room, classTeacherName: fullName(sec.ctFirst, sec.ctLast) },
    workingDays: working,
    periods: pers,
    slots,
    weekOf,
    substitutions: subs.map(subItem),
  };
}

// ───────────────────────────── slot validation & writes ─────────────────────────────

interface SlotInput {
  dayOfWeek: number;
  periodId: string;
  subjectId: string;
  staffId?: string | null;
  room?: string | null;
}
interface ResolvedSlot extends SlotInput {
  staffId: string | null;
  warnings: string[];
}

/** Serialises timetable writes school-wide so two admins can never double-book a teacher concurrently. */
async function lockTimetable(tx: Pick<TenantDb, 'execute'>) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('timetable-write'))`);
}

/**
 * Rules for one slot (documented in the route descriptions):
 *  1. the period exists and is not a break (422 PERIOD_IS_BREAK) and the weekday is a school day (422 NOT_A_WORKING_DAY)
 *  2. the subject is offered to the section's grade (422 SUBJECT_NOT_OFFERED)
 *  3. the teacher must be the one assigned to (section, subject) in teaching_assignments (422 TEACHER_NOT_ASSIGNED);
 *     with allowUnassigned the slot is saved anyway and a TEACHER_NOT_ASSIGNED warning is returned. A slot without any
 *     teacher (omitted staffId and no assignment) is only allowed together with allowUnassigned.
 *  4. a teacher cannot be in two sections in the same day+period (409 TEACHER_CLASH) — checked in assertNoClashes.
 */
async function resolveSlots(tx: TenantDb, sec: { id: string; gradeId: string }, inputs: SlotInput[], allowUnassigned: boolean): Promise<ResolvedSlot[]> {
  if (!inputs.length) return [];
  const seen = new Set<string>();
  for (const i of inputs) {
    const k = `${i.dayOfWeek}|${i.periodId}`;
    if (seen.has(k)) throw unprocessable('The same day and period appears twice', 'DUPLICATE_SLOT');
    seen.add(k);
  }
  const [pers, working, offered, assigned] = await Promise.all([
    loadPeriods(tx),
    workingDays(tx),
    tx.select({ subjectId: gradeSubjects.subjectId }).from(gradeSubjects).where(eq(gradeSubjects.gradeId, sec.gradeId)),
    tx.select({ subjectId: teachingAssignments.subjectId, staffId: teachingAssignments.staffId }).from(teachingAssignments).where(eq(teachingAssignments.sectionId, sec.id)),
  ]);
  const periodById = new Map(pers.map((x) => [x.id, x]));
  const offeredSet = new Set(offered.map((o) => o.subjectId));
  const assignedBy = new Map(assigned.map((a) => [a.subjectId, a.staffId]));
  const explicit = [...new Set(inputs.map((i) => i.staffId).filter((x): x is string => !!x))];
  if (explicit.length) {
    const found = await tx.select({ id: staff.id }).from(staff).where(and(inArray(staff.id, explicit), eq(staff.status, 'active')));
    if (found.length !== explicit.length) throw unprocessable('Teacher not found', 'STAFF_NOT_FOUND');
  }
  return inputs.map((i) => {
    const period = periodById.get(i.periodId);
    if (!period) throw unprocessable('Period not found', 'PERIOD_NOT_FOUND');
    if (period.isBreak) throw unprocessable(`${period.name} is a break; lessons cannot be scheduled in it`, 'PERIOD_IS_BREAK');
    if (!working.includes(i.dayOfWeek)) throw unprocessable('That weekday is not a school day', 'NOT_A_WORKING_DAY');
    if (!offeredSet.has(i.subjectId)) throw unprocessable('This subject is not offered to the grade', 'SUBJECT_NOT_OFFERED');
    const assignee = assignedBy.get(i.subjectId) ?? null;
    const warnings: string[] = [];
    let staffId = i.staffId ?? null;
    if (!staffId) {
      staffId = assignee;
      if (!staffId) {
        if (!allowUnassigned) throw unprocessable('No teacher is assigned to this subject in this section', 'TEACHER_NOT_ASSIGNED');
        warnings.push('TEACHER_NOT_ASSIGNED');
      }
    } else if (staffId !== assignee) {
      if (!allowUnassigned) throw unprocessable('This teacher is not assigned to teach this subject in this section', 'TEACHER_NOT_ASSIGNED');
      warnings.push('TEACHER_NOT_ASSIGNED');
    }
    return { ...i, staffId, room: i.room ?? null, warnings };
  });
}

async function assertNoClashes(tx: TenantDb, sectionId: string, resolved: ResolvedSlot[]) {
  const staffIds = [...new Set(resolved.map((r) => r.staffId).filter((x): x is string => !!x))];
  if (!staffIds.length) return;
  const others = await tx
    .select({ slotId: timetableSlots.id, staffId: timetableSlots.staffId, dayOfWeek: timetableSlots.dayOfWeek, periodId: timetableSlots.periodId, sectionId: timetableSlots.sectionId, sectionName: sections.name, gradeName: grades.name })
    .from(timetableSlots)
    .innerJoin(sections, eq(sections.id, timetableSlots.sectionId))
    .innerJoin(grades, eq(grades.id, sections.gradeId))
    .where(and(inArray(timetableSlots.staffId, staffIds), ne(timetableSlots.sectionId, sectionId)));
  const byKey = new Map(others.map((o) => [`${o.staffId}|${o.dayOfWeek}|${o.periodId}`, o]));
  for (const r of resolved) {
    const hit = r.staffId ? byKey.get(`${r.staffId}|${r.dayOfWeek}|${r.periodId}`) : undefined;
    if (hit) throw new AppError(409, 'TEACHER_CLASH', `This teacher already teaches ${hit.gradeName} ${hit.sectionName} in that period`, { sectionId: hit.sectionId, sectionName: `${hit.gradeName} ${hit.sectionName}`, slotId: hit.slotId, dayOfWeek: r.dayOfWeek, periodId: r.periodId });
  }
}

const compactSlot = (s: TimetableSlotItem) => ({ dayOfWeek: s.dayOfWeek, periodId: s.periodId, subjectId: s.subjectId, staffId: s.staffId, room: s.room });

export async function setSlot(db: TenantDb, p: Principal, actor: AuditActor, body: TimetableSetSlotBody): Promise<TimetableSlotItem> {
  assertSectionAccess(p, 'timetable:edit', body.sectionId);
  const slotId = await db.transaction(async (tx) => {
    await lockTimetable(tx);
    const sec = await loadSection(tx as unknown as TenantDb, body.sectionId);
    const [resolved] = await resolveSlots(tx as unknown as TenantDb, sec, [body], body.allowUnassigned);
    await assertNoClashes(tx as unknown as TenantDb, body.sectionId, [resolved!]);
    const [existing] = await tx
      .select({ id: timetableSlots.id, subjectId: timetableSlots.subjectId, staffId: timetableSlots.staffId, room: timetableSlots.room })
      .from(timetableSlots)
      .where(and(eq(timetableSlots.sectionId, body.sectionId), eq(timetableSlots.dayOfWeek, body.dayOfWeek), eq(timetableSlots.periodId, body.periodId)));
    if (!p.can(existing ? 'timetable:edit' : 'timetable:create')) throw forbidden();
    const values = { sectionId: body.sectionId, dayOfWeek: body.dayOfWeek, periodId: body.periodId, subjectId: body.subjectId, staffId: resolved!.staffId, room: resolved!.room };
    const [row] = existing
      ? await tx.update(timetableSlots).set(values).where(eq(timetableSlots.id, existing.id)).returning({ id: timetableSlots.id })
      : await tx.insert(timetableSlots).values(values).returning({ id: timetableSlots.id });
    await audit(tx, actor, { action: existing ? 'timetable.slot.update' : 'timetable.slot.create', entity: 'timetable_slot', entityId: row!.id, summary: `Section ${body.sectionId} day ${body.dayOfWeek}`, before: existing ?? null, after: values });
    return { id: row!.id, warnings: resolved!.warnings };
  });
  const [row] = await db.select(slotCols).from(timetableSlots).leftJoin(subjects, eq(subjects.id, timetableSlots.subjectId)).leftJoin(staff, eq(staff.id, timetableSlots.staffId)).where(eq(timetableSlots.id, slotId.id));
  return slotItem(row!, slotId.warnings);
}

export async function replaceSection(db: TenantDb, p: Principal, actor: AuditActor, sectionId: string, body: TimetableReplaceBody): Promise<TimetableSlotItem[]> {
  assertSectionAccess(p, 'timetable:edit', sectionId);
  await db.transaction(async (tx) => {
    await lockTimetable(tx);
    const sec = await loadSection(tx as unknown as TenantDb, sectionId);
    const resolved = await resolveSlots(tx as unknown as TenantDb, sec, body.slots, body.allowUnassigned);
    await assertNoClashes(tx as unknown as TenantDb, sectionId, resolved);
    const before = await sectionSlots(tx as unknown as TenantDb, sectionId);
    const keep = new Set(resolved.map((r) => `${r.dayOfWeek}|${r.periodId}`));
    const drop = before.filter((b) => !keep.has(`${b.dayOfWeek}|${b.periodId}`)).map((b) => b.id);
    if (drop.length) await tx.delete(timetableSlots).where(inArray(timetableSlots.id, drop));
    if (resolved.length) {
      await tx
        .insert(timetableSlots)
        .values(resolved.map((r) => ({ sectionId, dayOfWeek: r.dayOfWeek, periodId: r.periodId, subjectId: r.subjectId, staffId: r.staffId, room: r.room })))
        .onConflictDoUpdate({ target: [timetableSlots.sectionId, timetableSlots.dayOfWeek, timetableSlots.periodId], set: { subjectId: sql`excluded.subject_id`, staffId: sql`excluded.staff_id`, room: sql`excluded.room` } });
    }
    await audit(tx, actor, {
      action: 'timetable.replace',
      entity: 'section_timetable',
      entityId: sectionId,
      summary: `${resolved.length} slots saved, ${drop.length} removed`,
      before: before.map(compactSlot),
      after: resolved.map(({ dayOfWeek, periodId, subjectId, staffId, room }) => ({ dayOfWeek, periodId, subjectId, staffId, room })),
    });
  });
  const slots = await sectionSlots(db, sectionId);
  return slots;
}

export async function clearSlot(db: TenantDb, p: Principal, actor: AuditActor, slotId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await lockTimetable(tx);
    const [slot] = await tx.select().from(timetableSlots).where(eq(timetableSlots.id, slotId));
    if (!slot) throw notFound('Timetable slot');
    assertSectionAccess(p, 'timetable:edit', slot.sectionId);
    await tx.delete(timetableSlots).where(eq(timetableSlots.id, slotId));
    await audit(tx, actor, { action: 'timetable.slot.clear', entity: 'timetable_slot', entityId: slotId, before: { sectionId: slot.sectionId, dayOfWeek: slot.dayOfWeek, periodId: slot.periodId, subjectId: slot.subjectId, staffId: slot.staffId } });
  });
}

// ───────────────────────────── substitutions: writes ─────────────────────────────

export async function createSubstitution(db: TenantDb, tenant: TenantInfo, p: Principal, actor: AuditActor, body: TimetableSubstitutionCreateBody): Promise<TimetableSubstitutionItem> {
  const today = todayIn(tenant.timezone);
  const created = await db.transaction(async (tx) => {
    await lockTimetable(tx);
    const [slot] = await tx.select().from(timetableSlots).where(eq(timetableSlots.id, body.slotId));
    if (!slot) throw notFound('Timetable slot');
    assertSectionAccess(p, 'timetable:edit', slot.sectionId);
    if (body.date < today) throw unprocessable('A substitution cannot be set for a past date', 'DATE_IN_PAST');
    if (isoWeekday(body.date) !== slot.dayOfWeek) throw unprocessable('The date does not fall on this slot’s weekday', 'DATE_WEEKDAY_MISMATCH');
    if (slot.staffId === body.substituteStaffId) throw unprocessable('The substitute is already the teacher of this slot', 'SUBSTITUTE_IS_TEACHER');
    const [sub] = await tx.select({ id: staff.id }).from(staff).where(and(eq(staff.id, body.substituteStaffId), eq(staff.status, 'active')));
    if (!sub) throw unprocessable('Substitute not found', 'STAFF_NOT_FOUND');
    const [dup] = await tx.select({ id: timetableSubstitutions.id }).from(timetableSubstitutions).where(and(eq(timetableSubstitutions.slotId, body.slotId), eq(timetableSubstitutions.date, body.date)));
    if (dup) throw conflict('This lesson already has a substitute on that date; remove it first', 'SUBSTITUTION_EXISTS');

    // the substitute must be free: no lesson of their own in that day+period (unless that lesson is itself covered that date) …
    const ownSlots = await tx
      .select({ id: timetableSlots.id, sectionId: timetableSlots.sectionId, covered: timetableSubstitutions.id })
      .from(timetableSlots)
      .leftJoin(timetableSubstitutions, and(eq(timetableSubstitutions.slotId, timetableSlots.id), eq(timetableSubstitutions.date, body.date)))
      .where(and(eq(timetableSlots.staffId, body.substituteStaffId), eq(timetableSlots.dayOfWeek, slot.dayOfWeek), eq(timetableSlots.periodId, slot.periodId)));
    const busy = ownSlots.find((s) => !s.covered);
    // … and not already covering another class in that period that day
    const covering = await tx
      .select({ id: timetableSubstitutions.id, sectionId: timetableSlots.sectionId })
      .from(timetableSubstitutions)
      .innerJoin(timetableSlots, eq(timetableSlots.id, timetableSubstitutions.slotId))
      .where(and(eq(timetableSubstitutions.date, body.date), eq(timetableSubstitutions.substituteStaffId, body.substituteStaffId), eq(timetableSlots.periodId, slot.periodId)));
    const clash = busy ?? covering[0];
    if (clash) throw new AppError(409, 'TEACHER_CLASH', 'The substitute is already teaching in that period', { sectionId: clash.sectionId, date: body.date, periodId: slot.periodId });

    const [row] = await tx.insert(timetableSubstitutions).values({ slotId: body.slotId, date: body.date, substituteStaffId: body.substituteStaffId, reason: body.reason ?? null, createdBy: p.userId }).returning({ id: timetableSubstitutions.id });
    await audit(tx, actor, { action: 'timetable.substitute', entity: 'timetable_substitution', entityId: row!.id, summary: `Cover on ${body.date}`, after: { slotId: body.slotId, date: body.date, substituteStaffId: body.substituteStaffId, originalStaffId: slot.staffId, reason: body.reason ?? null } });
    return row!.id;
  });
  const [item] = (await substitutionSelect(db).where(eq(timetableSubstitutions.id, created)).limit(1)).map(subItem);

  // after commit: tell the substitute (and the teacher being covered)
  const [subUser] = await db.select({ userId: staff.userId }).from(staff).where(eq(staff.id, body.substituteStaffId));
  const rows = [];
  if (subUser?.userId) rows.push({ userId: subUser.userId, type: 'timetable.substitution', title: 'Substitution assigned', body: `You are covering ${item!.sectionName}${item!.subjectName ? ` (${item!.subjectName})` : ''}, ${item!.periodName} on ${body.date}.`, data: { route: '/timetable', date: body.date, substitutionId: item!.id } });
  if (item!.originalStaffId) {
    const [orig] = await db.select({ userId: staff.userId }).from(staff).where(eq(staff.id, item!.originalStaffId));
    if (orig?.userId) rows.push({ userId: orig.userId, type: 'timetable.substitution', title: 'Your lesson is covered', body: `${item!.sectionName}, ${item!.periodName} on ${body.date} will be covered by ${item!.substituteTeacherName}.`, data: { route: '/timetable', date: body.date, substitutionId: item!.id } });
  }
  await notifyRows(db, tenant, rows);
  return item!;
}

export async function removeSubstitution(db: TenantDb, p: Principal, actor: AuditActor, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: timetableSubstitutions.id, slotId: timetableSubstitutions.slotId, date: timetableSubstitutions.date, substituteStaffId: timetableSubstitutions.substituteStaffId, sectionId: timetableSlots.sectionId })
      .from(timetableSubstitutions)
      .innerJoin(timetableSlots, eq(timetableSlots.id, timetableSubstitutions.slotId))
      .where(eq(timetableSubstitutions.id, id));
    if (!row) throw notFound('Substitution');
    assertSectionAccess(p, 'timetable:edit', row.sectionId);
    await tx.delete(timetableSubstitutions).where(eq(timetableSubstitutions.id, id));
    await audit(tx, actor, { action: 'timetable.substitute.cancel', entity: 'timetable_substitution', entityId: id, before: { slotId: row.slotId, date: row.date, substituteStaffId: row.substituteStaffId } });
  });
}

// ───────────────────────────── day view (me / today) ─────────────────────────────

/** One school day for the caller: a student's / child's section, or a teacher's own lessons including covers. */
export async function dayView(db: TenantDb, tenant: TenantInfo, p: Principal, opts: { date?: string; studentId?: string; onlyToday?: boolean }): Promise<TimetableDayResponse> {
  const today = todayIn(tenant.timezone);
  const date = opts.onlyToday ? today : (opts.date ?? today);
  const dow = isoWeekday(date);
  const isToday = date === today;
  const nowHm = isToday ? localTime(new Date(), tenant.timezone) : null;
  const [pers, working] = await Promise.all([loadPeriods(db), workingDays(db)]);
  const isWorkingDay = working.includes(dow);

  const slotOrig = alias(staff, 'slot_teacher');
  const baseSelect = () =>
    db
      .select({
        slotId: timetableSlots.id,
        sectionId: timetableSlots.sectionId,
        sectionName: sections.name,
        gradeName: grades.name,
        periodId: timetableSlots.periodId,
        subjectId: timetableSlots.subjectId,
        subjectName: subjects.name,
        staffId: timetableSlots.staffId,
        origFirst: slotOrig.firstName,
        origLast: slotOrig.lastName,
        room: timetableSlots.room,
        subId: timetableSubstitutions.id,
        subStaffId: timetableSubstitutions.substituteStaffId,
        subFirst: subStaff.firstName,
        subLast: subStaff.lastName,
        subReason: timetableSubstitutions.reason,
      })
      .from(timetableSlots)
      .innerJoin(sections, eq(sections.id, timetableSlots.sectionId))
      .innerJoin(grades, eq(grades.id, sections.gradeId))
      .leftJoin(subjects, eq(subjects.id, timetableSlots.subjectId))
      .leftJoin(slotOrig, eq(slotOrig.id, timetableSlots.staffId))
      .leftJoin(timetableSubstitutions, and(eq(timetableSubstitutions.slotId, timetableSlots.id), eq(timetableSubstitutions.date, date)))
      .leftJoin(subStaff, eq(subStaff.id, timetableSubstitutions.substituteStaffId));

  let rows: Awaited<ReturnType<ReturnType<typeof baseSelect>['limit']>> = [];
  let studentId: string | null = null;
  let sectionId: string | null = null;
  let sectionName: string | null = null;
  const learner = p.userType !== 'staff';
  if (learner) {
    const st = await resolveStudent(db, p, 'timetable:view', opts.studentId);
    if (st?.sectionId) {
      studentId = st.id;
      sectionId = st.sectionId;
      const sec = await loadSection(db, st.sectionId);
      sectionName = `${sec.gradeName} ${sec.name}`;
      if (isWorkingDay) rows = await baseSelect().where(and(eq(timetableSlots.sectionId, st.sectionId), eq(timetableSlots.dayOfWeek, dow))).limit(100);
    }
  } else if (p.staffId && isWorkingDay) {
    rows = await baseSelect()
      .where(and(eq(timetableSlots.dayOfWeek, dow), or(eq(timetableSlots.staffId, p.staffId), eq(timetableSubstitutions.substituteStaffId, p.staffId))))
      .limit(100);
  }

  const byPeriod = new Map(rows.map((r) => [r.periodId, r]));
  const stateOf = (start: string, end: string): TimetableEntry['state'] => {
    if (!nowHm) return null;
    if (end <= nowHm) return 'past';
    if (start <= nowHm) return 'current';
    return 'upcoming';
  };
  const entries: TimetableEntry[] = [];
  for (const per of learner && !sectionId ? [] : pers) {
    const r = byPeriod.get(per.id);
    if (!isWorkingDay || (!r && !learner)) continue; // teachers only list lessons they teach or cover; students see the whole day
    const substituted = !!r?.subId;
    const teacherId = r ? (substituted ? r.subStaffId : r.staffId) : null;
    const teacherName = r ? (substituted ? fullName(r.subFirst, r.subLast) : fullName(r.origFirst, r.origLast)) : null;
    let relation: TimetableEntry['relation'] = null;
    if (!learner && r) relation = substituted ? (r.subStaffId === p.staffId ? 'covering' : 'covered') : 'own';
    entries.push({
      periodId: per.id,
      periodName: per.name,
      ordinal: per.ordinal,
      startTime: per.startTime,
      endTime: per.endTime,
      isBreak: per.isBreak,
      slotId: r?.slotId ?? null,
      sectionId: r?.sectionId ?? sectionId,
      sectionName: r ? `${r.gradeName} ${r.sectionName}` : sectionName,
      subjectId: r?.subjectId ?? null,
      subjectName: r?.subjectName ?? null,
      staffId: teacherId ?? null,
      teacherName,
      room: r?.room ?? null,
      substituted,
      substitution: r?.subId ? { id: r.subId, originalStaffId: r.staffId, originalTeacherName: fullName(r.origFirst, r.origLast), substituteStaffId: r.subStaffId!, substituteTeacherName: fullName(r.subFirst, r.subLast) ?? '', reason: r.subReason } : null,
      relation,
      state: stateOf(per.startTime, per.endTime),
    });
  }
  const current = entries.find((e) => e.state === 'current') ?? null;
  const next = entries.find((e) => e.state === 'upcoming' && !e.isBreak && (e.slotId || !learner)) ?? null;
  return { date, dayOfWeek: dow, isWorkingDay, now: nowHm, studentId, sectionId, sectionName, entries, current, next };
}
