import { sql } from 'drizzle-orm';
import { boolean, date, index, integer, jsonb, pgTable, text, uniqueIndex, uuid, numeric } from 'drizzle-orm/pg-core';
import { HOMEWORK_STATUSES, SUBMISSION_STATUSES, TASK_PRIORITIES, TASK_STATUSES } from '@school-sync/shared';
import { createdAt, pk, ts, updatedAt } from './_helpers';
import { grades, periods, sections, subjects, terms } from './academics';
import { staff, students } from './people';

export const timetableSlots = pgTable(
  'timetable_slots',
  {
    id: pk(),
    sectionId: uuid('section_id')
      .notNull()
      .references(() => sections.id, { onDelete: 'cascade' }),
    /** ISO weekday 1 (Mon) … 7 (Sun) */
    dayOfWeek: integer('day_of_week').notNull(),
    periodId: uuid('period_id')
      .notNull()
      .references(() => periods.id),
    subjectId: uuid('subject_id').references(() => subjects.id),
    staffId: uuid('staff_id').references(() => staff.id, { onDelete: 'set null' }),
    room: text('room'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('timetable_slots_uq').on(t.sectionId, t.dayOfWeek, t.periodId), index('timetable_slots_staff_idx').on(t.staffId, t.dayOfWeek)],
);

/** One-day cover for an absent teacher. */
export const timetableSubstitutions = pgTable(
  'timetable_substitutions',
  {
    id: pk(),
    slotId: uuid('slot_id')
      .notNull()
      .references(() => timetableSlots.id, { onDelete: 'cascade' }),
    date: date('date', { mode: 'string' }).notNull(),
    substituteStaffId: uuid('substitute_staff_id')
      .notNull()
      .references(() => staff.id),
    reason: text('reason'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('timetable_substitutions_uq').on(t.slotId, t.date), index('timetable_substitutions_date_idx').on(t.date, t.substituteStaffId)],
);

export interface AttachmentRef {
  fileId: string;
  name: string;
  mimeType?: string;
  sizeBytes?: number;
}

export const homework = pgTable(
  'homework',
  {
    id: pk(),
    sectionId: uuid('section_id')
      .notNull()
      .references(() => sections.id, { onDelete: 'cascade' }),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id),
    staffId: uuid('staff_id').references(() => staff.id, { onDelete: 'set null' }),
    createdByUserId: uuid('created_by_user_id'),
    title: text('title').notNull(),
    description: text('description'),
    attachments: jsonb('attachments').$type<AttachmentRef[]>().notNull().default([]),
    assignedAt: ts('assigned_at').notNull().defaultNow(),
    dueAt: ts('due_at').notNull(),
    allowSubmission: boolean('allow_submission').notNull().default(true),
    maxMarks: integer('max_marks'),
    status: text('status', { enum: HOMEWORK_STATUSES }).notNull().default('published'),
    /** set by the "due tomorrow" job so the reminder goes out once */
    dueReminderSentAt: ts('due_reminder_sent_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('homework_section_due_idx').on(t.sectionId, t.dueAt.desc()),
    index('homework_staff_idx').on(t.staffId, t.createdAt.desc()),
    index('homework_due_idx').on(t.dueAt).where(sql`${t.status} = 'published'`),
    // file-access lookups (`attachments @> '[{"fileId": …}]'`) — see modules/files/access.ts
    index('homework_attachments_gin').using('gin', t.attachments.op('jsonb_path_ops')),
  ],
);

export const homeworkSubmissions = pgTable(
  'homework_submissions',
  {
    id: pk(),
    homeworkId: uuid('homework_id')
      .notNull()
      .references(() => homework.id, { onDelete: 'cascade' }),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    text: text('text'),
    attachments: jsonb('attachments').$type<AttachmentRef[]>().notNull().default([]),
    submittedAt: ts('submitted_at').notNull().defaultNow(),
    status: text('status', { enum: SUBMISSION_STATUSES }).notNull().default('submitted'),
    marks: numeric('marks', { precision: 6, scale: 2, mode: 'number' }),
    feedback: text('feedback'),
    reviewedBy: uuid('reviewed_by'),
    reviewedAt: ts('reviewed_at'),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('homework_submissions_uq').on(t.homeworkId, t.studentId), index('homework_submissions_student_idx').on(t.studentId, t.submittedAt.desc()), index('homework_submissions_attachments_gin').using('gin', t.attachments.op('jsonb_path_ops'))],
);

export const materials = pgTable(
  'materials',
  {
    id: pk(),
    title: text('title').notNull(),
    description: text('description'),
    gradeId: uuid('grade_id').references(() => grades.id),
    sectionId: uuid('section_id').references(() => sections.id, { onDelete: 'cascade' }),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id),
    fileId: uuid('file_id'),
    url: text('url'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    archivedAt: ts('archived_at'),
  },
  (t) => [index('materials_section_idx').on(t.sectionId, t.subjectId), index('materials_grade_idx').on(t.gradeId, t.subjectId), index('materials_file_idx').on(t.fileId)],
);

export const syllabusTopics = pgTable(
  'syllabus_topics',
  {
    id: pk(),
    gradeId: uuid('grade_id')
      .notNull()
      .references(() => grades.id, { onDelete: 'cascade' }),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'cascade' }),
    termId: uuid('term_id').references(() => terms.id),
    title: text('title').notNull(),
    ordinal: integer('ordinal').notNull().default(0),
    plannedHours: integer('planned_hours'),
  },
  (t) => [index('syllabus_topics_idx').on(t.gradeId, t.subjectId, t.ordinal)],
);

export const topicProgress = pgTable(
  'topic_progress',
  {
    id: pk(),
    topicId: uuid('topic_id')
      .notNull()
      .references(() => syllabusTopics.id, { onDelete: 'cascade' }),
    sectionId: uuid('section_id')
      .notNull()
      .references(() => sections.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ['not_started', 'in_progress', 'completed'] })
      .notNull()
      .default('not_started'),
    completedAt: ts('completed_at'),
    updatedBy: uuid('updated_by'),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('topic_progress_uq').on(t.topicId, t.sectionId)],
);

/** The student's own to-do list (personal; homework shows up alongside it via a query, not a copy). */
export const studentTasks = pgTable(
  'student_tasks',
  {
    id: pk(),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    notes: text('notes'),
    dueAt: ts('due_at'),
    remindAt: ts('remind_at'),
    priority: text('priority', { enum: TASK_PRIORITIES }).notNull().default('normal'),
    status: text('status', { enum: TASK_STATUSES }).notNull().default('todo'),
    completedAt: ts('completed_at'),
    /** set once the `tasks.reminder` notification was sent for the current `remindAt` (reset when remindAt changes) */
    remindedAt: ts('reminded_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('student_tasks_student_idx').on(t.studentId, t.status, t.dueAt),
    index('student_tasks_remind_idx').on(t.remindAt).where(sql`${t.remindedAt} is null and ${t.status} <> 'done'`),
  ],
);

