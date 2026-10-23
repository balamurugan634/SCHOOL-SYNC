import { boolean, date, index, integer, jsonb, pgTable, primaryKey, text, time, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { ANNOUNCEMENT_PRIORITIES, AUDIENCE_TARGET_TYPES, EVENT_KINDS, MEETING_STATUSES } from '@school-sync/shared';
import { createdAt, pk, ts, updatedAt } from './_helpers';
import { staff, students, guardians } from './people';
import { users } from './identity';
import type { AttachmentRef } from './learning';

/** Who an announcement/event is for. No rows + audienceAll=false → nobody (draft). */
export const audienceTargets = pgTable(
  'audience_targets',
  {
    id: pk(),
    ownerType: text('owner_type', { enum: ['announcement', 'event'] }).notNull(),
    ownerId: uuid('owner_id').notNull(),
    targetType: text('target_type', { enum: AUDIENCE_TARGET_TYPES }).notNull(),
    /** user_type: 'student'|'parent'|'staff'; role: role key; grade/section: uuid; all: '*' */
    targetId: text('target_id').notNull().default('*'),
  },
  (t) => [index('audience_targets_owner_idx').on(t.ownerType, t.ownerId), index('audience_targets_target_idx').on(t.targetType, t.targetId)],
);

export const announcements = pgTable(
  'announcements',
  {
    id: pk(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    priority: text('priority', { enum: ANNOUNCEMENT_PRIORITIES }).notNull().default('normal'),
    status: text('status', { enum: ['draft', 'published', 'archived'] })
      .notNull()
      .default('draft'),
    attachments: jsonb('attachments').$type<AttachmentRef[]>().notNull().default([]),
    requiresAck: boolean('requires_ack').notNull().default(false),
    publishAt: ts('publish_at'),
    expiresAt: ts('expires_at'),
    createdBy: uuid('created_by').notNull(),
    publishedBy: uuid('published_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('announcements_status_idx').on(t.status, t.publishAt.desc()), index('announcements_attachments_gin').using('gin', t.attachments.op('jsonb_path_ops')), index('announcements_creator_idx').on(t.createdBy, t.createdAt.desc())],
);

export const announcementReceipts = pgTable(
  'announcement_receipts',
  {
    announcementId: uuid('announcement_id')
      .notNull()
      .references(() => announcements.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    readAt: ts('read_at'),
    ackedAt: ts('acked_at'),
  },
  (t) => [primaryKey({ columns: [t.announcementId, t.userId] }), index('announcement_receipts_user_idx').on(t.userId)],
);

/** In-app inbox. Push delivery status is tracked here so failures are visible and retryable. */
export const notifications = pgTable(
  'notifications',
  {
    id: pk(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** dotted category: attendance.absent, homework.assigned, marks.published, fees.due, announcement.new … */
    type: text('type').notNull(),
    title: text('title').notNull(),
    body: text('body'),
    /** deep-link payload for the clients: { route, entityId, ... } — never put private data here */
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    priority: text('priority', { enum: ['normal', 'high'] })
      .notNull()
      .default('normal'),
    readAt: ts('read_at'),
    /** `held` = inside the user's quiet hours; delivered by the sweeper once `deliverAfter` has passed */
    pushStatus: text('push_status', { enum: ['pending', 'sent', 'failed', 'skipped', 'held'] })
      .notNull()
      .default('pending'),
    pushedAt: ts('pushed_at'),
    deliverAfter: ts('deliver_after'),
    createdAt: createdAt(),
  },
  (t) => [
    index('notifications_user_idx').on(t.userId, t.createdAt.desc(), t.id.desc()),
    index('notifications_unread_idx').on(t.userId).where(sql`${t.readAt} is null`),
    index('notifications_push_pending_idx').on(t.createdAt).where(sql`${t.pushStatus} = 'pending'`),
    index('notifications_push_held_idx').on(t.deliverAfter).where(sql`${t.pushStatus} = 'held'`),
  ],
);

export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** category prefix: attendance | homework | marks | fees | announcement | event | meeting | leave | tasks | system */
    category: text('category').notNull(),
    push: boolean('push').notNull().default(true),
    email: boolean('email').notNull().default(false),
    /** quiet hours, local school time HH:MM (both or neither); push is held back inside the window and delivered when it ends (urgent still goes). from = to switches quiet hours off. */
    quietFrom: time('quiet_from'),
    quietTo: time('quiet_to'),
  },
  (t) => [primaryKey({ columns: [t.userId, t.category] })],
);

export const events = pgTable(
  'events',
  {
    id: pk(),
    title: text('title').notNull(),
    description: text('description'),
    kind: text('kind', { enum: EVENT_KINDS }).notNull().default('event'),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }).notNull(),
    startTime: time('start_time'),
    endTime: time('end_time'),
    allDay: boolean('all_day').notNull().default(true),
    location: text('location'),
    audienceAll: boolean('audience_all').notNull().default(true),
    registrationRequired: boolean('registration_required').notNull().default(false),
    consentRequired: boolean('consent_required').notNull().default(false),
    consentText: text('consent_text'),
    registrationDeadline: ts('registration_deadline'),
    capacity: integer('capacity'),
    status: text('status', { enum: ['draft', 'published', 'cancelled'] })
      .notNull()
      .default('published'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('events_start_idx').on(t.startDate, t.endDate), index('events_kind_idx').on(t.kind, t.startDate)],
);

export const eventRegistrations = pgTable(
  'event_registrations',
  {
    id: pk(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    respondedBy: uuid('responded_by').notNull(),
    response: text('response', { enum: ['going', 'not_going', 'consent_given', 'consent_denied'] }).notNull(),
    note: text('note'),
    respondedAt: ts('responded_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('event_registrations_uq').on(t.eventId, t.studentId), index('event_registrations_student_idx').on(t.studentId)],
);

/** Parent–teacher meeting requests and their outcome. */
export const meetings = pgTable(
  'meetings',
  {
    id: pk(),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    guardianId: uuid('guardian_id').references(() => guardians.id, { onDelete: 'set null' }),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staff.id, { onDelete: 'cascade' }),
    requestedBy: uuid('requested_by').notNull(),
    topic: text('topic').notNull(),
    proposedAt: ts('proposed_at'),
    scheduledAt: ts('scheduled_at'),
    durationMin: integer('duration_min').notNull().default(15),
    mode: text('mode', { enum: ['in_person', 'online', 'phone'] })
      .notNull()
      .default('in_person'),
    locationOrLink: text('location_or_link'),
    status: text('status', { enum: MEETING_STATUSES }).notNull().default('requested'),
    outcomeNotes: text('outcome_notes'),
    decidedBy: uuid('decided_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('meetings_staff_idx').on(t.staffId, t.status, t.scheduledAt), index('meetings_student_idx').on(t.studentId, t.createdAt.desc())],
);
