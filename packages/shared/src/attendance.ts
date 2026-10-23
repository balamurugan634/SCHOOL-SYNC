import { z } from 'zod';
import { cursored, cursorQuery, dateStr, isoDateTime, pageQuery, paged, timeStr, uuid } from './common';
import { ATTENDANCE_STATUSES, LEAVE_STATUSES, LEAVE_TYPES } from './enums';
import { learningBoolQuery } from './learning';

/**
 * Attendance & leave: roll call, corrections, summaries, student leave, staff attendance, staff leave.
 * Every exported name is prefixed with its domain (attendance*, leave*, staffAttendance*, staffLeave*) so `export *`
 * from index.ts never collides with other modules.
 *
 * Percentage rule used everywhere: `(present + late + ½·half_day) / (present + absent + late + half_day) × 100`,
 * rounded to one decimal; days on approved `leave` are excluded from the denominator. `null` = nothing to measure yet.
 */

export const attendanceStatus = z.enum(ATTENDANCE_STATUSES);
export const attendanceMode = z.enum(['daily', 'period']);

const yearMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected YYYY-MM');

export const attendanceStatusCounts = z.object({
  present: z.number().int(),
  absent: z.number().int(),
  late: z.number().int(),
  leave: z.number().int(),
  half_day: z.number().int(),
});
export type AttendanceStatusCounts = z.infer<typeof attendanceStatusCounts>;

/** counts + total + percentage */
export const attendanceTotals = attendanceStatusCounts.extend({ total: z.number().int(), percentage: z.number().nullable() });
export type AttendanceTotals = z.infer<typeof attendanceTotals>;

// ───────────────────────────── roll call ─────────────────────────────

export const attendanceRosterQuery = z.object({
  /** defaults to today (school time) */
  date: dateStr.optional(),
  /** required in `period` mode */
  periodId: uuid.optional(),
});

export const attendanceRosterStudent = z.object({
  studentId: uuid,
  name: z.string(),
  admissionNo: z.string(),
  rollNo: z.number().int().nullable(),
  /** the saved attendance record (null until marked) — the handle for `POST /attendance/records/:id/corrections` */
  recordId: uuid.nullable(),
  /** null = not marked yet */
  status: attendanceStatus.nullable(),
  remarks: z.string().nullable(),
  /** `marked` = saved in the session, `leave` = pre-filled from an approved leave request, null = nothing yet */
  source: z.enum(['marked', 'leave']).nullable(),
  onApprovedLeave: z.boolean(),
  markedAt: isoDateTime.nullable(),
});
export type AttendanceRosterStudent = z.infer<typeof attendanceRosterStudent>;

export const attendanceSessionInfo = z.object({
  id: uuid,
  status: z.enum(['draft', 'submitted']),
  takenByName: z.string().nullable(),
  submittedAt: isoDateTime.nullable(),
  /** teachers may re-submit until this instant; afterwards a correction request is needed (null for drafts) */
  editableUntil: isoDateTime.nullable(),
});

export const attendanceRosterResponse = z.object({
  sectionId: uuid,
  sectionName: z.string(),
  gradeName: z.string(),
  date: dateStr,
  mode: attendanceMode,
  periodId: uuid.nullable(),
  periodName: z.string().nullable(),
  subjectId: uuid.nullable(),
  subjectName: z.string().nullable(),
  isWorkingDay: z.boolean(),
  /** title of a published holiday event covering the date */
  holiday: z.string().nullable(),
  isFuture: z.boolean(),
  session: attendanceSessionInfo.nullable(),
  /** may the caller submit this roll call right now? */
  canSubmit: z.boolean(),
  /** machine code when `canSubmit` is false: FUTURE_DATE | NOT_A_WORKING_DAY | HOLIDAY | EDIT_WINDOW_CLOSED | NOT_CLASS_TEACHER | NOT_YOUR_PERIOD | NOT_ALLOWED_TO_MARK | PERIOD_REQUIRED */
  blockedReason: z.string().nullable(),
  /** the roll call is closed for direct edits: ask for a correction instead */
  canRequestCorrection: z.boolean(),
  warnings: z.array(z.string()),
  counts: attendanceStatusCounts.extend({ unmarked: z.number().int() }),
  students: z.array(attendanceRosterStudent),
});
export type AttendanceRosterResponse = z.infer<typeof attendanceRosterResponse>;

export const attendanceRecordInput = z.object({
  studentId: uuid,
  status: attendanceStatus,
  remarks: z.string().trim().max(300).nullish(),
});

export const attendanceSubmitBody = z.object({
  /** defaults to today; never in the future */
  date: dateStr.optional(),
  periodId: uuid.optional(),
  /** applied to every student NOT listed in `records` (students on approved leave always become `leave`). Without it every student must be listed. */
  defaultStatus: attendanceStatus.optional(),
  records: z.array(attendanceRecordInput).max(300),
});
export type AttendanceSubmitBody = z.infer<typeof attendanceSubmitBody>;

export const attendanceSubmitResponse = z.object({
  sessionId: uuid,
  sectionId: uuid,
  date: dateStr,
  periodId: uuid.nullable(),
  status: z.literal('submitted'),
  /** false when an existing submitted roll call was re-submitted */
  firstSubmission: z.boolean(),
  counts: attendanceStatusCounts.extend({ total: z.number().int() }),
  /** how many students' marks differ from what was stored before */
  changed: z.number().int(),
  /** guardians sent an absence notification */
  notifiedGuardians: z.number().int(),
  editableUntil: isoDateTime,
});
export type AttendanceSubmitResponse = z.infer<typeof attendanceSubmitResponse>;

// ───────────────────────────── corrections ─────────────────────────────

export const attendanceCorrectionStatus = z.enum(['pending', 'approved', 'rejected']);

export const attendanceCorrectionCreateBody = z.object({
  toStatus: attendanceStatus,
  reason: z.string().trim().min(3).max(500),
});

export const attendanceCorrectionListQuery = pageQuery.extend({
  /** default `pending` */
  status: attendanceCorrectionStatus.optional(),
  sectionId: uuid.optional(),
  /** only requests I raised (teachers); approvers otherwise see what they can decide */
  mine: learningBoolQuery.optional(),
});

export const attendanceCorrectionDecisionBody = z.object({ note: z.string().trim().max(500).optional() });

export const attendanceCorrectionItem = z.object({
  id: uuid,
  recordId: uuid,
  studentId: uuid,
  studentName: z.string(),
  admissionNo: z.string(),
  rollNo: z.number().int().nullable(),
  sectionId: uuid,
  sectionName: z.string(),
  date: dateStr,
  fromStatus: attendanceStatus,
  toStatus: attendanceStatus,
  reason: z.string(),
  requestedBy: uuid,
  requestedByName: z.string().nullable(),
  status: attendanceCorrectionStatus,
  decidedBy: uuid.nullable(),
  decidedByName: z.string().nullable(),
  decidedAt: isoDateTime.nullable(),
  decisionNote: z.string().nullable(),
  createdAt: isoDateTime,
  /** may the caller approve/reject it (class teacher of the section or school scope, never the requester themself unless school scope) */
  canDecide: z.boolean(),
});
export type AttendanceCorrectionItem = z.infer<typeof attendanceCorrectionItem>;
export const attendanceCorrectionListResponse = paged(attendanceCorrectionItem);

// ───────────────────────────── views ─────────────────────────────

export const attendanceRangeQuery = z.object({ from: dateStr.optional(), to: dateStr.optional() });

export const attendanceMonthStat = attendanceTotals.extend({ month: yearMonth });

export const attendanceStudentSummaryResponse = z.object({
  studentId: uuid,
  studentName: z.string(),
  sectionId: uuid.nullable(),
  from: dateStr,
  to: dateStr,
  totals: attendanceTotals,
  shortage: z.object({ thresholdPercent: z.number(), isShort: z.boolean() }),
  months: z.array(attendanceMonthStat),
});
export type AttendanceStudentSummaryResponse = z.infer<typeof attendanceStudentSummaryResponse>;

export const attendanceRecordsQuery = cursorQuery.extend({ from: dateStr.optional(), to: dateStr.optional(), status: attendanceStatus.optional() });

export const attendanceRecordItem = z.object({
  id: uuid,
  date: dateStr,
  status: attendanceStatus,
  remarks: z.string().nullable(),
  sectionId: uuid,
  periodId: uuid.nullable(),
  periodName: z.string().nullable(),
  subjectName: z.string().nullable(),
  markedAt: isoDateTime,
  /** a correction request for this record is waiting for a decision */
  correctionPending: z.boolean(),
});
export const attendanceRecordsResponse = cursored(attendanceRecordItem);

export const attendanceSectionSummaryResponse = z.object({
  sectionId: uuid,
  sectionName: z.string(),
  gradeName: z.string(),
  from: dateStr,
  to: dateStr,
  strength: z.number().int(),
  totals: attendanceTotals,
  days: z.array(attendanceStatusCounts.extend({ date: dateStr, percentage: z.number().nullable() })),
  students: z.array(
    attendanceTotals.extend({
      studentId: uuid,
      name: z.string(),
      admissionNo: z.string(),
      rollNo: z.number().int().nullable(),
      isShort: z.boolean(),
    }),
  ),
});

export const attendanceSchoolSummaryQuery = z.object({
  date: dateStr.optional(),
  /** days of trend to include, ending at `date` (default 7) */
  trendDays: z.coerce.number().int().min(1).max(31).default(7),
  absenteeLimit: z.coerce.number().int().min(1).max(500).default(100),
});

export const attendanceSchoolSectionRow = attendanceStatusCounts.extend({
  sectionId: uuid,
  name: z.string(),
  gradeName: z.string(),
  classTeacherName: z.string().nullable(),
  strength: z.number().int(),
  /** at least one submitted roll call for the date */
  marked: z.boolean(),
  percentPresent: z.number().nullable(),
});

export const attendanceSchoolSummaryResponse = z.object({
  date: dateStr,
  mode: attendanceMode,
  isWorkingDay: z.boolean(),
  holiday: z.string().nullable(),
  totals: attendanceStatusCounts.extend({
    activeStudents: z.number().int(),
    markedStudents: z.number().int(),
    unmarkedStudents: z.number().int(),
    percentPresent: z.number().nullable(),
  }),
  sectionsTotal: z.number().int(),
  sectionsMarked: z.number().int(),
  sections: z.array(attendanceSchoolSectionRow),
  absentees: z.array(
    z.object({
      studentId: uuid,
      name: z.string(),
      admissionNo: z.string(),
      rollNo: z.number().int().nullable(),
      sectionId: uuid,
      sectionName: z.string(),
      remarks: z.string().nullable(),
    }),
  ),
  absenteesTotal: z.number().int(),
  trend: z.array(attendanceStatusCounts.extend({ date: dateStr, percentPresent: z.number().nullable() })),
});
export type AttendanceSchoolSummaryResponse = z.infer<typeof attendanceSchoolSummaryResponse>;

export const attendanceTodayItem = z.object({
  sectionId: uuid,
  sectionName: z.string(),
  periodId: uuid.nullable(),
  periodName: z.string().nullable(),
  subjectName: z.string().nullable(),
  strength: z.number().int(),
  /** a roll call was submitted */
  marked: z.boolean(),
  sessionStatus: z.enum(['draft', 'submitted']).nullable(),
  counts: attendanceStatusCounts.nullable(),
});

export const attendanceTodayResponse = z.object({
  date: dateStr,
  mode: attendanceMode,
  isWorkingDay: z.boolean(),
  holiday: z.string().nullable(),
  role: z.enum(['teacher', 'management', 'student', 'parent']),
  /** teachers: sections (or period slots in period mode) I take attendance for today, marked or not */
  items: z.array(attendanceTodayItem),
  /** how many of `items` are not yet marked ("not yet marked" badge) */
  pendingCount: z.number().int(),
  /** students/parents: today's status per (linked) child */
  children: z.array(z.object({ studentId: uuid, name: z.string(), sectionId: uuid.nullable(), status: attendanceStatus.nullable(), remarks: z.string().nullable() })),
  /** management: school totals for today (see GET /attendance/summary for the full table) */
  school: z
    .object({ sectionsTotal: z.number().int(), sectionsMarked: z.number().int(), activeStudents: z.number().int(), present: z.number().int(), absent: z.number().int(), percentPresent: z.number().nullable() })
    .nullable(),
});
export type AttendanceTodayResponse = z.infer<typeof attendanceTodayResponse>;

/** exports are limited to 93 days per file */
export const attendanceExportQuery = z.object({ from: dateStr, to: dateStr, sectionId: uuid.optional() });

export const attendanceShortageScanResponse = z.object({
  month: yearMonth,
  thresholdPercent: z.number(),
  /** students with enough data to evaluate */
  checked: z.number().int(),
  belowThreshold: z.number().int(),
  /** new alerts sent now (students already alerted this month are skipped) */
  alertsSent: z.number().int(),
  notifications: z.number().int(),
});

// ───────────────────────────── student leave ─────────────────────────────

export const leaveStatus = z.enum(LEAVE_STATUSES);
export const leaveType = z.enum(LEAVE_TYPES);

export const leaveCreateBody = z
  .object({
    /** parents: the child (required when they have several); students: omit */
    studentId: uuid.optional(),
    leaveType: leaveType.default('other'),
    fromDate: dateStr,
    toDate: dateStr,
    reason: z.string().trim().min(3).max(1000),
    attachmentFileId: uuid.optional(),
  })
  .refine((b) => b.fromDate <= b.toDate, { message: 'toDate must not be before fromDate', path: ['toDate'] });
export type LeaveCreateBody = z.infer<typeof leaveCreateBody>;

export const leaveListQuery = pageQuery.extend({
  status: leaveStatus.optional(),
  studentId: uuid.optional(),
  sectionId: uuid.optional(),
  /** requests overlapping [from, to] */
  from: dateStr.optional(),
  to: dateStr.optional(),
});

export const leaveDecisionBody = z.object({ note: z.string().trim().max(500).optional() });

export const leaveItem = z.object({
  id: uuid,
  studentId: uuid,
  studentName: z.string(),
  admissionNo: z.string(),
  sectionId: uuid.nullable(),
  sectionName: z.string().nullable(),
  leaveType,
  fromDate: dateStr,
  toDate: dateStr,
  /** working days covered */
  days: z.number().int(),
  reason: z.string(),
  attachmentFileId: uuid.nullable(),
  status: leaveStatus,
  requestedBy: uuid,
  requestedByName: z.string().nullable(),
  decidedBy: uuid.nullable(),
  decidedByName: z.string().nullable(),
  decidedAt: isoDateTime.nullable(),
  decisionNote: z.string().nullable(),
  createdAt: isoDateTime,
  /** may the caller approve/reject it */
  canDecide: z.boolean(),
  /** may the caller cancel it (requester, while pending) */
  canCancel: z.boolean(),
});
export type LeaveItem = z.infer<typeof leaveItem>;
export const leaveListResponse = paged(leaveItem);

// ───────────────────────────── staff attendance ─────────────────────────────

export const staffAttendanceListQuery = pageQuery.extend({ date: dateStr.optional(), department: z.string().trim().max(100).optional() });

export const staffAttendanceItem = z.object({
  staffId: uuid,
  name: z.string(),
  employeeId: z.string(),
  designation: z.string().nullable(),
  department: z.string().nullable(),
  recordId: uuid.nullable(),
  /** null = not marked */
  status: attendanceStatus.nullable(),
  checkIn: timeStr.nullable(),
  checkOut: timeStr.nullable(),
  note: z.string().nullable(),
  onApprovedLeave: z.boolean(),
});
export type StaffAttendanceItem = z.infer<typeof staffAttendanceItem>;
export const staffAttendanceListResponse = paged(staffAttendanceItem).extend({ date: dateStr, counts: attendanceStatusCounts.extend({ unmarked: z.number().int() }) });

export const staffAttendanceMarkBody = z.object({
  date: dateStr.optional(),
  records: z
    .array(
      z.object({
        staffId: uuid,
        status: attendanceStatus,
        checkIn: timeStr.nullish(),
        checkOut: timeStr.nullish(),
        note: z.string().trim().max(300).nullish(),
      }),
    )
    .min(1)
    .max(500),
});
export const staffAttendanceMarkResponse = z.object({ date: dateStr, saved: z.number().int(), counts: attendanceStatusCounts });

export const staffAttendanceRecord = z.object({
  id: uuid,
  staffId: uuid,
  date: dateStr,
  status: attendanceStatus,
  checkIn: timeStr.nullable(),
  checkOut: timeStr.nullable(),
  note: z.string().nullable(),
});
export type StaffAttendanceRecord = z.infer<typeof staffAttendanceRecord>;

export const staffAttendanceUpdateBody = z
  .object({ status: attendanceStatus.optional(), checkIn: timeStr.nullish(), checkOut: timeStr.nullish(), note: z.string().trim().max(300).nullish() })
  .refine((b) => Object.keys(b).length > 0, { message: 'Nothing to change' });

export const staffAttendanceMineResponse = z.object({
  staffId: uuid,
  from: dateStr,
  to: dateStr,
  today: staffAttendanceRecord.nullable(),
  totals: attendanceTotals,
  records: z.array(staffAttendanceRecord),
});

export const staffAttendanceSummaryQuery = attendanceRangeQuery.extend({ department: z.string().trim().max(100).optional() });
export const staffAttendanceSummaryResponse = z.object({
  from: dateStr,
  to: dateStr,
  /** totals for the last date in range that has any record */
  today: attendanceStatusCounts.extend({ date: dateStr, unmarked: z.number().int() }),
  staff: z.array(
    attendanceTotals.extend({
      staffId: uuid,
      name: z.string(),
      employeeId: z.string(),
      designation: z.string().nullable(),
      department: z.string().nullable(),
    }),
  ),
});

// ───────────────────────────── staff leave ─────────────────────────────

export const staffLeaveCreateBody = z
  .object({ leaveType: leaveType.default('casual'), fromDate: dateStr, toDate: dateStr, reason: z.string().trim().min(3).max(1000) })
  .refine((b) => b.fromDate <= b.toDate, { message: 'toDate must not be before fromDate', path: ['toDate'] });

export const staffLeaveListQuery = pageQuery.extend({ status: leaveStatus.optional(), staffId: uuid.optional(), from: dateStr.optional(), to: dateStr.optional() });

export const staffLeaveItem = z.object({
  id: uuid,
  staffId: uuid,
  staffName: z.string(),
  employeeId: z.string(),
  designation: z.string().nullable(),
  leaveType,
  fromDate: dateStr,
  toDate: dateStr,
  days: z.number().int(),
  reason: z.string(),
  status: leaveStatus,
  decidedBy: uuid.nullable(),
  decidedByName: z.string().nullable(),
  decidedAt: isoDateTime.nullable(),
  decisionNote: z.string().nullable(),
  createdAt: isoDateTime,
  canDecide: z.boolean(),
  canCancel: z.boolean(),
});
export type StaffLeaveItem = z.infer<typeof staffLeaveItem>;
export const staffLeaveListResponse = paged(staffLeaveItem);

export const staffLeaveBalanceQuery = z.object({ staffId: uuid.optional() });
export const staffLeaveBalanceResponse = z.object({
  staffId: uuid,
  academicYear: z.string().nullable(),
  byType: z.array(z.object({ leaveType, approvedDays: z.number().int(), pendingDays: z.number().int() })),
  totalApprovedDays: z.number().int(),
  totalPendingDays: z.number().int(),
});
