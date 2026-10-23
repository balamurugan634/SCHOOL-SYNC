/**
 * Examinations & results: grade scales, exams, schedule (papers), mark sheets, results, report cards, analytics.
 * Used by apps/api (validation + OpenAPI) and by the web / mobile clients (generated types).
 *
 * Visibility rule (enforced server-side): students and parents only ever see `published` mark sheets, the
 * schedule of a non-draft exam for their own grade(s), and class-teacher remarks that have been published.
 */
import { z } from 'zod';
import { dateStr, isoDateTime, pageQuery, timeStr, uuid } from './common';
import { EXAM_STATUSES, EXAM_TYPES, MARK_SHEET_STATUSES } from './enums';

const nullableText = (max: number) => z.string().trim().max(max).nullable().optional();

// ── grade scales ─────────────────────────────────────────────────────────────────────────────

export const gradeBandIn = z
  .object({
    label: z.string().trim().min(1).max(10),
    minPercent: z.number().min(0).max(100),
    maxPercent: z.number().min(0).max(100),
    gradePoint: z.number().min(0).max(10).nullable().optional(),
    remark: nullableText(100),
  })
  .refine((b) => b.minPercent <= b.maxPercent, { message: 'minPercent must not exceed maxPercent', path: ['minPercent'] });
export type GradeBandIn = z.infer<typeof gradeBandIn>;

export const gradeBandOut = z.object({
  id: uuid,
  label: z.string(),
  minPercent: z.number(),
  maxPercent: z.number(),
  gradePoint: z.number().nullable(),
  remark: z.string().nullable(),
});
export type GradeBandOut = z.infer<typeof gradeBandOut>;

export const gradeScaleCreateBody = z.object({
  name: z.string().trim().min(1).max(80),
  isDefault: z.boolean().default(false),
  bands: z.array(gradeBandIn).min(1).max(20),
});
export const gradeScaleUpdateBody = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  isDefault: z.boolean().optional(),
  /** replaces all bands */
  bands: z.array(gradeBandIn).min(1).max(20).optional(),
});
export const gradeScaleOut = z.object({
  id: uuid,
  name: z.string(),
  isDefault: z.boolean(),
  bands: z.array(gradeBandOut),
  createdAt: isoDateTime,
});
export type GradeScaleOut = z.infer<typeof gradeScaleOut>;

// ── exams ───────────────────────────────────────────────────────────────────────────────────

export const examCreateBody = z
  .object({
    name: z.string().trim().min(2).max(120),
    examType: z.enum(EXAM_TYPES).default('unit_test'),
    /** defaults to the current academic year */
    academicYearId: uuid.optional(),
    termId: uuid.nullable().optional(),
    /** defaults to the school's default grade scale */
    gradeScaleId: uuid.nullable().optional(),
    startDate: dateStr.nullable().optional(),
    endDate: dateStr.nullable().optional(),
    passPercent: z.number().min(0).max(100).default(35),
  })
  .refine((e) => !e.startDate || !e.endDate || e.startDate <= e.endDate, { message: 'endDate must be on or after startDate', path: ['endDate'] });
export const examUpdateBody = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    examType: z.enum(EXAM_TYPES).optional(),
    termId: uuid.nullable().optional(),
    gradeScaleId: uuid.nullable().optional(),
    startDate: dateStr.nullable().optional(),
    endDate: dateStr.nullable().optional(),
    passPercent: z.number().min(0).max(100).optional(),
  })
  .refine((e) => !e.startDate || !e.endDate || e.startDate <= e.endDate, { message: 'endDate must be on or after startDate', path: ['endDate'] });

export const examListQuery = pageQuery.extend({
  academicYearId: uuid.optional(),
  termId: uuid.optional(),
  status: z.enum(EXAM_STATUSES).optional(),
  examType: z.enum(EXAM_TYPES).optional(),
  /** only exams whose end date (or start date) is today or later */
  upcoming: z.stringbool().optional(),
});

export const sheetStats = z.object({ total: z.number(), draft: z.number(), submitted: z.number(), approved: z.number(), returned: z.number(), published: z.number() });
export type SheetStats = z.infer<typeof sheetStats>;

export const examOut = z.object({
  id: uuid,
  name: z.string(),
  examType: z.enum(EXAM_TYPES),
  academicYearId: uuid,
  academicYearName: z.string().nullable(),
  termId: uuid.nullable(),
  termName: z.string().nullable(),
  gradeScaleId: uuid.nullable(),
  startDate: dateStr.nullable(),
  endDate: dateStr.nullable(),
  passPercent: z.number(),
  status: z.enum(EXAM_STATUSES),
  publishedAt: isoDateTime.nullable(),
  createdAt: isoDateTime,
  paperCount: z.number(),
  /** mark-sheet progress; only for staff who manage/review marks (null for students & parents) */
  sheets: sheetStats.nullable(),
});
export type ExamOut = z.infer<typeof examOut>;

export const examPublishBody = z.object({
  /** publish even if some mark sheets are not yet approved (those stay hidden from students/parents) */
  force: z.boolean().default(false),
});

// ── schedule (papers) ───────────────────────────────────────────────────────────────────────

const paperFields = {
  gradeId: uuid,
  subjectId: uuid,
  examDate: dateStr.nullable().optional(),
  startTime: timeStr.nullable().optional(),
  endTime: timeStr.nullable().optional(),
  room: nullableText(60),
  maxMarks: z.number().positive().max(1000).default(100),
  passMarks: z.number().min(0).max(1000).nullable().optional(),
};
const paperRules = <T extends z.ZodType<{ examDate?: string | null; startTime?: string | null; endTime?: string | null; maxMarks?: number; passMarks?: number | null }>>(s: T) =>
  s
    .refine((p) => (p.startTime || p.endTime ? !!p.examDate : true), { message: 'examDate is required when a time is given', path: ['examDate'] })
    .refine((p) => !p.startTime || !p.endTime || p.startTime < p.endTime, { message: 'endTime must be after startTime', path: ['endTime'] })
    .refine((p) => p.passMarks == null || p.maxMarks == null || p.passMarks <= p.maxMarks, { message: 'passMarks must not exceed maxMarks', path: ['passMarks'] });

export const paperCreateBody = paperRules(z.object(paperFields));
export const paperUpdateBody = paperRules(z.object({ ...paperFields, gradeId: uuid.optional(), subjectId: uuid.optional(), maxMarks: z.number().positive().max(1000).optional() }));
export const paperBulkBody = z.object({ papers: z.array(paperCreateBody).min(1).max(200) });

export const paperOut = z.object({
  id: uuid,
  examId: uuid,
  gradeId: uuid,
  gradeName: z.string(),
  subjectId: uuid,
  subjectName: z.string(),
  subjectCode: z.string(),
  examDate: dateStr.nullable(),
  startTime: timeStr.nullable(),
  endTime: timeStr.nullable(),
  room: z.string().nullable(),
  maxMarks: z.number(),
  passMarks: z.number().nullable(),
});
export type PaperOut = z.infer<typeof paperOut>;
export const paperListQuery = z.object({ gradeId: uuid.optional() });

// ── mark sheets ─────────────────────────────────────────────────────────────────────────────

export const sheetGenerateBody = z.object({ sectionId: uuid.optional() }).default({});
export const sheetGenerateOut = z.object({
  created: z.number(),
  existing: z.number(),
  /** papers (grade x subject) for which a section had no subject teacher assignment, so no sheet was created */
  skipped: z.array(z.object({ sectionId: uuid, sectionName: z.string(), subjectId: uuid, subjectName: z.string(), reason: z.string() })),
});

export const sheetListQuery = pageQuery.extend({
  examId: uuid.optional(),
  sectionId: uuid.optional(),
  subjectId: uuid.optional(),
  status: z.enum(MARK_SHEET_STATUSES).optional(),
  /** only sheets I am the subject teacher of */
  mine: z.stringbool().optional(),
});

export const sheetOut = z.object({
  id: uuid,
  examId: uuid,
  examName: z.string(),
  paperId: uuid,
  sectionId: uuid,
  sectionName: z.string(),
  gradeId: uuid,
  gradeName: z.string(),
  subjectId: uuid,
  subjectName: z.string(),
  status: z.enum(MARK_SHEET_STATUSES),
  maxMarks: z.number(),
  passMarks: z.number().nullable(),
  teacherName: z.string().nullable(),
  studentCount: z.number(),
  enteredCount: z.number(),
  absentCount: z.number(),
  submittedAt: isoDateTime.nullable(),
  reviewedAt: isoDateTime.nullable(),
  publishedAt: isoDateTime.nullable(),
  returnNote: z.string().nullable(),
});
export type SheetOut = z.infer<typeof sheetOut>;

export const sheetEntryOut = z.object({
  studentId: uuid,
  admissionNo: z.string(),
  name: z.string(),
  rollNo: z.number().nullable(),
  marksObtained: z.number().nullable(),
  isAbsent: z.boolean(),
  remarks: z.string().nullable(),
});
export type SheetEntryOut = z.infer<typeof sheetEntryOut>;

export const sheetDetailOut = sheetOut.extend({
  /** the caller may enter/edit marks right now (subject teacher + sheet is draft/returned + marks entry is open) */
  canEdit: z.boolean(),
  entries: z.array(sheetEntryOut),
});
export type SheetDetailOut = z.infer<typeof sheetDetailOut>;

export const markEntryIn = z
  .object({
    studentId: uuid,
    marksObtained: z.number().min(0).max(1000).nullable().optional(),
    isAbsent: z.boolean().default(false),
    remarks: nullableText(300),
  })
  .refine((e) => !(e.isAbsent && e.marksObtained != null), { message: 'An absent student cannot have marks', path: ['marksObtained'] });
export const markEntriesBody = z.object({ entries: z.array(markEntryIn).min(1).max(300) });

export const sheetSubmitBody = z.object({}).default({});
export const sheetApproveBody = z.object({ note: z.string().trim().max(500).optional() }).default({});
export const sheetReturnBody = z.object({ note: z.string().trim().min(3).max(500) });
export const sheetCorrectBody = z.object({
  /** mandatory: why a published mark is being changed (kept in the audit trail) */
  reason: z.string().trim().min(5).max(500),
  entries: markEntriesBody.shape.entries,
});
export const sheetBulkPublishBody = z.object({ sectionId: uuid.optional(), subjectId: uuid.optional() }).default({});
export const sheetBulkPublishOut = z.object({ published: z.number(), skipped: z.number() });

// ── results & report cards ──────────────────────────────────────────────────────────────────

export const resultSubjectOut = z.object({
  subjectId: uuid,
  subjectName: z.string(),
  subjectCode: z.string(),
  sheetId: uuid,
  maxMarks: z.number(),
  passMarks: z.number(),
  marksObtained: z.number().nullable(),
  isAbsent: z.boolean(),
  percent: z.number().nullable(),
  grade: z.string().nullable(),
  gradePoint: z.number().nullable(),
  passed: z.boolean(),
  remarks: z.string().nullable(),
});
export type ResultSubjectOut = z.infer<typeof resultSubjectOut>;

export const studentResultOut = z.object({
  examId: uuid,
  examName: z.string(),
  examType: z.enum(EXAM_TYPES),
  termName: z.string().nullable(),
  startDate: dateStr.nullable(),
  endDate: dateStr.nullable(),
  studentId: uuid,
  studentName: z.string(),
  admissionNo: z.string(),
  rollNo: z.number().nullable(),
  sectionId: uuid.nullable(),
  sectionName: z.string().nullable(),
  gradeName: z.string().nullable(),
  subjects: z.array(resultSubjectOut),
  totalMarks: z.number(),
  maxTotal: z.number(),
  percent: z.number().nullable(),
  grade: z.string().nullable(),
  gradePoint: z.number().nullable(),
  gradeRemark: z.string().nullable(),
  result: z.enum(['pass', 'fail']).nullable(),
  /** rank within the section by overall percent (ties share a rank) */
  rank: z.number().nullable(),
  classSize: z.number(),
  /** share of classmates this student scored above, 0-100 */
  percentile: z.number().nullable(),
  /** every subject paper of the grade has a published sheet; otherwise the numbers are provisional */
  complete: z.boolean(),
  subjectsPublished: z.number(),
  subjectsExpected: z.number(),
});
export type StudentResultOut = z.infer<typeof studentResultOut>;

export const resultsQuery = z.object({ studentId: uuid.optional(), examId: uuid.optional() });
export const resultsOut = z.object({ data: z.array(studentResultOut) });

export const classResultsQuery = z.object({ examId: uuid, sectionId: uuid });
export const classResultRow = z.object({
  studentId: uuid,
  name: z.string(),
  admissionNo: z.string(),
  rollNo: z.number().nullable(),
  totalMarks: z.number(),
  maxTotal: z.number(),
  percent: z.number().nullable(),
  grade: z.string().nullable(),
  result: z.enum(['pass', 'fail']).nullable(),
  rank: z.number().nullable(),
  subjectsPublished: z.number(),
});
export const classResultsOut = z.object({ examId: uuid, sectionId: uuid, subjectsExpected: z.number(), data: z.array(classResultRow) });

export const progressQuery = z.object({ studentId: uuid.optional() });
export const progressOut = z.object({
  studentId: uuid,
  exams: z.array(z.object({ examId: uuid, name: z.string(), examType: z.enum(EXAM_TYPES), date: dateStr.nullable(), percent: z.number().nullable(), grade: z.string().nullable() })),
  subjects: z.array(
    z.object({
      subjectId: uuid,
      subjectName: z.string(),
      points: z.array(z.object({ examId: uuid, percent: z.number().nullable(), marks: z.number().nullable(), maxMarks: z.number(), isAbsent: z.boolean() })),
    }),
  ),
});

export const attendanceSummaryOut = z.object({
  from: dateStr,
  to: dateStr,
  totalDays: z.number(),
  present: z.number(),
  late: z.number(),
  halfDay: z.number(),
  leave: z.number(),
  absent: z.number(),
  /** (present + late + half_day / 2) / recorded days, 0-100; null when no attendance was recorded */
  percent: z.number().nullable(),
});

export const reportRemarkIn = z.object({
  remark: nullableText(1000),
  areasToImprove: nullableText(1000),
  conduct: nullableText(200),
});
export const reportRemarkOut = z.object({
  remark: z.string().nullable(),
  areasToImprove: z.string().nullable(),
  conduct: z.string().nullable(),
  publishedAt: isoDateTime.nullable(),
  updatedAt: isoDateTime.nullable(),
});

export const reportCardOut = studentResultOut.extend({
  school: z.object({ name: z.string(), address: z.string(), phone: z.string(), email: z.string() }),
  academicYear: z.string().nullable(),
  passPercent: z.number(),
  attendance: attendanceSummaryOut.nullable(),
  /** class teacher remarks; null until the school publishes report cards */
  remarks: reportRemarkOut.nullable(),
  gradeScale: z.array(gradeBandOut.pick({ label: true, minPercent: true, maxPercent: true, gradePoint: true, remark: true })),
});
export type ReportCardOut = z.infer<typeof reportCardOut>;

export const reportRemarksQuery = z.object({ sectionId: uuid });
export const reportRemarkRow = reportRemarkOut.extend({ studentId: uuid, name: z.string(), admissionNo: z.string(), rollNo: z.number().nullable() });
export const reportRemarksOut = z.object({ data: z.array(reportRemarkRow) });
export const reportCardsPublishBody = z.object({ sectionId: uuid.optional(), studentIds: z.array(uuid).max(500).optional() }).default({});
export const reportCardsPublishOut = z.object({ published: z.number() });

// ── analytics ───────────────────────────────────────────────────────────────────────────────

export const examAnalyticsOut = z.object({
  examId: uuid,
  examName: z.string(),
  /** how many mark sheets (submitted/approved/published, within the caller's scope) the figures cover */
  sheetsIncluded: z.number(),
  rows: z.array(
    z.object({
      sectionId: uuid,
      sectionName: z.string(),
      gradeName: z.string(),
      subjectId: uuid,
      subjectName: z.string(),
      sheetStatus: z.enum(MARK_SHEET_STATUSES),
      students: z.number(),
      appeared: z.number(),
      absent: z.number(),
      averagePercent: z.number().nullable(),
      highestPercent: z.number().nullable(),
      lowestPercent: z.number().nullable(),
      passCount: z.number(),
      passPercent: z.number().nullable(),
    }),
  ),
  sections: z.array(z.object({ sectionId: uuid, sectionName: z.string(), gradeName: z.string(), students: z.number(), averagePercent: z.number().nullable(), passPercent: z.number().nullable() })),
  topPerformers: z.array(z.object({ studentId: uuid, name: z.string(), admissionNo: z.string(), sectionName: z.string(), percent: z.number(), totalMarks: z.number() })),
  /** students by overall percent, 10-point buckets */
  distribution: z.array(z.object({ range: z.string(), from: z.number(), to: z.number(), count: z.number() })),
  gradeDistribution: z.array(z.object({ grade: z.string(), count: z.number() })),
});
export type ExamAnalyticsOut = z.infer<typeof examAnalyticsOut>;

export const marksExportQuery = z.object({ examId: uuid, sectionId: uuid.optional(), subjectId: uuid.optional() });
