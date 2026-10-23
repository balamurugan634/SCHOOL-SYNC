import { and, asc, eq, inArray, ne, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import type { classTeacherBody, sectionCreateBody, sectionUpdateBody, teachingAssignmentQuery } from '@school-sync/shared';
import { audit, type AuditActor } from '../../core/audit';
import { conflict, notFound, unprocessable } from '../../core/errors';
import { ilikeAny } from '../../core/http';
import type { Principal } from '../../core/rbac/principal';
import { sectionScope } from '../../core/rbac/scope';
import type { Executor } from '../../core/tenancy/pools';
import { academicYears, enrollments, gradeSubjects, grades, roles, sections, staff, subjects, teachingAssignments, userRoles, users } from '../../db/tenant/schema';
import { currentYear, fullName } from './service';

// ───────────────────────────────────────────────────────────────────────────────────────────────
// Sections
// ───────────────────────────────────────────────────────────────────────────────────────────────

/** students who sat (or sit) in the section this year: enrolled now, or moved up / held back at year end */
const countedStatuses = sql`('enrolled','promoted','retained')`;

const sectionColumns = {
  id: sections.id,
  gradeId: sections.gradeId,
  gradeName: grades.name,
  gradeOrdinal: grades.ordinal,
  academicYearId: sections.academicYearId,
  academicYearName: academicYears.name,
  name: sections.name,
  room: sections.room,
  capacity: sections.capacity,
  classTeacherId: sections.classTeacherId,
  ctFirst: staff.firstName,
  ctLast: staff.lastName,
  studentCount: sql<number>`(select count(*)::int from ${enrollments} where ${enrollments.sectionId} = ${sections.id} and ${enrollments.status} in ${countedStatuses})`,
};

type SectionRow = {
  id: string;
  gradeId: string;
  gradeName: string;
  gradeOrdinal: number;
  academicYearId: string;
  academicYearName: string;
  name: string;
  room: string | null;
  capacity: number | null;
  classTeacherId: string | null;
  ctFirst: string | null;
  ctLast: string | null;
  studentCount: number;
};

export const toSectionOut = (r: SectionRow) => ({
  id: r.id,
  gradeId: r.gradeId,
  gradeName: r.gradeName,
  gradeOrdinal: r.gradeOrdinal,
  academicYearId: r.academicYearId,
  academicYearName: r.academicYearName,
  name: r.name,
  room: r.room,
  capacity: r.capacity,
  classTeacherId: r.classTeacherId,
  classTeacherName: r.classTeacherId ? fullName(r.ctFirst, r.ctLast) : null,
  studentCount: r.studentCount,
});

const sectionQuery = (db: Executor) =>
  db
    .select(sectionColumns)
    .from(sections)
    .innerJoin(grades, eq(grades.id, sections.gradeId))
    .innerJoin(academicYears, eq(academicYears.id, sections.academicYearId))
    .leftJoin(staff, eq(staff.id, sections.classTeacherId));

export async function listSections(db: Executor, p: Principal, q: { page: number; pageSize: number; q?: string; yearId?: string; gradeId?: string; mine?: boolean }) {
  const yearId = q.mine ? ((await currentYear(db))?.id ?? null) : (q.yearId ?? (await currentYear(db))?.id ?? null);
  const where = and(
    // scope is part of the query: a teacher only ever gets assigned sections, a parent only their children's
    sectionScope(p, 'academics:view', sections.id),
    yearId ? eq(sections.academicYearId, yearId) : sql`false`,
    q.gradeId ? eq(sections.gradeId, q.gradeId) : undefined,
    q.q ? ilikeAny(q.q, sections.name, grades.name) : undefined,
  );
  const [rows, [total]] = await Promise.all([
    sectionQuery(db)
      .where(where)
      .orderBy(asc(grades.ordinal), asc(sections.name))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db.select({ n: sql<number>`count(*)::int` }).from(sections).innerJoin(grades, eq(grades.id, sections.gradeId)).where(where),
  ]);
  return { rows: rows.map(toSectionOut), total: total?.n ?? 0 };
}

export async function getSectionRow(db: Executor, id: string, scope?: SQL) {
  const [row] = await sectionQuery(db)
    .where(and(eq(sections.id, id), scope))
    .limit(1);
  if (!row) throw notFound('Section');
  return row;
}

/** One section with its teaching assignments. `p` restricts to what the caller may see (404 otherwise). */
export async function getSectionDetail(db: Executor, p: Principal, id: string) {
  const row = await getSectionRow(db, id, sectionScope(p, 'academics:view', sections.id));
  const asg = await db
    .select({ id: teachingAssignments.id, subjectId: subjects.id, subjectCode: subjects.code, subjectName: subjects.name, staffId: staff.id, sFirst: staff.firstName, sLast: staff.lastName })
    .from(teachingAssignments)
    .innerJoin(subjects, eq(subjects.id, teachingAssignments.subjectId))
    .innerJoin(staff, eq(staff.id, teachingAssignments.staffId))
    .where(eq(teachingAssignments.sectionId, id))
    .orderBy(asc(subjects.name));
  return { ...toSectionOut(row), teachingAssignments: asg.map((a) => ({ id: a.id, subjectId: a.subjectId, subjectCode: a.subjectCode, subjectName: a.subjectName, staffId: a.staffId, staffName: fullName(a.sFirst, a.sLast) })) };
}

const sectionAudit = (r: SectionRow) => ({ name: r.name, gradeId: r.gradeId, academicYearId: r.academicYearId, room: r.room, capacity: r.capacity, classTeacherId: r.classTeacherId });

async function assertSectionName(db: Executor, gradeId: string, yearId: string, name: string, exceptId?: string) {
  const [dupe] = await db
    .select({ id: sections.id })
    .from(sections)
    .where(and(eq(sections.gradeId, gradeId), eq(sections.academicYearId, yearId), sql`lower(${sections.name}) = lower(${name})`, exceptId ? ne(sections.id, exceptId) : undefined))
    .limit(1);
  if (dupe) throw conflict(`Section "${name}" already exists for this grade and year`, 'SECTION_EXISTS');
}

export interface ClassTeacherEffect {
  /** users whose cached principal must be refreshed after commit */
  userIds: string[];
}

export async function createSection(tx: Executor, actor: AuditActor, input: z.infer<typeof sectionCreateBody>): Promise<{ id: string; effect: ClassTeacherEffect }> {
  const [grade] = await tx.select({ id: grades.id }).from(grades).where(eq(grades.id, input.gradeId)).limit(1);
  if (!grade) throw unprocessable('Grade not found', 'GRADE_NOT_FOUND');
  const yearId = input.academicYearId ?? (await currentYear(tx))?.id;
  if (!yearId) throw unprocessable('There is no current academic year; create one first', 'NO_CURRENT_YEAR');
  const [year] = await tx.select({ id: academicYears.id }).from(academicYears).where(eq(academicYears.id, yearId)).limit(1);
  if (!year) throw unprocessable('Academic year not found', 'YEAR_NOT_FOUND');
  await assertSectionName(tx, input.gradeId, yearId, input.name);
  const [row] = await tx.insert(sections).values({ gradeId: input.gradeId, academicYearId: yearId, name: input.name, room: input.room ?? null, capacity: input.capacity ?? null }).returning();
  await audit(tx, actor, { action: 'section.create', entity: 'section', entityId: row!.id, summary: `Created section ${input.name}`, after: { name: row!.name, gradeId: row!.gradeId, academicYearId: yearId, room: row!.room, capacity: row!.capacity } });
  let effect: ClassTeacherEffect = { userIds: [] };
  if (input.classTeacherId) effect = await setClassTeacher(tx, actor, row!.id, input.classTeacherId);
  return { id: row!.id, effect };
}

export async function updateSection(tx: Executor, actor: AuditActor, id: string, patch: z.infer<typeof sectionUpdateBody>) {
  const [before] = await tx.select().from(sections).where(eq(sections.id, id)).limit(1).for('update');
  if (!before) throw notFound('Section');
  const next = { name: patch.name ?? before.name, room: patch.room === undefined ? before.room : patch.room, capacity: patch.capacity === undefined ? before.capacity : patch.capacity };
  if (next.name !== before.name) await assertSectionName(tx, before.gradeId, before.academicYearId, next.name, id);
  if (next.capacity != null) {
    const [c] = await tx.select({ n: sql<number>`count(*)::int` }).from(enrollments).where(and(eq(enrollments.sectionId, id), eq(enrollments.status, 'enrolled')));
    if ((c?.n ?? 0) > next.capacity) throw unprocessable(`The section already has ${c!.n} students, more than the new capacity`, 'CAPACITY_BELOW_ENROLMENT');
  }
  await tx.update(sections).set(next).where(eq(sections.id, id));
  await audit(tx, actor, { action: 'section.update', entity: 'section', entityId: id, summary: `Updated section ${next.name}`, before: { name: before.name, room: before.room, capacity: before.capacity }, after: next });
}

export async function deleteSection(tx: Executor, actor: AuditActor, id: string): Promise<{ userIds: string[] }> {
  const [before] = await tx.select().from(sections).where(eq(sections.id, id)).limit(1).for('update');
  if (!before) throw notFound('Section');
  const [enr] = await tx.select({ n: sql<number>`count(*)::int` }).from(enrollments).where(eq(enrollments.sectionId, id));
  if ((enr?.n ?? 0) > 0) throw conflict('This section has student enrolments, so it cannot be deleted', 'SECTION_HAS_STUDENTS');
  // teachers whose assigned sections change
  const staffIds = [...new Set([before.classTeacherId, ...(await tx.select({ staffId: teachingAssignments.staffId }).from(teachingAssignments).where(eq(teachingAssignments.sectionId, id))).map((a) => a.staffId)].filter((x): x is string => !!x))];
  await tx.delete(sections).where(eq(sections.id, id));
  await audit(tx, actor, { action: 'section.delete', entity: 'section', entityId: id, summary: `Deleted section ${before.name}`, before: sectionAudit({ ...before, ctFirst: null, ctLast: null, gradeName: '', gradeOrdinal: 0, academicYearName: '', studentCount: 0 }) });
  const userIds = staffIds.length ? (await tx.select({ userId: staff.userId }).from(staff).where(inArray(staff.id, staffIds))).map((s) => s.userId).filter((x): x is string => !!x) : [];
  return { userIds };
}

// ───────────────────────────────────────────────────────────────────────────────────────────────
// Class teacher
// ───────────────────────────────────────────────────────────────────────────────────────────────

const CLASS_TEACHER_ROLE = 'class_teacher';

/**
 * Assign (or clear, with null) the class teacher of a section.
 * Keeps the system role `class_teacher` in step: granted to the new class teacher, removed from the previous one when
 * they no longer lead any current or upcoming section. Role changes bump `users.auth_version` so stale tokens refresh.
 */
export async function setClassTeacher(tx: Executor, actor: AuditActor, sectionId: string, staffId: string | null): Promise<ClassTeacherEffect> {
  const [sec] = await tx.select().from(sections).where(eq(sections.id, sectionId)).limit(1).for('update');
  if (!sec) throw notFound('Section');
  let newUserId: string | null = null;
  if (staffId) {
    const [st] = await tx.select({ id: staff.id, userId: staff.userId, status: staff.status }).from(staff).where(eq(staff.id, staffId)).limit(1);
    if (!st || st.status !== 'active') throw unprocessable('That staff member is not active', 'STAFF_NOT_ELIGIBLE');
    if (!st.userId) throw unprocessable('That staff member has no login account yet', 'STAFF_NOT_ELIGIBLE');
    newUserId = st.userId;
  }
  const oldStaffId = sec.classTeacherId;
  if (oldStaffId === staffId) return { userIds: [] };

  await tx.update(sections).set({ classTeacherId: staffId }).where(eq(sections.id, sectionId));

  const [role] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.key, CLASS_TEACHER_ROLE)).limit(1);
  const touched = new Set<string>();
  const rolesChanged: { userId: string; granted: boolean }[] = [];
  if (newUserId) touched.add(newUserId);

  if (role && newUserId) {
    const added = await tx.insert(userRoles).values({ userId: newUserId, roleId: role.id, grantedBy: actor.userId ?? null }).onConflictDoNothing().returning({ userId: userRoles.userId });
    if (added.length) rolesChanged.push({ userId: newUserId, granted: true });
  }
  let oldUserId: string | null = null;
  if (oldStaffId) {
    const [old] = await tx.select({ userId: staff.userId }).from(staff).where(eq(staff.id, oldStaffId)).limit(1);
    oldUserId = old?.userId ?? null;
    if (oldUserId) {
      touched.add(oldUserId);
      if (role) {
        const [stillLeads] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(sections)
          .innerJoin(academicYears, eq(academicYears.id, sections.academicYearId))
          .where(and(eq(sections.classTeacherId, oldStaffId), sql`${academicYears.endDate} >= current_date`));
        if ((stillLeads?.n ?? 0) === 0) {
          const removed = await tx.delete(userRoles).where(and(eq(userRoles.userId, oldUserId), eq(userRoles.roleId, role.id))).returning({ userId: userRoles.userId });
          if (removed.length) rolesChanged.push({ userId: oldUserId, granted: false });
        }
      }
    }
  }
  if (rolesChanged.length) await tx.update(users).set({ authVersion: sql`${users.authVersion} + 1` }).where(inArray(users.id, rolesChanged.map((r) => r.userId)));

  await audit(tx, actor, {
    action: 'section.class_teacher',
    entity: 'section',
    entityId: sectionId,
    summary: staffId ? `Assigned a class teacher to section ${sec.name}` : `Removed the class teacher of section ${sec.name}`,
    before: { classTeacherId: oldStaffId },
    after: { classTeacherId: staffId, roleChanges: rolesChanged.map((r) => ({ userId: r.userId, role: CLASS_TEACHER_ROLE, granted: r.granted })) },
  });
  return { userIds: [...touched] };
}

export type ClassTeacherInput = z.infer<typeof classTeacherBody>;

// ───────────────────────────────────────────────────────────────────────────────────────────────
// Teaching assignments
// ───────────────────────────────────────────────────────────────────────────────────────────────

type AssignmentFilter = z.infer<typeof teachingAssignmentQuery>;

const assignmentColumns = {
  id: teachingAssignments.id,
  sectionId: teachingAssignments.sectionId,
  sectionName: sections.name,
  gradeId: sections.gradeId,
  gradeName: grades.name,
  academicYearId: sections.academicYearId,
  subjectId: teachingAssignments.subjectId,
  subjectCode: subjects.code,
  subjectName: subjects.name,
  staffId: teachingAssignments.staffId,
  sFirst: staff.firstName,
  sLast: staff.lastName,
  periodsPerWeek: gradeSubjects.periodsPerWeek,
};

const assignmentQuery = (db: Executor) =>
  db
    .select(assignmentColumns)
    .from(teachingAssignments)
    .innerJoin(sections, eq(sections.id, teachingAssignments.sectionId))
    .innerJoin(grades, eq(grades.id, sections.gradeId))
    .innerJoin(subjects, eq(subjects.id, teachingAssignments.subjectId))
    .innerJoin(staff, eq(staff.id, teachingAssignments.staffId))
    .leftJoin(gradeSubjects, and(eq(gradeSubjects.gradeId, sections.gradeId), eq(gradeSubjects.subjectId, teachingAssignments.subjectId)));

type AssignmentRow = Awaited<ReturnType<typeof assignmentQuery>>[number];

export const toAssignmentOut = (r: AssignmentRow) => ({
  id: r.id,
  sectionId: r.sectionId,
  sectionName: r.sectionName,
  gradeId: r.gradeId,
  gradeName: r.gradeName,
  academicYearId: r.academicYearId,
  subjectId: r.subjectId,
  subjectCode: r.subjectCode,
  subjectName: r.subjectName,
  staffId: r.staffId,
  staffName: fullName(r.sFirst, r.sLast),
  periodsPerWeek: r.periodsPerWeek ?? null,
});

export async function listAssignments(db: Executor, p: Principal, q: AssignmentFilter) {
  const yearId = q.yearId ?? (await currentYear(db))?.id ?? null;
  const where = and(
    sectionScope(p, 'academics:view', teachingAssignments.sectionId),
    yearId ? eq(sections.academicYearId, yearId) : sql`false`,
    q.sectionId ? eq(teachingAssignments.sectionId, q.sectionId) : undefined,
    q.staffId ? eq(teachingAssignments.staffId, q.staffId) : undefined,
    q.subjectId ? eq(teachingAssignments.subjectId, q.subjectId) : undefined,
  );
  const [rows, [total]] = await Promise.all([
    assignmentQuery(db)
      .where(where)
      .orderBy(asc(grades.ordinal), asc(sections.name), asc(subjects.name))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db.select({ n: sql<number>`count(*)::int` }).from(teachingAssignments).innerJoin(sections, eq(sections.id, teachingAssignments.sectionId)).where(where),
  ]);
  return { rows: rows.map(toAssignmentOut), total: total?.n ?? 0 };
}

export async function getAssignment(db: Executor, id: string) {
  const [row] = await assignmentQuery(db).where(eq(teachingAssignments.id, id)).limit(1);
  if (!row) throw notFound('Teaching assignment');
  return row;
}

/** subject offered by the section's grade + teacher active; returns the teacher's user id (for cache invalidation). */
async function validateAssignment(tx: Executor, section: { id: string; gradeId: string }, subjectId: string, staffId: string): Promise<string | null> {
  const [[offer], [st]] = await Promise.all([
    tx.select({ g: gradeSubjects.gradeId }).from(gradeSubjects).where(and(eq(gradeSubjects.gradeId, section.gradeId), eq(gradeSubjects.subjectId, subjectId))).limit(1),
    tx.select({ id: staff.id, userId: staff.userId, status: staff.status }).from(staff).where(eq(staff.id, staffId)).limit(1),
  ]);
  if (!offer) throw unprocessable('This grade does not offer that subject; add it to the grade first', 'SUBJECT_NOT_OFFERED');
  if (!st || st.status !== 'active') throw unprocessable('That staff member is not active', 'STAFF_NOT_ELIGIBLE');
  return st.userId;
}

const staffUserIds = async (db: Executor, staffIds: string[]): Promise<string[]> => {
  const ids = [...new Set(staffIds)];
  if (!ids.length) return [];
  return (await db.select({ userId: staff.userId }).from(staff).where(inArray(staff.id, ids))).map((s) => s.userId).filter((x): x is string => !!x);
};

const assignmentAudit = (r: AssignmentRow) => ({ section: `${r.gradeName} ${r.sectionName}`, sectionId: r.sectionId, subject: r.subjectCode, subjectId: r.subjectId, staffId: r.staffId, teacher: fullName(r.sFirst, r.sLast) });

export async function createAssignment(tx: Executor, actor: AuditActor, input: { sectionId: string; subjectId: string; staffId: string }) {
  const [sec] = await tx.select({ id: sections.id, gradeId: sections.gradeId }).from(sections).where(eq(sections.id, input.sectionId)).limit(1);
  if (!sec) throw notFound('Section');
  await validateAssignment(tx, sec, input.subjectId, input.staffId);
  const [dupe] = await tx.select({ id: teachingAssignments.id }).from(teachingAssignments).where(and(eq(teachingAssignments.sectionId, input.sectionId), eq(teachingAssignments.subjectId, input.subjectId))).limit(1);
  if (dupe) throw conflict('That subject already has a teacher in this section; change the existing assignment instead', 'ASSIGNMENT_EXISTS');
  const [row] = await tx.insert(teachingAssignments).values(input).returning({ id: teachingAssignments.id });
  const full = await getAssignment(tx, row!.id);
  await audit(tx, actor, { action: 'teaching_assignment.create', entity: 'teaching_assignment', entityId: row!.id, summary: `Assigned ${fullName(full.sFirst, full.sLast)} to ${full.subjectName} in ${full.gradeName} ${full.sectionName}`, after: assignmentAudit(full) });
  return { row: full, userIds: await staffUserIds(tx, [input.staffId]) };
}

export async function updateAssignment(tx: Executor, actor: AuditActor, id: string, staffId: string) {
  const before = await getAssignment(tx, id);
  const [sec] = await tx.select({ id: sections.id, gradeId: sections.gradeId }).from(sections).where(eq(sections.id, before.sectionId)).limit(1);
  await validateAssignment(tx, sec!, before.subjectId, staffId);
  await tx.update(teachingAssignments).set({ staffId }).where(eq(teachingAssignments.id, id));
  const after = await getAssignment(tx, id);
  await audit(tx, actor, { action: 'teaching_assignment.update', entity: 'teaching_assignment', entityId: id, summary: `Changed the ${after.subjectName} teacher of ${after.gradeName} ${after.sectionName}`, before: assignmentAudit(before), after: assignmentAudit(after) });
  return { row: after, userIds: await staffUserIds(tx, [before.staffId, staffId]) };
}

export async function deleteAssignment(tx: Executor, actor: AuditActor, id: string) {
  const before = await getAssignment(tx, id);
  await tx.delete(teachingAssignments).where(eq(teachingAssignments.id, id));
  await audit(tx, actor, { action: 'teaching_assignment.delete', entity: 'teaching_assignment', entityId: id, summary: `Removed the ${before.subjectName} teacher of ${before.gradeName} ${before.sectionName}`, before: assignmentAudit(before) });
  return { userIds: await staffUserIds(tx, [before.staffId]) };
}

/** Replace a section's whole subject→teacher grid in one go. Subjects not listed lose their teacher. */
export async function replaceSectionAssignments(tx: Executor, actor: AuditActor, sectionId: string, desired: { subjectId: string; staffId: string }[]) {
  const [sec] = await tx.select({ id: sections.id, gradeId: sections.gradeId, name: sections.name }).from(sections).where(eq(sections.id, sectionId)).limit(1).for('update');
  if (!sec) throw notFound('Section');
  const subjectIds = desired.map((d) => d.subjectId);
  if (new Set(subjectIds).size !== subjectIds.length) throw unprocessable('A subject is listed twice', 'DUPLICATE_SUBJECT');
  for (const d of desired) await validateAssignment(tx, sec, d.subjectId, d.staffId);
  const existing = await tx.select().from(teachingAssignments).where(eq(teachingAssignments.sectionId, sectionId));
  const bySubject = new Map(existing.map((e) => [e.subjectId, e]));
  const affectedStaff = new Set<string>();

  const toDelete = existing.filter((e) => !subjectIds.includes(e.subjectId));
  if (toDelete.length) {
    await tx.delete(teachingAssignments).where(inArray(teachingAssignments.id, toDelete.map((d) => d.id)));
    toDelete.forEach((d) => affectedStaff.add(d.staffId));
  }
  const toInsert = desired.filter((d) => !bySubject.has(d.subjectId));
  if (toInsert.length) {
    await tx.insert(teachingAssignments).values(toInsert.map((d) => ({ sectionId, subjectId: d.subjectId, staffId: d.staffId })));
    toInsert.forEach((d) => affectedStaff.add(d.staffId));
  }
  for (const d of desired) {
    const cur = bySubject.get(d.subjectId);
    if (cur && cur.staffId !== d.staffId) {
      await tx.update(teachingAssignments).set({ staffId: d.staffId }).where(eq(teachingAssignments.id, cur.id));
      affectedStaff.add(cur.staffId);
      affectedStaff.add(d.staffId);
    }
  }
  const after = await assignmentQuery(tx).where(eq(teachingAssignments.sectionId, sectionId)).orderBy(asc(subjects.name));
  await audit(tx, actor, {
    action: 'teaching_assignment.replace',
    entity: 'section',
    entityId: sectionId,
    summary: `Updated the teaching assignments of section ${sec.name}`,
    before: existing.map((e) => ({ subjectId: e.subjectId, staffId: e.staffId })),
    after: desired.map((d) => ({ subjectId: d.subjectId, staffId: d.staffId })),
  });
  return { rows: after, userIds: await staffUserIds(tx, [...affectedStaff]) };
}

