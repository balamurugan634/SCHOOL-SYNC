import { z } from 'zod';
import { passwordPolicy } from './auth';
import { cursored, dateStr, isoDateTime, pageMeta, uuid } from './common';
import { featuresOut, hexColor } from './settings';

/**
 * Platform operator console (us, not schools). Everything here lives under `/api/v1/platform/*`.
 * Money is integer minor units; the school's currency travels with every amount.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Operator accounts + auth
// ─────────────────────────────────────────────────────────────────────────────

export const PLATFORM_OPERATOR_STATUSES = ['active', 'disabled'] as const;
export const platformOperatorStatus = z.enum(PLATFORM_OPERATOR_STATUSES);

export const platformOperator = z.object({
  id: uuid,
  email: z.string(),
  displayName: z.string(),
  status: platformOperatorStatus,
  mustChangePassword: z.boolean(),
  lastLoginAt: isoDateTime.nullable(),
  /** set while the account is locked after repeated failed sign-ins */
  lockedUntil: isoDateTime.nullable(),
  createdAt: isoDateTime,
});
export type PlatformOperator = z.infer<typeof platformOperator>;

export const platformLoginBody = z.object({ email: z.string().trim().min(3).max(200), password: z.string().min(1).max(200) });
export type PlatformLoginBody = z.infer<typeof platformLoginBody>;
export const platformRefreshBody = z.object({ refreshToken: z.string().min(20).max(300) });

export const platformTokenResponse = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  tokenType: z.literal('Bearer'),
  expiresIn: z.number(),
  sessionId: uuid,
  operator: platformOperator,
});
export type PlatformTokenResponse = z.infer<typeof platformTokenResponse>;

export const platformChangePasswordBody = z.object({ currentPassword: z.string().min(1).max(200), newPassword: passwordPolicy });
export type PlatformChangePasswordBody = z.infer<typeof platformChangePasswordBody>;

export const platformOperatorCreateBody = z.object({
  email: z.email().max(200),
  displayName: z.string().trim().min(2).max(80),
  /** omit to have a temporary password generated (shown once) */
  password: passwordPolicy.optional(),
});
export type PlatformOperatorCreateBody = z.infer<typeof platformOperatorCreateBody>;
/** `temporaryPassword` is null when the caller supplied the password. Shown once, never stored in readable form. */
export const platformOperatorCreateOut = z.object({ operator: platformOperator, temporaryPassword: z.string().nullable() });
export const platformOperatorResetOut = z.object({ operator: platformOperator, temporaryPassword: z.string() });
export const platformOperatorList = z.object({ data: z.array(platformOperator) });

// ─────────────────────────────────────────────────────────────────────────────
// Schools (tenants): list, detail, create, update
// ─────────────────────────────────────────────────────────────────────────────

export const PLATFORM_TENANT_STATUSES = ['provisioning', 'active', 'suspended', 'archived', 'failed'] as const;
export const platformTenantStatus = z.enum(PLATFORM_TENANT_STATUSES);
export const PLATFORM_LICENSE_STATES = ['unlicensed', 'trial', 'active', 'grace', 'expired', 'cancelled'] as const;
export const platformLicenseState = z.enum(PLATFORM_LICENSE_STATES);
export type PlatformLicenseState = z.infer<typeof platformLicenseState>;
export const platformOveragePolicy = z.enum(['allow_and_bill', 'block']);

export const platformLicense = z.object({
  /** the subscription this describes (the one covering today, else the latest); null when unlicensed */
  subscriptionId: uuid.nullable(),
  state: platformLicenseState,
  readOnly: z.boolean(),
  academicYear: z.string().nullable(),
  startsOn: dateStr.nullable(),
  endsOn: dateStr.nullable(),
  graceEndsOn: dateStr.nullable(),
  daysLeft: z.number().nullable(),
  licensedStudents: z.number().nullable(),
  pricePerStudentMinor: z.number().nullable(),
  currency: z.string().nullable(),
  overagePolicy: platformOveragePolicy,
});
export type PlatformLicense = z.infer<typeof platformLicense>;

/** `used` is the latest metered count for the current subscription (null until the school has been metered). */
export const platformSeats = z.object({
  used: z.number().nullable(),
  licensed: z.number().nullable(),
  remaining: z.number().nullable(),
  overBy: z.number(),
  nearLimit: z.boolean(),
  asOf: dateStr.nullable(),
});
export type PlatformSeats = z.infer<typeof platformSeats>;

export const platformUsagePoint = z.object({ date: dateStr, billableStudents: z.number(), activeStudents: z.number(), staff: z.number(), parents: z.number() });
export type PlatformUsagePoint = z.infer<typeof platformUsagePoint>;

export const platformBillingBrief = z.object({ outstandingMinor: z.number(), outstandingCount: z.number(), overdueCount: z.number() });

/** Is the school's database on the newest structure? (`upToDate` false = an update is waiting) */
export const platformSchemaState = z.object({ version: z.string().nullable(), latest: z.string(), upToDate: z.boolean() });
export type PlatformSchemaState = z.infer<typeof platformSchemaState>;

export const platformMigrateOut = z.object({
  updated: z.number(),
  failed: z.number(),
  results: z.array(z.object({ code: z.string(), ok: z.boolean(), error: z.string().nullable() })),
});
export type PlatformMigrateOut = z.infer<typeof platformMigrateOut>;

export const platformTenantSummary = z.object({
  id: uuid,
  code: z.string(),
  name: z.string(),
  status: platformTenantStatus,
  dbName: z.string(),
  timezone: z.string(),
  currency: z.string(),
  brandColor: z.string().nullable(),
  createdAt: isoDateTime,
  license: platformLicense,
  seats: platformSeats,
  usage: platformUsagePoint.nullable(),
  billing: platformBillingBrief,
  schema: platformSchemaState,
});
export type PlatformTenantSummary = z.infer<typeof platformTenantSummary>;

/** All filters optional; without `pageSize` the whole (filtered) list is returned, which keeps the older automation call unchanged. */
export const platformTenantListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: platformTenantStatus.optional(),
  license: platformLicenseState.optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
});
export type PlatformTenantListQuery = z.infer<typeof platformTenantListQuery>;

export const platformTenantList = z.object({
  data: z.array(platformTenantSummary),
  meta: pageMeta,
  /** counts over the search-filtered set, before the status / subscription filters (for the filter chips) */
  facets: z.object({ status: z.record(z.string(), z.number()), license: z.record(z.string(), z.number()), /** schools whose database is behind (update waiting) */ updates: z.number() }),
});

export const platformSubscription = z.object({
  id: uuid,
  academicYear: z.string(),
  startsOn: dateStr,
  endsOn: dateStr,
  graceDays: z.number(),
  status: z.enum(['trial', 'active', 'cancelled']),
  pricePerStudentMinor: z.number(),
  currency: z.string(),
  licensedStudents: z.number().nullable(),
  overagePolicy: platformOveragePolicy,
  notes: z.string().nullable(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type PlatformSubscription = z.infer<typeof platformSubscription>;

export const platformTenantProfile = z.object({
  id: uuid,
  code: z.string(),
  name: z.string(),
  status: platformTenantStatus,
  dbName: z.string(),
  plan: z.string(),
  timezone: z.string(),
  locale: z.string(),
  currency: z.string(),
  branding: z.object({ primaryColor: z.string().nullable(), shortName: z.string().nullable(), logoUrl: z.string().nullable() }),
  features: featuresOut,
  schemaVersion: z.string().nullable(),
  schemaLatest: z.string(),
  schemaUpToDate: z.boolean(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});

export const platformTenantDetail = z.object({
  tenant: platformTenantProfile,
  domains: z.array(z.object({ domain: z.string(), isPrimary: z.boolean(), createdAt: isoDateTime })),
  license: platformLicense,
  seats: platformSeats,
  usage: platformUsagePoint.nullable(),
  billing: platformBillingBrief,
  subscriptions: z.array(platformSubscription),
});
export type PlatformTenantDetail = z.infer<typeof platformTenantDetail>;

export const platformCodeCheck = z.object({ available: z.boolean(), reason: z.enum(['invalid', 'reserved', 'taken']).nullable(), message: z.string().nullable() });
export const platformCodeCheckQuery = z.object({ code: z.string().trim().max(60) });

// Subscription terms. `pricePerStudent` (major units, the original API) or `pricePerStudentMinor` (integer minor units, preferred).
const subscriptionFields = z.object({
  academicYear: z.string().regex(/^\d{4}-\d{2}$/, 'Use a year like 2026-27'),
  startsOn: dateStr,
  endsOn: dateStr,
  pricePerStudent: z.number().min(0).optional(),
  pricePerStudentMinor: z.number().int().min(0).optional(),
  licensedStudents: z.number().int().min(0).nullable().optional(),
  overagePolicy: platformOveragePolicy.optional(),
  graceDays: z.number().int().min(0).max(180).optional(),
  trial: z.boolean().optional(),
  currency: z.string().length(3).optional(),
  notes: z.string().trim().max(500).optional(),
});
const needsPrice = (v: { pricePerStudent?: number; pricePerStudentMinor?: number }) => v.pricePerStudent !== undefined || v.pricePerStudentMinor !== undefined;
const priceMsg = { message: 'Enter the price per student', path: ['pricePerStudentMinor'] };
export const platformSubscriptionBody = subscriptionFields.refine(needsPrice, priceMsg);
export type PlatformSubscriptionBody = z.infer<typeof platformSubscriptionBody>;
/** Terms given while creating a school: the academic year and dates default to the current April-March year. */
export const platformSubscriptionTerms = subscriptionFields.partial({ academicYear: true, startsOn: true, endsOn: true }).refine(needsPrice, priceMsg);
export type PlatformSubscriptionTerms = z.infer<typeof platformSubscriptionTerms>;

export const platformSubscriptionList = z.object({ data: z.array(platformSubscription) });

/** Creating a school. The `admin*`, `timezone`, `currency` and `subscription` fields are the original API; the rest is new. */
export const platformTenantCreateBody = z.object({
  code: z.string().trim().min(1).max(60),
  name: z.string().trim().min(2).max(120),
  adminName: z.string().trim().min(2).max(120).optional(),
  adminEmail: z.email().optional(),
  adminUsername: z.string().trim().toLowerCase().min(3).max(60).optional(),
  adminPassword: z.string().min(10).optional(),
  timezone: z.string().trim().min(3).max(60).optional(),
  currency: z.string().length(3).optional(),
  locale: z.string().trim().min(2).max(10).optional(),
  brandColor: hexColor.optional(),
  features: featuresOut.partial().optional(),
  subscription: platformSubscriptionTerms.optional(),
  /** only honoured when the server allows demo data (never in production unless explicitly enabled) */
  demoData: z.boolean().optional(),
});
export type PlatformTenantCreateBody = z.infer<typeof platformTenantCreateBody>;

/** `admin.password` is the temporary password: returned exactly once, here. */
export const platformTenantCreateOut = z.object({
  id: uuid,
  code: z.string(),
  name: z.string(),
  status: platformTenantStatus,
  admin: z.object({ username: z.string(), password: z.string(), generated: z.boolean() }),
  subscription: platformSubscription.nullable(),
  demoDataLoaded: z.boolean(),
});
export type PlatformTenantCreateOut = z.infer<typeof platformTenantCreateOut>;

export const platformTenantUpdateBody = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  brandColor: hexColor.optional(),
  shortName: z.string().trim().min(1).max(24).nullable().optional(),
  timezone: z.string().trim().min(3).max(60).optional(),
  features: featuresOut.partial().optional(),
});
export type PlatformTenantUpdateBody = z.infer<typeof platformTenantUpdateBody>;

export const platformTenantStatusBody = z.object({ status: z.enum(['active', 'suspended', 'archived']), reason: z.string().trim().max(300).optional() });
export const platformTenantStatusOut = z.object({ ok: z.literal(true), status: platformTenantStatus });

export const platformSubscriptionOut = z.object({ id: uuid, academicYear: z.string(), subscription: platformSubscription });

// ─────────────────────────────────────────────────────────────────────────────
// Usage
// ─────────────────────────────────────────────────────────────────────────────

export const platformUsageQuery = z.object({ days: z.coerce.number().int().min(7).max(800).default(180) });
export const platformUsageOut = z.object({ data: z.array(platformUsagePoint), peakBillable: z.number(), academicYear: z.string().nullable() });
export const platformUsageSnapshotOut = z.object({ usage: platformUsagePoint, seats: platformSeats });
export const platformMeterAllOut = z.object({ data: z.array(z.object({ code: z.string(), ok: z.boolean(), billableStudents: z.number().optional(), error: z.string().optional() })) });

// ─────────────────────────────────────────────────────────────────────────────
// Invoices + billing overview
// ─────────────────────────────────────────────────────────────────────────────

export const platformInvoice = z.object({
  id: uuid,
  tenantId: uuid,
  number: z.string(),
  tenantCode: z.string(),
  tenantName: z.string(),
  subscriptionId: uuid,
  academicYear: z.string(),
  kind: z.enum(['seats', 'true_up', 'adjustment']),
  students: z.number(),
  unitPriceMinor: z.number(),
  amountMinor: z.number(),
  currency: z.string(),
  status: z.enum(['draft', 'issued', 'paid', 'void']),
  /** issued, unpaid and past its due date */
  overdue: z.boolean(),
  issuedAt: isoDateTime,
  dueOn: dateStr.nullable(),
  paidAt: isoDateTime.nullable(),
  paymentReference: z.string().nullable(),
  notes: z.string().nullable(),
});
export type PlatformInvoice = z.infer<typeof platformInvoice>;

export const platformInvoiceListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  tenant: z.string().trim().max(60).optional(),
  status: z.enum(['draft', 'issued', 'paid', 'void']).optional(),
  kind: z.enum(['seats', 'true_up', 'adjustment']).optional(),
  overdue: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type PlatformInvoiceListQuery = z.infer<typeof platformInvoiceListQuery>;
export const platformInvoiceList = z.object({ data: z.array(platformInvoice), meta: pageMeta });
export const platformInvoiceDataList = z.object({ data: z.array(platformInvoice) });

export const platformInvoiceIssueBody = z.object({ kind: z.enum(['seats', 'true_up']), academicYear: z.string().regex(/^\d{4}-\d{2}$/), dueOn: dateStr.optional() });
export type PlatformInvoiceIssueBody = z.infer<typeof platformInvoiceIssueBody>;
/** `invoice` is null when there is nothing to bill (for example no students above what was already invoiced). */
export const platformInvoiceIssueOut = z.object({ invoice: platformInvoice.nullable(), message: z.string().nullable() });
export const platformInvoicePayBody = z.object({ paidOn: dateStr, reference: z.string().trim().max(120).optional() });
export const platformInvoiceVoidBody = z.object({ reason: z.string().trim().min(3).max(300) });
export const platformInvoiceOut = z.object({ invoice: platformInvoice });

export const platformBillingSchool = z.object({
  code: z.string(),
  name: z.string(),
  status: platformTenantStatus,
  currency: z.string(),
  state: platformLicenseState,
  academicYear: z.string().nullable(),
  subscriptionId: uuid.nullable(),
  pricePerStudentMinor: z.number().nullable(),
  /** committed seats, null = unlimited */
  licensedStudents: z.number().nullable(),
  /** latest metered count, null until the school has been metered */
  usedNow: z.number().nullable(),
  peakBillable: z.number(),
  /** students already covered by non-void seats + true-up invoices */
  invoicedStudents: z.number(),
  seatsInvoiced: z.boolean(),
  trueUpStudents: z.number(),
  trueUpMinor: z.number(),
  outstandingMinor: z.number(),
  outstandingCount: z.number(),
  overdueCount: z.number(),
});
export type PlatformBillingSchool = z.infer<typeof platformBillingSchool>;

export const platformBillingOverview = z.object({
  asOf: dateStr,
  /** one row per currency, so schools billed in different currencies are never added together */
  totals: z.array(z.object({ currency: z.string(), committedMinor: z.number(), invoicedMinor: z.number(), paidMinor: z.number(), outstandingMinor: z.number(), overdueMinor: z.number(), trueUpDueMinor: z.number() })),
  schools: z.array(platformBillingSchool),
});
export type PlatformBillingOverview = z.infer<typeof platformBillingOverview>;

// ─────────────────────────────────────────────────────────────────────────────
// Audit log
// ─────────────────────────────────────────────────────────────────────────────

export const platformAuditEntry = z.object({
  id: uuid,
  at: isoDateTime,
  /** operator id, `platform-api` (X-Platform-Key), `cli` or `system` */
  actor: z.string(),
  actorKind: z.enum(['operator', 'key', 'cli', 'system']),
  actorName: z.string().nullable(),
  action: z.string(),
  tenantCode: z.string().nullable(),
  detail: z.unknown().nullable(),
});
export type PlatformAuditEntry = z.infer<typeof platformAuditEntry>;
export const platformAuditQuery = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  tenant: z.string().trim().max(60).optional(),
  action: z.string().trim().max(80).optional(),
  actor: z.string().trim().max(80).optional(),
});
export const platformAuditList = cursored(platformAuditEntry);

// ─────────────────────────────────────────────────────────────────────────────
// Console configuration (what this server allows)
// ─────────────────────────────────────────────────────────────────────────────

export const platformConsoleConfig = z.object({
  environment: z.enum(['development', 'test', 'production']),
  /** the create-school wizard offers demo data only when this is true */
  demoDataAllowed: z.boolean(),
  apiVersion: z.string(),
});
export type PlatformConsoleConfig = z.infer<typeof platformConsoleConfig>;
