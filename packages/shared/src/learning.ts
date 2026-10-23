import { z } from 'zod';
import { dateStr, isoDateTime, timeStr, uuid } from './common';
import { HOMEWORK_STATUSES, SUBMISSION_STATUSES, TASK_PRIORITIES, TASK_STATUSES } from './enums';

/**
 * Teaching & learning: timetable, homework, submissions, materials, syllabus, personal tasks.
 * Every exported name is prefixed with its domain so `export *` from index.ts never collides with other modules.
 */

/** query-string boolean ("true"/"false"/"1"/"0"); z.coerce.boolean() would turn "false" into true */
export const learningBoolQuery = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

export const learningAttachmentRef = z.object({
  fileId: uuid,
  name: z.string().trim().min(1).max(255),
  mimeType: z.string().max(120).optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
});
export type LearningAttachmentRef = z.infer<typeof learningAttachmentRef>;

const weekday = z.number().int().min(1).max(7);

// ───────────────────────────── timetable ─────────────────────────────

export const timetablePeriod = z.object({ id: uuid, name: z.string(), ordinal: z.number().int(), startTime: timeStr, endTime: timeStr, isBreak: z.boolean() });
export type TimetablePeriod = z.infer<typeof timetablePeriod>;

export const timetableSlotItem = z.object({
  id: uuid,
  sectionId: uuid,
  dayOfWeek: weekday,
  periodId: uuid,
  subjectId: uuid.nullable(),
  subjectName: z.string().nullable(),
  subjectCode: z.string().nullable(),
  staffId: uuid.nullable(),
  teacherName: z.string().nullable(),
  room: z.string().nullable(),
  /** only on write responses, e.g. `TEACHER_NOT_ASSIGNED` when saved with allowUnassigned */
  warnings: z.array(z.string()).optional(),
});
export type TimetableSlotItem = z.infer<typeof timetableSlotItem>;

export const timetableSubstitutionItem = z.object({
  id: uuid,
  slotId: uuid,
  date: dateStr,
  dayOfWeek: weekday,
  sectionId: uuid,
  sectionName: z.string(),
  periodId: uuid,
  periodName: z.string(),
  startTime: timeStr,
  endTime: timeStr,
  subjectId: uuid.nullable(),
  subjectName: z.string().nullable(),
  originalStaffId: uuid.nullable(),
  originalTeacherName: z.string().nullable(),
  substituteStaffId: uuid,
  substituteTeacherName: z.string(),
  reason: z.string().nullable(),
  createdAt: isoDateTime,
});
export type TimetableSubstitutionItem = z.infer<typeof timetableSubstitutionItem>;

export const timetableGridResponse = z.object({
  section: z.object({ id: uuid, name: z.string(), gradeId: uuid, gradeName: z.string(), room: z.string().nullable(), classTeacherName: z.string().nullable() }),
  /** ISO weekdays that are school days (setting `academic.workingDays`) */
  workingDays: z.array(weekday),
  periods: z.array(timetablePeriod),
  slots: z.array(timetableSlotItem),
  /** one-day covers falling in the Monday–Sunday week of `weekOf` */
  weekOf: dateStr,
  substitutions: z.array(timetableSubstitutionItem),
});
export type TimetableGridResponse = z.infer<typeof timetableGridResponse>;

export const timetableGridQuery = z.object({ date: dateStr.optional() });

export const timetableSlotInput = z.object({
  dayOfWeek: weekday,
  periodId: uuid,
  subjectId: uuid,
  /** omitted → the teacher assigned to this (section, subject) */
  staffId: uuid.nullish(),
  room: z.string().trim().max(60).nullish(),
});
export const timetableSetSlotBody = timetableSlotInput.extend({
  sectionId: uuid,
  /** save even if the teacher holds no teaching assignment for this section+subject (a warning is returned) */
  allowUnassigned: z.boolean().default(false),
});
export type TimetableSetSlotBody = z.infer<typeof timetableSetSlotBody>;

export const timetableReplaceBody = z.object({ slots: z.array(timetableSlotInput).max(7 * 20), allowUnassigned: z.boolean().default(false) });
export type TimetableReplaceBody = z.infer<typeof timetableReplaceBody>;

export const timetableSubstitutionCreateBody = z.object({ slotId: uuid, date: dateStr, substituteStaffId: uuid, reason: z.string().trim().max(300).optional() });
export type TimetableSubstitutionCreateBody = z.infer<typeof timetableSubstitutionCreateBody>;

export const timetableSubstitutionQuery = z.object({
  from: dateStr.optional(),
  to: dateStr.optional(),
  sectionId: uuid.optional(),
  staffId: uuid.optional(),
});

export const timetableDayQuery = z.object({ date: dateStr.optional(), studentId: uuid.optional() });

export const timetableEntry = z.object({
  periodId: uuid,
  periodName: z.string(),
  ordinal: z.number().int(),
  startTime: timeStr,
  endTime: timeStr,
  isBreak: z.boolean(),
  slotId: uuid.nullable(),
  sectionId: uuid.nullable(),
  sectionName: z.string().nullable(),
  subjectId: uuid.nullable(),
  subjectName: z.string().nullable(),
  /** the person actually teaching that day (the substitute when covered) */
  staffId: uuid.nullable(),
  teacherName: z.string().nullable(),
  room: z.string().nullable(),
  substituted: z.boolean(),
  substitution: z
    .object({ id: uuid, originalStaffId: uuid.nullable(), originalTeacherName: z.string().nullable(), substituteStaffId: uuid, substituteTeacherName: z.string(), reason: z.string().nullable() })
    .nullable(),
  /** teacher view only: `own` I teach it, `covering` I am the substitute, `covered` someone covers my class (I am free) */
  relation: z.enum(['own', 'covering', 'covered']).nullable(),
  /** relative to school time; null for dates other than today */
  state: z.enum(['past', 'current', 'upcoming']).nullable(),
});
export type TimetableEntry = z.infer<typeof timetableEntry>;

export const timetableDayResponse = z.object({
  date: dateStr,
  dayOfWeek: weekday,
  isWorkingDay: z.boolean(),
  /** school-local time used to compute current/next (only when date is today) */
  now: timeStr.nullable(),
  studentId: uuid.nullable(),
  sectionId: uuid.nullable(),
  sectionName: z.string().nullable(),
  entries: z.array(timetableEntry),
  current: timetableEntry.nullable(),
  next: timetableEntry.nullable(),
});
export type TimetableDayResponse = z.infer<typeof timetableDayResponse>;

// ───────────────────────────── homework ─────────────────────────────

/** what the learner (student, or parent for their child) sees for each homework */
export const HOMEWORK_LEARNER_STATUSES = ['pending', 'submitted', 'late', 'reviewed', 'returned', 'overdue', 'not_required'] as const;
export type HomeworkLearnerStatus = (typeof HOMEWORK_LEARNER_STATUSES)[number];

export const submissionItem = z.object({
  id: uuid,
  homeworkId: uuid,
  studentId: uuid,
  studentName: z.string(),
  rollNo: z.number().int().nullable(),
  text: z.string().nullable(),
  attachments: z.array(learningAttachmentRef),
  submittedAt: isoDateTime,
  status: z.enum(SUBMISSION_STATUSES),
  /** latest submission time is after the due time */
  isLate: z.boolean(),
  marks: z.number().nullable(),
  feedback: z.string().nullable(),
  reviewedBy: uuid.nullable(),
  reviewedAt: isoDateTime.nullable(),
  updatedAt: isoDateTime,
});
export type SubmissionItem = z.infer<typeof submissionItem>;

export const homeworkSubmissionSummary = z.object({
  id: uuid,
  status: z.enum(SUBMISSION_STATUSES),
  submittedAt: isoDateTime,
  isLate: z.boolean(),
  marks: z.number().nullable(),
  feedback: z.string().nullable(),
  reviewedAt: isoDateTime.nullable(),
});

export const homeworkStats = z.object({ totalStudents: z.number().int(), submitted: z.number().int(), late: z.number().int(), reviewed: z.number().int(), returned: z.number().int(), missing: z.number().int() });
export type HomeworkStats = z.infer<typeof homeworkStats>;

export const homeworkItem = z.object({
  id: uuid,
  sectionId: uuid,
  sectionName: z.string(),
  gradeName: z.string(),
  subjectId: uuid,
  subjectName: z.string(),
  staffId: uuid.nullable(),
  teacherName: z.string().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  attachments: z.array(learningAttachmentRef),
  assignedAt: isoDateTime,
  dueAt: isoDateTime,
  allowSubmission: z.boolean(),
  maxMarks: z.number().int().nullable(),
  status: z.enum(HOMEWORK_STATUSES),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  /** student / parent view: the child's status for this homework (null for staff) */
  learner: z.object({ studentId: uuid, status: z.enum(HOMEWORK_LEARNER_STATUSES), submission: homeworkSubmissionSummary.nullable() }).nullable(),
  /** staff view: submission counts (null for students / parents) */
  stats: homeworkStats.nullable(),
});
export type HomeworkItem = z.infer<typeof homeworkItem>;

export const homeworkListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().max(100).optional(),
  sectionId: uuid.optional(),
  subjectId: uuid.optional(),
  /** staff: homework lifecycle filter. Learners only ever see published / closed. */
  status: z.enum(HOMEWORK_STATUSES).optional(),
  /** learner filter: pending | submitted | late | reviewed | returned | overdue | not_required */
  learnerStatus: z.enum(HOMEWORK_LEARNER_STATUSES).optional(),
  /** parents: which linked child (required when the parent has several children) */
  studentId: uuid.optional(),
  /** only homework due on/after / on/before this school-local date */
  dueFrom: dateStr.optional(),
  dueTo: dateStr.optional(),
  /** staff: only homework I created */
  mine: learningBoolQuery.optional(),
  /** order by due date: `dueAsc` (soonest first) or `dueDesc` (default) */
  sort: z.enum(['dueAsc', 'dueDesc']).optional(),
});
export type HomeworkListQuery = z.infer<typeof homeworkListQuery>;

export const homeworkDetailQuery = z.object({ studentId: uuid.optional() });

export const homeworkCreateBody = z.object({
  sectionId: uuid,
  subjectId: uuid,
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).nullish(),
  attachments: z.array(learningAttachmentRef).max(10).default([]),
  dueAt: isoDateTime,
  allowSubmission: z.boolean().default(true),
  maxMarks: z.number().int().min(1).max(1000).nullish(),
  /** publish immediately (notifies students and their guardians); otherwise saved as a draft */
  publish: z.boolean().default(false),
});
export type HomeworkCreateBody = z.infer<typeof homeworkCreateBody>;

export const homeworkUpdateBody = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(5000).nullable(),
    attachments: z.array(learningAttachmentRef).max(10),
    dueAt: isoDateTime,
    allowSubmission: z.boolean(),
    maxMarks: z.number().int().min(1).max(1000).nullable(),
  })
  .partial();
export type HomeworkUpdateBody = z.infer<typeof homeworkUpdateBody>;

export const homeworkRosterRow = z.object({
  studentId: uuid,
  name: z.string(),
  admissionNo: z.string(),
  rollNo: z.number().int().nullable(),
  status: z.enum(['missing', 'submitted', 'late', 'reviewed', 'returned']),
  submission: homeworkSubmissionSummary.nullable(),
});
export const homeworkRosterResponse = z.object({ homework: homeworkItem, data: z.array(homeworkRosterRow) });
export type HomeworkRosterResponse = z.infer<typeof homeworkRosterResponse>;

// ───────────────────────────── submissions ─────────────────────────────

export const homeworkSubmitBody = z.object({ text: z.string().trim().max(10000).nullish(), attachments: z.array(learningAttachmentRef).max(10).default([]) });
export type HomeworkSubmitBody = z.infer<typeof homeworkSubmitBody>;

export const submissionReviewBody = z.object({ marks: z.number().min(0).max(100000).multipleOf(0.01).optional(), feedback: z.string().trim().max(2000).optional() });
export type SubmissionReviewBody = z.infer<typeof submissionReviewBody>;

export const submissionReturnBody = z.object({ feedback: z.string().trim().min(1).max(2000) });
export type SubmissionReturnBody = z.infer<typeof submissionReturnBody>;

export const submissionListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  homeworkId: uuid.optional(),
  status: z.enum(SUBMISSION_STATUSES).optional(),
  sectionId: uuid.optional(),
});

// ───────────────────────────── materials ─────────────────────────────

export const materialItem = z.object({
  id: uuid,
  title: z.string(),
  description: z.string().nullable(),
  subjectId: uuid,
  subjectName: z.string(),
  gradeId: uuid.nullable(),
  gradeName: z.string().nullable(),
  sectionId: uuid.nullable(),
  sectionName: z.string().nullable(),
  fileId: uuid.nullable(),
  url: z.string().nullable(),
  createdBy: uuid.nullable(),
  createdByName: z.string().nullable(),
  createdAt: isoDateTime,
  archivedAt: isoDateTime.nullable(),
});
export type MaterialItem = z.infer<typeof materialItem>;

export const materialListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().max(100).optional(),
  subjectId: uuid.optional(),
  sectionId: uuid.optional(),
  gradeId: uuid.optional(),
  /** parents: which linked child */
  studentId: uuid.optional(),
  /** staff only: include archived materials */
  archived: learningBoolQuery.optional(),
});

export const materialCreateBody = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2000).nullish(),
    subjectId: uuid,
    /** a single section, or (when omitted) every section of `gradeId` */
    sectionId: uuid.nullish(),
    gradeId: uuid.nullish(),
    fileId: uuid.nullish(),
    url: z.url().max(2000).nullish(),
  })
  .refine((v) => !!v.sectionId || !!v.gradeId, { message: 'Provide sectionId or gradeId', path: ['sectionId'] })
  .refine((v) => !!v.fileId || !!v.url, { message: 'Provide a file or a link', path: ['url'] });
export type MaterialCreateBody = z.infer<typeof materialCreateBody>;

export const materialUpdateBody = z.object({ title: z.string().trim().min(1).max(200), description: z.string().trim().max(2000).nullable(), url: z.url().max(2000).nullable(), fileId: uuid.nullable() }).partial();
export type MaterialUpdateBody = z.infer<typeof materialUpdateBody>;

// ───────────────────────────── syllabus ─────────────────────────────

export const SYLLABUS_PROGRESS_STATUSES = ['not_started', 'in_progress', 'completed'] as const;
export type SyllabusProgressStatus = (typeof SYLLABUS_PROGRESS_STATUSES)[number];

export const syllabusTopicItem = z.object({
  id: uuid,
  gradeId: uuid,
  gradeName: z.string(),
  subjectId: uuid,
  subjectName: z.string(),
  termId: uuid.nullable(),
  termName: z.string().nullable(),
  title: z.string(),
  ordinal: z.number().int(),
  plannedHours: z.number().int().nullable(),
  /** progress for the requested section (null when no section is in play) */
  progress: z.object({ sectionId: uuid, status: z.enum(SYLLABUS_PROGRESS_STATUSES), completedAt: isoDateTime.nullable(), updatedAt: isoDateTime.nullable() }).nullable(),
});
export type SyllabusTopicItem = z.infer<typeof syllabusTopicItem>;

export const syllabusListQuery = z.object({
  gradeId: uuid.optional(),
  subjectId: uuid.optional(),
  termId: uuid.optional(),
  /** progress is reported for this section (students / parents: their own, via `studentId`) */
  sectionId: uuid.optional(),
  studentId: uuid.optional(),
});

export const syllabusTopicCreateBody = z.object({
  gradeId: uuid,
  subjectId: uuid,
  termId: uuid.nullish(),
  title: z.string().trim().min(1).max(200),
  ordinal: z.number().int().min(0).max(10000).optional(),
  plannedHours: z.number().int().min(0).max(1000).nullish(),
});
export type SyllabusTopicCreateBody = z.infer<typeof syllabusTopicCreateBody>;

export const syllabusTopicUpdateBody = z
  .object({ title: z.string().trim().min(1).max(200), termId: uuid.nullable(), ordinal: z.number().int().min(0).max(10000), plannedHours: z.number().int().min(0).max(1000).nullable() })
  .partial();
export type SyllabusTopicUpdateBody = z.infer<typeof syllabusTopicUpdateBody>;

export const syllabusProgressBody = z.object({ sectionId: uuid, status: z.enum(SYLLABUS_PROGRESS_STATUSES) });
export type SyllabusProgressBody = z.infer<typeof syllabusProgressBody>;

export const syllabusBulkProgressBody = z.object({
  sectionId: uuid,
  items: z.array(z.object({ topicId: uuid, status: z.enum(SYLLABUS_PROGRESS_STATUSES) })).min(1).max(200),
});

export const syllabusCoverageItem = z.object({
  sectionId: uuid,
  sectionName: z.string(),
  gradeId: uuid,
  gradeName: z.string(),
  subjectId: uuid,
  subjectName: z.string(),
  totalTopics: z.number().int(),
  completed: z.number().int(),
  inProgress: z.number().int(),
  notStarted: z.number().int(),
  /** completed / total, 0–100 (one decimal) */
  percent: z.number(),
});
export type SyllabusCoverageItem = z.infer<typeof syllabusCoverageItem>;

export const syllabusCoverageQuery = z.object({ sectionId: uuid.optional(), gradeId: uuid.optional(), subjectId: uuid.optional(), studentId: uuid.optional() });

// ───────────────────────────── personal tasks ─────────────────────────────

export const taskItem = z.object({
  id: uuid,
  title: z.string(),
  notes: z.string().nullable(),
  dueAt: isoDateTime.nullable(),
  remindAt: isoDateTime.nullable(),
  priority: z.enum(TASK_PRIORITIES),
  status: z.enum(TASK_STATUSES),
  completedAt: isoDateTime.nullable(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type TaskItem = z.infer<typeof taskItem>;

export const taskListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  dueFrom: dateStr.optional(),
  dueTo: dateStr.optional(),
});

export const taskCreateBody = z.object({
  title: z.string().trim().min(1).max(200),
  notes: z.string().trim().max(2000).nullish(),
  dueAt: isoDateTime.nullish(),
  remindAt: isoDateTime.nullish(),
  priority: z.enum(TASK_PRIORITIES).default('normal'),
});
export type TaskCreateBody = z.infer<typeof taskCreateBody>;

export const taskUpdateBody = z
  .object({
    title: z.string().trim().min(1).max(200),
    notes: z.string().trim().max(2000).nullable(),
    dueAt: isoDateTime.nullable(),
    remindAt: isoDateTime.nullable(),
    priority: z.enum(TASK_PRIORITIES),
    status: z.enum(TASK_STATUSES),
  })
  .partial();
export type TaskUpdateBody = z.infer<typeof taskUpdateBody>;

export const TASK_FEED_KINDS = ['task', 'homework'] as const;
export const tasksFeedItem = z.object({
  kind: z.enum(TASK_FEED_KINDS),
  /** task id (kind=task) or homework id (kind=homework) */
  id: uuid,
  title: z.string(),
  /** subject name for homework, notes for personal tasks */
  subtitle: z.string().nullable(),
  dueAt: isoDateTime.nullable(),
  priority: z.enum(TASK_PRIORITIES).nullable(),
  /** task: todo | doing | done; homework: pending | overdue | returned | not_required */
  status: z.string(),
  overdue: z.boolean(),
  /** deep link: `/tasks` or `/homework/<id>` */
  route: z.string(),
});
export type TasksFeedItem = z.infer<typeof tasksFeedItem>;

export const tasksFeedQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  includeDone: learningBoolQuery.optional(),
});
export const tasksFeedResponse = z.object({ data: z.array(tasksFeedItem) });

// ───────────────────────────── list envelopes (non-paged) ─────────────────────────────

export const timetableSlotsResponse = z.object({ data: z.array(timetableSlotItem) });
export const syllabusTopicsResponse = z.object({ data: z.array(syllabusTopicItem) });
export const syllabusCoverageResponse = z.object({ data: z.array(syllabusCoverageItem) });
export const syllabusProgressResponse = z.object({ data: z.array(z.object({ topicId: uuid, sectionId: uuid, status: z.enum(SYLLABUS_PROGRESS_STATUSES), completedAt: isoDateTime.nullable(), updatedAt: isoDateTime })) });
export const timetableSubstitutionListQuery = timetableSubstitutionQuery.extend({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
