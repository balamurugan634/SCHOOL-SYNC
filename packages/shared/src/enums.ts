/** Enumerations shared by DB schema, API validation and clients. Plain string unions — no DB enum types (easy to evolve). */

export const ATTENDANCE_STATUSES = ['present', 'absent', 'late', 'leave', 'half_day'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export const LEAVE_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];

export const LEAVE_TYPES = ['sick', 'casual', 'family', 'event', 'other'] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];

export const STUDENT_STATUSES = ['active', 'transferred', 'withdrawn', 'alumni', 'suspended'] as const;
export type StudentStatus = (typeof STUDENT_STATUSES)[number];

export const GENDERS = ['male', 'female', 'other'] as const;
export type Gender = (typeof GENDERS)[number];

export const RELATIONSHIPS = ['father', 'mother', 'guardian', 'grandparent', 'sibling', 'other'] as const;
export type Relationship = (typeof RELATIONSHIPS)[number];

export const EXAM_TYPES = ['unit_test', 'quiz', 'midterm', 'final', 'practical', 'other'] as const;
export type ExamType = (typeof EXAM_TYPES)[number];

export const EXAM_STATUSES = ['draft', 'scheduled', 'marks_entry', 'under_review', 'published'] as const;
export type ExamStatus = (typeof EXAM_STATUSES)[number];

/** Per (exam, section, subject) mark sheet workflow. Students/parents only see `published`. */
export const MARK_SHEET_STATUSES = ['draft', 'submitted', 'approved', 'published', 'returned'] as const;
export type MarkSheetStatus = (typeof MARK_SHEET_STATUSES)[number];

export const HOMEWORK_STATUSES = ['draft', 'published', 'closed'] as const;
export type HomeworkStatus = (typeof HOMEWORK_STATUSES)[number];

export const SUBMISSION_STATUSES = ['submitted', 'late', 'reviewed', 'returned'] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export const TASK_STATUSES = ['todo', 'doing', 'done'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_PRIORITIES = ['low', 'normal', 'high'] as const;

export const INVOICE_STATUSES = ['unpaid', 'partial', 'paid', 'void'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const PAYMENT_METHODS = ['cash', 'cheque', 'bank_transfer', 'upi', 'card', 'online'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_STATUSES = ['pending', 'succeeded', 'failed', 'refunded', 'partially_refunded'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const ANNOUNCEMENT_PRIORITIES = ['normal', 'important', 'urgent'] as const;
export type AnnouncementPriority = (typeof ANNOUNCEMENT_PRIORITIES)[number];

export const AUDIENCE_TARGET_TYPES = ['all', 'user_type', 'role', 'grade', 'section'] as const;
export type AudienceTargetType = (typeof AUDIENCE_TARGET_TYPES)[number];

export const EVENT_KINDS = ['holiday', 'event', 'exam', 'ptm', 'sports', 'other'] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export const MEETING_STATUSES = ['requested', 'confirmed', 'declined', 'completed', 'cancelled'] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];

export const ADMISSION_STATUSES = ['submitted', 'under_review', 'waitlisted', 'accepted', 'rejected', 'enrolled'] as const;
export type AdmissionStatus = (typeof ADMISSION_STATUSES)[number];

export const PLATFORMS = ['web', 'android', 'ios'] as const;
export type Platform = (typeof PLATFORMS)[number];

/** ISO weekday: 1 = Monday … 7 = Sunday */
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
