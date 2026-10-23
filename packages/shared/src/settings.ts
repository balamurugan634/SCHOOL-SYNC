import { z } from 'zod';
import { cursorQuery, cursored, dateStr, isoDateTime, pageQuery, paged, uuid } from './common';
import { licenseResponse } from './auth';
import { ACTIONS, SCOPES, USER_TYPES } from './permissions';

// ─────────────────────────────────────────────────────────────────────────────
// Permission catalog (role editor UI)
// ─────────────────────────────────────────────────────────────────────────────

/** `permission key -> scope`, e.g. `{ "students:view": "assigned" }` */
export const roleGrantsMap = z.record(z.string(), z.enum(SCOPES));
export type RoleGrantsMap = z.infer<typeof roleGrantsMap>;

export const permissionResourceOut = z.object({
  key: z.string(),
  label: z.string(),
  module: z.string(),
  actions: z.array(z.object({ action: z.enum(ACTIONS), permission: z.string() })),
});

export const permissionCatalogOut = z.object({
  actions: z.array(z.enum(ACTIONS)),
  /** narrowest -> widest */
  scopes: z.array(z.enum(SCOPES)),
  modules: z.array(z.object({ key: z.string(), label: z.string(), resources: z.array(permissionResourceOut) })),
  /** the factory presets seeded into every school (for "reset to default" / comparison in the role editor) */
  systemRoles: z.array(
    z.object({
      key: z.string(),
      name: z.string(),
      description: z.string(),
      userTypes: z.array(z.enum(USER_TYPES)),
      experience: z.enum(['student', 'parent', 'teacher', 'management']),
      grants: roleGrantsMap,
    }),
  ),
});
export type PermissionCatalogOut = z.infer<typeof permissionCatalogOut>;

// ─────────────────────────────────────────────────────────────────────────────
// Roles
// ─────────────────────────────────────────────────────────────────────────────

export const roleOut = z.object({
  id: uuid,
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  isSystem: z.boolean(),
  userCount: z.number(),
  permissionCount: z.number(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type RoleOut = z.infer<typeof roleOut>;

export const roleDetailOut = roleOut.extend({ grants: roleGrantsMap });
export type RoleDetailOut = z.infer<typeof roleDetailOut>;

export const roleCreateBody = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(300).optional(),
  /** start from an existing role's grants (then `grants` is applied on top) */
  cloneFromRoleId: uuid.optional(),
  grants: roleGrantsMap.optional(),
});
export type RoleCreateBody = z.infer<typeof roleCreateBody>;

/** The role key is immutable; only the display name / description change. */
export const roleUpdateBody = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  description: z.string().trim().max(300).nullable().optional(),
});
export type RoleUpdateBody = z.infer<typeof roleUpdateBody>;

/** Partial grants map: a scope sets/changes the grant, `null` removes it, omitted keys are untouched. */
export const roleGrantsBody = z.object({ grants: z.record(z.string(), z.enum(SCOPES).nullable()) });
export type RoleGrantsBody = z.infer<typeof roleGrantsBody>;

// ─────────────────────────────────────────────────────────────────────────────
// User accounts
// ─────────────────────────────────────────────────────────────────────────────

export const USER_STATUSES = ['invited', 'active', 'suspended', 'deactivated'] as const;

export const userRoleRef = z.object({ id: uuid, key: z.string(), name: z.string() });

export const userOut = z.object({
  id: uuid,
  username: z.string(),
  displayName: z.string(),
  userType: z.enum(USER_TYPES),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  status: z.enum(USER_STATUSES),
  roles: z.array(userRoleRef),
  lastLoginAt: isoDateTime.nullable(),
  mustChangePassword: z.boolean(),
  /** temporarily locked after failed sign-ins */
  locked: z.boolean(),
  createdAt: isoDateTime,
  studentId: uuid.nullable(),
  guardianId: uuid.nullable(),
  staffId: uuid.nullable(),
});
export type UserOut = z.infer<typeof userOut>;

export const userDetailOut = userOut.extend({
  failedLoginCount: z.number(),
  lockedUntil: isoDateTime.nullable(),
  passwordChangedAt: isoDateTime.nullable(),
  locale: z.string(),
  activeSessions: z.number(),
});
export type UserDetailOut = z.infer<typeof userDetailOut>;

export const userListQuery = pageQuery.extend({
  userType: z.enum(USER_TYPES).optional(),
  status: z.enum(USER_STATUSES).optional(),
  roleId: uuid.optional(),
  roleKey: z.string().max(60).optional(),
});
export type UserListQuery = z.infer<typeof userListQuery>;
export const userListOut = paged(userOut);

/** Creates a **staff** login. Students and parents get theirs from the people module (admission / guardians). */
export const userCreateBody = z.object({
  displayName: z.string().trim().min(2).max(120),
  /** defaults to the employee id (lower case) */
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9._@-]{2,60}$/, 'Use 3-61 letters, digits or . _ @ -')
    .optional(),
  email: z.email().max(160).optional(),
  phone: z.string().trim().min(6).max(20).optional(),
  /** needs `roles:edit` */
  roleIds: z.array(uuid).max(20).optional(),
  /** attach the login to an existing staff profile that has none; otherwise a minimal profile is created */
  staffId: uuid.optional(),
});
export type UserCreateBody = z.infer<typeof userCreateBody>;

export const userCreateOut = userDetailOut.extend({
  /** shown ONCE; the user must change it at first sign-in */
  temporaryPassword: z.string(),
});

export const userRolesBody = z.object({ roleIds: z.array(uuid).max(20) });
export const userRoleAddBody = z.object({ roleId: uuid });
export const userRolesOut = z.object({ userId: uuid, roles: z.array(userRoleRef), changed: z.boolean() });

export const passwordResetOut = z.object({
  username: z.string(),
  /** shown ONCE; all of the user's sessions were signed out and they must change it at next sign-in */
  temporaryPassword: z.string(),
});

export const forceLogoutOut = z.object({ ok: z.literal(true), revoked: z.number() });

export const userSessionOut = z.object({
  id: uuid,
  platform: z.string(),
  deviceName: z.string().nullable(),
  appVersion: z.string().nullable(),
  ip: z.string().nullable(),
  createdAt: isoDateTime,
  lastUsedAt: isoDateTime,
});
export const userSessionsOut = z.object({ data: z.array(userSessionOut) });

// ─────────────────────────────────────────────────────────────────────────────
// School settings (key/value groups, branding, feature toggles)
// ─────────────────────────────────────────────────────────────────────────────

export const settingsGroupParam = z.object({ group: z.string().min(1).max(40) });

/**
 * One settings group as `{ field: value }`. Groups and fields are defined server-side (core/settings.ts):
 * attendance, academic, school, exams, fees, notifications (more may be added). `PUT` takes any subset of a group's fields.
 */
export const settingsGroupOut = z.record(z.string(), z.unknown());
export const settingsGroupBody = z.record(z.string(), z.unknown());
/** every group in one call: `{ attendance: {…}, academic: {…}, … }` */
export const settingsAllOut = z.record(z.string(), settingsGroupOut);

export const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #4f46e5');

export const brandingOut = z.object({
  name: z.string(),
  shortName: z.string().nullable(),
  logoFileId: uuid.nullable(),
  logoUrl: z.string().nullable(),
  primaryColor: z.string(),
  accentColor: z.string().nullable(),
  /** read-only here */
  timezone: z.string(),
  locale: z.string(),
  currency: z.string(),
});
export type BrandingOut = z.infer<typeof brandingOut>;

export const brandingUpdateBody = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  shortName: z.string().trim().min(1).max(24).nullable().optional(),
  /** an uploaded file id; `null` removes the logo */
  logoFileId: uuid.nullable().optional(),
  primaryColor: hexColor.optional(),
  accentColor: hexColor.nullable().optional(),
});
export type BrandingUpdateBody = z.infer<typeof brandingUpdateBody>;

export const featuresOut = z.object({
  fees: z.boolean(),
  transport: z.boolean(),
  library: z.boolean(),
  onlinePayments: z.boolean(),
  studentLogin: z.boolean(),
});
export type FeaturesOut = z.infer<typeof featuresOut>;
/** super administrators only */
export const featuresUpdateBody = featuresOut.partial();

// ─────────────────────────────────────────────────────────────────────────────
// Audit log
// ─────────────────────────────────────────────────────────────────────────────

const auditFilters = {
  actorUserId: uuid.optional(),
  entity: z.string().max(60).optional(),
  entityId: z.string().max(80).optional(),
  /** prefix match: `role.` matches role.create, role.update, … */
  action: z.string().max(80).optional(),
  /** `YYYY-MM-DD` (school-local day) or an ISO-8601 instant */
  from: z.union([dateStr, isoDateTime]).optional(),
  to: z.union([dateStr, isoDateTime]).optional(),
};

export const auditQuery = cursorQuery.extend(auditFilters);
export type AuditQuery = z.infer<typeof auditQuery>;
export const auditExportQuery = z.object(auditFilters);

export const auditEntryOut = z.object({
  id: uuid,
  at: isoDateTime,
  actorUserId: uuid.nullable(),
  actorName: z.string().nullable(),
  action: z.string(),
  entity: z.string(),
  entityId: z.string().nullable(),
  summary: z.string().nullable(),
  ip: z.string().nullable(),
  requestId: z.string().nullable(),
});
export type AuditEntryOut = z.infer<typeof auditEntryOut>;
export const auditListOut = cursored(auditEntryOut);

/** Single entry including the before/after snapshots (secrets are redacted at write time). */
export const auditDetailOut = auditEntryOut.extend({
  userAgent: z.string().nullable(),
  before: z.unknown(),
  after: z.unknown(),
});
export type AuditDetailOut = z.infer<typeof auditDetailOut>;

// ─────────────────────────────────────────────────────────────────────────────
// Setup checklist ("Get your school ready")
// ─────────────────────────────────────────────────────────────────────────────

export const SETUP_STEP_KEYS = [
  'school_profile',
  'academic_year',
  'terms',
  'grades',
  'sections',
  'subjects',
  'teaching_assignments',
  'teachers',
  'students',
  'parents_linked',
  'timetable',
  'fee_structure',
  'communication',
] as const;
export type SetupStepKey = (typeof SETUP_STEP_KEYS)[number];

export const setupStepOut = z.object({
  key: z.enum(SETUP_STEP_KEYS),
  label: z.string(),
  done: z.boolean(),
  /** how many records exist for this step */
  count: z.number(),
  /** what to do next / what is missing */
  hint: z.string(),
});
export type SetupStepOut = z.infer<typeof setupStepOut>;

export const setupStatusOut = z.object({
  steps: z.array(setupStepOut),
  progress: z.object({ done: z.number(), total: z.number(), percent: z.number() }),
  /** every step done */
  ready: z.boolean(),
  license: z.object({
    state: licenseResponse.shape.state,
    readOnly: z.boolean(),
    academicYear: z.string().nullable(),
    daysLeft: z.number().nullable(),
    seats: licenseResponse.shape.seats,
  }),
});
export type SetupStatusOut = z.infer<typeof setupStatusOut>;
