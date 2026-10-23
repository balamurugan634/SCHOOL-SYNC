import { boolean, date, index, integer, numeric, pgTable, text, time, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { EXAM_STATUSES, EXAM_TYPES, MARK_SHEET_STATUSES } from '@school-sync/shared';
import { createdAt, pk, ts, updatedAt } from './_helpers';
import { academicYears, grades, sections, subjects, terms } from './academics';
import { students } from './people';

export const gradeScales = pgTable('grade_scales', {
  id: pk(),
  name: text('name').notNull(),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: createdAt(),
});

export const gradeScaleBands = pgTable(
  'grade_scale_bands',
  {
    id: pk(),
    scaleId: uuid('scale_id')
      .notNull()
      .references(() => gradeScales.id, { onDelete: 'cascade' }),
    label: text('label').notNull(), // A+
    minPercent: numeric('min_percent', { precision: 5, scale: 2, mode: 'number' }).notNull(),
    maxPercent: numeric('max_percent', { precision: 5, scale: 2, mode: 'number' }).notNull(),
    gradePoint: numeric('grade_point', { precision: 4, scale: 2, mode: 'number' }),
    remark: text('remark'),
  },
  (t) => [index('grade_scale_bands_scale_idx').on(t.scaleId, t.minPercent)],
);

export const exams = pgTable(
  'exams',
  {
    id: pk(),
    name: text('name').notNull(),
    examType: text('exam_type', { enum: EXAM_TYPES }).notNull().default('unit_test'),
    academicYearId: uuid('academic_year_id')
      .notNull()
      .references(() => academicYears.id),
    termId: uuid('term_id').references(() => terms.id),
    gradeScaleId: uuid('grade_scale_id').references(() => gradeScales.id),
    startDate: date('start_date', { mode: 'string' }),
    endDate: date('end_date', { mode: 'string' }),
    passPercent: numeric('pass_percent', { precision: 5, scale: 2, mode: 'number' }).notNull().default(35),
    status: text('status', { enum: EXAM_STATUSES }).notNull().default('draft'),
    publishedAt: ts('published_at'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('exams_year_idx').on(t.academicYearId, t.startDate)],
);

/** The schedule: one paper per grade × subject × exam. */
export const examPapers = pgTable(
  'exam_papers',
  {
    id: pk(),
    examId: uuid('exam_id')
      .notNull()
      .references(() => exams.id, { onDelete: 'cascade' }),
    gradeId: uuid('grade_id')
      .notNull()
      .references(() => grades.id),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id),
    examDate: date('exam_date', { mode: 'string' }),
    startTime: time('start_time'),
    endTime: time('end_time'),
    room: text('room'),
    maxMarks: numeric('max_marks', { precision: 6, scale: 2, mode: 'number' }).notNull().default(100),
    passMarks: numeric('pass_marks', { precision: 6, scale: 2, mode: 'number' }),
  },
  (t) => [uniqueIndex('exam_papers_uq').on(t.examId, t.gradeId, t.subjectId), index('exam_papers_date_idx').on(t.examDate)],
);

/**
 * Workflow unit: exam × section × subject. Teacher enters marks (draft) → submits →
 * principal approves → publishes. Students/parents only ever see `published` sheets.
 */
export const markSheets = pgTable(
  'mark_sheets',
  {
    id: pk(),
    examId: uuid('exam_id')
      .notNull()
      .references(() => exams.id, { onDelete: 'cascade' }),
    paperId: uuid('paper_id')
      .notNull()
      .references(() => examPapers.id, { onDelete: 'cascade' }),
    sectionId: uuid('section_id')
      .notNull()
      .references(() => sections.id),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id),
    status: text('status', { enum: MARK_SHEET_STATUSES }).notNull().default('draft'),
    submittedBy: uuid('submitted_by'),
    submittedAt: ts('submitted_at'),
    reviewedBy: uuid('reviewed_by'),
    reviewedAt: ts('reviewed_at'),
    publishedBy: uuid('published_by'),
    publishedAt: ts('published_at'),
    returnNote: text('return_note'),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('mark_sheets_uq').on(t.examId, t.sectionId, t.subjectId), index('mark_sheets_status_idx').on(t.status, t.examId)],
);

export const marks = pgTable(
  'marks',
  {
    id: pk(),
    sheetId: uuid('sheet_id')
      .notNull()
      .references(() => markSheets.id, { onDelete: 'cascade' }),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id),
    marksObtained: numeric('marks_obtained', { precision: 6, scale: 2, mode: 'number' }),
    isAbsent: boolean('is_absent').notNull().default(false),
    remarks: text('remarks'),
    enteredBy: uuid('entered_by'),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('marks_uq').on(t.sheetId, t.studentId), index('marks_student_idx').on(t.studentId)],
);

/** Class-teacher remarks that appear on the report card. */
export const reportRemarks = pgTable(
  'report_remarks',
  {
    id: pk(),
    examId: uuid('exam_id')
      .notNull()
      .references(() => exams.id, { onDelete: 'cascade' }),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    remark: text('remark'),
    areasToImprove: text('areas_to_improve'),
    conduct: text('conduct'),
    enteredBy: uuid('entered_by'),
    publishedAt: ts('published_at'),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('report_remarks_uq').on(t.examId, t.studentId)],
);


/** Reminder ledger so the daily `exams.reminders` job tells each grade about tomorrow's exam exactly once. */
export const examReminders = pgTable(
  'exam_reminders',
  {
    id: pk(),
    examId: uuid('exam_id')
      .notNull()
      .references(() => exams.id, { onDelete: 'cascade' }),
    gradeId: uuid('grade_id')
      .notNull()
      .references(() => grades.id, { onDelete: 'cascade' }),
    forDate: date('for_date', { mode: 'string' }).notNull(),
    recipients: integer('recipients').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('exam_reminders_uq').on(t.examId, t.gradeId, t.forDate)],
);
