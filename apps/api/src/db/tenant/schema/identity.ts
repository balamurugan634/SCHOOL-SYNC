import { bigint, boolean, index, integer, jsonb, pgTable, primaryKey, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { PLATFORMS, SCOPES, USER_TYPES } from '@school-sync/shared';
import { createdAt, pk, ts, updatedAt } from './_helpers';

export const users = pgTable(
  'users',
  {
    id: pk(),
    userType: text('user_type', { enum: USER_TYPES }).notNull(),
    /** lower-case login handle; for students usually the admission number */
    username: text('username').notNull(),
    email: text('email'),
    phone: text('phone'),
    passwordHash: text('password_hash'),
    displayName: text('display_name').notNull(),
    avatarFileId: uuid('avatar_file_id'),
    status: text('status', { enum: ['invited', 'active', 'suspended', 'deactivated'] })
      .notNull()
      .default('active'),
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: ts('locked_until'),
    lastLoginAt: ts('last_login_at'),
    passwordChangedAt: ts('password_changed_at'),
    /** bumped when roles/permissions change → cached grants and old access tokens are invalidated */
    authVersion: integer('auth_version').notNull().default(1),
    locale: text('locale').notNull().default('en'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('users_username_uq').on(t.username),
    uniqueIndex('users_email_uq').on(t.email),
    uniqueIndex('users_phone_uq').on(t.phone),
    index('users_type_status_idx').on(t.userType, t.status),
  ],
);

export const roles = pgTable(
  'roles',
  {
    id: pk(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    isSystem: boolean('is_system').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('roles_key_uq').on(t.key)],
);

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permission: text('permission').notNull(),
    scope: text('scope', { enum: SCOPES }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permission] })],
);

export const userRoles = pgTable(
  'user_roles',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    grantedBy: uuid('granted_by'),
    grantedAt: ts('granted_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.roleId] }), index('user_roles_role_idx').on(t.roleId)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: pk(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** sha256 of the current refresh secret */
    refreshHash: text('refresh_hash').notNull(),
    /** sha256 of the previous secret — presenting it again means the token was stolen/replayed */
    prevRefreshHash: text('prev_refresh_hash'),
    platform: text('platform', { enum: PLATFORMS }).notNull().default('web'),
    deviceName: text('device_name'),
    appVersion: text('app_version'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    lastUsedAt: ts('last_used_at').notNull().defaultNow(),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
    revokedReason: text('revoked_reason'),
  },
  (t) => [index('sessions_user_idx').on(t.userId, t.revokedAt)],
);

/** FCM / APNs registration tokens, one row per physical install. */
export const devices = pgTable(
  'devices',
  {
    id: pk(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id').references(() => sessions.id, { onDelete: 'set null' }),
    pushToken: text('push_token').notNull(),
    platform: text('platform', { enum: PLATFORMS }).notNull(),
    deviceName: text('device_name'),
    appVersion: text('app_version'),
    enabled: boolean('enabled').notNull().default(true),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('devices_token_uq').on(t.pushToken), index('devices_user_idx').on(t.userId)],
);

export const passwordResets = pgTable(
  'password_resets',
  {
    id: pk(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: ts('expires_at').notNull(),
    usedAt: ts('used_at'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('password_resets_hash_uq').on(t.tokenHash)],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: pk(),
    at: ts('at').notNull().defaultNow(),
    actorUserId: uuid('actor_user_id'),
    actorName: text('actor_name'),
    /** e.g. attendance.submit, marks.publish, auth.login, role.update */
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id'),
    summary: text('summary'),
    before: jsonb('before'),
    after: jsonb('after'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    requestId: text('request_id'),
  },
  (t) => [
    index('audit_at_idx').on(t.at.desc()),
    index('audit_entity_idx').on(t.entity, t.entityId, t.at.desc()),
    index('audit_actor_idx').on(t.actorUserId, t.at.desc()),
    index('audit_action_idx').on(t.action, t.at.desc()),
  ],
);

/** Key/value school settings (branding, timezone, features, attendance policy, …). */
export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedBy: uuid('updated_by'),
  updatedAt: updatedAt(),
});

export const files = pgTable(
  'files',
  {
    id: pk(),
    storageKey: text('storage_key').notNull(),
    originalName: text('original_name').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    sha256: text('sha256'),
    purpose: text('purpose', {
      enum: ['avatar', 'homework', 'submission', 'material', 'document', 'receipt', 'announcement', 'other'],
    })
      .notNull()
      .default('other'),
    uploadedBy: uuid('uploaded_by'),
    createdAt: createdAt(),
    deletedAt: ts('deleted_at'),
  },
  (t) => [uniqueIndex('files_key_uq').on(t.storageKey), index('files_uploader_idx').on(t.uploadedBy)],
);

/** Gap-tolerant, atomic sequences: admission numbers, invoice numbers, receipt numbers. */
export const counters = pgTable('counters', {
  key: text('key').primaryKey(),
  value: bigint('value', { mode: 'number' }).notNull().default(0),
});
