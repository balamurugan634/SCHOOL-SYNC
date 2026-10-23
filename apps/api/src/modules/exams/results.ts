import { and, asc, desc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import type { ExamAnalyticsOut, ReportCardOut, ResultSubjectOut, StudentResultOut } from '@school-sync/shared';
import { audit, type AuditActor } from '../../core/audit';
import { conflict, notFound, unprocessable } from '../../core/errors';
import { todayIn } from '../../core/http';
import { notify } from '../../core/notify';
import type { Principal } from '../../core/rbac/principal';
import { getSetting } from '../../core/settings';
import type { Executor } from '../../core/tenancy/pools';
import type { TenantInfo } from '../../core/tenancy/registry';
import { academicYears, attendanceRecords, examPapers, exams, gradeScaleBands, gradeScales, grades, markSheets, marks, reportRemarks, sections, students, subjects, terms } from '../../db/tenant/schema';
import { recipientsForStudents, round2 } from './common';
import { ENROLLED } from './sheets';
import { sheetScope } from './scope';

type ExamRow = typeof exams.$inferSelect;
export interface Band {
  label: string;
  minPercent: number;
  maxPercent: number;
  gradePoint: number | null;
  remark: string | null;
}

// ── grading ─────────────────────────────────────────────────────────────────────────────────

/** Bands of the exam's grade scale (or the school default), highest first. */
export async function loadBands(db: Executor, exam: Pick<ExamRow, 'gradeScaleId'>): Promise<Band[]> {
  let scaleId = exam.gradeScaleId;
  if (!scaleId) {
    const [d] = await db.select({ id: gradeScales.id }).from(gradeScales).where(eq(gradeScales.isDefault, true)).limit(1);
    scaleId = d?.id ?? null;
  }
  if (!scaleId) return [];
  const rows = await db.select().from(gradeScaleBands).where(eq(gradeScaleBands.scaleId, scaleId)).orderBy(desc(gradeScaleBands.minPercent));
  return rows.map((b) => ({ label: b.label, minPercent: b.minPercent, maxPercent: b.maxPercent, gradePoint: b.gradePoint ?? null, remark: b.remark ?? null }));
}

/** The highest band whose lower bound the percentage reaches (bands are sorted high to low). */
export function gradeFor(bands: Band[], percent: number | null): Band | null {
  if (percent == null || !bands.length) return null;
  return bands.find((b) => percent >= b.minPercent) ?? bands[bands.length - 1]!;
}

// ── loading published marks ─────────────────────────────────────────────────────────────────

interface MarkRow {
  examId: string;
  sectionId: string;
  sheetId: string;
  subjectId: string;
  subjectName: string;
  subjectCode: string;
  maxMarks: number;
  passMarks: number | null;
  studentId: string;
  marksObtained: number | null;
  isAbsent: boolean;
  remarks: string | null;
}
type Pair = { examId: string; sectionId: string };
const pairSql = (pairs: Pair[]) => sql`(${markSheets.examId}, ${markSheets.sectionId}) in (${sql.join(pairs.map((p) => sql`(${p.examId}::uuid, ${p.sectionId}::uuid)`), sql`, `)})`;

/** PUBLISHED marks only — the publish gate lives here, so no caller can leak a draft by forgetting a filter. */
async function loadPublished(db: Executor, pairs: Pair[]): Promise<{ rows: MarkRow[]; expected: Map<string, number> }> {
  if (!pairs.length) return { rows: [], expected: new Map() };
  const [rows, totals] = await Promise.all([
    db
      .select({
        examId: markSheets.examId,
        sectionId: markSheets.sectionId,
        sheetId: markSheets.id,
        subjectId: markSheets.subjectId,
        subjectName: subjects.name,
        subjectCode: subjects.code,
        maxMarks: examPapers.maxMarks,
        passMarks: examPapers.passMarks,
        studentId: marks.studentId,
        marksObtained: marks.marksObtained,
        isAbsent: marks.isAbsent,
        remarks: marks.remarks,
      })
      .from(markSheets)
      .innerJoin(examPapers, eq(examPapers.id, markSheets.paperId))
      .innerJoin(subjects, eq(subjects.id, markSheets.subjectId))
      .innerJoin(marks, eq(marks.sheetId, markSheets.id))
      .where(and(eq(markSheets.status, 'published'), pairSql(pairs))),
    db
      .select({ examId: markSheets.examId, sectionId: markSheets.sectionId, n: sql<number>`count(*)::int` })
      .from(markSheets)
      .where(pairSql(pairs))
      .groupBy(markSheets.examId, markSheets.sectionId),
  ]);
  return { rows, expected: new Map(totals.map((t) => [`${t.examId}:${t.sectionId}`, t.n])) };
}

interface Calc {
  subjects: ResultSubjectOut[];
  totalMarks: number;
  maxTotal: number;
  percent: number | null;
  grade: string | null;
  gradePoint: number | null;
  gradeRemark: string | null;
  result: 'pass' | 'fail' | null;
  rank: number | null;
  classSize: number;
  percentile: number | null;
  subjectsPublished: number;
}

/** Marks -> subject grades, totals, pass/fail, and class rank for ONE exam x section. */
function buildSection(exam: ExamRow, bands: Band[], rows: MarkRow[]): Map<string, Calc> {
  const byStudent = Map.groupBy(rows, (r) => r.studentId);
  const out = new Map<string, Calc>();
  for (const [studentId, list] of byStudent) {
    const subs: ResultSubjectOut[] = list
      .map((r) => {
        const passMarks = r.passMarks ?? round2((r.maxMarks * exam.passPercent) / 100);
        const obtained = r.isAbsent ? null : r.marksObtained;
        const percent = obtained == null ? null : round2((obtained / r.maxMarks) * 100);
        const band = gradeFor(bands, percent);
        return {
          subjectId: r.subjectId,
          subjectName: r.subjectName,
          subjectCode: r.subjectCode,
          sheetId: r.sheetId,
          maxMarks: r.maxMarks,
          passMarks,
          marksObtained: obtained,
          isAbsent: r.isAbsent,
          percent,
          grade: band?.label ?? null,
          gradePoint: band?.gradePoint ?? null,
          passed: obtained != null && obtained >= passMarks,
          remarks: r.remarks,
        };
      })
      .sort((a, b) => a.subjectName.localeCompare(b.subjectName));
    const total = round2(subs.reduce((t, s) => t + (s.marksObtained ?? 0), 0));
    const max = subs.reduce((t, s) => t + s.maxMarks, 0);
    const percent = max > 0 ? round2((total / max) * 100) : null;
    const band = gradeFor(bands, percent);
    out.set(studentId, {
      subjects: subs,
      totalMarks: total,
      maxTotal: max,
      percent,
      grade: band?.label ?? null,
      gradePoint: band?.gradePoint ?? null,
      gradeRemark: band?.remark ?? null,
      result: percent == null ? null : subs.every((s) => s.passed) && percent >= exam.passPercent ? 'pass' : 'fail',
      rank: null,
      classSize: byStudent.size,
      percentile: null,
      subjectsPublished: new Set(list.map((l) => l.sheetId)).size,
    });
  }
  // competition ranking by percent (ties share a rank)
  const ranked = [...out.entries()].filter(([, c]) => c.percent != null).sort((a, b) => b[1].percent! - a[1].percent!);
  let prev: number | null = null;
  let rank = 0;
  ranked.forEach(([, c], i) => {
    if (c.percent !== prev) {
      rank = i + 1;
      prev = c.percent;
    }
    c.rank = rank;
    c.percentile = ranked.length >= 2 ? round2(((ranked.length - rank) / (ranked.length - 1)) * 100) : null;
  });
  return out;
}

async function loadExams(db: Executor, ids: string[]) {
  const rows = await db
    .select({ e: exams, termName: terms.name })
    .from(exams)
    .leftJoin(terms, eq(terms.id, exams.termId))
    .where(inArray(exams.id, ids));
  return new Map(rows.map((r) => [r.e.id, r]));
}

interface StudentCtx {
  id: string;
  name: string;
  admissionNo: string;
  rollNo: number | null;
}

/**
 * Published results of one student, newest exam first. Access to the student must already be checked
 * (`assertResultAccess`). Rank/percentile are computed against the whole section the student was in for that exam.
 */
export async function studentResults(db: Executor, studentId: string, examId?: string): Promise<StudentResultOut[]> {
  const pairRows = await db
    .selectDistinct({ examId: markSheets.examId, sectionId: markSheets.sectionId, start: exams.startDate, created: exams.createdAt })
    .from(marks)
    .innerJoin(markSheets, eq(markSheets.id, marks.sheetId))
    .innerJoin(exams, eq(exams.id, markSheets.examId))
    .where(and(eq(marks.studentId, studentId), eq(markSheets.status, 'published'), examId ? eq(markSheets.examId, examId) : undefined))
    .orderBy(sql`${exams.startDate} desc nulls last`, desc(exams.createdAt))
    .limit(30);
  if (!pairRows.length) return [];
  const pairs = pairRows.map((r) => ({ examId: r.examId, sectionId: r.sectionId }));
  const [{ rows, expected }, examMap, [stu]] = await Promise.all([
    loadPublished(db, pairs),
    loadExams(db, [...new Set(pairs.map((p) => p.examId))]),
    db
      .select({ id: students.id, first: students.firstName, last: students.lastName, admissionNo: students.admissionNo, rollNo: students.rollNo })
      .from(students)
      .where(eq(students.id, studentId))
      .limit(1),
  ]);
  if (!stu) return [];
  const secs = await db
    .select({ id: sections.id, name: sections.name, gradeName: grades.name })
    .from(sections)
    .innerJoin(grades, eq(grades.id, sections.gradeId))
    .where(inArray(sections.id, [...new Set(pairs.map((p) => p.sectionId))]));
  const secMap = new Map(secs.map((s) => [s.id, s]));
  const bandCache = new Map<string, Band[]>();
  const grouped = Map.groupBy(rows, (r) => `${r.examId}:${r.sectionId}`);
  const out: StudentResultOut[] = [];
  for (const pr of pairs) {
    const ex = examMap.get(pr.examId);
    if (!ex) continue;
    const bandKey = ex.e.gradeScaleId ?? 'default';
    if (!bandCache.has(bandKey)) bandCache.set(bandKey, await loadBands(db, ex.e));
    const built = buildSection(ex.e, bandCache.get(bandKey)!, grouped.get(`${pr.examId}:${pr.sectionId}`) ?? []);
    const calc = built.get(studentId);
    if (!calc) continue;
    const sec = secMap.get(pr.sectionId);
    const total = expected.get(`${pr.examId}:${pr.sectionId}`) ?? calc.subjectsPublished;
    const sectionPublished = new Set((grouped.get(`${pr.examId}:${pr.sectionId}`) ?? []).map((r) => r.sheetId)).size;
    out.push({
      examId: ex.e.id,
      examName: ex.e.name,
      examType: ex.e.examType,
      termName: ex.termName ?? null,
      startDate: ex.e.startDate,
      endDate: ex.e.endDate,
      studentId,
      studentName: [stu.first, stu.last].filter(Boolean).join(' '),
      admissionNo: stu.admissionNo,
      rollNo: stu.rollNo,
      sectionId: pr.sectionId,
      sectionName: sec?.name ?? null,
      gradeName: sec?.gradeName ?? null,
      ...calc,
      complete: total > 0 && sectionPublished >= total,
      subjectsPublished: calc.subjectsPublished,
      subjectsExpected: total,
    });
  }
  return out;
}

/** Whole-section result list for one exam (class teacher / school scope; the route checks that). */
export async function classResults(db: Executor, examId: string, sectionId: string) {
  const ex = (await loadExams(db, [examId])).get(examId);
  if (!ex) throw notFound('Exam');
  const { rows, expected } = await loadPublished(db, [{ examId, sectionId }]);
  const bands = await loadBands(db, ex.e);
  const built = buildSection(ex.e, bands, rows);
  const people = built.size
    ? await db.select({ id: students.id, first: students.firstName, last: students.lastName, admissionNo: students.admissionNo, rollNo: students.rollNo }).from(students).where(inArray(students.id, [...built.keys()]))
    : [];
  const data = people
    .map((s) => {
      const c = built.get(s.id)!;
      return { studentId: s.id, name: [s.first, s.last].filter(Boolean).join(' '), admissionNo: s.admissionNo, rollNo: s.rollNo, totalMarks: c.totalMarks, maxTotal: c.maxTotal, percent: c.percent, grade: c.grade, result: c.result, rank: c.rank, subjectsPublished: c.subjectsPublished };
    })
    .sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || (a.rollNo ?? 1e9) - (b.rollNo ?? 1e9));
  return { examId, sectionId, subjectsExpected: expected.get(`${examId}:${sectionId}`) ?? 0, data };
}

/** "My progress": a student's published results per subject across exams, oldest first. */
export async function progress(db: Executor, studentId: string) {
  const results = (await studentResults(db, studentId)).reverse();
  const subj = new Map<string, { subjectId: string; subjectName: string; points: { examId: string; percent: number | null; marks: number | null; maxMarks: number; isAbsent: boolean }[] }>();
  for (const r of results) {
    for (const s of r.subjects) {
      const e = subj.get(s.subjectId) ?? { subjectId: s.subjectId, subjectName: s.subjectName, points: [] };
      e.points.push({ examId: r.examId, percent: s.percent, marks: s.marksObtained, maxMarks: s.maxMarks, isAbsent: s.isAbsent });
      subj.set(s.subjectId, e);
    }
  }
  return {
    studentId,
    exams: results.map((r) => ({ examId: r.examId, name: r.examName, examType: r.examType, date: r.startDate, percent: r.percent, grade: r.grade })),
    subjects: [...subj.values()].sort((a, b) => a.subjectName.localeCompare(b.subjectName)),
  };
}

// ── report card ─────────────────────────────────────────────────────────────────────────────

export async function attendanceSummary(db: Executor, studentId: string, from: string, to: string) {
  const [r] = await db
    .select({
      total: sql<number>`count(*)::int`,
      present: sql<number>`(count(*) filter (where ${attendanceRecords.status} = 'present'))::int`,
      late: sql<number>`(count(*) filter (where ${attendanceRecords.status} = 'late'))::int`,
      halfDay: sql<number>`(count(*) filter (where ${attendanceRecords.status} = 'half_day'))::int`,
      leave: sql<number>`(count(*) filter (where ${attendanceRecords.status} = 'leave'))::int`,
      absent: sql<number>`(count(*) filter (where ${attendanceRecords.status} = 'absent'))::int`,
    })
    .from(attendanceRecords)
    .where(and(eq(attendanceRecords.studentId, studentId), sql`${attendanceRecords.date} between ${from} and ${to}`));
  const total = r?.total ?? 0;
  return {
    from,
    to,
    totalDays: total,
    present: r?.present ?? 0,
    late: r?.late ?? 0,
    halfDay: r?.halfDay ?? 0,
    leave: r?.leave ?? 0,
    absent: r?.absent ?? 0,
    percent: total > 0 ? round2((((r?.present ?? 0) + (r?.late ?? 0) + (r?.halfDay ?? 0) / 2) / total) * 100) : null,
  };
}

/** Student-visible remarks only exist once published; staff see drafts too. */
export async function getRemarks(db: Executor, examId: string, studentId: string, includeDraft: boolean) {
  const [r] = await db.select().from(reportRemarks).where(and(eq(reportRemarks.examId, examId), eq(reportRemarks.studentId, studentId))).limit(1);
  if (!r || (!includeDraft && !r.publishedAt)) return null;
  return { remark: r.remark, areasToImprove: r.areasToImprove, conduct: r.conduct, publishedAt: r.publishedAt?.toISOString() ?? null, updatedAt: r.updatedAt.toISOString() };
}

export async function reportCard(db: Executor, tenant: TenantInfo, p: Principal, examId: string, studentId: string): Promise<ReportCardOut> {
  const [result] = await studentResults(db, studentId, examId);
  if (!result) throw notFound('Report card'); // nothing published for this student yet (also the answer for unpublished drafts)
  const [ex] = await db.select({ e: exams, year: academicYears.name, yearStart: academicYears.startDate }).from(exams).innerJoin(academicYears, eq(academicYears.id, exams.academicYearId)).where(eq(exams.id, examId)).limit(1);
  const bands = await loadBands(db, ex!.e);
  const school = await getSetting(db, 'school');
  const today = todayIn(tenant.timezone);
  const to = ex!.e.endDate && ex!.e.endDate < today ? ex!.e.endDate : today;
  const staffView = p.scope('report_cards:view') === 'school' || p.scope('report_cards:view') === 'assigned';
  const [attendance, remarks] = await Promise.all([attendanceSummary(db, studentId, ex!.yearStart, to < ex!.yearStart ? ex!.yearStart : to), getRemarks(db, examId, studentId, staffView)]);
  return {
    ...result,
    school: { name: tenant.name, address: school.address, phone: school.phone, email: school.email },
    academicYear: ex!.year,
    passPercent: ex!.e.passPercent,
    attendance,
    remarks,
    gradeScale: [...bands].reverse().map((b) => ({ label: b.label, minPercent: b.minPercent, maxPercent: b.maxPercent, gradePoint: b.gradePoint, remark: b.remark })),
  };
}

// ── class-teacher remarks ───────────────────────────────────────────────────────────────────

async function sectionOfStudent(db: Executor, studentId: string) {
  const [s] = await db.select({ sectionId: students.currentSectionId }).from(students).where(eq(students.id, studentId)).limit(1);
  if (!s?.sectionId) throw notFound('Student');
  return s.sectionId;
}

/** Class teacher of the section, or school scope. Everyone else gets 404 (never reveal other classes). */
export function assertCanRemark(p: Principal, perm: 'report_cards:edit' | 'report_cards:view', sectionId: string) {
  if (p.scope(perm) === 'school') return;
  if (!p.leadsSection(sectionId)) throw notFound('Section');
}

export async function listRemarks(db: Executor, p: Principal, examId: string, sectionId: string) {
  assertCanRemark(p, 'report_cards:view', sectionId);
  const rows = await db
    .select({ s: students, r: reportRemarks })
    .from(students)
    .leftJoin(reportRemarks, and(eq(reportRemarks.studentId, students.id), eq(reportRemarks.examId, examId)))
    .where(and(eq(students.currentSectionId, sectionId), isNull(students.archivedAt), notInArray(students.status, [...ENROLLED])))
    .orderBy(asc(students.rollNo), asc(students.firstName));
  return {
    data: rows.map(({ s, r }) => ({
      studentId: s.id,
      name: [s.firstName, s.lastName].filter(Boolean).join(' '),
      admissionNo: s.admissionNo,
      rollNo: s.rollNo,
      remark: r?.remark ?? null,
      areasToImprove: r?.areasToImprove ?? null,
      conduct: r?.conduct ?? null,
      publishedAt: r?.publishedAt?.toISOString() ?? null,
      updatedAt: r?.updatedAt.toISOString() ?? null,
    })),
  };
}

export async function saveRemark(tx: Executor, p: Principal, actor: AuditActor, examId: string, studentId: string, body: { remark?: string | null; areasToImprove?: string | null; conduct?: string | null }) {
  const [ex] = await tx.select({ status: exams.status }).from(exams).where(eq(exams.id, examId)).limit(1);
  if (!ex) throw notFound('Exam');
  if (ex.status === 'draft') throw conflict('The exam has not been scheduled yet', 'INVALID_EXAM_STATE');
  const sectionId = await sectionOfStudent(tx, studentId);
  assertCanRemark(p, 'report_cards:edit', sectionId);
  const [before] = await tx.select().from(reportRemarks).where(and(eq(reportRemarks.examId, examId), eq(reportRemarks.studentId, studentId))).limit(1);
  const next = {
    remark: body.remark === undefined ? (before?.remark ?? null) : (body.remark?.trim() || null),
    areasToImprove: body.areasToImprove === undefined ? (before?.areasToImprove ?? null) : (body.areasToImprove?.trim() || null),
    conduct: body.conduct === undefined ? (before?.conduct ?? null) : (body.conduct?.trim() || null),
  };
  if (!next.remark && !next.areasToImprove && !next.conduct) throw unprocessable('Write at least a remark, an area to improve or a conduct note', 'EMPTY_REMARK');
  // any edit takes the remarks back to draft: parents must never see text nobody approved
  await tx
    .insert(reportRemarks)
    .values({ examId, studentId, ...next, enteredBy: actor.userId ?? null, publishedAt: null })
    .onConflictDoUpdate({ target: [reportRemarks.examId, reportRemarks.studentId], set: { ...next, enteredBy: actor.userId ?? null, publishedAt: null, updatedAt: new Date() } });
  await audit(tx, actor, { action: 'report_card.remark', entity: 'report_remark', entityId: `${examId}:${studentId}`, before: before ? { remark: before.remark, areasToImprove: before.areasToImprove, conduct: before.conduct, published: !!before.publishedAt } : null, after: next });
  return getRemarks(tx, examId, studentId, true);
}

export async function publishRemarks(tx: Executor, actor: AuditActor, examId: string, opts: { sectionId?: string; studentIds?: string[] }) {
  const [ex] = await tx.select({ id: exams.id }).from(exams).where(eq(exams.id, examId)).limit(1);
  if (!ex) throw notFound('Exam');
  const roster = opts.sectionId
    ? (await tx.select({ id: students.id }).from(students).where(eq(students.currentSectionId, opts.sectionId))).map((s) => s.id)
    : opts.studentIds;
  const rows = await tx
    .update(reportRemarks)
    .set({ publishedAt: new Date() })
    .where(and(eq(reportRemarks.examId, examId), isNull(reportRemarks.publishedAt), roster ? inArray(reportRemarks.studentId, roster) : undefined))
    .returning({ studentId: reportRemarks.studentId });
  if (rows.length) await audit(tx, actor, { action: 'report_card.publish', entity: 'exam', entityId: examId, summary: `${rows.length} report card remarks`, after: { sectionId: opts.sectionId ?? null, count: rows.length } });
  return rows.map((r) => r.studentId);
}

export async function notifyReportCards(db: Executor, tenant: TenantInfo, examId: string, studentIds: string[]) {
  const users = await recipientsForStudents(db, studentIds);
  for (let i = 0; i < users.length; i += 1000) {
    await notify(db, tenant, { userIds: users.slice(i, i + 1000), type: 'marks.report_card', title: 'Report card available', body: 'A report card is ready to view.', data: { route: `/results/${examId}`, examId } });
  }
}

// ── analytics (staff) ───────────────────────────────────────────────────────────────────────

export async function examAnalytics(db: Executor, p: Principal, examId: string): Promise<ExamAnalyticsOut> {
  const [ex] = await db.select().from(exams).where(eq(exams.id, examId)).limit(1);
  if (!ex) throw notFound('Exam');
  const scope = and(eq(markSheets.examId, examId), inArray(markSheets.status, ['submitted', 'approved', 'published']), sheetScope(p, 'marks:view', markSheets));
  const pct = sql`(${marks.marksObtained} / ${examPapers.maxMarks} * 100)`;
  const live = sql`not ${marks.isAbsent} and ${marks.marksObtained} is not null`;
  const [rows, perStudent] = await Promise.all([
    db
      .select({
        sectionId: markSheets.sectionId,
        sectionName: sections.name,
        gradeName: grades.name,
        ordinal: grades.ordinal,
        subjectId: markSheets.subjectId,
        subjectName: subjects.name,
        sheetStatus: markSheets.status,
        students: sql<number>`count(${marks.id})::int`,
        absent: sql<number>`(count(*) filter (where ${marks.isAbsent}))::int`,
        appeared: sql<number>`(count(*) filter (where ${live}))::int`,
        avg: sql<number | null>`(avg(${pct}) filter (where ${live}))::float8`,
        hi: sql<number | null>`(max(${pct}) filter (where ${live}))::float8`,
        lo: sql<number | null>`(min(${pct}) filter (where ${live}))::float8`,
        passCount: sql<number>`(count(*) filter (where ${live} and ${marks.marksObtained} >= coalesce(${examPapers.passMarks}, ${examPapers.maxMarks} * ${exams.passPercent} / 100)))::int`,
      })
      .from(markSheets)
      .innerJoin(exams, eq(exams.id, markSheets.examId))
      .innerJoin(examPapers, eq(examPapers.id, markSheets.paperId))
      .innerJoin(sections, eq(sections.id, markSheets.sectionId))
      .innerJoin(grades, eq(grades.id, sections.gradeId))
      .innerJoin(subjects, eq(subjects.id, markSheets.subjectId))
      .leftJoin(marks, eq(marks.sheetId, markSheets.id))
      .where(scope)
      .groupBy(markSheets.id, markSheets.sectionId, sections.name, grades.name, grades.ordinal, markSheets.subjectId, subjects.name, markSheets.status)
      .orderBy(asc(grades.ordinal), asc(sections.name), asc(subjects.name)),
    db
      .select({
        studentId: marks.studentId,
        first: students.firstName,
        last: students.lastName,
        admissionNo: students.admissionNo,
        sectionId: markSheets.sectionId,
        sectionName: sections.name,
        gradeName: grades.name,
        total: sql<number>`sum(coalesce(${marks.marksObtained}, 0))::float8`,
        max: sql<number>`sum(${examPapers.maxMarks})::float8`,
      })
      .from(marks)
      .innerJoin(markSheets, eq(markSheets.id, marks.sheetId))
      .innerJoin(examPapers, eq(examPapers.id, markSheets.paperId))
      .innerJoin(students, eq(students.id, marks.studentId))
      .innerJoin(sections, eq(sections.id, markSheets.sectionId))
      .innerJoin(grades, eq(grades.id, sections.gradeId))
      .where(scope)
      .groupBy(marks.studentId, students.firstName, students.lastName, students.admissionNo, markSheets.sectionId, sections.name, grades.name),
  ]);
  const bands = await loadBands(db, ex);
  const students_ = perStudent.map((s) => ({ ...s, percent: s.max > 0 ? round2((s.total / s.max) * 100) : 0 }));

  const sectionAgg = new Map<string, { sectionId: string; sectionName: string; gradeName: string; students: Set<string>; pctSum: number; passSum: number; appeared: number }>();
  for (const r of rows) {
    const a = sectionAgg.get(r.sectionId) ?? { sectionId: r.sectionId, sectionName: r.sectionName, gradeName: r.gradeName, students: new Set<string>(), pctSum: 0, passSum: 0, appeared: 0 };
    a.pctSum += (r.avg ?? 0) * r.appeared;
    a.appeared += r.appeared;
    a.passSum += r.passCount;
    sectionAgg.set(r.sectionId, a);
  }
  for (const s of students_) sectionAgg.get(s.sectionId)?.students.add(s.studentId);

  const buckets = Array.from({ length: 10 }, (_, i) => ({ range: i === 9 ? '90-100' : `${i * 10}-${i * 10 + 9}`, from: i * 10, to: i === 9 ? 100 : i * 10 + 9, count: 0 }));
  const gradeCount = new Map<string, number>();
  for (const s of students_) {
    buckets[Math.min(9, Math.floor(s.percent / 10))]!.count++;
    const g = gradeFor(bands, s.percent)?.label;
    if (g) gradeCount.set(g, (gradeCount.get(g) ?? 0) + 1);
  }
  return {
    examId,
    examName: ex.name,
    sheetsIncluded: rows.length,
    rows: rows.map((r) => ({
      sectionId: r.sectionId,
      sectionName: r.sectionName,
      gradeName: r.gradeName,
      subjectId: r.subjectId,
      subjectName: r.subjectName,
      sheetStatus: r.sheetStatus,
      students: r.students,
      appeared: r.appeared,
      absent: r.absent,
      averagePercent: r.avg == null ? null : round2(r.avg),
      highestPercent: r.hi == null ? null : round2(r.hi),
      lowestPercent: r.lo == null ? null : round2(r.lo),
      passCount: r.passCount,
      passPercent: r.appeared > 0 ? round2((r.passCount / r.appeared) * 100) : null,
    })),
    sections: [...sectionAgg.values()].map((a) => ({
      sectionId: a.sectionId,
      sectionName: a.sectionName,
      gradeName: a.gradeName,
      students: a.students.size,
      averagePercent: a.appeared ? round2(a.pctSum / a.appeared) : null,
      passPercent: a.appeared ? round2((a.passSum / a.appeared) * 100) : null,
    })),
    topPerformers: [...students_]
      .sort((a, b) => b.percent - a.percent || b.total - a.total)
      .slice(0, 10)
      .map((s) => ({ studentId: s.studentId, name: [s.first, s.last].filter(Boolean).join(' '), admissionNo: s.admissionNo, sectionName: `${s.gradeName} ${s.sectionName}`, percent: s.percent, totalMarks: round2(s.total) })),
    distribution: buckets,
    gradeDistribution: [...gradeCount.entries()].map(([grade, count]) => ({ grade, count })),
  };
}
