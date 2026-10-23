import { z } from 'zod';
import { MAX_PAGE_SIZE, dateStr, timeStr, uuid } from './common';

/** Shared zod schemas for the academics module: years, terms, grades, subjects, sections, assignments, periods, promotions. */

const isoTs = z.string();
const academicsBool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');
export const academicsList = <T extends z.ZodType>(item: T) => z.object({ data: z.array(item) });

export const SUBJECT_TYPES = ['core', 'elective', 'co_scholastic'] as const;
export const PROMOTION_DECISIONS = ['promote', 'retain', 'leave'] as const;
export type PromotionDecision = (typeof PROMOTION_DECISIONS)[number];

// ── academic years ───────────────────────────────────────────────────────────────────────────────
export const academicYearOut = z.object({
  id: uuid,
  name: z.string(),
  startDate: dateStr,
  endDate: dateStr,
  isCurrent: z.boolean(),
  termCount: z.number(),
  sectionCount: z.number(),
  createdAt: isoTs,
});
export type AcademicYearOut = z.infer<typeof academicYearOut>;

export const academicYearCreateBody = z.object({
  /** e.g. `2027-28` */
  name: z.string().trim().min(3).max(20),
  startDate: dateStr,
  endDate: dateStr,
  /** also make it the current year (switches the school over) */
  makeCurrent: z.boolean().optional(),
});
export type AcademicYearCreateBody = z.infer<typeof academicYearCreateBody>;
export const academicYearUpdateBody = z.object({ name: z.string().trim().min(3).max(20).optional(), startDate: dateStr.optional(), endDate: dateStr.optional() });

export const copySectionsBody = z.object({
  fromYearId: uuid,
  /** keep the same class teachers in the new year's sections */
  copyClassTeachers: z.boolean().default(false),
  /** copy the subject→teacher assignments of every copied section */
  copyTeachingAssignments: z.boolean().default(false),
});
export const copySectionsOut = z.object({ created: z.number(), skipped: z.number(), assignmentsCopied: z.number() });

// ── terms ────────────────────────────────────────────────────────────────────────────────────────
export const termOut = z.object({ id: uuid, academicYearId: uuid, name: z.string(), ordinal: z.number(), startDate: dateStr, endDate: dateStr });
export type TermOut = z.infer<typeof termOut>;
export const termCreateBody = z.object({ name: z.string().trim().min(1).max(60), ordinal: z.number().int().min(1).max(12).optional(), startDate: dateStr, endDate: dateStr });
export const termUpdateBody = termCreateBody.partial();

// ── grades & subjects ────────────────────────────────────────────────────────────────────────────
export const gradeOut = z.object({ id: uuid, name: z.string(), ordinal: z.number(), isActive: z.boolean() });
export type GradeOut = z.infer<typeof gradeOut>;
export const gradeCreateBody = z.object({ name: z.string().trim().min(1).max(60), ordinal: z.number().int().min(-5).max(30), isActive: z.boolean().optional() });
export const gradeUpdateBody = gradeCreateBody.partial();

export const subjectOut = z.object({ id: uuid, code: z.string(), name: z.string(), type: z.enum(SUBJECT_TYPES), isActive: z.boolean() });
export type SubjectOut = z.infer<typeof subjectOut>;
export const subjectCreateBody = z.object({ code: z.string().trim().min(1).max(20), name: z.string().trim().min(1).max(100), type: z.enum(SUBJECT_TYPES).optional(), isActive: z.boolean().optional() });
export const subjectUpdateBody = subjectCreateBody.partial();

/** Which subjects a grade offers and how many periods per week. */
export const gradeSubjectOut = z.object({ gradeId: uuid, subjectId: uuid, subjectCode: z.string(), subjectName: z.string(), periodsPerWeek: z.number() });
export type GradeSubjectOut = z.infer<typeof gradeSubjectOut>;
export const gradeSubjectsPutBody = z.object({ subjects: z.array(z.object({ subjectId: uuid, periodsPerWeek: z.number().int().min(1).max(40).default(5) })).max(60) });
export const gradeSubjectsQuery = z.object({ gradeId: uuid.optional() });

// ── periods (school-day structure) ───────────────────────────────────────────────────────────────
export const periodOut = z.object({ id: uuid, name: z.string(), ordinal: z.number(), startTime: timeStr, endTime: timeStr, isBreak: z.boolean() });
export type PeriodOut = z.infer<typeof periodOut>;
export const periodCreateBody = z.object({ name: z.string().trim().min(1).max(60), ordinal: z.number().int().min(1).max(30), startTime: timeStr, endTime: timeStr, isBreak: z.boolean().optional() });
export const periodUpdateBody = periodCreateBody.partial();

// ── sections ─────────────────────────────────────────────────────────────────────────────────────
export const sectionOut = z.object({
  id: uuid,
  gradeId: uuid,
  gradeName: z.string(),
  gradeOrdinal: z.number(),
  academicYearId: uuid,
  academicYearName: z.string(),
  name: z.string(),
  room: z.string().nullable(),
  capacity: z.number().nullable(),
  classTeacherId: uuid.nullable(),
  classTeacherName: z.string().nullable(),
  /** students enrolled in this section for the year */
  studentCount: z.number(),
});
export type SectionOut = z.infer<typeof sectionOut>;

export const sectionTeachingOut = z.object({ id: uuid, subjectId: uuid, subjectCode: z.string(), subjectName: z.string(), staffId: uuid, staffName: z.string() });
export const sectionDetailOut = sectionOut.extend({ teachingAssignments: z.array(sectionTeachingOut) });
export type SectionDetailOut = z.infer<typeof sectionDetailOut>;

export const sectionListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(100),
  q: z.string().trim().max(100).optional(),
  /** default: the current academic year */
  yearId: uuid.optional(),
  gradeId: uuid.optional(),
  /** only sections visible to me by scope in the current year (teacher = assigned, student = own, parent = children's, management = all) */
  mine: academicsBool.optional(),
});
export const sectionCreateBody = z.object({
  gradeId: uuid,
  /** default: the current academic year */
  academicYearId: uuid.optional(),
  name: z.string().trim().min(1).max(20),
  room: z.string().trim().max(40).nullish(),
  capacity: z.number().int().min(1).max(500).nullish(),
  classTeacherId: uuid.nullish(),
});
export const sectionUpdateBody = z.object({ name: z.string().trim().min(1).max(20).optional(), room: z.string().trim().max(40).nullish(), capacity: z.number().int().min(1).max(500).nullish() });
export const classTeacherBody = z.object({ staffId: uuid.nullable() });

// ── teaching assignments ─────────────────────────────────────────────────────────────────────────
export const teachingAssignmentOut = z.object({
  id: uuid,
  sectionId: uuid,
  sectionName: z.string(),
  gradeId: uuid,
  gradeName: z.string(),
  academicYearId: uuid,
  subjectId: uuid,
  subjectCode: z.string(),
  subjectName: z.string(),
  staffId: uuid,
  staffName: z.string(),
  /** periods per week the grade offers this subject for (null if no offering) */
  periodsPerWeek: z.number().nullable(),
});
export type TeachingAssignmentOut = z.infer<typeof teachingAssignmentOut>;
export const teachingAssignmentQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(100),
  sectionId: uuid.optional(),
  staffId: uuid.optional(),
  subjectId: uuid.optional(),
  /** default: the current academic year */
  yearId: uuid.optional(),
});
export const teachingAssignmentCreateBody = z.object({ sectionId: uuid, subjectId: uuid, staffId: uuid });
export const teachingAssignmentUpdateBody = z.object({ staffId: uuid });
export const sectionAssignmentsPutBody = z.object({ assignments: z.array(z.object({ subjectId: uuid, staffId: uuid })).max(60) });

// ── overview ─────────────────────────────────────────────────────────────────────────────────────
export const academicsOverviewOut = z.object({
  currentYear: z.object({ id: uuid, name: z.string(), startDate: dateStr, endDate: dateStr }).nullable(),
  counts: z.object({
    years: z.number(),
    terms: z.number(),
    grades: z.number(),
    sections: z.number(),
    sectionsWithoutClassTeacher: z.number(),
    subjects: z.number(),
    teachingAssignments: z.number(),
    periods: z.number(),
    /** active students visible to the caller (0 without `students:view`) */
    students: z.number(),
    /** active staff; null unless the caller has school-wide `staff:view` */
    staff: z.number().nullable(),
  }),
});

// ── year-end promotion ───────────────────────────────────────────────────────────────────────────
export const promotionBody = z.object({
  fromYearId: uuid,
  toYearId: uuid,
  /** grade → next grade (`null` = graduate). Default: the next higher ordinal; the highest grade graduates. */
  gradeMapping: z.array(z.object({ fromGradeId: uuid, toGradeId: uuid.nullable() })).max(100).optional(),
  /** section → section override */
  sectionMapping: z.array(z.object({ fromSectionId: uuid, toSectionId: uuid })).max(500).optional(),
  /** per-student decisions; everyone else is promoted */
  decisions: z.array(z.object({ studentId: uuid, decision: z.enum(PROMOTION_DECISIONS), toSectionId: uuid.optional() })).max(10000).optional(),
});
export const promotionPreviewBody = promotionBody;
export const promotionApplyBody = promotionBody;
export type PromotionBody = z.infer<typeof promotionBody>;

const promotionTotals = z.object({
  eligible: z.number(),
  promote: z.number(),
  retain: z.number(),
  leave: z.number(),
  /** promoted out of the last grade → alumni */
  graduate: z.number(),
  /** students who get a new-year enrollment (= billable seats consumed in the new year) */
  newSeats: z.number(),
  /** enrolled in the old year but already enrolled in the new year (skipped) */
  alreadyEnrolled: z.number(),
});
export const promotionPreviewOut = z.object({
  fromYear: z.object({ id: uuid, name: z.string() }),
  toYear: z.object({ id: uuid, name: z.string() }),
  totals: promotionTotals,
  byGrade: z.array(
    z.object({
      fromGradeId: uuid,
      fromGradeName: z.string(),
      toGradeId: uuid.nullable(),
      toGradeName: z.string().nullable(),
      students: z.number(),
      promote: z.number(),
      retain: z.number(),
      leave: z.number(),
      graduate: z.number(),
    }),
  ),
  bySection: z.array(z.object({ sectionId: uuid, gradeId: uuid, gradeName: z.string(), name: z.string(), incoming: z.number(), existing: z.number(), capacity: z.number().nullable(), overCapacity: z.boolean() })),
  problems: z.array(z.object({ code: z.string(), message: z.string(), studentId: uuid.optional() })),
  warnings: z.array(z.object({ code: z.string(), message: z.string(), studentId: uuid.optional() })),
  seat: z.object({ ok: z.boolean(), code: z.string().optional(), message: z.string().optional() }),
  canApply: z.boolean(),
});
export type PromotionPreviewOut = z.infer<typeof promotionPreviewOut>;

export const promotionApplyOut = z.object({
  fromYear: z.object({ id: uuid, name: z.string() }),
  toYear: z.object({ id: uuid, name: z.string() }),
  totals: promotionTotals,
  /** new-year enrollments created */
  enrolled: z.number(),
  alumni: z.number(),
  withdrawn: z.number(),
  appliedAt: isoTs,
});
export type PromotionApplyOut = z.infer<typeof promotionApplyOut>;
