import { z } from 'zod';
import { uuid } from './common';
import { PLATFORMS } from './enums';
import { USER_TYPES } from './permissions';

export const deviceInfo = z.object({
  platform: z.enum(PLATFORMS),
  name: z.string().max(120).optional(),
  appVersion: z.string().max(40).optional(),
  /** FCM registration token, if the device has one yet. */
  pushToken: z.string().min(20).max(4096).optional(),
});
export type DeviceInfo = z.infer<typeof deviceInfo>;

export const loginBody = z.object({
  identifier: z.string().trim().min(2).max(120),
  password: z.string().min(1).max(200),
  device: deviceInfo.optional(),
});
export type LoginBody = z.infer<typeof loginBody>;

export const refreshBody = z.object({ refreshToken: z.string().min(20).max(300), device: deviceInfo.optional() });

export const passwordPolicy = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(128)
  .refine((v) => /[a-z]/.test(v) && /[A-Z]/.test(v) && /\d/.test(v), 'Use upper and lower case letters and a number');

export const changePasswordBody = z.object({ currentPassword: z.string().min(1).max(200), newPassword: passwordPolicy });
export const forgotPasswordBody = z.object({ identifier: z.string().trim().min(2).max(120) });
export const resetPasswordBody = z.object({ token: z.string().min(20).max(300), newPassword: passwordPolicy });

export const registerDeviceBody = deviceInfo.required({ pushToken: true });

export const linkedChild = z.object({
  studentId: uuid,
  name: z.string(),
  admissionNo: z.string(),
  grade: z.string().nullable(),
  section: z.string().nullable(),
  sectionId: uuid.nullable(),
  photoUrl: z.string().nullable(),
});
export type LinkedChild = z.infer<typeof linkedChild>;

export const meResponse = z.object({
  id: uuid,
  userType: z.enum(USER_TYPES),
  displayName: z.string(),
  username: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  locale: z.string(),
  mustChangePassword: z.boolean(),
  roles: z.array(z.string()),
  experience: z.enum(['student', 'parent', 'teacher', 'management']),
  /** permission key -> scope. For UI gating only; the API enforces. */
  permissions: z.record(z.string(), z.enum(['own', 'linked', 'assigned', 'school'])),
  profile: z.object({
    studentId: uuid.nullable(),
    guardianId: uuid.nullable(),
    staffId: uuid.nullable(),
    /** Parent only: verified-linked children. */
    children: z.array(linkedChild),
    /** Student only. */
    sectionId: uuid.nullable(),
    gradeName: z.string().nullable(),
    sectionName: z.string().nullable(),
    /** Teacher only. */
    classTeacherSectionIds: z.array(uuid),
    assignedSectionIds: z.array(uuid),
  }),
});
export type Me = z.infer<typeof meResponse>;

export const tokenResponse = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  tokenType: z.literal('Bearer'),
  /** seconds until the access token expires */
  expiresIn: z.number(),
  sessionId: uuid,
  user: meResponse,
});
export type TokenResponse = z.infer<typeof tokenResponse>;

export const siteInfoResponse = z.object({
  code: z.string(),
  name: z.string(),
  shortName: z.string().nullable(),
  logoUrl: z.string().nullable(),
  primaryColor: z.string(),
  accentColor: z.string().nullable(),
  timezone: z.string(),
  locale: z.string(),
  currency: z.string(),
  features: z.object({
    fees: z.boolean(),
    transport: z.boolean(),
    library: z.boolean(),
    onlinePayments: z.boolean(),
    studentLogin: z.boolean(),
  }),
  /** subscription lapsed: reads work, writes are refused until the school renews */
  readOnly: z.boolean(),
  api: z.object({ version: z.string(), minAppVersion: z.string() }),
});
export type SiteInfo = z.infer<typeof siteInfoResponse>;

export const sessionInfo = z.object({
  id: uuid,
  platform: z.enum(PLATFORMS),
  deviceName: z.string().nullable(),
  appVersion: z.string().nullable(),
  ip: z.string().nullable(),
  createdAt: z.string(),
  lastUsedAt: z.string(),
  current: z.boolean(),
});

export const licenseResponse = z.object({
  state: z.enum(['unlicensed', 'trial', 'active', 'grace', 'expired', 'cancelled']),
  readOnly: z.boolean(),
  academicYear: z.string().nullable(),
  startsOn: z.string().nullable(),
  endsOn: z.string().nullable(),
  graceEndsOn: z.string().nullable(),
  daysLeft: z.number().nullable(),
  seats: z.object({ used: z.number(), licensed: z.number().nullable(), remaining: z.number().nullable(), nearLimit: z.boolean(), overBy: z.number() }),
  overagePolicy: z.enum(['allow_and_bill', 'block']),
  pricePerStudentMinor: z.number().nullable(),
  currency: z.string().nullable(),
});
