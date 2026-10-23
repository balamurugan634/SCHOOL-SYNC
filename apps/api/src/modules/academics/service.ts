import { and, asc, eq, getTableColumns, inArray, ne, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { academicYearCreateBody, academicYearUpdateBody, copySectionsBody, gradeCreateBody, gradeUpdateBody, periodCreateBody, periodUpdateBody, subjectCreateBody, subjectUpdateBody, termCreateBody, termUpdateBody } from '@school-sync/shared';
import { audit, type AuditActor } from '../../core/audit';
import { conflict, notFound, unprocessable } from '../../core/errors';
import type { Principal } from '../../core/rbac/principal';
import { studentScope } from '../../core/rbac/scope';
import type { Executor } from '../../core/tenancy/pools';
import {
  academicYears,
  attendanceSessions,
  enrollments,
  gradeSubjects,
  grades,
  periods,
  sections,
  staff,
  students,
  subjects,
  teachingAssignments,
  terms,
  timetableSlots,
} from '../../db/tenant/schema';

type Body<T extends z.ZodType> = z.infer<T>;

export const iso = (d: Date): string => d.toISOString();
export const hhmm = (t: string): string => t.slice(0, 5);
export const fullName = (first: string | null, last: string | null): string => [first, last].filter(Boolean).join(' ');

// ───────────────────────────────────────────────────────────────────────────────────────────────
// Academic years
// ───────────────────────────────────────────────────────────────────────────────────────────────

const yearSelect = (db: Executor) =>
  db
    .select({
      ...getTableColumns(academicYears),
      termCount: sql<number>`(select count(*)::int from ${terms} where ${terms.academicYearId} = ${academicYears.id})`,
      sectionCount: sql<number>`(select count(*)::int from ${sections} where ${sections.academicYearId} = ${academicYears.id})`,
    })
    .from(academicYears);

export const toYearOut = (r: Awaited<ReturnType<typeof listYears>>[number]) => ({
  id: r.id,
  name: r.name,
  startDate: r.startDate,
  endDate: r.endDate,
  isCurrent: r.isCurrent,
  termCount: r.termCount,
  sectionCount: r.sectionCount,
  createdAt: iso(r.createdAt),
});

export async function listYears(db: Executor) {
  return yearSelect(db).orderBy(sql`${academicYears.startDate} desc`);
}

export async function getYear(db: Executor, id: string) {
  const [row] = await yearSelect(db).where(eq(academicYears.id, id)).limit(1);
  if (!row) throw notFound('Academic year');
  return row;
}

export async function currentYear(db: Executor) {
  const [y] = await db.select().from(academicYears).where(eq(academicYears.isCurrent, true)).limit(1);
  return y ?? null;
}

async function assertYearDates(db: Executor, input: { name: string; startDate: string; endDate: string }, exceptId?: string) {
  if (input.startDate >= input.endDate) throw unprocessable('The year must end after it starts', 'INVALID_DATE_RANGE');
  const [dupe] = await db
    .select({ id: academicYears.id })
    .from(academicYears)
    .where(and(eq(academicYears.name, input.name), exceptId ? ne(academicYears.id, exceptId) : undefined))
    .limit(1);
  if (dupe) throw conflict(`An academic year named "${input.name}" already exists`, 'ACADEMIC_YEAR_EXISTS');
  const [overlap] = await db
    .select({ id: academicYears.id, name: academicYears.name })
    .from(academicYears)
    .where(and(sql`${academicYears.startDate} <= ${input.endDate}`, sql`${academicYears.endDate} >= ${input.startDate}`, exceptId ? ne(academicYears.id, exceptId) : undefined))
    .limit(1);
  if (overlap) throw conflict(`These dates overlap the academic year ${overlap.name}`, 'YEAR_OVERLAP');
}

export async function createYear(tx: Executor, actor: AuditActor, input: Body<typeof academicYearCreateBody>) {
  await assertYearDates(tx, input);
  const [existingCurrent] = await tx.select({ id: academicYears.id }).from(academicYears).where(eq(academicYears.isCurrent, true)).limit(1);
  const makeCurrent = input.makeCurrent === true || !existingCurrent;
  if (makeCurrent && existingCurrent) await tx.update(academicYears).set({ isCurrent: false }).where(eq(academicYears.isCurrent, true));
  const [row] = await tx.insert(academicYears).values({ name: input.name, startDate: input.startDate, endDate: input.endDate, isCurrent: makeCurrent }).returning();
  await audit(tx, actor, { action: 'academic_year.create', entity: 'academic_year', entityId: row!.id, summary: `Created academic year ${row!.name}`, after: { name: row!.name, startDate: row!.startDate, endDate: row!.endDate, isCurrent: row!.isCurrent } });
  return { id: row!.id, switchedCurrent: makeCurrent };
}

export async function updateYear(tx: Executor, actor: AuditActor, id: string, patch: Body<typeof academicYearUpdateBody>) {
  const [before] = await tx.select().from(academicYears).where(eq(academicYears.id, id)).limit(1).for('update');
  if (!before) throw notFound('Academic year');
  const next = { name: patch.name ?? before.name, startDate: patch.startDate ?? before.startDate, endDate: patch.endDate ?? before.endDate };
  await assertYearDates(tx, next, id);
  const [outside] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(terms)
    .where(and(eq(terms.academicYearId, id), sql`(${terms.startDate} < ${next.startDate} or ${terms.endDate} > ${next.endDate})`));
  if (outside && outside.n > 0) throw unprocessable('Some terms fall outside the new dates; adjust the terms first', 'TERMS_OUT_OF_RANGE');
  await tx.update(academicYears).set(next).where(eq(academicYears.id, id));
  await audit(tx, actor, { action: 'academic_year.update', entity: 'academic_year', entityId: id, summary: `Updated academic year ${next.name}`, before: { name: before.name, startDate: before.startDate, endDate: before.endDate }, after: next });
}

/** Make `id` the one current year. Returns false when it already was (no-op). */
export async function setCurrentYear(tx: Executor, actor: AuditActor, id: string): Promise<boolean> {
  const [target] = await tx.select().from(academicYears).where(eq(academicYears.id, id)).limit(1).for('update');
  if (!target) throw notFound('Academic year');
  if (target.isCurrent) return false;
  const [prev] = await tx.select({ id: academicYears.id, name: academicYears.name }).from(academicYears).where(eq(academicYears.isCurrent, true)).limit(1);
  // the partial unique index allows exactly one current row, so clear the old one first
  await tx.update(academicYears).set({ isCurrent: false }).where(eq(academicYears.isCurrent, true));
  await tx.update(academicYears).set({ isCurrent: true }).where(eq(academicYears.id, id));
  await audit(tx, actor, { action: 'academic_year.set_current', entity: 'academic_year', entityId: id, summary: `Current academic year is now ${target.name}`, before: { current: prev ?? null }, after: { current: { id, name: target.name } } });
  return true;
}

export async function deleteYear(tx: Executor, actor: AuditActor, id: string) {
  const [y] = await tx.select().from(academicYears).where(eq(academicYears.id, id)).limit(1).for('update');
  if (!y) throw notFound('Academic year');
  if (y.isCurrent) throw conflict('The current academic year cannot be deleted', 'YEAR_IS_CURRENT');
  const [[sec], [enr]] = await Promise.all([
    tx.select({ n: sql<number>`count(*)::int` }).from(sections).where(eq(sections.academicYearId, id)),
    tx.select({ n: sql<number>`count(*)::int` }).from(enrollments).where(eq(enrollments.academicYearId, id)),
  ]);
  if ((sec?.n ?? 0) > 0 || (enr?.n ?? 0) > 0) throw conflict('This year already has sections or enrolments, so it cannot be deleted', 'YEAR_IN_USE');
  await tx.delete(academicYears).where(eq(academicYears.id, id));
  await audit(tx, actor, { action: 'academic_year.delete', entity: 'academic_year', entityId: id, summary: `Deleted academic year ${y.name}`, before: { name: y.name, startDate: y.startDate, endDate: y.endDate } });
}

/** Create the next year's sections from an earlier year (skips grade+name pairs that already exist). */
export async function copySections(tx: Executor, actor: AuditActor, toYearId: string, input: Body<typeof copySectionsBody>) {
  if (input.fromYearId === toYearId) throw unprocessable('Pick a different year to copy from', 'SAME_YEAR');
  const [[to], [from]] = await Promise.all([tx.select().from(academicYears).where(eq(academicYears.id, toYearId)).limit(1), tx.select().from(academicYears).where(eq(academicYears.id, input.fromYearId)).limit(1)]);
  if (!to || !from) throw notFound('Academic year');
  const source = await tx.select().from(sections).where(eq(sections.academicYearId, from.id)).orderBy(asc(sections.name));
  const existing = await tx.select({ gradeId: sections.gradeId, name: sections.name }).from(sections).where(eq(sections.academicYearId, to.id));
  const have = new Set(existing.map((e) => `${e.gradeId}:${e.name.toLowerCase()}`));
  const toCreate = source.filter((s) => !have.has(`${s.gradeId}:${s.name.toLowerCase()}`));
  const created: { id: string; sourceId: string }[] = [];
  for (let i = 0; i < toCreate.length; i += 500) {
    const chunk = toCreate.slice(i, i + 500);
    const rows = await tx
      .insert(sections)
      .values(chunk.map((s) => ({ gradeId: s.gradeId, academicYearId: to.id, name: s.name, room: s.room, capacity: s.capacity, classTeacherId: input.copyClassTeachers ? s.classTeacherId : null })))
      .returning({ id: sections.id, gradeId: sections.gradeId, name: sections.name });
    const byKey = new Map(chunk.map((s) => [`${s.gradeId}:${s.name}`, s.id]));
    for (const r of rows) created.push({ id: r.id, sourceId: byKey.get(`${r.gradeId}:${r.name}`)! });
  }
  let assignmentsCopied = 0;
  if (input.copyTeachingAssignments && created.length) {
    const src = await tx.select().from(teachingAssignments).where(inArray(teachingAssignments.sectionId, created.map((c) => c.sourceId)));
    const newBySource = new Map(created.map((c) => [c.sourceId, c.id]));
    const rows = src.map((a) => ({ sectionId: newBySource.get(a.sectionId)!, subjectId: a.subjectId, staffId: a.staffId }));
    for (let i = 0; i < rows.length; i += 500) await tx.insert(teachingAssignments).values(rows.slice(i, i + 500));
    assignmentsCopied = rows.length;
  }
  const result = { created: created.length, skipped: source.length - toCreate.length, assignmentsCopied };
  await audit(tx, actor, { action: 'academic_year.copy_sections', entity: 'academic_year', entityId: to.id, summary: `Copied ${result.created} sections from ${from.name} to ${to.name}`, after: { fromYear: from.name, ...result, copyClassTeachers: input.copyClassTeachers, copyTeachingAssignments: input.copyTeachingAssignments } });
  return { result, targetIsCurrent: to.isCurrent };
}

// ───────────────────────────────────────────────────────────────────────────────────────────────
// Terms
// ───────────────────────────────────────────────────────────────────────────────────────────────

export const toTermOut = (t: typeof terms.$inferSelect) => ({ id: t.id, academicYearId: t.academicYearId, name: t.name, ordinal: t.ordinal, startDate: t.startDate, endDate: t.endDate });

export async function listTerms(db: Executor, yearId: string) {
  const [y] = await db.select({ id: academicYears.id }).from(academicYears).where(eq(academicYears.id, yearId)).limit(1);
  if (!y) throw notFound('Academic year');
  return db.select().from(terms).where(eq(terms.academicYearId, yearId)).orderBy(asc(terms.ordinal));
}

async function assertTerm(db: Executor, year: typeof academicYears.$inferSelect, t: { ordinal: number; startDate: string; endDate: string }, exceptId?: string) {
  if (t.startDate >= t.endDate) throw unprocessable('The term must end after it starts', 'INVALID_DATE_RANGE');
  if (t.startDate < year.startDate || t.endDate > year.endDate) throw unprocessable(`The term must fall within ${year.name} (${year.startDate} to ${year.endDate})`, 'TERM_OUT_OF_RANGE');
  const others = await db.select().from(terms).where(and(eq(terms.academicYearId, year.id), exceptId ? ne(terms.id, exceptId) : undefined));
  if (others.some((o) => o.ordinal === t.ordinal)) throw conflict(`Term number ${t.ordinal} already exists in ${year.name}`, 'TERM_ORDINAL_EXISTS');
  const clash = others.find((o) => o.startDate <= t.endDate && o.endDate >= t.startDate);
  if (clash) throw conflict(`These dates overlap ${clash.name}`, 'TERM_OVERLAP');
}

export async function createTerm(tx: Executor, actor: AuditActor, yearId: string, input: Body<typeof termCreateBody>) {
  const [year] = await tx.select().from(academicYears).where(eq(academicYears.id, yearId)).limit(1).for('update');
  if (!year) throw notFound('Academic year');
  let ordinal = input.ordinal;
  if (ordinal == null) {
    const [m] = await tx.select({ m: sql<number>`coalesce(max(${terms.ordinal}), 0)::int` }).from(terms).where(eq(terms.academicYearId, yearId));
    ordinal = (m?.m ?? 0) + 1;
  }
  await assertTerm(tx, year, { ordinal, startDate: input.startDate, endDate: input.endDate });
  const [row] = await tx.insert(terms).values({ academicYearId: yearId, name: input.name, ordinal, startDate: input.startDate, endDate: input.endDate }).returning();
  await audit(tx, actor, { action: 'term.create', entity: 'term', entityId: row!.id, summary: `Created ${row!.name} in ${year.name}`, after: toTermOut(row!) });
  return row!;
}

export async function updateTerm(tx: Executor, actor: AuditActor, id: string, patch: Body<typeof termUpdateBody>) {
  const [before] = await tx.select().from(terms).where(eq(terms.id, id)).limit(1).for('update');
  if (!before) throw notFound('Term');
  const [year] = await tx.select().from(academicYears).where(eq(academicYears.id, before.academicYearId)).limit(1);
  const next = { name: patch.name ?? before.name, ordinal: patch.ordinal ?? before.ordinal, startDate: patch.startDate ?? before.startDate, endDate: patch.endDate ?? before.endDate };
  await assertTerm(tx, year!, next, id);
  const [row] = await tx.update(terms).set(next).where(eq(terms.id, id)).returning();
  await audit(tx, actor, { action: 'term.update', entity: 'term', entityId: id, before: toTermOut(before), after: toTermOut(row!) });
  return row!;
}

export async function deleteTerm(tx: Executor, actor: AuditActor, id: string) {
  const [before] = await tx.select().from(terms).where(eq(terms.id, id)).limit(1);
  if (!before) throw notFound('Term');
  await tx.delete(terms).where(eq(terms.id, id));
  await audit(tx, actor, { action: 'term.delete', entity: 'term', entityId: id, before: toTermOut(before) });
}

// ───────────────────────────────────────────────────────────────────────────────────────────────
// Grades
// ───────────────────────────────────────────────────────────────────────────────────────────────

export const toGradeOut = (g: typeof grades.$inferSelect) => ({ id: g.id, name: g.name, ordinal: g.ordinal, isActive: g.isActive });

export const listGrades = (db: Executor) => db.select().from(grades).orderBy(asc(grades.ordinal), asc(grades.name));

async function assertGradeFree(db: Executor, name: string, ordinal: number, exceptId?: string) {
  const rows = await db
    .select({ id: grades.id, name: grades.name, ordinal: grades.ordinal })
    .from(grades)
    .where(and(sql`(lower(${grades.name}) = lower(${name}) or ${grades.ordinal} = ${ordinal})`, exceptId ? ne(grades.id, exceptId) : undefined))
    .limit(2);
  for (const r of rows) {
    if (r.name.toLowerCase() === name.toLowerCase()) throw conflict(`A grade named "${name}" already exists`, 'GRADE_EXISTS');
    if (r.ordinal === ordinal) throw conflict(`Grade "${r.name}" already uses position ${ordinal}`, 'GRADE_ORDINAL_EXISTS');
  }
}

export async function createGrade(tx: Executor, actor: AuditActor, input: Body<typeof gradeCreateBody>) {
  await assertGradeFree(tx, input.name, input.ordinal);
  const [row] = await tx.insert(grades).values({ name: input.name, ordinal: input.ordinal, isActive: input.isActive ?? true }).returning();
  await audit(tx, actor, { action: 'grade.create', entity: 'grade', entityId: row!.id, summary: `Created grade ${row!.name}`, after: toGradeOut(row!) });
  return row!;
}

export async function updateGrade(tx: Executor, actor: AuditActor, id: string, patch: Body<typeof gradeUpdateBody>) {
  const [before] = await tx.select().from(grades).where(eq(grades.id, id)).limit(1).for('update');
  if (!before) throw notFound('Grade');
  const next = { name: patch.name ?? before.name, ordinal: patch.ordinal ?? before.ordinal, isActive: patch.isActive ?? before.isActive };
  await assertGradeFree(tx, next.name, next.ordinal, id);
  const [row] = await tx.update(grades).set(next).where(eq(grades.id, id)).returning();
  await audit(tx, actor, { action: 'grade.update', entity: 'grade', entityId: id, before: toGradeOut(before), after: toGradeOut(row!) });
  return row!;
}

export async function deleteGrade(tx: Executor, actor: AuditActor, id: string) {
  const [before] = await tx.select().from(grades).where(eq(grades.id, id)).limit(1).for('update');
  if (!before) throw notFound('Grade');
  const [[sec], [enr], [stu]] = await Promise.all([
    tx.select({ n: sql<number>`count(*)::int` }).from(sections).where(eq(sections.gradeId, id)),
    tx.select({ n: sql<number>`count(*)::int` }).from(enrollments).where(eq(enrollments.gradeId, id)),
    tx.select({ n: sql<number>`count(*)::int` }).from(students).where(eq(students.currentGradeId, id)),
  ]);
  if ((sec?.n ?? 0) + (enr?.n ?? 0) + (stu?.n ?? 0) > 0) throw conflict('This grade has sections or students, so it cannot be deleted. Mark it inactive instead.', 'GRADE_IN_USE');
  await tx.delete(grades).where(eq(grades.id, id));
  await audit(tx, actor, { action: 'grade.delete', entity: 'grade', entityId: id, summary: `Deleted grade ${before.name}`, before: toGradeOut(before) });
}

// ───────────────────────────────────────────────────────────────────────────────────────────────
// Subjects
// ───────────────────────────────────────────────────────────────────────────────────────────────

export const toSubjectOut = (s: typeof subjects.$inferSelect) => ({ id: s.id, code: s.code, name: s.name, type: s.type, isActive: s.isActive });

export const listSubjects = (db: Executor) => db.select().from(subjects).orderBy(asc(subjects.name));

async function assertSubjectCode(db: Executor, code: string, exceptId?: string) {
  const [dupe] = await db
    .select({ id: subjects.id })
    .from(subjects)
    .where(and(sql`lower(${subjects.code}) = lower(${code})`, exceptId ? ne(subjects.id, exceptId) : undefined))
    .limit(1);
  if (dupe) throw conflict(`A subject with code "${code}" already exists`, 'SUBJECT_CODE_EXISTS');
}

export async function createSubject(tx: Executor, actor: AuditActor, input: Body<typeof subjectCreateBody>) {
  const code = input.code.toUpperCase();
  await assertSubjectCode(tx, code);
  const [row] = await tx.insert(subjects).values({ code, name: input.name, type: input.type ?? 'core', isActive: input.isActive ?? true }).returning();
  await audit(tx, actor, { action: 'subject.create', entity: 'subject', entityId: row!.id, summary: `Created subject ${row!.name}`, after: toSubjectOut(row!) });
  return row!;
}

export async function updateSubject(tx: Executor, actor: AuditActor, id: string, patch: Body<typeof subjectUpdateBody>) {
  const [before] = await tx.select().from(subjects).where(eq(subjects.id, id)).limit(1).for('update');
  if (!before) throw notFound('Subject');
  const next = { code: patch.code ? patch.code.toUpperCase() : before.code, name: patch.name ?? before.name, type: patch.type ?? before.type, isActive: patch.isActive ?? before.isActive };
  await assertSubjectCode(tx, next.code, id);
  const [row] = await tx.update(subjects).set(next).where(eq(subjects.id, id)).returning();
  await audit(tx, actor, { action: 'subject.update', entity: 'subject', entityId: id, before: toSubjectOut(before), after: toSubjectOut(row!) });
  return row!;
}

export async function deleteSubject(tx: Executor, actor: AuditActor, id: string) {
  const [before] = await tx.select().from(subjects).where(eq(subjects.id, id)).limit(1).for('update');
  if (!before) throw notFound('Subject');
  const [[off], [asg]] = await Promise.all([
    tx.select({ n: sql<number>`count(*)::int` }).from(gradeSubjects).where(eq(gradeSubjects.subjectId, id)),
    tx.select({ n: sql<number>`count(*)::int` }).from(teachingAssignments).where(eq(teachingAssignments.subjectId, id)),
  ]);
  if ((off?.n ?? 0) + (asg?.n ?? 0) > 0) throw conflict('This subject is offered by a grade or assigned to a teacher, so it cannot be deleted. Mark it inactive instead.', 'SUBJECT_IN_USE');
  await tx.delete(subjects).where(eq(subjects.id, id));
  await audit(tx, actor, { action: 'subject.delete', entity: 'subject', entityId: id, summary: `Deleted subject ${before.name}`, before: toSubjectOut(before) });
}

// ───────────────────────────────────────────────────────────────────────────────────────────────
// Grade ↔ subject offering
// ───────────────────────────────────────────────────────────────────────────────────────────────

export async function listGradeSubjects(db: Executor, gradeId?: string) {
  return db
    .select({ gradeId: gradeSubjects.gradeId, subjectId: gradeSubjects.subjectId, subjectCode: subjects.code, subjectName: subjects.name, periodsPerWeek: gradeSubjects.periodsPerWeek })
    .from(gradeSubjects)
    .innerJoin(subjects, eq(subjects.id, gradeSubjects.subjectId))
    .innerJoin(grades, eq(grades.id, gradeSubjects.gradeId))
    .where(gradeId ? eq(gradeSubjects.gradeId, gradeId) : undefined)
    .orderBy(asc(grades.ordinal), asc(subjects.name));
}

export async function putGradeSubjects(tx: Executor, actor: AuditActor, gradeId: string, items: { subjectId: string; periodsPerWeek: number }[]) {
  const [grade] = await tx.select().from(grades).where(eq(grades.id, gradeId)).limit(1).for('update');
  if (!grade) throw notFound('Grade');
  const ids = items.map((i) => i.subjectId);
  if (new Set(ids).size !== ids.length) throw unprocessable('A subject is listed twice', 'DUPLICATE_SUBJECT');
  if (ids.length) {
    const found = await tx.select({ id: subjects.id }).from(subjects).where(inArray(subjects.id, ids));
    if (found.length !== ids.length) throw unprocessable('One or more subjects do not exist', 'SUBJECT_NOT_FOUND');
  }
  const before = await listGradeSubjects(tx, gradeId);
  const removed = before.filter((b) => !ids.includes(b.subjectId)).map((b) => b.subjectId);
  if (removed.length) {
    // a subject cannot stop being offered while a teacher is still assigned to it in one of the grade's sections
    const [inUse] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(teachingAssignments)
      .innerJoin(sections, eq(sections.id, teachingAssignments.sectionId))
      .where(and(eq(sections.gradeId, gradeId), inArray(teachingAssignments.subjectId, removed)));
    if ((inUse?.n ?? 0) > 0) throw conflict('Some removed subjects still have teachers assigned in this grade’s sections; remove those assignments first', 'OFFERING_IN_USE');
    await tx.delete(gradeSubjects).where(and(eq(gradeSubjects.gradeId, gradeId), inArray(gradeSubjects.subjectId, removed)));
  }
  if (items.length) {
    await tx
      .insert(gradeSubjects)
      .values(items.map((i) => ({ gradeId, subjectId: i.subjectId, periodsPerWeek: i.periodsPerWeek })))
      .onConflictDoUpdate({ target: [gradeSubjects.gradeId, gradeSubjects.subjectId], set: { periodsPerWeek: sql`excluded.periods_per_week` } });
  }
  const after = await listGradeSubjects(tx, gradeId);
  await audit(tx, actor, {
    action: 'grade_subjects.update',
    entity: 'grade',
    entityId: gradeId,
    summary: `Updated subjects offered by ${grade.name}`,
    before: before.map((b) => ({ subject: b.subjectCode, periodsPerWeek: b.periodsPerWeek })),
    after: after.map((b) => ({ subject: b.subjectCode, periodsPerWeek: b.periodsPerWeek })),
  });
  return after;
}

// ───────────────────────────────────────────────────────────────────────────────────────────────
// Periods
// ───────────────────────────────────────────────────────────────────────────────────────────────

export const toPeriodOut = (p: typeof periods.$inferSelect) => ({ id: p.id, name: p.name, ordinal: p.ordinal, startTime: hhmm(p.startTime), endTime: hhmm(p.endTime), isBreak: p.isBreak });

export const listPeriods = (db: Executor) => db.select().from(periods).orderBy(asc(periods.ordinal));

async function assertPeriod(db: Executor, p: { ordinal: number; startTime: string; endTime: string }, exceptId?: string) {
  if (p.startTime >= p.endTime) throw unprocessable('A period must end after it starts', 'INVALID_TIME_RANGE');
  const others = await db.select().from(periods).where(exceptId ? ne(periods.id, exceptId) : undefined);
  if (others.some((o) => o.ordinal === p.ordinal)) throw conflict(`Period number ${p.ordinal} already exists`, 'PERIOD_ORDINAL_EXISTS');
  const clash = others.find((o) => hhmm(o.startTime) < p.endTime && hhmm(o.endTime) > p.startTime);
  if (clash) throw conflict(`These times overlap "${clash.name}"`, 'PERIOD_OVERLAP');
}

export async function createPeriod(tx: Executor, actor: AuditActor, input: Body<typeof periodCreateBody>) {
  await assertPeriod(tx, input);
  const [row] = await tx.insert(periods).values({ name: input.name, ordinal: input.ordinal, startTime: input.startTime, endTime: input.endTime, isBreak: input.isBreak ?? false }).returning();
  await audit(tx, actor, { action: 'period.create', entity: 'period', entityId: row!.id, after: toPeriodOut(row!) });
  return row!;
}

export async function updatePeriod(tx: Executor, actor: AuditActor, id: string, patch: Body<typeof periodUpdateBody>) {
  const [before] = await tx.select().from(periods).where(eq(periods.id, id)).limit(1).for('update');
  if (!before) throw notFound('Period');
  const next = { name: patch.name ?? before.name, ordinal: patch.ordinal ?? before.ordinal, startTime: patch.startTime ?? hhmm(before.startTime), endTime: patch.endTime ?? hhmm(before.endTime), isBreak: patch.isBreak ?? before.isBreak };
  await assertPeriod(tx, next, id);
  const [row] = await tx.update(periods).set(next).where(eq(periods.id, id)).returning();
  await audit(tx, actor, { action: 'period.update', entity: 'period', entityId: id, before: toPeriodOut(before), after: toPeriodOut(row!) });
  return row!;
}

export async function deletePeriod(tx: Executor, actor: AuditActor, id: string) {
  const [before] = await tx.select().from(periods).where(eq(periods.id, id)).limit(1).for('update');
  if (!before) throw notFound('Period');
  const [[slot], [att]] = await Promise.all([
    tx.select({ n: sql<number>`count(*)::int` }).from(timetableSlots).where(eq(timetableSlots.periodId, id)),
    tx.select({ n: sql<number>`count(*)::int` }).from(attendanceSessions).where(eq(attendanceSessions.periodId, id)),
  ]);
  if ((slot?.n ?? 0) + (att?.n ?? 0) > 0) throw conflict('This period is used by the timetable or by attendance records, so it cannot be deleted', 'PERIOD_IN_USE');
  await tx.delete(periods).where(eq(periods.id, id));
  await audit(tx, actor, { action: 'period.delete', entity: 'period', entityId: id, before: toPeriodOut(before) });
}

// ───────────────────────────────────────────────────────────────────────────────────────────────
// Overview
// ───────────────────────────────────────────────────────────────────────────────────────────────

export async function overview(db: Executor, p: Principal) {
  const cur = await currentYear(db);
  const curId = cur?.id ?? null;
  const studentsVisible = p.scope('students:view') ? studentScope(p, 'students:view') : sql`false`;
  const canSeeStaff = p.can('staff:view', 'school');
  const r = await db.execute(sql`
    select
      (select count(*)::int from ${academicYears}) as years,
      (select count(*)::int from ${terms} where ${terms.academicYearId} = ${curId}) as terms,
      (select count(*)::int from ${grades} where ${grades.isActive}) as grades,
      (select count(*)::int from ${sections} where ${sections.academicYearId} = ${curId}) as sections,
      (select count(*)::int from ${sections} where ${sections.academicYearId} = ${curId} and ${sections.classTeacherId} is null) as sections_without_ct,
      (select count(*)::int from ${subjects} where ${subjects.isActive}) as subjects,
      (select count(*)::int from ${teachingAssignments} ta inner join ${sections} s on s.id = ta.section_id where s.academic_year_id = ${curId}) as assignments,
      (select count(*)::int from ${periods} where not ${periods.isBreak}) as periods,
      (select count(*)::int from ${students} where ${students.status} = 'active' and ${students.archivedAt} is null and ${studentsVisible}) as students,
      ${canSeeStaff ? sql`(select count(*)::int from ${staff} where ${staff.status} = 'active')` : sql`null`} as staff
  `);
  const row = r.rows[0] as Record<string, number | null>;
  return {
    currentYear: cur ? { id: cur.id, name: cur.name, startDate: cur.startDate, endDate: cur.endDate } : null,
    counts: {
      years: row.years ?? 0,
      terms: row.terms ?? 0,
      grades: row.grades ?? 0,
      sections: row.sections ?? 0,
      sectionsWithoutClassTeacher: row.sections_without_ct ?? 0,
      subjects: row.subjects ?? 0,
      teachingAssignments: row.assignments ?? 0,
      periods: row.periods ?? 0,
      students: row.students ?? 0,
      staff: canSeeStaff ? (row.staff ?? 0) : null,
    },
  };
}

