import { z } from 'zod';
import { attendanceSchoolSummaryResponse, attendanceStatus, attendanceStudentSummaryResponse, attendanceTodayResponse } from './attendance';
import { announcementItem, calendarItem, meetingItem } from './communication';
import { dateStr, isoDateTime, uuid } from './common';
import { financeSummaryOut } from './fees';
import { homeworkItem, tasksFeedItem, timetableDayResponse } from './learning';
import { licenseResponse } from './auth';

/**
 * Home-screen payloads, one per experience. Each block embeds the SAME schema its own module returns, so the numbers on a
 * dashboard can never disagree with the detail screen behind it. Blocks the caller may not see are `null`, never absent.
 */

const learner = z.object({ id: uuid, name: z.string(), admissionNo: z.string(), grade: z.string().nullable(), section: z.string().nullable() });

const announcementsBlock = z.object({ unreadCount: z.number().int(), pendingAckCount: z.number().int(), latest: z.array(announcementItem) });

/** What a student (or a parent looking at one child) needs for "today". */
export const learnerToday = z.object({
  student: learner,
  /** year-to-date summary; null when there is no current academic year */
  attendance: attendanceStudentSummaryResponse.nullable(),
  /** today's mark for this child, null = not marked yet */
  attendanceToday: attendanceStatus.nullable(),
  timetable: timetableDayResponse,
  homework: z.object({ pendingCount: z.number().int(), overdueCount: z.number().int(), items: z.array(homeworkItem) }),
  upcomingExams: z.array(z.object({ examId: uuid, examName: z.string(), subject: z.string(), date: dateStr, startTime: z.string().nullable(), endTime: z.string().nullable(), room: z.string().nullable() })),
  /** most recent PUBLISHED exams for this child's class (open /results?examId=…) */
  publishedResults: z.array(z.object({ examId: uuid, examName: z.string(), publishedAt: isoDateTime })),
});

export const studentDashboard = learnerToday.extend({
  date: dateStr,
  tasks: z.array(tasksFeedItem),
  announcements: announcementsBlock,
  calendar: z.array(calendarItem),
  notifications: z.object({ unreadCount: z.number().int() }),
});
export type StudentDashboard = z.infer<typeof studentDashboard>;

export const parentDashboard = z.object({
  date: dateStr,
  /** the child shown in `child` (the `studentId` query, else the first linked child); null = no verified children */
  selectedStudentId: uuid.nullable(),
  children: z.array(
    z.object({
      student: learner,
      attendanceToday: attendanceStatus.nullable(),
      attendancePercentage: z.number().nullable(),
      outstandingMinor: z.number(),
      overdueCount: z.number().int(),
    }),
  ),
  child: learnerToday.nullable(),
  fees: z
    .object({
      currency: z.string(),
      outstandingMinor: z.number(),
      overdueMinor: z.number(),
      overdueCount: z.number().int(),
      nextDue: z.object({ invoiceId: uuid, title: z.string(), studentName: z.string(), dueDate: dateStr, balanceMinor: z.number() }).nullable(),
    })
    .nullable(),
  meetings: z.array(meetingItem),
  pendingLeaveCount: z.number().int(),
  announcements: announcementsBlock,
  calendar: z.array(calendarItem),
  notifications: z.object({ unreadCount: z.number().int() }),
});
export type ParentDashboard = z.infer<typeof parentDashboard>;

export const teacherDashboard = z.object({
  date: dateStr,
  staff: z.object({ id: uuid, name: z.string(), designation: z.string().nullable() }),
  /** sections I still have to mark today (see items/pendingCount) */
  attendance: attendanceTodayResponse,
  timetable: timetableDayResponse,
  homework: z.object({
    /** submissions waiting for my review */
    toReviewCount: z.number().int(),
    /** my published homework due in the next 3 days */
    dueSoon: z.array(homeworkItem),
  }),
  marks: z.object({
    /** sheets I must still enter or re-enter (draft / returned) */
    pendingCount: z.number().int(),
    returnedCount: z.number().int(),
    items: z.array(z.object({ sheetId: uuid, examName: z.string(), sectionName: z.string(), subject: z.string(), status: z.enum(['draft', 'returned']) })),
  }),
  /** class teachers: pending student leave for the sections I lead */
  pendingLeaveCount: z.number().int(),
  meetings: z.array(meetingItem),
  announcements: announcementsBlock,
  calendar: z.array(calendarItem),
  notifications: z.object({ unreadCount: z.number().int() }),
});
export type TeacherDashboard = z.infer<typeof teacherDashboard>;

export const dashboardAlert = z.object({
  key: z.string(),
  severity: z.enum(['info', 'warning', 'critical']),
  message: z.string(),
  count: z.number().int().nullable(),
  /** client deep link, e.g. /attendance */
  route: z.string().nullable(),
});

export const managementDashboard = z.object({
  date: dateStr,
  kpis: z.object({ students: z.number().int(), staff: z.number().int(), parents: z.number().int(), sections: z.number().int(), grades: z.number().int() }),
  /** today's totals + 7-day trend (full table lives at GET /attendance/summary); null without attendance:view at school scope */
  attendance: attendanceSchoolSummaryResponse.pick({ date: true, mode: true, isWorkingDay: true, holiday: true, totals: true, sectionsTotal: true, sectionsMarked: true, trend: true }).nullable(),
  /** items waiting for a decision; each count is null when the caller cannot act on that queue */
  approvals: z.object({
    studentLeave: z.number().int().nullable(),
    staffLeave: z.number().int().nullable(),
    attendanceCorrections: z.number().int().nullable(),
    markSheetsForReview: z.number().int().nullable(),
    admissions: z.number().int().nullable(),
    correctionRequests: z.number().int().nullable(),
    concessions: z.number().int().nullable(),
    refunds: z.number().int().nullable(),
    expenses: z.number().int().nullable(),
  }),
  finance: financeSummaryOut.nullable(),
  exams: z.object({ upcoming: z.array(z.object({ examId: uuid, name: z.string(), startDate: dateStr.nullable(), status: z.string() })), underReviewCount: z.number().int() }).nullable(),
  enrollmentByGrade: z.array(z.object({ grade: z.string(), students: z.number().int() })),
  license: licenseResponse.nullable(),
  alerts: z.array(dashboardAlert),
  announcements: announcementsBlock,
  calendar: z.array(calendarItem),
  notifications: z.object({ unreadCount: z.number().int() }),
});
export type ManagementDashboard = z.infer<typeof managementDashboard>;

export const parentDashboardQuery = z.object({ studentId: uuid.optional() });
