import { and, asc, desc, eq, inArray, isNotNull, notInArray, or, sql, type SQL } from 'drizzle-orm';
import type { MarkSheetStatus, SheetDetailOut, SheetOut } from '@school-sync/shared';
import { z } from 'zod';
import { markEntriesBody, sheetListQuery } from '@school-sync/shared';
import { audit, type AuditActor } from '../../core/audit';
import { AppError, conflict, forbidden, notFound, unprocessable } from '../../core/errors';

const unproc = (message: string, code: string, extra?: Record<string, unknown>) => new AppError(422, code, message, extra);
import { pageArgs, paged as pagedResult } from '../../core/http';
import { notify } from '../../core/notify';
import type { Principal } from '../../core/rbac/principal';
import { studentIdScope } from '../../core/rbac/scope';
import { getSetting } from '../../core/settings';
import type { Executor } from '../../core/tenancy/pools';
import type { TenantInfo } from '../../core/tenancy/registry';
import { examPapers, exams, grades, markSheets, marks, sections, staff, students, subjects, teachingAssignments } from '../../db/tenant/schema';
import { recipientsForStudents, usersWithPermission } from './common';
import { sheetScope } from './scope';

type EntryIn = z.infer<typeof markEntriesBody>['entries'][number];
export const ENROLLED = ['transferred', 'withdrawn', 'alumni'] as const;

const sheetCols = {
  sheet: markSheets,
  examName: exams.name,
  examStatus: exams.status,
  passPercent: exams.passPercent,
  maxMarks: examPapers.maxMarks,
  passMarks: examPapers.passMarks,
  sectionName: sections.name,
  gradeId: sections.gradeId,
  gradeName: grades.name,
  subjectName: subjects.name,
  teacherName: sql<string | null>`(select nullif(concat_ws(' ', st.first_name, st.last_name), '') from ${teachingAssignments} ta join ${staff} st on st.id = ta.staff_id where ta.section_id = ${markSheets.sectionId} and ta.subject_id = ${markSheets.subjectId} limit 1)`,
  studentCount: sql<number>`(select count(*)::int from ${students} s where s.current_section_id = ${markSheets.sectionId} and s.archived_at is null and s.status not in ('transferred','withdrawn','alumni'))`,
  enteredCount: sql<number>`(select count(*)::int from ${marks} m where m.sheet_id = ${markSheets.id} and (m.marks_obtained is not null or m.is_absent))`,
  absentCount: sql<number>`(select count(*)::int from ${marks} m where m.sheet_id = ${markSheets.id} and m.is_absent)`,
};

function baseQuery(db: Executor) {
  return db
    .select(sheetCols)
    .from(markSheets)
    .innerJoin(exams, eq(exams.id, markSheets.examId))
    .innerJoin(examPapers, eq(examPapers.id, markSheets.paperId))
    .innerJoin(sections, eq(sections.id, markSheets.sectionId))
    .innerJoin(grades, eq(grades.id, sections.gradeId))
    .innerJoin(subjects, eq(subjects.id, markSheets.subjectId));
}
type SheetRow = Awaited<ReturnType<typeof baseQuery>>[number];

const toSheetOut = (r: SheetRow): SheetOut => ({
  id: r.sheet.id,
  examId: r.sheet.examId,
  examName: r.examName,
  paperId: r.sheet.paperId,
  sectionId: r.sheet.sectionId,
  sectionName: r.sectionName,
  gradeId: r.gradeId,
  gradeName: r.gradeName,
  subjectId: r.sheet.subjectId,
  subjectName: r.subjectName,
  status: r.sheet.status,
  maxMarks: r.maxMarks,
  passMarks: r.passMarks,
  teacherName: r.teacherName,
  studentCount: r.studentCount,
  enteredCount: r.enteredCount,
  absentCount: r.absentCount,
  submittedAt: r.sheet.submittedAt?.toISOString() ?? null,
  reviewedAt: r.sheet.reviewedAt?.toISOString() ?? null,
  publishedAt: r.sheet.publishedAt?.toISOString() ?? null,
  returnNote: r.sheet.returnNote,
});

// ── reading ─────────────────────────────────────────────────────────────────────────────────

export async function listSheets(db: Executor, p: Principal, q: z.infer<typeof sheetListQuery>) {
  const mine: SQL | undefined = q.mine
    ? p.teaching.length
      ? sql`(${markSheets.sectionId}, ${markSheets.subjectId}) in (${sql.join(p.teaching.map((t) => sql`(${t.sectionId}::uuid, ${t.subjectId}::uuid)`), sql`, `)})`
      : sql`false`
    : undefined;
  const where = and(
    sheetScope(p, 'marks:view', markSheets),
    q.examId ? eq(markSheets.examId, q.examId) : undefined,
    q.sectionId ? eq(markSheets.sectionId, q.sectionId) : undefined,
    q.subjectId ? eq(markSheets.subjectId, q.subjectId) : undefined,
    q.status ? eq(markSheets.status, q.status) : undefined,
    mine,
  );
  const [rows, [cnt]] = await Promise.all([
    baseQuery(db).where(where).orderBy(desc(exams.startDate), asc(grades.ordinal), asc(sections.name), asc(subjects.name)).limit(pageArgs(q).limit).offset(pageArgs(q).offset),
    db.select({ n: sql<number>`count(*)::int` }).from(markSheets).where(where) as Promise<{ n: number }[]>,
  ]);
  return pagedResult(rows.map(toSheetOut), cnt?.n ?? 0, q);
}

const canEnterMarks = (p: Principal, r: Pick<SheetRow, 'sheet' | 'examStatus'>): boolean =>
  p.can('marks:edit', 'assigned') && (p.scope('marks:edit') === 'school' || p.teaches(r.sheet.sectionId, r.sheet.subjectId)) && (r.sheet.status === 'draft' || r.sheet.status === 'returned') && r.examStatus !== 'draft' && r.examStatus !== 'scheduled';

/**
 * One sheet with its entries. Staff see every student of the section; students/parents (own/linked scope) reach
 * only PUBLISHED sheets and only their own / their children's entries — anything else answers 404.
 */
export async function getSheetDetail(db: Executor, p: Principal, id: string, opts: { authorised?: boolean } = {}): Promise<SheetDetailOut> {
  const [r] = await baseQuery(db)
    .where(and(eq(markSheets.id, id), opts.authorised ? undefined : sheetScope(p, 'marks:view', markSheets)))
    .limit(1);
  if (!r) throw notFound('Mark sheet');
  const entryScope = opts.authorised ? undefined : studentIdScope(p, 'marks:view', students.id);
  const rows = await db
    .select({
      studentId: students.id,
      admissionNo: students.admissionNo,
      first: students.firstName,
      last: students.lastName,
      rollNo: students.rollNo,
      marksObtained: marks.marksObtained,
      isAbsent: marks.isAbsent,
      remarks: marks.remarks,
      hasRow: marks.id,
    })
    .from(students)
    .leftJoin(marks, and(eq(marks.sheetId, id), eq(marks.studentId, students.id)))
    .where(
      and(
        entryScope,
        or(and(eq(students.currentSectionId, r.sheet.sectionId), sql`${students.archivedAt} is null`, notInArray(students.status, [...ENROLLED])), isNotNull(marks.id)),
      ),
    )
    .orderBy(asc(students.rollNo), asc(students.firstName));
  const scoped = p.scope('marks:view') === 'own' || p.scope('marks:view') === 'linked';
  const base = toSheetOut(r);
  return {
    ...base,
    ...(scoped ? { studentCount: rows.length, enteredCount: rows.filter((x) => x.hasRow).length, absentCount: rows.filter((x) => x.isAbsent).length } : {}),
    canEdit: canEnterMarks(p, r),
    entries: rows.map((x) => ({ studentId: x.studentId, admissionNo: x.admissionNo, name: [x.first, x.last].filter(Boolean).join(' '), rollNo: x.rollNo, marksObtained: x.marksObtained ?? null, isAbsent: x.isAbsent ?? false, remarks: x.remarks ?? null })),
  };
}

// ── internals ───────────────────────────────────────────────────────────────────────────────

/** Load + lock a sheet the caller may act on for `perm` (404 when out of scope). */
async function lockSheet(tx: Executor, p: Principal, perm: 'marks:edit' | 'marks:approve' | 'marks:publish', id: string) {
  const [lock] = await tx.select({ id: markSheets.id }).from(markSheets).where(and(eq(markSheets.id, id), sheetScope(p, perm, markSheets))).for('update').limit(1);
  if (!lock) throw notFound('Mark sheet');
  const [r] = await baseQuery(tx).where(eq(markSheets.id, id)).limit(1);
  return r!;
}

function assertSubjectTeacher(p: Principal, r: SheetRow) {
  if (p.scope('marks:edit') === 'school') return;
  if (!p.teaches(r.sheet.sectionId, r.sheet.subjectId)) throw forbidden('Only the subject teacher of this section can enter or submit these marks', 'NOT_SUBJECT_TEACHER');
}

function assertMarksOpen(r: SheetRow) {
  if (r.examStatus === 'draft' || r.examStatus === 'scheduled') throw conflict('Marks entry has not been opened for this exam yet', 'MARKS_ENTRY_NOT_OPEN');
}

async function sectionStudentIds(db: Executor, sectionId: string): Promise<string[]> {
  const rows = await db.select({ id: students.id }).from(students).where(and(eq(students.currentSectionId, sectionId), sql`${students.archivedAt} is null`, notInArray(students.status, [...ENROLLED])));
  return rows.map((x) => x.id);
}

/** Validate a batch of entries against the section roster and the paper's maximum. Returns the de-duplicated list. */
async function validateEntries(db: Executor, r: SheetRow, entries: EntryIn[], allowFormerStudents = false): Promise<EntryIn[]> {
  const seen = new Set<string>();
  for (const e of entries) {
    if (seen.has(e.studentId)) throw unprocessable('A student appears more than once in the request', 'DUPLICATE_ENTRY');
    seen.add(e.studentId);
  }
  const roster = new Set(await sectionStudentIds(db, r.sheet.sectionId));
  if (allowFormerStudents) {
    const existing = await db.select({ s: marks.studentId }).from(marks).where(eq(marks.sheetId, r.sheet.id));
    for (const x of existing) roster.add(x.s);
  }
  const bad = entries.filter((e) => !roster.has(e.studentId));
  if (bad.length) throw unproc('Some students are not in this section', 'STUDENT_NOT_IN_SECTION', { studentIds: bad.map((b) => b.studentId) });
  const over = entries.filter((e) => e.marksObtained != null && e.marksObtained > r.maxMarks);
  if (over.length) throw unproc(`Marks cannot exceed the maximum of ${r.maxMarks}`, 'MARKS_EXCEED_MAX', { studentIds: over.map((o) => o.studentId), maxMarks: r.maxMarks });
  return entries;
}

type Snap = { marksObtained: number | null; isAbsent: boolean; remarks: string | null };
const snap = (m: { marksObtained: number | null; isAbsent: boolean; remarks: string | null } | undefined): Snap | null => (m ? { marksObtained: m.marksObtained, isAbsent: m.isAbsent, remarks: m.remarks } : null);

/** Upsert the entries; returns the before/after of the rows that actually changed. */
async function upsertEntries(tx: Executor, sheetId: string, userId: string | null | undefined, entries: EntryIn[]) {
  const ids = entries.map((e) => e.studentId);
  const existing = await tx.select().from(marks).where(and(eq(marks.sheetId, sheetId), inArray(marks.studentId, ids)));
  const was = new Map(existing.map((m) => [m.studentId, m]));
  const changed: { studentId: string; before: Snap | null; after: Snap }[] = [];
  const rows: (typeof marks.$inferInsert)[] = [];
  for (const e of entries) {
    const next: Snap = { marksObtained: e.isAbsent ? null : (e.marksObtained ?? null), isAbsent: e.isAbsent, remarks: e.remarks?.trim() || null };
    const prev = snap(was.get(e.studentId));
    if (prev && prev.marksObtained === next.marksObtained && prev.isAbsent === next.isAbsent && prev.remarks === next.remarks) continue;
    changed.push({ studentId: e.studentId, before: prev, after: next });
    rows.push({ sheetId, studentId: e.studentId, marksObtained: next.marksObtained, isAbsent: next.isAbsent, remarks: next.remarks, enteredBy: userId ?? null });
  }
  for (let i = 0; i < rows.length; i += 500) {
    await tx
      .insert(marks)
      .values(rows.slice(i, i + 500))
      .onConflictDoUpdate({ target: [marks.sheetId, marks.studentId], set: { marksObtained: sql`excluded.marks_obtained`, isAbsent: sql`excluded.is_absent`, remarks: sql`excluded.remarks`, enteredBy: sql`excluded.entered_by`, updatedAt: new Date() } });
  }
  return changed;
}

const label = (r: SheetRow) => `${r.examName} · ${r.gradeName} ${r.sectionName} · ${r.subjectName}`;

// ── teacher: enter + submit ─────────────────────────────────────────────────────────────────

export async function saveEntries(tx: Executor, p: Principal, actor: AuditActor, id: string, entries: EntryIn[]): Promise<SheetDetailOut> {
  const r = await lockSheet(tx, p, 'marks:edit', id);
  assertSubjectTeacher(p, r);
  assertMarksOpen(r);
  if (r.sheet.status !== 'draft' && r.sheet.status !== 'returned') {
    throw conflict(r.sheet.status === 'published' ? 'Published marks can only be corrected through the correction workflow' : `This sheet is ${r.sheet.status} and can no longer be edited`, 'SHEET_LOCKED');
  }
  await validateEntries(tx, r, entries);
  const changed = await upsertEntries(tx, id, actor.userId, entries);
  if (changed.length) await audit(tx, actor, { action: 'marks.entry', entity: 'mark_sheet', entityId: id, summary: `${changed.length} entries on ${label(r)}`, before: changed.map((c) => ({ studentId: c.studentId, ...c.before })), after: changed.map((c) => ({ studentId: c.studentId, ...c.after })) });
  return getSheetDetail(tx, p, id, { authorised: true });
}

export async function submitSheet(tx: Executor, p: Principal, actor: AuditActor, id: string): Promise<{ sheet: SheetDetailOut; after: (db: Executor, tenant: TenantInfo) => Promise<void> }> {
  const r = await lockSheet(tx, p, 'marks:edit', id);
  assertSubjectTeacher(p, r);
  assertMarksOpen(r);
  if (r.sheet.status !== 'draft' && r.sheet.status !== 'returned') throw conflict(`This sheet is already ${r.sheet.status}`, 'INVALID_SHEET_STATE');
  const roster = await sectionStudentIds(tx, r.sheet.sectionId);
  if (!roster.length) throw unprocessable('This section has no students', 'EMPTY_SECTION');
  const filled = await tx.select({ s: marks.studentId }).from(marks).where(and(eq(marks.sheetId, id), or(isNotNull(marks.marksObtained), eq(marks.isAbsent, true))));
  const have = new Set(filled.map((f) => f.s));
  const missing = roster.filter((s) => !have.has(s));
  if (missing.length) throw unproc(`Marks are missing for ${missing.length} student(s). Enter marks or mark them absent before submitting.`, 'INCOMPLETE_SHEET', { missing: missing.length, studentIds: missing });

  const { requireApproval } = await getSetting(tx, 'exams');
  const now = new Date();
  // no approval step: the submitted sheet is ready to publish; an authorised publisher publishes it right away
  const directPublish = !requireApproval && p.can('marks:publish', 'school');
  const next: MarkSheetStatus = requireApproval ? 'submitted' : 'approved';
  await tx.update(markSheets).set({ status: next, submittedBy: actor.userId ?? null, submittedAt: now, returnNote: null, ...(requireApproval ? {} : { reviewedAt: now }) }).where(eq(markSheets.id, id));
  await audit(tx, actor, { action: 'marks.submit', entity: 'mark_sheet', entityId: id, summary: label(r), before: { status: r.sheet.status }, after: { status: next, requireApproval } });
  let newSection = false;
  if (directPublish) newSection = (await publishInTx(tx, actor, [id], { fromStatuses: ['approved'] })).newSections.includes(r.sheet.sectionId);

  const after = async (db: Executor, tenant: TenantInfo) => {
    if (requireApproval) {
      const reviewers = await usersWithPermission(db, 'marks:approve');
      await notify(db, tenant, { userIds: reviewers.filter((u) => u !== actor.userId), type: 'marks.submitted', title: 'Mark sheet submitted for review', body: label(r), data: { route: `/marks/sheets/${id}`, sheetId: id, examId: r.sheet.examId } });
    }
    if (directPublish && newSection) await notifyPublished(db, tenant, r.sheet.examId, [r.sheet.sectionId], r.examName);
  };
  return { sheet: await getSheetDetail(tx, p, id, { authorised: true }), after };
}

// ── reviewer: approve / return ──────────────────────────────────────────────────────────────

export async function approveSheet(tx: Executor, p: Principal, actor: AuditActor, id: string, note?: string): Promise<SheetDetailOut> {
  const r = await lockSheet(tx, p, 'marks:approve', id);
  if (r.sheet.status !== 'submitted') throw conflict(`Only a submitted sheet can be approved (this one is ${r.sheet.status})`, 'INVALID_SHEET_STATE');
  await tx.update(markSheets).set({ status: 'approved', reviewedBy: actor.userId ?? null, reviewedAt: new Date(), returnNote: null }).where(eq(markSheets.id, id));
  await audit(tx, actor, { action: 'marks.approve', entity: 'mark_sheet', entityId: id, summary: label(r), before: { status: 'submitted' }, after: { status: 'approved', note: note ?? null } });
  return getSheetDetail(tx, p, id, { authorised: true });
}

export async function returnSheet(tx: Executor, p: Principal, actor: AuditActor, id: string, note: string): Promise<{ sheet: SheetDetailOut; after: (db: Executor, tenant: TenantInfo) => Promise<void> }> {
  const r = await lockSheet(tx, p, 'marks:approve', id);
  if (r.sheet.status !== 'submitted' && r.sheet.status !== 'approved') throw conflict(`Only a submitted or approved sheet can be returned (this one is ${r.sheet.status})`, 'INVALID_SHEET_STATE');
  await tx.update(markSheets).set({ status: 'returned', reviewedBy: actor.userId ?? null, reviewedAt: new Date(), returnNote: note }).where(eq(markSheets.id, id));
  await audit(tx, actor, { action: 'marks.return', entity: 'mark_sheet', entityId: id, summary: label(r), before: { status: r.sheet.status }, after: { status: 'returned', note } });
  const after = async (db: Executor, tenant: TenantInfo) => {
    const teachers = await db.select({ userId: staff.userId }).from(teachingAssignments).innerJoin(staff, eq(staff.id, teachingAssignments.staffId)).where(and(eq(teachingAssignments.sectionId, r.sheet.sectionId), eq(teachingAssignments.subjectId, r.sheet.subjectId)));
    const ids = teachers.map((t) => t.userId).filter((u): u is string => !!u);
    // also the person who submitted it, if different
    if (r.sheet.submittedBy) ids.push(r.sheet.submittedBy);
    await notify(db, tenant, { userIds: ids, type: 'marks.returned', title: 'Mark sheet returned for changes', body: `${label(r)}: ${note}`.slice(0, 300), data: { route: `/marks/sheets/${id}`, sheetId: id, examId: r.sheet.examId }, priority: 'high' });
  };
  return { sheet: await getSheetDetail(tx, p, id, { authorised: true }), after };
}

// ── publish ─────────────────────────────────────────────────────────────────────────────────

/**
 * Flip sheets to `published` inside the caller's transaction. Returns the sections that had NO published sheet for
 * the exam before (those get the "results available" notification once, not once per subject).
 */
export async function publishInTx(tx: Executor, actor: AuditActor, sheetIds: string[], opts: { fromStatuses: MarkSheetStatus[] }): Promise<{ published: string[]; newSections: string[] }> {
  if (!sheetIds.length) return { published: [], newSections: [] };
  const rows = await tx
    .select({ id: markSheets.id, examId: markSheets.examId, sectionId: markSheets.sectionId, subjectId: markSheets.subjectId, status: markSheets.status })
    .from(markSheets)
    .where(and(inArray(markSheets.id, sheetIds), inArray(markSheets.status, opts.fromStatuses)))
    .for('update');
  if (!rows.length) return { published: [], newSections: [] };
  const examIds = [...new Set(rows.map((r) => r.examId))];
  const alreadyOpen = await tx
    .selectDistinct({ examId: markSheets.examId, sectionId: markSheets.sectionId })
    .from(markSheets)
    .where(and(inArray(markSheets.examId, examIds), eq(markSheets.status, 'published')));
  const open = new Set(alreadyOpen.map((r) => `${r.examId}:${r.sectionId}`));
  const now = new Date();
  await tx.update(markSheets).set({ status: 'published', publishedBy: actor.userId ?? null, publishedAt: now, returnNote: null }).where(inArray(markSheets.id, rows.map((r) => r.id)));
  for (const r of rows) await audit(tx, actor, { action: 'marks.publish', entity: 'mark_sheet', entityId: r.id, before: { status: r.status }, after: { status: 'published' } });
  const newSections = [...new Set(rows.filter((r) => !open.has(`${r.examId}:${r.sectionId}`)).map((r) => r.sectionId))];
  return { published: rows.map((r) => r.id), newSections };
}

/** Tell students and their verified guardians that new results are available. Neutral wording, deep link only. */
export async function notifyPublished(db: Executor, tenant: TenantInfo, examId: string, sectionIds: string[], _examName?: string): Promise<void> {
  if (!sectionIds.length) return;
  const rows = await db
    .select({ id: students.id })
    .from(students)
    .where(and(inArray(students.currentSectionId, sectionIds), sql`${students.archivedAt} is null`, notInArray(students.status, [...ENROLLED])));
  const users = await recipientsForStudents(db, rows.map((r) => r.id));
  for (let i = 0; i < users.length; i += 1000) {
    await notify(db, tenant, { userIds: users.slice(i, i + 1000), type: 'marks.published', title: 'New results available', body: 'New exam results have been published.', data: { route: `/results/${examId}`, examId } });
  }
}

export async function publishSheet(tx: Executor, p: Principal, actor: AuditActor, id: string): Promise<{ sheet: SheetDetailOut; after: (db: Executor, tenant: TenantInfo) => Promise<void> }> {
  const r = await lockSheet(tx, p, 'marks:publish', id);
  const { requireApproval } = await getSetting(tx, 'exams');
  const from: MarkSheetStatus[] = requireApproval ? ['approved'] : ['approved', 'submitted'];
  if (!from.includes(r.sheet.status)) {
    throw conflict(r.sheet.status === 'published' ? 'This sheet is already published' : `A sheet must be approved before it is published (this one is ${r.sheet.status})`, r.sheet.status === 'published' ? 'ALREADY_PUBLISHED' : 'INVALID_SHEET_STATE');
  }
  const res = await publishInTx(tx, actor, [id], { fromStatuses: from });
  return { sheet: await getSheetDetail(tx, p, id, { authorised: true }), after: (db, tenant) => notifyPublished(db, tenant, r.sheet.examId, res.newSections, r.examName) };
}

/** Publish every approved sheet of an exam that the caller may publish (optionally one section / subject). */
export async function publishExamSheets(tx: Executor, p: Principal, actor: AuditActor, examId: string, filter: { sectionId?: string; subjectId?: string } = {}) {
  const { requireApproval } = await getSetting(tx, 'exams');
  const from: MarkSheetStatus[] = requireApproval ? ['approved'] : ['approved', 'submitted'];
  const candidates = await tx
    .select({ id: markSheets.id, status: markSheets.status })
    .from(markSheets)
    .where(and(eq(markSheets.examId, examId), sheetScope(p, 'marks:publish', markSheets), filter.sectionId ? eq(markSheets.sectionId, filter.sectionId) : undefined, filter.subjectId ? eq(markSheets.subjectId, filter.subjectId) : undefined, sql`${markSheets.status} <> 'published'`));
  const publishable = candidates.filter((c) => from.includes(c.status));
  const res = await publishInTx(tx, actor, publishable.map((c) => c.id), { fromStatuses: from });
  return { published: res.published.length, skipped: candidates.length - res.published.length, newSections: res.newSections };
}

// ── post-publication correction ─────────────────────────────────────────────────────────────

export async function correctSheet(tx: Executor, p: Principal, actor: AuditActor, id: string, reason: string, entries: EntryIn[]): Promise<{ sheet: SheetDetailOut; changed: number; after: (db: Executor, tenant: TenantInfo) => Promise<void> }> {
  const r = await lockSheet(tx, p, 'marks:approve', id);
  if (r.sheet.status !== 'published') throw conflict('Only published marks go through the correction workflow; enter marks normally while the sheet is a draft', 'SHEET_NOT_PUBLISHED');
  await validateEntries(tx, r, entries, true);
  const changed = await upsertEntries(tx, id, actor.userId, entries);
  if (!changed.length) throw unprocessable('Nothing was changed', 'NO_CHANGES');
  await audit(tx, actor, { action: 'marks.correct', entity: 'mark_sheet', entityId: id, summary: `${label(r)}: ${reason}`, before: { reason, entries: changed.map((c) => ({ studentId: c.studentId, ...c.before })) }, after: { reason, entries: changed.map((c) => ({ studentId: c.studentId, ...c.after })) } });
  const after = async (db: Executor, tenant: TenantInfo) => {
    const users = await recipientsForStudents(db, changed.map((c) => c.studentId));
    for (let i = 0; i < users.length; i += 1000) {
      await notify(db, tenant, { userIds: users.slice(i, i + 1000), type: 'marks.corrected', title: 'A published result was updated', body: 'A published exam result has been corrected.', data: { route: `/results/${r.sheet.examId}`, examId: r.sheet.examId } });
    }
  };
  return { sheet: await getSheetDetail(tx, p, id, { authorised: true }), changed: changed.length, after };
}

// ── CSV export rows ─────────────────────────────────────────────────────────────────────────

export async function exportRows(db: Executor, p: Principal, q: { examId: string; sectionId?: string; subjectId?: string }) {
  const rows = await db
    .select({
      exam: exams.name,
      grade: grades.name,
      section: sections.name,
      subject: subjects.name,
      sheetStatus: markSheets.status,
      admissionNo: students.admissionNo,
      first: students.firstName,
      last: students.lastName,
      rollNo: students.rollNo,
      maxMarks: examPapers.maxMarks,
      obtained: marks.marksObtained,
      absent: marks.isAbsent,
      remarks: marks.remarks,
    })
    .from(marks)
    .innerJoin(markSheets, eq(markSheets.id, marks.sheetId))
    .innerJoin(exams, eq(exams.id, markSheets.examId))
    .innerJoin(examPapers, eq(examPapers.id, markSheets.paperId))
    .innerJoin(sections, eq(sections.id, markSheets.sectionId))
    .innerJoin(grades, eq(grades.id, sections.gradeId))
    .innerJoin(subjects, eq(subjects.id, markSheets.subjectId))
    .innerJoin(students, eq(students.id, marks.studentId))
    .where(and(eq(markSheets.examId, q.examId), inArray(markSheets.status, ['submitted', 'approved', 'published']), sheetScope(p, 'marks:export', markSheets), q.sectionId ? eq(markSheets.sectionId, q.sectionId) : undefined, q.subjectId ? eq(markSheets.subjectId, q.subjectId) : undefined))
    .orderBy(asc(grades.ordinal), asc(sections.name), asc(subjects.name), asc(students.rollNo), asc(students.firstName))
    .limit(50_000);
  return rows;
}
