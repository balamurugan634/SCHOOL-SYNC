import { date, index, numeric, pgTable, text, time, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { ATTENDANCE_STATUSES, LEAVE_STATUSES, LEAVE_TYPES } from '@school-sync/shared';
import { createdAt, pk, ts, updatedAt } from './_helpers';
import { periods, sections, subjects } from './academics';
import { staff, students } from './people';

/** One roll call: a section on a date, optionally for one period/subject. */
export const attendanceSessions = pgTable(
  'attendance_sessions',
  {
    id: pk(),
    sectionId: uuid('section_id')
      .notNull()
      .references(() => sections.id),
    date: date('date', { mode: 'string' }).notNull(),
    /** NULL = whole-day attendance */
    periodId: uuid('period_id').references(() => periods.id),
    subjectId: uuid('subject_id').references(() => subjects.id),
    takenBy: uuid('taken_by').references(() => staff.id, { onDelete: 'set null' }),
    takenByUserId: uuid('taken_by_user_id'),
    status: text('status', { enum: ['draft', 'submitted'] })
      .notNull()
      .default('submitted'),
    submittedAt: ts('submitted_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('attendance_sessions_uq').on(t.sectionId, t.date, t.periodId).nullsNotDistinct(),
    index('attendance_sessions_date_idx').on(t.date),
  ],
);

/**
 * Hot table (students × school days × periods). `date` and `sectionId` are denormalised from the
 * session so the common queries — a student's history, a section's day, school-wide daily totals —
 * are single-index lookups.
 */
export const attendanceRecords = pgTable(
  'attendance_records',
  {
    id: pk(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => attendanceSessions.id, { onDelete: 'cascade' }),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id),
    sectionId: uuid('section_id').notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    status: text('status', { enum: ATTENDANCE_STATUSES }).notNull(),
    remarks: text('remarks'),
    markedAt: ts('marked_at').notNull().defaultNow(),
    updatedBy: uuid('updated_by'),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('attendance_records_session_student_uq').on(t.sessionId, t.studentId),
    index('attendance_records_student_date_idx').on(t.studentId, t.date.desc()),
    index('attendance_records_section_date_idx').on(t.sectionId, t.date),
    index('attendance_records_date_status_idx').on(t.date, t.status),
  ],
);

/** Post-submission changes go through a request → approval → audited edit. */
export const attendanceCorrections = pgTable(
  'attendance_corrections',
  {
    id: pk(),
    recordId: uuid('record_id')
      .notNull()
      .references(() => attendanceRecords.id, { onDelete: 'cascade' }),
    studentId: uuid('student_id').notNull(),
    sectionId: uuid('section_id').notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    fromStatus: text('from_status', { enum: ATTENDANCE_STATUSES }).notNull(),
    toStatus: text('to_status', { enum: ATTENDANCE_STATUSES }).notNull(),
    reason: text('reason').notNull(),
    requestedBy: uuid('requested_by').notNull(),
    status: text('status', { enum: ['pending', 'approved', 'rejected'] })
      .notNull()
      .default('pending'),
    decidedBy: uuid('decided_by'),
    decidedAt: ts('decided_at'),
    decisionNote: text('decision_note'),
    createdAt: createdAt(),
  },
  (t) => [index('attendance_corrections_status_idx').on(t.status, t.createdAt.desc()), index('attendance_corrections_section_idx').on(t.sectionId)],
);

/** Student leave (applied by parent/student) — approval does not rewrite attendance unless policy says so. */
export const leaveRequests = pgTable(
  'leave_requests',
  {
    id: pk(),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    sectionId: uuid('section_id'),
    requestedBy: uuid('requested_by').notNull(),
    leaveType: text('leave_type', { enum: LEAVE_TYPES }).notNull().default('other'),
    fromDate: date('from_date', { mode: 'string' }).notNull(),
    toDate: date('to_date', { mode: 'string' }).notNull(),
    reason: text('reason').notNull(),
    attachmentFileId: uuid('attachment_file_id'),
    status: text('status', { enum: LEAVE_STATUSES }).notNull().default('pending'),
    decidedBy: uuid('decided_by'),
    decidedAt: ts('decided_at'),
    decisionNote: text('decision_note'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('leave_requests_student_idx').on(t.studentId, t.fromDate.desc()),
    index('leave_requests_status_idx').on(t.status, t.fromDate),
    index('leave_requests_section_idx').on(t.sectionId, t.status),
  ],
);

export const staffLeaveRequests = pgTable(
  'staff_leave_requests',
  {
    id: pk(),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staff.id, { onDelete: 'cascade' }),
    leaveType: text('leave_type', { enum: LEAVE_TYPES }).notNull().default('casual'),
    fromDate: date('from_date', { mode: 'string' }).notNull(),
    toDate: date('to_date', { mode: 'string' }).notNull(),
    reason: text('reason').notNull(),
    status: text('status', { enum: LEAVE_STATUSES }).notNull().default('pending'),
    decidedBy: uuid('decided_by'),
    decidedAt: ts('decided_at'),
    decisionNote: text('decision_note'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('staff_leave_staff_idx').on(t.staffId, t.fromDate.desc()), index('staff_leave_status_idx').on(t.status, t.fromDate)],
);

export const staffAttendance = pgTable(
  'staff_attendance',
  {
    id: pk(),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staff.id, { onDelete: 'cascade' }),
    date: date('date', { mode: 'string' }).notNull(),
    status: text('status', { enum: ATTENDANCE_STATUSES }).notNull(),
    checkIn: time('check_in'),
    checkOut: time('check_out'),
    note: text('note'),
    markedBy: uuid('marked_by'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('staff_attendance_uq').on(t.staffId, t.date), index('staff_attendance_date_idx').on(t.date, t.status)],
);


/** One row per (student, month, kind) once an alert went out — makes the shortage scan idempotent and race-safe. */
export const attendanceAlerts = pgTable(
  'attendance_alerts',
  {
    id: pk(),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    /** `YYYY-MM` the alert belongs to */
    month: text('month').notNull(),
    kind: text('kind', { enum: ['shortage'] })
      .notNull()
      .default('shortage'),
    percentage: numeric('percentage', { precision: 5, scale: 1, mode: 'number' }),
    sentAt: ts('sent_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('attendance_alerts_uq').on(t.studentId, t.month, t.kind)],
);
