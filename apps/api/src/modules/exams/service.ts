import { and, asc, desc, eq, inArray, ne, sql, type SQL } from 'drizzle-orm';
import type { ExamOut, ExamStatus, GradeScaleOut, PaperOut, SheetStats } from '@school-sync/shared';
import { z } from 'zod';
import {
  examCreateBody,
  examListQuery,
  examUpdateBody,
  gradeScaleCreateBody,
  gradeScaleUpdateBody,
  paperCreateBody,
  paperUpdateBody,
  type GradeBandIn,
} from '@school-sync/shared';
import { audit, type AuditActor } from '../../core/audit';
import { AppError, conflict, notFound, unprocessable } from '../../core/errors';
import { ilikeAny, pageArgs, paged as pagedResult, todayIn } from '../../core/http';
import { notify } from '../../core/notify';
import type { Principal } from '../../core/rbac/principal';
import type { Executor } from '../../core/tenancy/pools';
import type { TenantInfo } from '../../core/tenancy/registry';
import { academicYears, examPapers, exams, gradeScaleBands, gradeScales, gradeSubjects, grades, markSheets, sections, staff, students, subjects, teachingAssignments, terms } from '../../db/tenant/schema';
import { hhmm, recipientsForStudents } from './common';
import { notifyPublished, publishExamSheets } from './sheets';
import { gradesOfScope, managesExams } from './scope';

type ExamRow = typeof exams.$inferSelect;

// ── grade scales ────────────────────────────────────────────────────────────────────────────

const bandOut = (b: typeof gradeScaleBands.$inferSelect) => ({ id: b.id, label: b.label, minPercent: b.minPercent, maxPercent: b.maxPercent, gradePoint: b.gradePoint ?? null, remark: b.remark ?? null });

export function validateBands(bands: GradeBandIn[]): void {
  const sorted = [...bands].sort((a, b) => a.minPercent - b.minPercent);
  if (sorted[0]!.minPercent !== 0) throw unprocessable('The lowest band must start at 0%', 'INVALID_BANDS');
  if (sorted[sorted.length - 1]!.maxPercent !== 100) throw unprocessable('The highest band must end at 100%', 'INVALID_BANDS');
  const labels = new Set<string>();
  for (let i = 0; i < sorted.length; i++) {
    const b = sorted[i]!;
    const key = b.label.toLowerCase();
    if (labels.has(key)) throw unprocessable(`Duplicate grade label "${b.label}"`, 'INVALID_BANDS');
    labels.add(key);
    if (i > 0 && b.minPercent <= sorted[i - 1]!.maxPercent) throw unprocessable(`Bands "${sorted[i - 1]!.label}" and "${b.label}" overlap`, 'INVALID_BANDS');
  }
}

async function bandsByScale(db: Executor, scaleIds: string[]) {
  if (!scaleIds.length) return new Map<string, (typeof gradeScaleBands.$inferSelect)[]>();
  const rows = await db.select().from(gradeScaleBands).where(inArray(gradeScaleBands.scaleId, scaleIds)).orderBy(desc(gradeScaleBands.minPercent));
  return Map.groupBy(rows, (r) => r.scaleId);
}

export async function listGradeScales(db: Executor, q: { page: number; pageSize: number }) {
  const [rows, [cnt]] = await Promise.all([
    db.select().from(gradeScales).orderBy(desc(gradeScales.isDefault), asc(gradeScales.name)).limit(pageArgs(q).limit).offset(pageArgs(q).offset),
    db.select({ n: sql<number>`count(*)::int` }).from(gradeScales) as Promise<{ n: number }[]>,
  ]);
  const bands = await bandsByScale(db, rows.map((r) => r.id));
  return pagedResult(
    rows.map((s): GradeScaleOut => ({ id: s.id, name: s.name, isDefault: s.isDefault, createdAt: s.createdAt.toISOString(), bands: (bands.get(s.id) ?? []).map(bandOut) })),
    cnt?.n ?? 0,
    q,
  );
}

export async function getGradeScale(db: Executor, id: string): Promise<GradeScaleOut> {
  const [s] = await db.select().from(gradeScales).where(eq(gradeScales.id, id)).limit(1);
  if (!s) throw notFound('Grade scale');
  const bands = await bandsByScale(db, [id]);
  return { id: s.id, name: s.name, isDefault: s.isDefault, createdAt: s.createdAt.toISOString(), bands: (bands.get(id) ?? []).map(bandOut) };
}

export async function createGradeScale(tx: Executor, actor: AuditActor, body: z.infer<typeof gradeScaleCreateBody>): Promise<GradeScaleOut> {
  validateBands(body.bands);
  const [cnt] = await tx.select({ n: sql<number>`count(*)::int` }).from(gradeScales);
  const makeDefault = body.isDefault || (cnt?.n ?? 0) === 0;
  if (makeDefault) await tx.update(gradeScales).set({ isDefault: false }).where(eq(gradeScales.isDefault, true));
  const [s] = await tx.insert(gradeScales).values({ name: body.name, isDefault: makeDefault }).returning();
  await tx.insert(gradeScaleBands).values(body.bands.map((b) => ({ scaleId: s!.id, label: b.label, minPercent: b.minPercent, maxPercent: b.maxPercent, gradePoint: b.gradePoint ?? null, remark: b.remark ?? null })));
  const out = await getGradeScale(tx, s!.id);
  await audit(tx, actor, { action: 'grade_scale.create', entity: 'grade_scale', entityId: s!.id, after: out });
  return out;
}

export async function updateGradeScale(tx: Executor, actor: AuditActor, id: string, body: z.infer<typeof gradeScaleUpdateBody>): Promise<GradeScaleOut> {
  const before = await getGradeScale(tx, id);
  if (body.bands) validateBands(body.bands);
  if (body.isDefault === false && before.isDefault) throw conflict('Make another scale the default instead of unsetting this one', 'DEFAULT_REQUIRED');
  if (body.isDefault) await tx.update(gradeScales).set({ isDefault: false }).where(and(eq(gradeScales.isDefault, true), ne(gradeScales.id, id)));
  if (body.name !== undefined || body.isDefault !== undefined) await tx.update(gradeScales).set({ ...(body.name !== undefined ? { name: body.name } : {}), ...(body.isDefault !== undefined ? { isDefault: body.isDefault } : {}) }).where(eq(gradeScales.id, id));
  if (body.bands) {
    await tx.delete(gradeScaleBands).where(eq(gradeScaleBands.scaleId, id));
    await tx.insert(gradeScaleBands).values(body.bands.map((b) => ({ scaleId: id, label: b.label, minPercent: b.minPercent, maxPercent: b.maxPercent, gradePoint: b.gradePoint ?? null, remark: b.remark ?? null })));
  }
  const after = await getGradeScale(tx, id);
  await audit(tx, actor, { action: 'grade_scale.update', entity: 'grade_scale', entityId: id, before, after });
  return after;
}

export async function deleteGradeScale(tx: Executor, actor: AuditActor, id: string): Promise<void> {
  const before = await getGradeScale(tx, id);
  if (before.isDefault) throw conflict('The default grade scale cannot be deleted', 'DEFAULT_REQUIRED');
  const [used] = await tx.select({ id: exams.id }).from(exams).where(eq(exams.gradeScaleId, id)).limit(1);
  if (used) throw conflict('This grade scale is used by an exam', 'GRADE_SCALE_IN_USE');
  await tx.delete(gradeScales).where(eq(gradeScales.id, id));
  await audit(tx, actor, { action: 'grade_scale.delete', entity: 'grade_scale', entityId: id, before });
}

// ── exams ───────────────────────────────────────────────────────────────────────────────────

const emptyStats = (): SheetStats => ({ total: 0, draft: 0, submitted: 0, approved: 0, returned: 0, published: 0 });

export async function hydrateExams(db: Executor, p: Principal, rows: ExamRow[]): Promise<ExamOut[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const manage = managesExams(p);
  const showStats = manage || p.can('marks:approve', 'school');
  const paperScope: SQL | undefined = manage ? undefined : sql`${examPapers.gradeId} in ${gradesOfScope(p, 'exams:view')}`;
  const [paperCounts, statRows, years, termRows] = await Promise.all([
    db
      .select({ examId: examPapers.examId, n: sql<number>`count(*)::int` })
      .from(examPapers)
      .where(and(inArray(examPapers.examId, ids), paperScope))
      .groupBy(examPapers.examId),
    showStats
      ? db
          .select({ examId: markSheets.examId, status: markSheets.status, n: sql<number>`count(*)::int` })
          .from(markSheets)
          .where(inArray(markSheets.examId, ids))
          .groupBy(markSheets.examId, markSheets.status)
      : Promise.resolve([] as { examId: string; status: string; n: number }[]),
    db.select({ id: academicYears.id, name: academicYears.name }).from(academicYears).where(inArray(academicYears.id, [...new Set(rows.map((r) => r.academicYearId))])),
    rows.some((r) => r.termId) ? db.select({ id: terms.id, name: terms.name }).from(terms).where(inArray(terms.id, rows.map((r) => r.termId).filter((x): x is string => !!x))) : Promise.resolve([]),
  ]);
  const pc = new Map(paperCounts.map((r) => [r.examId, r.n]));
  const yn = new Map(years.map((y) => [y.id, y.name]));
  const tn = new Map(termRows.map((t) => [t.id, t.name]));
  const stats = new Map<string, SheetStats>();
  for (const r of statRows) {
    const s = stats.get(r.examId) ?? emptyStats();
    s[r.status as keyof Omit<SheetStats, 'total'>] = r.n;
    s.total += r.n;
    stats.set(r.examId, s);
  }
  return rows.map((e) => ({
    id: e.id,
    name: e.name,
    examType: e.examType,
    academicYearId: e.academicYearId,
    academicYearName: yn.get(e.academicYearId) ?? null,
    termId: e.termId,
    termName: e.termId ? (tn.get(e.termId) ?? null) : null,
    gradeScaleId: e.gradeScaleId,
    startDate: e.startDate,
    endDate: e.endDate,
    passPercent: e.passPercent,
    status: e.status,
    publishedAt: e.publishedAt?.toISOString() ?? null,
    createdAt: e.createdAt.toISOString(),
    paperCount: pc.get(e.id) ?? 0,
    sheets: showStats ? (stats.get(e.id) ?? emptyStats()) : null,
  }));
}

/** Visibility: managers see everything; everyone else only non-draft exams that have a paper for their grade(s). */
function examVisibility(p: Principal): SQL | undefined {
  if (managesExams(p)) return undefined;
  return and(ne(exams.status, 'draft'), sql`exists (select 1 from ${examPapers} where ${examPapers.examId} = ${exams.id} and ${examPapers.gradeId} in ${gradesOfScope(p, 'exams:view')})`);
}

export async function listExams(db: Executor, p: Principal, tenant: TenantInfo, q: z.infer<typeof examListQuery>) {
  const today = todayIn(tenant.timezone);
  const where = and(
    q.academicYearId ? eq(exams.academicYearId, q.academicYearId) : undefined,
    q.termId ? eq(exams.termId, q.termId) : undefined,
    q.status ? eq(exams.status, q.status) : undefined,
    q.examType ? eq(exams.examType, q.examType) : undefined,
    q.q ? ilikeAny(q.q, exams.name) : undefined,
    q.upcoming ? sql`coalesce(${exams.endDate}, ${exams.startDate}, '9999-12-31') >= ${today}` : undefined,
    examVisibility(p),
  );
  const [rows, [cnt]] = await Promise.all([
    db.select().from(exams).where(where).orderBy(sql`${exams.startDate} desc nulls last`, desc(exams.createdAt)).limit(pageArgs(q).limit).offset(pageArgs(q).offset),
    db.select({ n: sql<number>`count(*)::int` }).from(exams).where(where) as Promise<{ n: number }[]>,
  ]);
  return pagedResult(await hydrateExams(db, p, rows), cnt?.n ?? 0, q);
}

export async function getExamRow(db: Executor, id: string): Promise<ExamRow> {
  const [e] = await db.select().from(exams).where(eq(exams.id, id)).limit(1);
  if (!e) throw notFound('Exam');
  return e;
}

/** Load an exam the caller may see (404 for drafts / other grades' exams when they are not a manager). */
export async function getExamFor(db: Executor, p: Principal, id: string): Promise<ExamOut> {
  const [e] = await db.select().from(exams).where(and(eq(exams.id, id), examVisibility(p))).limit(1);
  if (!e) throw notFound('Exam');
  return (await hydrateExams(db, p, [e]))[0]!;
}

export async function createExam(tx: Executor, p: Principal, actor: AuditActor, body: z.infer<typeof examCreateBody>): Promise<ExamOut> {
  let yearId = body.academicYearId;
  if (!yearId) {
    const [y] = await tx.select({ id: academicYears.id }).from(academicYears).where(eq(academicYears.isCurrent, true)).limit(1);
    if (!y) throw unprocessable('No current academic year is set up', 'NO_ACADEMIC_YEAR');
    yearId = y.id;
  } else if (!(await tx.select({ id: academicYears.id }).from(academicYears).where(eq(academicYears.id, yearId)).limit(1))[0]) {
    throw unprocessable('Academic year not found', 'ACADEMIC_YEAR_NOT_FOUND');
  }
  if (body.termId) await assertTerm(tx, body.termId, yearId);
  const scaleId = body.gradeScaleId ?? null;
  if (scaleId) await getGradeScale(tx, scaleId).catch(() => Promise.reject(unprocessable('Grade scale not found', 'GRADE_SCALE_NOT_FOUND')));
  const [row] = await tx
    .insert(exams)
    .values({ name: body.name, examType: body.examType, academicYearId: yearId, termId: body.termId ?? null, gradeScaleId: scaleId, startDate: body.startDate ?? null, endDate: body.endDate ?? null, passPercent: body.passPercent, createdBy: actor.userId ?? null })
    .returning();
  const out = (await hydrateExams(tx, p, [row!]))[0]!;
  await audit(tx, actor, { action: 'exam.create', entity: 'exam', entityId: row!.id, after: out });
  return out;
}

async function assertTerm(db: Executor, termId: string, yearId: string) {
  const [t] = await db.select({ y: terms.academicYearId }).from(terms).where(eq(terms.id, termId)).limit(1);
  if (!t || t.y !== yearId) throw unprocessable('That term does not belong to the exam’s academic year', 'TERM_MISMATCH');
}

export async function updateExam(tx: Executor, p: Principal, actor: AuditActor, id: string, body: z.infer<typeof examUpdateBody>): Promise<ExamOut> {
  const before = await getExamRow(tx, id);
  if (before.status === 'published') throw conflict('A published exam can no longer be edited', 'EXAM_PUBLISHED');
  if (body.termId) await assertTerm(tx, body.termId, before.academicYearId);
  if (body.gradeScaleId) await getGradeScale(tx, body.gradeScaleId).catch(() => Promise.reject(unprocessable('Grade scale not found', 'GRADE_SCALE_NOT_FOUND')));
  const start = body.startDate === undefined ? before.startDate : body.startDate;
  const end = body.endDate === undefined ? before.endDate : body.endDate;
  if (start && end && start > end) throw unprocessable('endDate must be on or after startDate', 'INVALID_DATES');
  const [row] = await tx.update(exams).set(body).where(eq(exams.id, id)).returning();
  const out = (await hydrateExams(tx, p, [row!]))[0]!;
  await audit(tx, actor, { action: 'exam.update', entity: 'exam', entityId: id, before: { name: before.name, examType: before.examType, termId: before.termId, gradeScaleId: before.gradeScaleId, startDate: before.startDate, endDate: before.endDate, passPercent: before.passPercent }, after: body });
  return out;
}

export async function deleteExam(tx: Executor, actor: AuditActor, id: string): Promise<void> {
  const e = await getExamRow(tx, id);
  const [sheet] = await tx.select({ id: markSheets.id }).from(markSheets).where(eq(markSheets.examId, id)).limit(1);
  if (sheet || e.status === 'published' || e.status === 'marks_entry' || e.status === 'under_review') throw conflict('Only an exam without mark sheets that is still a draft or scheduled can be deleted', 'EXAM_IN_USE');
  await tx.delete(exams).where(eq(exams.id, id));
  await audit(tx, actor, { action: 'exam.delete', entity: 'exam', entityId: id, before: { name: e.name, status: e.status } });
}

// ── status flow ─────────────────────────────────────────────────────────────────────────────

export type ExamVerb = 'schedule' | 'open-marks' | 'start-review';
const FLOW: Record<ExamVerb, { from: ExamStatus[]; to: ExamStatus }> = {
  schedule: { from: ['draft'], to: 'scheduled' },
  'open-marks': { from: ['scheduled'], to: 'marks_entry' },
  'start-review': { from: ['marks_entry'], to: 'under_review' },
};

export interface ExamTransition {
  exam: ExamOut;
  /** call AFTER the transaction commits (with the pool handle, not the transaction) */
  notifyAfter: (db: Executor) => Promise<void>;
}

/** draft→scheduled→marks_entry→under_review (publishing is `publishExam` in sheets.ts). */
export async function transitionExam(tx: Executor, tenant: TenantInfo, p: Principal, actor: AuditActor, id: string, verb: ExamVerb): Promise<ExamTransition> {
  const [lock] = await tx.select().from(exams).where(eq(exams.id, id)).for('update').limit(1);
  if (!lock) throw notFound('Exam');
  const flow = FLOW[verb];
  if (!flow.from.includes(lock.status)) throw conflict(`Exam is ${lock.status}; "${verb}" needs it to be ${flow.from.join(' or ')}`, 'INVALID_EXAM_STATE');
  if (verb === 'schedule') {
    const [paper] = await tx.select({ id: examPapers.id }).from(examPapers).where(eq(examPapers.examId, id)).limit(1);
    if (!paper) throw unprocessable('Add at least one paper to the schedule before scheduling the exam', 'NO_PAPERS');
  }
  const [row] = await tx.update(exams).set({ status: flow.to }).where(eq(exams.id, id)).returning();
  await audit(tx, actor, { action: `exam.${verb.replace('-', '_')}`, entity: 'exam', entityId: id, before: { status: lock.status }, after: { status: flow.to } });
  const exam = (await hydrateExams(tx, p, [row!]))[0]!;

  const notifyAfter = async (db: Executor) => {
    // after commit, on the pool: tell the people the new state concerns
    if (verb === 'schedule') {
      const gradeRows = await db.selectDistinct({ gradeId: examPapers.gradeId }).from(examPapers).where(eq(examPapers.examId, id));
      const studentRows = await db
        .select({ id: students.id })
        .from(students)
        .where(and(inArray(students.currentGradeId, gradeRows.map((g) => g.gradeId)), inArray(students.status, ['active', 'suspended'])));
      const users = await recipientsForStudents(db, studentRows.map((s) => s.id));
      for (let i = 0; i < users.length; i += 1000) {
        await notify(db, tenant, { userIds: users.slice(i, i + 1000), type: 'marks.scheduled', title: 'Exam schedule published', body: `The schedule for ${exam.name} is available.`, data: { route: `/exams/${id}`, examId: id } });
      }
    } else if (verb === 'open-marks') {
      const teachers = await db
        .selectDistinct({ userId: staff.userId })
        .from(markSheets)
        .innerJoin(teachingAssignments, and(eq(teachingAssignments.sectionId, markSheets.sectionId), eq(teachingAssignments.subjectId, markSheets.subjectId)))
        .innerJoin(staff, eq(staff.id, teachingAssignments.staffId))
        .where(eq(markSheets.examId, id));
      await notify(db, tenant, { userIds: teachers.map((t) => t.userId).filter((u): u is string => !!u), type: 'marks.entry_open', title: 'Marks entry is open', body: `You can now enter marks for ${exam.name}.`, data: { route: `/exams/${id}/marks`, examId: id } });
    }
  };
  return { exam, notifyAfter };
}

// ── schedule (papers) ───────────────────────────────────────────────────────────────────────

export async function listPapers(db: Executor, p: Principal, examId: string, gradeId?: string): Promise<PaperOut[]> {
  const e = await getExamFor(db, p, examId); // 404 for drafts / foreign exams
  const rows = await db
    .select({
      p: examPapers,
      gradeName: grades.name,
      subjectName: subjects.name,
      subjectCode: subjects.code,
    })
    .from(examPapers)
    .innerJoin(grades, eq(grades.id, examPapers.gradeId))
    .innerJoin(subjects, eq(subjects.id, examPapers.subjectId))
    .where(and(eq(examPapers.examId, e.id), gradeId ? eq(examPapers.gradeId, gradeId) : undefined, managesExams(p) ? undefined : sql`${examPapers.gradeId} in ${gradesOfScope(p, 'exams:view')}`))
    .orderBy(sql`${examPapers.examDate} asc nulls last`, asc(examPapers.startTime), asc(grades.ordinal), asc(subjects.name));
  return rows.map(toPaperOut);
}

const toPaperOut = (r: { p: typeof examPapers.$inferSelect; gradeName: string; subjectName: string; subjectCode: string }): PaperOut => ({
  id: r.p.id,
  examId: r.p.examId,
  gradeId: r.p.gradeId,
  gradeName: r.gradeName,
  subjectId: r.p.subjectId,
  subjectName: r.subjectName,
  subjectCode: r.subjectCode,
  examDate: r.p.examDate,
  startTime: hhmm(r.p.startTime),
  endTime: hhmm(r.p.endTime),
  room: r.p.room,
  maxMarks: r.p.maxMarks,
  passMarks: r.p.passMarks,
});

async function paperOutById(db: Executor, id: string): Promise<PaperOut> {
  const [r] = await db
    .select({ p: examPapers, gradeName: grades.name, subjectName: subjects.name, subjectCode: subjects.code })
    .from(examPapers)
    .innerJoin(grades, eq(grades.id, examPapers.gradeId))
    .innerJoin(subjects, eq(subjects.id, examPapers.subjectId))
    .where(eq(examPapers.id, id))
    .limit(1);
  if (!r) throw notFound('Paper');
  return toPaperOut(r);
}

type PaperInput = z.infer<typeof paperCreateBody>;

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** Same grade, same date: clash when both are untimed, or both are timed and the intervals overlap. */
async function assertNoClash(db: Executor, examId: string, paper: { gradeId: string; examDate?: string | null; startTime?: string | null; endTime?: string | null }, excludeId?: string) {
  if (!paper.examDate) return;
  const others = await db
    .select({ id: examPapers.id, start: examPapers.startTime, end: examPapers.endTime, subject: subjects.name })
    .from(examPapers)
    .innerJoin(subjects, eq(subjects.id, examPapers.subjectId))
    .where(and(eq(examPapers.examId, examId), eq(examPapers.gradeId, paper.gradeId), eq(examPapers.examDate, paper.examDate), excludeId ? ne(examPapers.id, excludeId) : undefined));
  const timed = !!(paper.startTime && paper.endTime);
  for (const o of others) {
    const otherTimed = !!(o.start && o.end);
    const clash = !timed && !otherTimed ? true : timed && otherTimed ? toMin(paper.startTime!) < toMin(o.end!) && toMin(o.start!) < toMin(paper.endTime!) : false;
    if (clash) throw conflict(`This grade already has ${o.subject} scheduled in that slot`, 'SCHEDULE_CONFLICT');
  }
}

async function assertPaperValid(db: Executor, exam: ExamRow, paper: { gradeId: string; subjectId: string; examDate?: string | null }) {
  const [gs] = await db.select({ g: gradeSubjects.gradeId }).from(gradeSubjects).where(and(eq(gradeSubjects.gradeId, paper.gradeId), eq(gradeSubjects.subjectId, paper.subjectId))).limit(1);
  if (!gs) throw unprocessable('That subject is not taught in that grade', 'SUBJECT_NOT_IN_GRADE');
  if (paper.examDate && exam.startDate && exam.endDate && (paper.examDate < exam.startDate || paper.examDate > exam.endDate)) {
    throw unprocessable(`The paper date must fall within the exam dates (${exam.startDate} to ${exam.endDate})`, 'DATE_OUTSIDE_EXAM');
  }
}

function assertEditableSchedule(exam: ExamRow) {
  if (exam.status === 'published' || exam.status === 'under_review') throw conflict(`The schedule of an exam that is ${exam.status} cannot be changed`, 'EXAM_LOCKED');
}

export async function createPaper(tx: Executor, actor: AuditActor, examId: string, body: PaperInput): Promise<PaperOut> {
  const exam = await getExamRow(tx, examId);
  assertEditableSchedule(exam);
  await assertPaperValid(tx, exam, body);
  await assertNoClash(tx, examId, body);
  const [dup] = await tx.select({ id: examPapers.id }).from(examPapers).where(and(eq(examPapers.examId, examId), eq(examPapers.gradeId, body.gradeId), eq(examPapers.subjectId, body.subjectId))).limit(1);
  if (dup) throw conflict('That subject already has a paper for this grade', 'PAPER_EXISTS');
  const [row] = await tx
    .insert(examPapers)
    .values({ examId, gradeId: body.gradeId, subjectId: body.subjectId, examDate: body.examDate ?? null, startTime: body.startTime ?? null, endTime: body.endTime ?? null, room: body.room ?? null, maxMarks: body.maxMarks, passMarks: body.passMarks ?? null })
    .returning({ id: examPapers.id });
  const out = await paperOutById(tx, row!.id);
  await audit(tx, actor, { action: 'exam.paper_create', entity: 'exam_paper', entityId: row!.id, after: out });
  return out;
}

export async function upsertPapers(tx: Executor, actor: AuditActor, examId: string, papers: PaperInput[]): Promise<PaperOut[]> {
  const exam = await getExamRow(tx, examId);
  assertEditableSchedule(exam);
  // the incoming set itself must be clash-free too
  const seen = new Set<string>();
  for (const b of papers) {
    const key = `${b.gradeId}:${b.subjectId}`;
    if (seen.has(key)) throw unprocessable('The same grade and subject appears twice', 'DUPLICATE_PAPER');
    seen.add(key);
  }
  const out: PaperOut[] = [];
  for (const b of papers) {
    await assertPaperValid(tx, exam, b);
    const [existing] = await tx.select({ id: examPapers.id }).from(examPapers).where(and(eq(examPapers.examId, examId), eq(examPapers.gradeId, b.gradeId), eq(examPapers.subjectId, b.subjectId))).limit(1);
    await assertNoClash(tx, examId, b, existing?.id);
    const values = { examDate: b.examDate ?? null, startTime: b.startTime ?? null, endTime: b.endTime ?? null, room: b.room ?? null, maxMarks: b.maxMarks, passMarks: b.passMarks ?? null };
    let id: string;
    if (existing) {
      await tx.update(examPapers).set(values).where(eq(examPapers.id, existing.id));
      id = existing.id;
    } else {
      const [row] = await tx.insert(examPapers).values({ examId, gradeId: b.gradeId, subjectId: b.subjectId, ...values }).returning({ id: examPapers.id });
      id = row!.id;
    }
    out.push(await paperOutById(tx, id));
  }
  await audit(tx, actor, { action: 'exam.schedule_set', entity: 'exam', entityId: examId, summary: `${papers.length} papers`, after: out.map((o) => ({ grade: o.gradeName, subject: o.subjectName, date: o.examDate, start: o.startTime, end: o.endTime, max: o.maxMarks })) });
  return out;
}

export async function updatePaper(tx: Executor, actor: AuditActor, examId: string, paperId: string, body: z.infer<typeof paperUpdateBody>): Promise<PaperOut> {
  const exam = await getExamRow(tx, examId);
  assertEditableSchedule(exam);
  const [cur] = await tx.select().from(examPapers).where(and(eq(examPapers.id, paperId), eq(examPapers.examId, examId))).limit(1);
  if (!cur) throw notFound('Paper');
  const next = {
    gradeId: body.gradeId ?? cur.gradeId,
    subjectId: body.subjectId ?? cur.subjectId,
    examDate: body.examDate === undefined ? cur.examDate : body.examDate,
    startTime: body.startTime === undefined ? hhmm(cur.startTime) : body.startTime,
    endTime: body.endTime === undefined ? hhmm(cur.endTime) : body.endTime,
    maxMarks: body.maxMarks ?? cur.maxMarks,
    passMarks: body.passMarks === undefined ? cur.passMarks : body.passMarks,
  };
  if ((next.startTime || next.endTime) && !next.examDate) throw unprocessable('examDate is required when a time is given', 'INVALID_PAPER');
  if (next.startTime && next.endTime && next.startTime >= next.endTime) throw unprocessable('endTime must be after startTime', 'INVALID_PAPER');
  if (next.passMarks != null && next.passMarks > next.maxMarks) throw unprocessable('passMarks must not exceed maxMarks', 'INVALID_PAPER');
  const [sheet] = await tx.select({ id: markSheets.id }).from(markSheets).where(eq(markSheets.paperId, paperId)).limit(1);
  if (sheet && (next.gradeId !== cur.gradeId || next.subjectId !== cur.subjectId)) throw conflict('Mark sheets exist for this paper, so its grade and subject cannot change', 'PAPER_IN_USE');
  if (sheet && next.maxMarks < cur.maxMarks) {
    const [over] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from marks m join mark_sheets s on s.id = m.sheet_id where s.paper_id = ${paperId} and m.marks_obtained > ${next.maxMarks}`).then((r) => r.rows);
    if (over && over.n > 0) throw conflict('Some entered marks exceed the new maximum marks', 'MARKS_EXCEED_MAX');
  }
  await assertPaperValid(tx, exam, next);
  await assertNoClash(tx, examId, next, paperId);
  await tx
    .update(examPapers)
    .set({ gradeId: next.gradeId, subjectId: next.subjectId, examDate: next.examDate ?? null, startTime: next.startTime ?? null, endTime: next.endTime ?? null, room: body.room === undefined ? cur.room : (body.room ?? null), maxMarks: next.maxMarks, passMarks: next.passMarks ?? null })
    .where(eq(examPapers.id, paperId));
  const out = await paperOutById(tx, paperId);
  await audit(tx, actor, { action: 'exam.paper_update', entity: 'exam_paper', entityId: paperId, before: { examDate: cur.examDate, startTime: cur.startTime, endTime: cur.endTime, room: cur.room, maxMarks: cur.maxMarks, passMarks: cur.passMarks }, after: out });
  return out;
}

export async function deletePaper(tx: Executor, actor: AuditActor, examId: string, paperId: string): Promise<void> {
  const exam = await getExamRow(tx, examId);
  assertEditableSchedule(exam);
  const [cur] = await tx.select().from(examPapers).where(and(eq(examPapers.id, paperId), eq(examPapers.examId, examId))).limit(1);
  if (!cur) throw notFound('Paper');
  const [sheet] = await tx.select({ id: markSheets.id }).from(markSheets).where(eq(markSheets.paperId, paperId)).limit(1);
  if (sheet) throw conflict('Mark sheets exist for this paper', 'PAPER_IN_USE');
  await tx.delete(examPapers).where(eq(examPapers.id, paperId));
  await audit(tx, actor, { action: 'exam.paper_delete', entity: 'exam_paper', entityId: paperId, before: cur });
}

// ── mark-sheet generation ───────────────────────────────────────────────────────────────────

/** Create one sheet per (section x paper) for which a subject teacher is assigned. Idempotent. */
export async function generateSheets(tx: Executor, actor: AuditActor, examId: string, sectionId?: string) {
  const exam = await getExamRow(tx, examId);
  if (exam.status === 'draft') throw conflict('Schedule the exam before generating mark sheets', 'INVALID_EXAM_STATE');
  const papers = await tx.select().from(examPapers).where(eq(examPapers.examId, examId));
  if (!papers.length) throw unprocessable('The exam has no papers', 'NO_PAPERS');
  const gradeIds = [...new Set(papers.map((p) => p.gradeId))];
  const secs = await tx
    .select({ id: sections.id, name: sections.name, gradeId: sections.gradeId, gradeName: grades.name })
    .from(sections)
    .innerJoin(grades, eq(grades.id, sections.gradeId))
    .where(and(eq(sections.academicYearId, exam.academicYearId), inArray(sections.gradeId, gradeIds), sectionId ? eq(sections.id, sectionId) : undefined));
  if (sectionId && !secs.length) throw notFound('Section');
  const assigns = secs.length ? await tx.select({ sectionId: teachingAssignments.sectionId, subjectId: teachingAssignments.subjectId }).from(teachingAssignments).where(inArray(teachingAssignments.sectionId, secs.map((s) => s.id))) : [];
  const assigned = new Set(assigns.map((a) => `${a.sectionId}:${a.subjectId}`));
  const subjectNames = new Map((await tx.select({ id: subjects.id, name: subjects.name }).from(subjects).where(inArray(subjects.id, [...new Set(papers.map((p) => p.subjectId))]))).map((s) => [s.id, s.name]));

  const toCreate: (typeof markSheets.$inferInsert)[] = [];
  const skipped: { sectionId: string; sectionName: string; subjectId: string; subjectName: string; reason: string }[] = [];
  for (const sec of secs) {
    for (const paper of papers.filter((x) => x.gradeId === sec.gradeId)) {
      if (!assigned.has(`${sec.id}:${paper.subjectId}`)) {
        skipped.push({ sectionId: sec.id, sectionName: `${sec.gradeName} ${sec.name}`, subjectId: paper.subjectId, subjectName: subjectNames.get(paper.subjectId) ?? '', reason: 'No subject teacher is assigned to this section' });
        continue;
      }
      toCreate.push({ examId, paperId: paper.id, sectionId: sec.id, subjectId: paper.subjectId });
    }
  }
  let created = 0;
  for (let i = 0; i < toCreate.length; i += 500) {
    const rows = await tx.insert(markSheets).values(toCreate.slice(i, i + 500)).onConflictDoNothing().returning({ id: markSheets.id });
    created += rows.length;
  }
  await audit(tx, actor, { action: 'exam.sheets_generate', entity: 'exam', entityId: examId, summary: `${created} created, ${toCreate.length - created} existing, ${skipped.length} skipped` });
  return { created, existing: toCreate.length - created, skipped };
}

// ── publishing the exam ─────────────────────────────────────────────────────────────────────

/**
 * Publish the exam: every APPROVED sheet is published (students/parents are notified once per section), then the
 * exam itself becomes `published`. Without `force` all sheets must already be approved/published; with `force`
 * the unfinished sheets simply stay hidden from students and parents.
 */
export async function publishExam(tx: Executor, p: Principal, actor: AuditActor, id: string, force: boolean): Promise<{ exam: ExamOut; after: (db: Executor, tenant: TenantInfo) => Promise<void> }> {
  const [lock] = await tx.select().from(exams).where(eq(exams.id, id)).for('update').limit(1);
  if (!lock) throw notFound('Exam');
  if (lock.status !== 'marks_entry' && lock.status !== 'under_review') throw conflict(`Exam is ${lock.status}; open marks entry before publishing`, 'INVALID_EXAM_STATE');
  const stats = await tx.select({ status: markSheets.status, n: sql<number>`count(*)::int` }).from(markSheets).where(eq(markSheets.examId, id)).groupBy(markSheets.status);
  const total = stats.reduce((t, s) => t + s.n, 0);
  if (!total) throw unprocessable('Generate mark sheets and enter marks before publishing', 'NO_SHEETS');
  const pending = stats.filter((s) => s.status !== 'approved' && s.status !== 'published').reduce((t, s) => t + s.n, 0);
  if (pending && !force) throw new AppError(409, 'SHEETS_PENDING', `${pending} mark sheet(s) are not approved yet. Approve or return them, or publish with force to leave them hidden.`, { pending });
  const res = await publishExamSheets(tx, p, actor, id);
  const [row] = await tx.update(exams).set({ status: 'published', publishedAt: new Date() }).where(eq(exams.id, id)).returning();
  await audit(tx, actor, { action: 'exam.publish', entity: 'exam', entityId: id, before: { status: lock.status }, after: { status: 'published', sheetsPublished: res.published, sheetsHidden: pending } });
  const exam = (await hydrateExams(tx, p, [row!]))[0]!;
  return { exam, after: (db, tenant) => notifyPublished(db, tenant, id, res.newSections, lock.name) };
}
