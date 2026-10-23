import { boolean, date, index, integer, pgTable, primaryKey, text, time, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, pk, updatedAt } from './_helpers';
import { staff } from './people';

export const academicYears = pgTable(
  'academic_years',
  {
    id: pk(),
    name: text('name').notNull(), // 2026-27
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }).notNull(),
    isCurrent: boolean('is_current').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('academic_years_name_uq').on(t.name), uniqueIndex('academic_years_current_uq').on(t.isCurrent).where(sql`${t.isCurrent}`)],
);

export const terms = pgTable('terms', {
  id: pk(),
  academicYearId: uuid('academic_year_id')
    .notNull()
    .references(() => academicYears.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  ordinal: integer('ordinal').notNull(),
  startDate: date('start_date', { mode: 'string' }).notNull(),
  endDate: date('end_date', { mode: 'string' }).notNull(),
});

/** "Class" / "Grade 8" */
export const grades = pgTable(
  'grades',
  {
    id: pk(),
    name: text('name').notNull(),
    ordinal: integer('ordinal').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('grades_name_uq').on(t.name)],
);

export const sections = pgTable(
  'sections',
  {
    id: pk(),
    gradeId: uuid('grade_id')
      .notNull()
      .references(() => grades.id),
    academicYearId: uuid('academic_year_id')
      .notNull()
      .references(() => academicYears.id),
    name: text('name').notNull(), // A
    classTeacherId: uuid('class_teacher_id').references(() => staff.id, { onDelete: 'set null' }),
    room: text('room'),
    capacity: integer('capacity'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('sections_uq').on(t.gradeId, t.academicYearId, t.name), index('sections_teacher_idx').on(t.classTeacherId)],
);

export const subjects = pgTable(
  'subjects',
  {
    id: pk(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    type: text('type', { enum: ['core', 'elective', 'co_scholastic'] })
      .notNull()
      .default('core'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('subjects_code_uq').on(t.code)],
);

export const gradeSubjects = pgTable(
  'grade_subjects',
  {
    gradeId: uuid('grade_id')
      .notNull()
      .references(() => grades.id, { onDelete: 'cascade' }),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'cascade' }),
    periodsPerWeek: integer('periods_per_week').notNull().default(5),
  },
  (t) => [primaryKey({ columns: [t.gradeId, t.subjectId] })],
);

/** Which teacher teaches which subject in which section. Drives the `assigned` scope. */
export const teachingAssignments = pgTable(
  'teaching_assignments',
  {
    id: pk(),
    sectionId: uuid('section_id')
      .notNull()
      .references(() => sections.id, { onDelete: 'cascade' }),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staff.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('teaching_assignments_uq').on(t.sectionId, t.subjectId), index('teaching_assignments_staff_idx').on(t.staffId)],
);

/** School-day period definitions (Period 1, Break, …). */
export const periods = pgTable(
  'periods',
  {
    id: pk(),
    name: text('name').notNull(),
    ordinal: integer('ordinal').notNull(),
    startTime: time('start_time').notNull(),
    endTime: time('end_time').notNull(),
    isBreak: boolean('is_break').notNull().default(false),
  },
  (t) => [uniqueIndex('periods_ordinal_uq').on(t.ordinal)],
);
