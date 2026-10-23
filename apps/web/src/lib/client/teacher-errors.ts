import { ApiError, errorMessage } from '../problem';

/**
 * Teacher-facing wording for the problem+json codes the teaching, attendance, marks and communication endpoints answer with.
 * The API's own `detail` is already readable; these say what to DO about it. Unknown codes fall back to `errorMessage`.
 */
const MESSAGES: Record<string, string> = {
  // scope / role
  NOT_TEACHING_SUBJECT: 'You are not assigned to teach this subject in this class, so you can’t add or change it. Choose one of your own class and subject pairs.',
  NOT_SUBJECT_TEACHER: 'Only the subject teacher of this class can enter or submit these marks.',
  NOT_CLASS_TEACHER: 'Only the class teacher of this class can do this.',
  NOT_ALLOWED_TO_MARK: 'You don’t have permission to mark attendance for this class.',
  NOT_YOUR_PERIOD: 'This period is taken by another teacher.',
  FORBIDDEN: 'You don’t have permission to do this.',
  NOT_FOUND: 'We couldn’t find that. It may have been removed, or it is outside your classes.',
  // approvals
  SELF_APPROVAL: 'You can’t decide your own request. The class teacher or the school office has to approve or reject it.',
  ALREADY_DECIDED: 'Someone has already decided this request. The list has been refreshed.',
  NOTE_REQUIRED: 'Add a short note explaining why you are rejecting it.',
  NOT_PENDING: 'Only a pending request can be changed.',
  NOT_REQUESTER: 'Only the person who made the request can cancel it.',
  CORRECTION_PENDING: 'A correction for this record is already waiting for a decision.',
  NO_CHANGE: 'The record already has that status. Pick a different one.',
  RECORD_GONE: 'The attendance record no longer exists.',
  // attendance
  EDIT_WINDOW_CLOSED: 'The time to edit this roll call has passed. Request a correction instead.',
  FUTURE_DATE: 'That date is in the future.',
  NOT_A_WORKING_DAY: 'That date is not a school working day.',
  HOLIDAY: 'That date is a holiday.',
  OUTSIDE_ACADEMIC_YEAR: 'That date is outside the current academic year.',
  PERIOD_REQUIRED: 'Pick the period first. This school takes attendance per period.',
  // homework
  DUE_DATE_PAST: 'The due date must be in the future. Pick a later date and time.',
  HOMEWORK_CLOSED: 'This homework is closed. It can no longer be edited, and students can’t submit.',
  HOMEWORK_HAS_SUBMISSIONS: 'This homework already has submissions, so it can’t be deleted. Close it instead.',
  SUBMISSION_LOCKED: 'This submission has already been reviewed. Return it for rework if the student needs to resubmit.',
  SUBJECT_NOT_OFFERED: 'This subject is not offered to that class’s grade.',
  EMPTY_REVIEW: 'Give marks or feedback before saving the review.',
  MARKS_NOT_ENABLED: 'This homework has no marks. Add a maximum mark to the homework first.',
  INVALID_STATE: 'That isn’t possible in the current state. Refresh the page and check its status.',
  // marks
  MARKS_EXCEED_MAX: 'Some marks are higher than the maximum for this paper. Correct them and save again.',
  SHEET_LOCKED: 'This sheet is locked. Only draft or returned sheets can be edited.',
  MARKS_ENTRY_NOT_OPEN: 'Marks entry has not been opened for this exam yet.',
  INCOMPLETE_SHEET: 'Every student needs marks or an absent flag before the sheet can be submitted.',
  INVALID_SHEET_STATE: 'This sheet isn’t in a state where that is possible. Refresh and check its status.',
  STUDENT_NOT_IN_SECTION: 'One of the students is not in this class.',
  DUPLICATE_ENTRY: 'A student appears more than once.',
  // communication
  AUDIENCE_INVALID: 'You can only address sections you teach or lead.',
  AUDIENCE_EMPTY: 'Choose at least one class to send this to.',
  ANNOUNCEMENT_NOT_DRAFT: 'Only a draft can be edited or published. Refresh to see its current state.',
  ANNOUNCEMENT_NOT_EDITABLE: 'This announcement can no longer be edited.',
  ANNOUNCEMENT_ARCHIVED: 'This announcement is archived.',
  MEETING_INVALID_STATE: 'That isn’t possible for this meeting any more. Refresh to see its current state.',
  MEETING_SLOT_TAKEN: 'You already have a meeting at that time. Choose another slot.',
  MEETING_LINK_REQUIRED: 'Add the meeting link for an online meeting.',
  SCHEDULED_AT_IN_PAST: 'The meeting time must be in the future.',
  SCHEDULE_CONFLICT: 'That time clashes with another commitment. Choose another slot.',
  // staff
  ALREADY_CHECKED_IN: 'You have already checked in today.',
  ALREADY_CHECKED_OUT: 'You have already checked out today.',
  ALREADY_MARKED: 'Your attendance for today was already recorded by the office.',
  NOT_CHECKED_IN: 'Check in first, then check out.',
  LEAVE_OVERLAP: 'You already have a leave request covering some of these dates.',
  LEAVE_TOO_LONG: 'That request is longer than the school allows. Split it into shorter requests.',
  LEAVE_TOO_OLD: 'Leave can’t start that far in the past.',
  NO_WORKING_DAYS: 'Those dates contain no school days.',
  // files
  PAYLOAD_TOO_LARGE: 'That file is too large. Choose a smaller one.',
  FILE_TYPE_NOT_ALLOWED: 'That type of file can’t be uploaded here.',
  FILE_EXTENSION_MISMATCH: 'The file’s extension doesn’t match its contents. Check the file and try again.',
  FILE_EMPTY: 'That file is empty.',
  UNSUPPORTED_MEDIA_TYPE: 'The file could not be sent. Try again.',
  // syllabus / materials
  TOPIC_NOT_FOR_SECTION: 'That topic doesn’t belong to this class’s grade.',
  MATERIAL_ARCHIVED: 'Archived materials can’t be edited.',
  MATERIAL_EMPTY: 'A material needs a file or a link.',
  SECTION_GRADE_MISMATCH: 'That class doesn’t belong to the chosen grade.',
  // generic
  VALIDATION_ERROR: 'Some details need fixing. Check the highlighted fields.',
  RATE_LIMITED: 'You’re doing that too quickly. Wait a moment and try again.',
};

/** The wording for a bare code (e.g. a roster's `blockedReason`), or null when there is none. */
export const codeMessage = (code: string | null | undefined): string | null => (code ? (MESSAGES[code] ?? null) : null);

/** A clear sentence for any error thrown by a teacher action. */
export function teacherError(e: unknown, fallback?: string): string {
  if (e instanceof ApiError) {
    if (e.code === 'SUBSCRIPTION_EXPIRED') return errorMessage(e);
    const m = MESSAGES[e.code];
    if (m) return m;
    if (e.status === 403) return e.detail ?? MESSAGES.FORBIDDEN!;
    if (e.status === 404 && !e.detail) return MESSAGES.NOT_FOUND!;
  }
  return errorMessage(e, fallback);
}

/** True for the "this is outside your scope / gone" family: show a calm out-of-scope state rather than an error card. */
export const isOutOfScope = (e: unknown): boolean => e instanceof ApiError && (e.status === 404 || e.status === 403);
