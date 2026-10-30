import { boolean, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { ONLINE_PROVIDERS, ONLINE_STATUSES } from '@school-sync/shared';
import { createdAt, pk, ts, updatedAt } from './_helpers';

/**
 * A school's own Zoom / Google Meet connection (one row per provider; unique). The credentials are sealed with AES-256-GCM
 * under a per-school key with the row id as additional authenticated data (core/online-meetings/secret.ts) and never leave
 * the API. `settings` only holds what the screen may show: Zoom account id / client id / host email, Google organizer email +
 * the service account's client email and numeric client id.
 */
export const meetingIntegrations = pgTable(
  'meeting_integrations',
  {
    id: pk(),
    provider: text('provider', { enum: ONLINE_PROVIDERS }).notNull(),
    enabled: boolean('enabled').notNull().default(true),
    /** v1.<iv>.<tag>.<ciphertext>; write-only */
    credentialsEnc: text('credentials_enc'),
    settings: jsonb('settings').$type<Record<string, string>>().notNull().default({}),
    lastTestAt: ts('last_test_at'),
    lastTestOk: boolean('last_test_ok'),
    lastTestError: text('last_test_error'),
    /** the provider used when a meeting is scheduled without choosing one (at most one: partial unique index) */
    isDefault: boolean('is_default').notNull().default(false),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('meeting_integrations_provider_uq').on(t.provider), uniqueIndex('meeting_integrations_default_uq').on(t.isDefault).where(sql`${t.isDefault}`)],
);

/**
 * A meeting that must still be cancelled at its provider although the event / meeting row that owned it is gone (deleted
 * events). The background job retries it for a day. Rows are deleted as soon as the provider confirms (or says it is gone).
 */
export const onlineMeetingCleanup = pgTable(
  'online_meeting_cleanup',
  {
    id: pk(),
    provider: text('provider', { enum: ONLINE_PROVIDERS }).notNull(),
    remoteMeetingId: text('remote_meeting_id').notNull(),
    source: text('source', { enum: ['event', 'meeting'] }).notNull(),
    attempts: integer('attempts').notNull().default(0),
    /** sanitised */
    lastError: text('last_error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('online_meeting_cleanup_uq').on(t.provider, t.remoteMeetingId), index('online_meeting_cleanup_created_idx').on(t.createdAt)],
);

/** Columns shared by `events` and `meetings`: the online meeting (Zoom / Google Meet) attached to the row. */
export const onlineColumns = () => ({
  /** the provider chosen for this row (null = no online meeting wanted). A draft event keeps its choice here until it is published. */
  onlineProvider: text('online_provider', { enum: ONLINE_PROVIDERS }),
  onlineStatus: text('online_status', { enum: ONLINE_STATUSES }).notNull().default('none'),
  /** where the meeting actually lives right now (differs from `onlineProvider` while it is being switched or cancelled) */
  onlineRemoteProvider: text('online_remote_provider', { enum: ONLINE_PROVIDERS }),
  onlineMeetingId: text('online_meeting_id'),
  onlineJoinUrl: text('online_join_url'),
  /** host link, sealed (staff only) */
  onlineStartUrlEnc: text('online_start_url_enc'),
  onlinePasscode: text('online_passcode'),
  /** sanitised: never a raw provider response */
  onlineError: text('online_error'),
  /** when the current run of failures began (the background retry stops a day after this) */
  onlineFailedAt: ts('online_failed_at'),
  /** short hash of the title / time last pushed to the provider; a different hash means the provider copy needs an update */
  onlineSyncSig: text('online_sync_sig'),
  /** a worker is talking to the provider for this row until this instant (stops two requests creating two meetings) */
  onlineLeaseUntil: ts('online_lease_until'),
});
