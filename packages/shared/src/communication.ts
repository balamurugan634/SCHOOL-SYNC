// Shared zod schemas for the communication module: announcements, events & calendar, parent–teacher meetings,
// notifications inbox + preferences. Dates are YYYY-MM-DD, times HH:MM, instants ISO-8601.
import { z } from 'zod';
import { cursorQuery, cursored, dateStr, isoDateTime, pageQuery, paged, timeStr, uuid } from './common';
import { ANNOUNCEMENT_PRIORITIES, AUDIENCE_TARGET_TYPES, EVENT_KINDS, MEETING_STATUSES } from './enums';
import { fileAttachment } from './files';
import { USER_TYPES } from './permissions';

/** `?flag=true|false` (z.coerce.boolean would turn "false" into true). */
export const commBoolQuery = z.enum(['true', 'false']).transform((v) => v === 'true');

// ── audience ────────────────────────────────────────────────────────────────────────────────────
/**
 * Who a message / event is for. `id` depends on `type`: `all` → omit; `user_type` → student | parent | staff;
 * `role` → a role key (e.g. teacher); `grade` → grade id; `section` → section id.
 * Teachers (announcements at "assigned" scope) may only use `section` targets for sections they lead or teach.
 */
export const audienceTargetIn = z.object({
  type: z.enum(AUDIENCE_TARGET_TYPES),
  id: z.string().trim().min(1).max(64).optional(),
});
export type AudienceTargetIn = z.infer<typeof audienceTargetIn>;
export const audienceTargetOut = z.object({ type: z.enum(AUDIENCE_TARGET_TYPES), id: z.string(), label: z.string() });
export type AudienceTargetOut = z.infer<typeof audienceTargetOut>;
const audienceList = z.array(audienceTargetIn).min(1).max(20);

// ── announcements ──────────────────────────────────────────────────────────────────────────────
/** `scheduled` = draft with a future publishAt; `expired` = published but past expiresAt (the job archives it shortly after). */
export const ANNOUNCEMENT_STATES = ['draft', 'scheduled', 'published', 'expired', 'archived'] as const;
export type AnnouncementState = (typeof ANNOUNCEMENT_STATES)[number];

const announcementFields = {
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(10_000),
  priority: z.enum(ANNOUNCEMENT_PRIORITIES),
  audience: audienceList,
  requiresAck: z.boolean(),
  attachmentFileIds: z.array(uuid).max(10),
  publishAt: isoDateTime.nullable(),
  expiresAt: isoDateTime.nullable(),
};
export const announcementCreateBody = z.object({
  title: announcementFields.title,
  body: announcementFields.body,
  priority: announcementFields.priority.default('normal'),
  audience: announcementFields.audience,
  requiresAck: announcementFields.requiresAck.default(false),
  attachmentFileIds: announcementFields.attachmentFileIds.default([]),
  /** set a future time to schedule: the announcement is published automatically then */
  publishAt: announcementFields.publishAt.optional(),
  expiresAt: announcementFields.expiresAt.optional(),
});
export type AnnouncementCreateBody = z.infer<typeof announcementCreateBody>;
/** Only drafts can be edited (published ones can be expired or archived). */
export const announcementUpdateBody = z.object(announcementFields).partial();
export type AnnouncementUpdateBody = z.infer<typeof announcementUpdateBody>;
export const announcementScheduleBody = z.object({ publishAt: isoDateTime });

export const announcementItem = z.object({
  id: uuid,
  title: z.string(),
  body: z.string(),
  priority: z.enum(ANNOUNCEMENT_PRIORITIES),
  status: z.enum(['draft', 'published', 'archived']),
  state: z.enum(ANNOUNCEMENT_STATES),
  requiresAck: z.boolean(),
  attachments: z.array(fileAttachment),
  publishAt: isoDateTime.nullable(),
  expiresAt: isoDateTime.nullable(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  author: z.object({ id: uuid, name: z.string() }).nullable(),
  /** the caller's own receipt */
  read: z.boolean(),
  readAt: isoDateTime.nullable(),
  acknowledged: z.boolean(),
  ackedAt: isoDateTime.nullable(),
  /** may the caller edit / publish / archive it (author, or school-scope editor) */
  canManage: z.boolean(),
  /** only for managers; empty for ordinary recipients */
  audience: z.array(audienceTargetOut),
  /** managers' list only: how many recipients opened / acknowledged it so far */
  readCount: z.number().int().nullable(),
  ackCount: z.number().int().nullable(),
});
export type AnnouncementItem = z.infer<typeof announcementItem>;

export const announcementListQuery = pageQuery.extend({
  unread: commBoolQuery.optional(),
  priority: z.enum(ANNOUNCEMENT_PRIORITIES).optional(),
});
export const announcementManageQuery = pageQuery.extend({
  state: z.enum(ANNOUNCEMENT_STATES).optional(),
  /** school-scope editors see everyone's announcements; `mine=true` narrows to their own */
  mine: commBoolQuery.optional(),
});
export const announcementUnreadCount = z.object({ unread: z.number().int(), pendingAck: z.number().int() });

export const announcementStats = z.object({
  announcementId: uuid,
  requiresAck: z.boolean(),
  audienceSize: z.number().int(),
  readCount: z.number().int(),
  ackCount: z.number().int(),
  unreadCount: z.number().int(),
  pendingAckCount: z.number().int(),
  byUserType: z.array(z.object({ userType: z.enum(USER_TYPES), audience: z.number().int(), read: z.number().int(), acked: z.number().int() })),
  /** users reachable through each section (a parent with children in two sections counts in both) */
  bySection: z.array(z.object({ sectionId: uuid, gradeName: z.string(), sectionName: z.string(), audience: z.number().int(), read: z.number().int(), acked: z.number().int() })),
});
export type AnnouncementStats = z.infer<typeof announcementStats>;

export const announcementRecipientsQuery = pageQuery.extend({ status: z.enum(['all', 'unread', 'unacknowledged']).default('all') });
export const announcementRecipient = z.object({ userId: uuid, name: z.string(), userType: z.enum(USER_TYPES), readAt: isoDateTime.nullable(), ackedAt: isoDateTime.nullable() });

// ── events & calendar ──────────────────────────────────────────────────────────────────────────
export const EVENT_STATUSES = ['draft', 'published', 'cancelled'] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];
/** `going`/`not_going` answer a registration; `consent_given`/`consent_denied` answer a consent form. */
export const EVENT_RESPONSES = ['going', 'not_going', 'consent_given', 'consent_denied'] as const;
export type EventResponse = (typeof EVENT_RESPONSES)[number];

const eventFields = {
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).nullable(),
  kind: z.enum(EVENT_KINDS),
  startDate: dateStr,
  endDate: dateStr,
  startTime: timeStr.nullable(),
  endTime: timeStr.nullable(),
  allDay: z.boolean(),
  location: z.string().trim().max(200).nullable(),
  audience: audienceList,
  /** parents/students answer going / not going per child */
  registrationRequired: z.boolean(),
  /** parents give or deny permission per child (needs `consentText`); students cannot answer it */
  consentRequired: z.boolean(),
  consentText: z.string().trim().max(3000).nullable(),
  registrationDeadline: isoDateTime.nullable(),
  /** max number of children who may answer `going` / `consent_given` */
  capacity: z.number().int().min(1).max(100_000).nullable(),
};
export const eventCreateBody = z.object({
  title: eventFields.title,
  description: eventFields.description.optional(),
  kind: eventFields.kind.default('event'),
  startDate: eventFields.startDate,
  /** defaults to startDate */
  endDate: eventFields.endDate.optional(),
  startTime: eventFields.startTime.optional(),
  endTime: eventFields.endTime.optional(),
  /** defaults to true when no startTime is given */
  allDay: eventFields.allDay.optional(),
  location: eventFields.location.optional(),
  audience: eventFields.audience,
  registrationRequired: eventFields.registrationRequired.default(false),
  consentRequired: eventFields.consentRequired.default(false),
  consentText: eventFields.consentText.optional(),
  registrationDeadline: eventFields.registrationDeadline.optional(),
  capacity: eventFields.capacity.optional(),
  /** publish immediately (needs events:publish) instead of saving a draft */
  publish: z.boolean().default(false),
});
export type EventCreateBody = z.infer<typeof eventCreateBody>;
export const eventUpdateBody = z.object(eventFields).partial();
export type EventUpdateBody = z.infer<typeof eventUpdateBody>;

export const eventChildResponse = z.object({
  studentId: uuid,
  studentName: z.string(),
  /** null = not answered yet */
  response: z.enum(EVENT_RESPONSES).nullable(),
  note: z.string().nullable(),
  respondedAt: isoDateTime.nullable(),
});
export type EventChildResponse = z.infer<typeof eventChildResponse>;
export const eventCounts = z.object({
  /** students the audience covers */
  eligible: z.number().int(),
  going: z.number().int(),
  notGoing: z.number().int(),
  consentGiven: z.number().int(),
  consentDenied: z.number().int(),
  pending: z.number().int(),
  capacity: z.number().int().nullable(),
  /** seats left (null = unlimited) */
  seatsLeft: z.number().int().nullable(),
});
export type EventCounts = z.infer<typeof eventCounts>;

export const eventItem = z.object({
  id: uuid,
  title: z.string(),
  description: z.string().nullable(),
  kind: z.enum(EVENT_KINDS),
  status: z.enum(EVENT_STATUSES),
  startDate: dateStr,
  endDate: dateStr,
  startTime: timeStr.nullable(),
  endTime: timeStr.nullable(),
  allDay: z.boolean(),
  location: z.string().nullable(),
  registrationRequired: z.boolean(),
  consentRequired: z.boolean(),
  consentText: z.string().nullable(),
  registrationDeadline: isoDateTime.nullable(),
  capacity: z.number().int().nullable(),
  createdAt: isoDateTime,
  canManage: z.boolean(),
  /** can the caller still answer (published, before the deadline and before the event ends) */
  responseOpen: z.boolean(),
  /** the caller's own children / own record that this event asks an answer from; empty when no answer is needed */
  children: z.array(eventChildResponse),
  /** only for managers; empty otherwise */
  audience: z.array(audienceTargetOut),
  /** only for managers on the detail endpoint */
  counts: eventCounts.nullable(),
});
export type EventItem = z.infer<typeof eventItem>;

export const eventListQuery = pageQuery.extend({
  from: dateStr.optional(),
  to: dateStr.optional(),
  kind: z.enum(EVENT_KINDS).optional(),
  /** drafts / cancelled are visible to managers only */
  status: z.enum(EVENT_STATUSES).optional(),
});
export const eventRespondBody = z.object({
  studentId: uuid,
  response: z.enum(EVENT_RESPONSES),
  note: z.string().trim().max(500).optional(),
});
export type EventRespondBody = z.infer<typeof eventRespondBody>;

export const eventResponsesQuery = pageQuery.extend({
  /** `pending` lists audience students who have not answered */
  response: z.enum([...EVENT_RESPONSES, 'pending'] as const).optional(),
  sectionId: uuid.optional(),
});
export const eventResponseRow = z.object({
  studentId: uuid,
  studentName: z.string(),
  admissionNo: z.string(),
  grade: z.string().nullable(),
  section: z.string().nullable(),
  response: z.enum(EVENT_RESPONSES).nullable(),
  note: z.string().nullable(),
  respondedBy: z.string().nullable(),
  respondedAt: isoDateTime.nullable(),
});

export const CALENDAR_KINDS = ['holiday', 'event', 'ptm', 'sports', 'exam', 'other', 'exam_paper', 'homework_due'] as const;
export type CalendarKind = (typeof CALENDAR_KINDS)[number];
export const calendarQuery = z.object({
  from: dateStr,
  to: dateStr,
  /** narrow exam papers / homework to one child (parents) */
  studentId: uuid.optional(),
});
export const calendarItem = z.object({
  /** stable key: `<source>:<entityId>[:<date>]` */
  id: z.string(),
  kind: z.enum(CALENDAR_KINDS),
  title: z.string(),
  subtitle: z.string().nullable(),
  date: dateStr,
  endDate: dateStr,
  startTime: timeStr.nullable(),
  endTime: timeStr.nullable(),
  allDay: z.boolean(),
  location: z.string().nullable(),
  /** event status (published | cancelled) or null for derived items */
  status: z.string().nullable(),
  /** child the item belongs to (exam papers, homework) when the caller is a parent */
  studentId: uuid.nullable(),
  entityId: uuid,
  /** client deep link */
  route: z.string(),
});
export type CalendarItem = z.infer<typeof calendarItem>;
export const calendarResponse = z.object({ from: dateStr, to: dateStr, data: z.array(calendarItem) });

// ── parent–teacher meetings ────────────────────────────────────────────────────────────────────
export const MEETING_MODES = ['in_person', 'online', 'phone'] as const;
export const MEETING_ACTIONS = ['confirm', 'decline', 'reschedule', 'complete', 'cancel'] as const;
export type MeetingAction = (typeof MEETING_ACTIONS)[number];

export const meetingRequestBody = z.object({
  studentId: uuid,
  /** a teacher who teaches or leads the child's section (see GET /meetings/teachers) */
  staffId: uuid,
  topic: z.string().trim().min(3).max(300),
  /** preferred time */
  proposedAt: isoDateTime.optional(),
});
const meetingSlot = {
  scheduledAt: isoDateTime,
  durationMin: z.number().int().min(5).max(180),
  mode: z.enum(MEETING_MODES),
  locationOrLink: z.string().trim().max(300),
};
export const meetingConfirmBody = z.object({
  scheduledAt: meetingSlot.scheduledAt,
  durationMin: meetingSlot.durationMin.default(15),
  mode: meetingSlot.mode.default('in_person'),
  /** a room for in_person meetings; a link is required for online */
  locationOrLink: meetingSlot.locationOrLink.optional(),
});
export const meetingRescheduleBody = z.object({
  scheduledAt: meetingSlot.scheduledAt,
  durationMin: meetingSlot.durationMin.optional(),
  mode: meetingSlot.mode.optional(),
  locationOrLink: meetingSlot.locationOrLink.optional(),
});
export const meetingDeclineBody = z.object({ reason: z.string().trim().min(1).max(500) });
export const meetingCompleteBody = z.object({ outcomeNotes: z.string().trim().min(1).max(3000) });
/** the body may be omitted entirely (treated as `{}`) */
export const meetingCancelBody = z.object({ reason: z.string().trim().max(500).optional() });

export const meetingItem = z.object({
  id: uuid,
  status: z.enum(MEETING_STATUSES),
  student: z.object({ id: uuid, name: z.string(), admissionNo: z.string(), grade: z.string().nullable(), section: z.string().nullable() }),
  teacher: z.object({ staffId: uuid, name: z.string(), designation: z.string().nullable() }),
  guardian: z.object({ id: uuid, name: z.string() }).nullable(),
  topic: z.string(),
  proposedAt: isoDateTime.nullable(),
  scheduledAt: isoDateTime.nullable(),
  durationMin: z.number().int(),
  mode: z.enum(MEETING_MODES),
  locationOrLink: z.string().nullable(),
  /** decline reason (declined), cancellation note (cancelled) or meeting outcome (completed) */
  outcomeNotes: z.string().nullable(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  /** what the caller may do next */
  availableActions: z.array(z.enum(MEETING_ACTIONS)),
});
export type MeetingItem = z.infer<typeof meetingItem>;
export const meetingListQuery = pageQuery.extend({
  status: z.enum(MEETING_STATUSES).optional(),
  studentId: uuid.optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
});
export const meetingTeachersQuery = z.object({ studentId: uuid });
export const meetingTeacherOption = z.object({ staffId: uuid, name: z.string(), designation: z.string().nullable(), isClassTeacher: z.boolean(), subjects: z.array(z.string()) });

// ── notifications ──────────────────────────────────────────────────────────────────────────────
export const NOTIFICATION_CATEGORY_LIST = ['attendance', 'homework', 'marks', 'fees', 'announcement', 'event', 'meeting', 'leave', 'tasks', 'system'] as const;
export type NotificationCategoryKey = (typeof NOTIFICATION_CATEGORY_LIST)[number];

export const notificationItem = z.object({
  id: uuid,
  type: z.string(),
  /** first segment of `type`, i.e. the preference category */
  category: z.string(),
  title: z.string(),
  body: z.string().nullable(),
  /** deep link payload: { route: '/homework/<id>', … } */
  data: z.record(z.string(), z.unknown()),
  priority: z.enum(['normal', 'high']),
  read: z.boolean(),
  readAt: isoDateTime.nullable(),
  createdAt: isoDateTime,
});
export type NotificationItem = z.infer<typeof notificationItem>;
export const notificationListQuery = cursorQuery.extend({
  unread: commBoolQuery.optional(),
  category: z.enum(NOTIFICATION_CATEGORY_LIST).optional(),
});
export const notificationList = cursored(notificationItem);
export const notificationUnreadCount = z.object({ unread: z.number().int() });
/** the body may be omitted entirely (treated as `{}`) */
export const notificationReadAllBody = z.object({ category: z.enum(NOTIFICATION_CATEGORY_LIST).optional() });
export const notificationReadAllResponse = z.object({ updated: z.number().int() });

export const notificationPreferenceItem = z.object({
  category: z.enum(NOTIFICATION_CATEGORY_LIST),
  label: z.string(),
  push: z.boolean(),
  email: z.boolean(),
  /** local school time; both null → the school default window applies; from = to switches quiet hours off */
  quietFrom: timeStr.nullable(),
  quietTo: timeStr.nullable(),
});
export const notificationPreferences = z.object({
  categories: z.array(notificationPreferenceItem),
  schoolDefaults: z.object({ quietFrom: timeStr, quietTo: timeStr }),
  timezone: z.string(),
});
export type NotificationPreferences = z.infer<typeof notificationPreferences>;
export const notificationPreferencesUpdateBody = z.object({
  preferences: z
    .array(
      z.object({
        category: z.enum(NOTIFICATION_CATEGORY_LIST),
        push: z.boolean().optional(),
        email: z.boolean().optional(),
        quietFrom: timeStr.nullable().optional(),
        quietTo: timeStr.nullable().optional(),
      }),
    )
    .min(1)
    .max(NOTIFICATION_CATEGORY_LIST.length),
});
export const notificationTestResponse = z.object({
  notificationId: uuid,
  /** what happened to the test push: `sent` reached a device; `skipped` = no device registered or push is off for `system`; `held` = quiet hours */
  status: z.enum(['pending', 'sent', 'failed', 'skipped', 'held']),
  devices: z.number().int(),
});

export const announcementPage = paged(announcementItem);
export const eventPage = paged(eventItem);
export const meetingPage = paged(meetingItem);
