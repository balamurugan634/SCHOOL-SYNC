import { z } from 'zod';
import { dateStr, isoDateTime, pageMeta, pageQuery, uuid } from './common';

// ─────────────────────────────────────────────────────────────────────────────
// Outgoing email: a school's own mail accounts + the email queue (like Frappe's Email Account / Email Queue)
// ─────────────────────────────────────────────────────────────────────────────

export const EMAIL_PROVIDERS = ['gmail', 'outlook', 'zoho', 'yahoo', 'sendgrid', 'custom'] as const;
export type EmailProvider = (typeof EMAIL_PROVIDERS)[number];

export const EMAIL_SECURITY = ['starttls', 'ssl', 'none'] as const;
export type EmailSecurity = (typeof EMAIL_SECURITY)[number];

export const EMAIL_QUEUE_STATUSES = ['not_sent', 'sending', 'sent', 'error', 'cancelled'] as const;
export type EmailQueueStatus = (typeof EMAIL_QUEUE_STATUSES)[number];
export const EMAIL_QUEUE_STATUS_LABELS: Record<EmailQueueStatus, string> = {
  not_sent: 'Not Sent',
  sending: 'Sending',
  sent: 'Sent',
  error: 'Error',
  cancelled: 'Cancelled',
};

/** SMTP ports a school may use (submission 587/465, relay 25, alternative 2525). Anything else is refused unless the API runs with ALLOW_PRIVATE_SMTP (dev/test). */
export const EMAIL_ALLOWED_PORTS = [25, 465, 587, 2525] as const;

/** 1 = high (password reset, one-time codes) · 5 = normal (receipts, notifications) · 9 = bulk (announcements). */
export const EMAIL_PRIORITY = { high: 1, normal: 5, bulk: 9 } as const;

/** How long finished rows are kept (the retention job deletes older ones). */
export const EMAIL_QUEUE_RETENTION = { sentDays: 30, failedDays: 90 } as const;

/** Presets only prefill host/port/security in the form, like Frappe's Email Domain. */
export const EMAIL_PROVIDER_PRESETS: Record<EmailProvider, { label: string; host: string; port: number; security: EmailSecurity; hint: string }> = {
  gmail: { label: 'Google Workspace / Gmail', host: 'smtp.gmail.com', port: 587, security: 'starttls', hint: 'Turn on 2-step verification, then create an app password and use it here. Your normal password will not work.' },
  outlook: { label: 'Microsoft 365 / Outlook', host: 'smtp.office365.com', port: 587, security: 'starttls', hint: 'SMTP sending must be enabled for the mailbox, and many tenants need an app password. Use the full mailbox address as the username.' },
  zoho: { label: 'Zoho Mail', host: 'smtp.zoho.com', port: 587, security: 'starttls', hint: 'Create an application-specific password in Zoho. Accounts in India use smtp.zoho.in, in the EU smtp.zoho.eu.' },
  yahoo: { label: 'Yahoo Mail', host: 'smtp.mail.yahoo.com', port: 587, security: 'starttls', hint: 'Generate an app password in your Yahoo account security settings.' },
  sendgrid: { label: 'SendGrid', host: 'smtp.sendgrid.net', port: 587, security: 'starttls', hint: 'The username is the word apikey and the password is your SendGrid API key. The From address must be a verified sender.' },
  custom: { label: 'Another mail server (SMTP)', host: '', port: 587, security: 'starttls', hint: 'Ask your mail provider or IT person for the SMTP server name, port and security type.' },
};

const noControlChars = (s: string) => !/[\u0000-\u001f\u007f]/.test(s);

/** Pragmatic address check: one plain mailbox, no display name, no quoting, no control characters (header-injection safe). */
export const EMAIL_ADDRESS_RE = /^[^\s@<>()[\]\\,;:"'`]+@[^\s@<>()[\]\\,;:"'`]+\.[^\s@<>()[\]\\,;:"'`]{2,}$/;
export const isEmailAddress = (s: string): boolean => s.length <= 254 && noControlChars(s) && EMAIL_ADDRESS_RE.test(s);

const HOST_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i;
const IPV6_RE = /^[0-9a-f:.]{2,45}$/i;

export const emailAddress = z
  .string()
  .trim()
  .max(254)
  .refine(isEmailAddress, 'Enter a valid email address, for example office@yourschool.org');
const label = (min: number, max: number) => z.string().trim().min(min).max(max).refine(noControlChars, 'Remove line breaks and control characters');

export const smtpHostName = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .refine((h) => HOST_RE.test(h) || (h.includes(':') && IPV6_RE.test(h)), 'Enter only the server name, like smtp.example.com (no https:// and no port)');

const accountShape = {
  name: label(2, 80),
  emailAddress,
  senderName: label(0, 100),
  provider: z.enum(EMAIL_PROVIDERS),
  smtpHost: smtpHostName,
  smtpPort: z.number().int().min(1).max(65535),
  smtpSecurity: z.enum(EMAIL_SECURITY),
  smtpUsername: label(0, 254),
  /** write-only: omitted = keep the saved password, empty string = remove it */
  smtpPassword: z.string().max(512),
  replyTo: emailAddress,
  isDefaultOutgoing: z.boolean(),
  enabled: z.boolean(),
  alwaysUseAccountAddress: z.boolean(),
  dailyLimit: z.number().int().min(1).max(1_000_000),
  /** must be true to save `smtpSecurity: "none"` (credentials and mail travel unencrypted) */
  allowInsecure: z.boolean(),
} as const;

/** Defaults are applied by the service, never here (Zod 4 re-applies `.default()` inside `.partial()`). */
export const emailAccountCreateBody = z.object({
  name: accountShape.name,
  emailAddress: accountShape.emailAddress,
  senderName: accountShape.senderName.optional(),
  provider: accountShape.provider.optional(),
  smtpHost: accountShape.smtpHost,
  smtpPort: accountShape.smtpPort,
  smtpSecurity: accountShape.smtpSecurity,
  smtpUsername: accountShape.smtpUsername.optional(),
  smtpPassword: accountShape.smtpPassword.optional(),
  replyTo: accountShape.replyTo.nullish(),
  isDefaultOutgoing: accountShape.isDefaultOutgoing.optional(),
  enabled: accountShape.enabled.optional(),
  alwaysUseAccountAddress: accountShape.alwaysUseAccountAddress.optional(),
  dailyLimit: accountShape.dailyLimit.nullish(),
  allowInsecure: accountShape.allowInsecure.optional(),
});
export type EmailAccountCreateBody = z.infer<typeof emailAccountCreateBody>;

export const emailAccountUpdateBody = z.object({
  name: accountShape.name.optional(),
  emailAddress: accountShape.emailAddress.optional(),
  senderName: accountShape.senderName.optional(),
  provider: accountShape.provider.optional(),
  smtpHost: accountShape.smtpHost.optional(),
  smtpPort: accountShape.smtpPort.optional(),
  smtpSecurity: accountShape.smtpSecurity.optional(),
  smtpUsername: accountShape.smtpUsername.optional(),
  smtpPassword: accountShape.smtpPassword.optional(),
  replyTo: accountShape.replyTo.nullish(),
  enabled: accountShape.enabled.optional(),
  alwaysUseAccountAddress: accountShape.alwaysUseAccountAddress.optional(),
  dailyLimit: accountShape.dailyLimit.nullish(),
  allowInsecure: accountShape.allowInsecure.optional(),
});
export type EmailAccountUpdateBody = z.infer<typeof emailAccountUpdateBody>;

export const emailAccountOut = z.object({
  id: uuid,
  name: z.string(),
  emailAddress: z.string(),
  senderName: z.string(),
  provider: z.enum(EMAIL_PROVIDERS),
  smtpHost: z.string(),
  smtpPort: z.number(),
  smtpSecurity: z.enum(EMAIL_SECURITY),
  smtpUsername: z.string(),
  /** the password itself is never returned */
  passwordSet: z.boolean(),
  replyTo: z.string().nullable(),
  isDefaultOutgoing: z.boolean(),
  enabled: z.boolean(),
  alwaysUseAccountAddress: z.boolean(),
  dailyLimit: z.number().nullable(),
  /** messages sent today through this account */
  sentToday: z.number(),
  lastTestAt: isoDateTime.nullable(),
  lastTestOk: z.boolean().nullable(),
  lastTestError: z.string().nullable(),
  lastSendAt: isoDateTime.nullable(),
  lastSendError: z.string().nullable(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type EmailAccountOut = z.infer<typeof emailAccountOut>;

/** The read-only "SchoolSync default (platform)" row. */
export const emailPlatformSenderOut = z.object({
  /** the platform operator configured a mail server */
  configured: z.boolean(),
  /** true while no enabled default account exists, i.e. this sender is the one in use */
  active: z.boolean(),
  senderName: z.string(),
  senderAddress: z.string(),
  replyTo: z.string().nullable(),
  lastSendAt: isoDateTime.nullable(),
  lastSendError: z.string().nullable(),
});
export type EmailPlatformSenderOut = z.infer<typeof emailPlatformSenderOut>;

export const emailAccountsOut = z.object({ data: z.array(emailAccountOut), platform: emailPlatformSenderOut });
export type EmailAccountsOut = z.infer<typeof emailAccountsOut>;

export const emailTestBody = z.object({ to: emailAddress.optional() });
export const emailTestOut = z.object({
  ok: z.boolean(),
  /** plain-language and sanitised: never a raw server response */
  error: z.string().nullable(),
  sentTo: z.string(),
  testedAt: isoDateTime,
});
export type EmailTestOut = z.infer<typeof emailTestOut>;

// ── queue ───────────────────────────────────────────────────────────────────────────────────────
export const emailQueueQuery = pageQuery.extend({
  status: z.enum(EMAIL_QUEUE_STATUSES).optional(),
  /** an account id, or `platform` for mail that went through the platform default sender */
  accountId: z.union([uuid, z.literal('platform')]).optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
});

export const emailQueueItem = z.object({
  id: uuid,
  status: z.enum(EMAIL_QUEUE_STATUSES),
  priority: z.number(),
  to: z.array(z.string()),
  cc: z.array(z.string()),
  subject: z.string(),
  sender: z.string(),
  accountId: uuid.nullable(),
  accountName: z.string().nullable(),
  attempts: z.number(),
  maxAttempts: z.number(),
  nextAttemptAt: isoDateTime.nullable(),
  sentAt: isoDateTime.nullable(),
  sentVia: z.string().nullable(),
  lastError: z.string().nullable(),
  referenceType: z.string().nullable(),
  referenceId: z.string().nullable(),
  createdAt: isoDateTime,
});
export type EmailQueueItem = z.infer<typeof emailQueueItem>;

export const emailQueueDetail = emailQueueItem.extend({
  replyTo: z.string().nullable(),
  messageId: z.string().nullable(),
  /** one-time messages (password reset links) are never shown */
  bodyHidden: z.boolean(),
  textBody: z.string().nullable(),
  htmlBody: z.string().nullable(),
  createdByName: z.string().nullable(),
  updatedAt: isoDateTime,
});
export type EmailQueueDetail = z.infer<typeof emailQueueDetail>;

export const emailQueueListOut = z.object({ data: z.array(emailQueueItem), meta: pageMeta });

export const emailQueueSummaryOut = z.object({
  counts: z.object({ not_sent: z.number(), sending: z.number(), sent: z.number(), error: z.number(), cancelled: z.number() }),
  nextDueAt: isoDateTime.nullable(),
  lastSentAt: isoDateTime.nullable(),
  retention: z.object({ sentDays: z.number(), failedDays: z.number() }),
  /** the worker is switched off on this API instance (RUN_WORKERS=false): mail waits for another instance */
  workerEnabled: z.boolean(),
});
export type EmailQueueSummaryOut = z.infer<typeof emailQueueSummaryOut>;

export const EMAIL_QUEUE_ACTIONS = ['send_now', 'retry', 'cancel', 'delete'] as const;
export type EmailQueueAction = (typeof EMAIL_QUEUE_ACTIONS)[number];
export const emailQueueBulkBody = z.object({ action: z.enum(EMAIL_QUEUE_ACTIONS), ids: z.array(uuid).min(1).max(200) });
export const emailQueueBulkOut = z.object({ affected: z.number(), skipped: z.number() });

export const emailQueueFlushOut = z.object({ ok: z.literal(true), due: z.number() });
export const emailQueueClearBody = z.object({
  /** 0 = every finished row of the chosen statuses */
  olderThanDays: z.number().int().min(0).max(3650),
  statuses: z.array(z.enum(['sent', 'error', 'cancelled'])).min(1).max(3),
});
export const emailQueueClearOut = z.object({ deleted: z.number() });
