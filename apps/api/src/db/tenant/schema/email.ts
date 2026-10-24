import { boolean, date, index, integer, pgTable, smallint, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { EMAIL_PROVIDERS, EMAIL_QUEUE_STATUSES, EMAIL_SECURITY } from '@school-sync/shared';
import { createdAt, pk, ts, updatedAt } from './_helpers';

/**
 * A school's own outgoing mail account (like Frappe's "Email Account"). Many per school; at most one is the default
 * outgoing account (partial unique index). With no enabled default the platform sender is used (env SMTP_URL / MAIL_FROM).
 * The SMTP password is AES-256-GCM sealed with a per-school key (core/email/secret.ts) and never leaves the API.
 */
export const emailAccounts = pgTable(
  'email_accounts',
  {
    id: pk(),
    /** unique label shown in lists, e.g. "Office mailbox" */
    name: text('name').notNull(),
    /** the From address */
    emailAddress: text('email_address').notNull(),
    senderName: text('sender_name').notNull().default(''),
    /** only prefills host/port/security in the UI */
    provider: text('provider', { enum: EMAIL_PROVIDERS }).notNull().default('custom'),
    smtpHost: text('smtp_host').notNull(),
    smtpPort: integer('smtp_port').notNull().default(587),
    smtpSecurity: text('smtp_security', { enum: EMAIL_SECURITY }).notNull().default('starttls'),
    smtpUsername: text('smtp_username').notNull().default(''),
    /** v1.<iv>.<tag>.<ciphertext>; write-only */
    smtpPasswordEnc: text('smtp_password_enc'),
    replyTo: text('reply_to'),
    isDefaultOutgoing: boolean('is_default_outgoing').notNull().default(false),
    enabled: boolean('enabled').notNull().default(true),
    /** true: the From address is always this account's address; false: a message may ask for another address on the same domain */
    alwaysUseAccountAddress: boolean('always_use_account_address').notNull().default(true),
    dailyLimit: integer('daily_limit'),
    /** messages sent today (school-local day `sentCountDay`); reset lazily, immune to queue clean-ups */
    sentCount: integer('sent_count').notNull().default(0),
    sentCountDay: date('sent_count_day'),
    lastTestAt: ts('last_test_at'),
    lastTestOk: boolean('last_test_ok'),
    lastTestError: text('last_test_error'),
    lastSendAt: ts('last_send_at'),
    lastSendError: text('last_send_error'),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('email_accounts_name_uq').on(sql`lower(${t.name})`), uniqueIndex('email_accounts_default_uq').on(t.isDefaultOutgoing).where(sql`${t.isDefaultOutgoing}`)],
);

/**
 * Every outgoing email (like Frappe's "Email Queue"). A worker sends the rows of one school strictly one at a time
 * (core/email/queue.ts); the partial unique index below makes "one message in flight per school" a database guarantee.
 */
export const emailQueue = pgTable(
  'email_queue',
  {
    id: pk(),
    /** null = the platform default sender */
    accountId: uuid('account_id').references(() => emailAccounts.id, { onDelete: 'set null' }),
    /** the From header as resolved when the mail was queued, e.g. `Office <office@school.org>` */
    sender: text('sender').notNull(),
    toAddresses: text('to_addresses').array().notNull(),
    ccAddresses: text('cc_addresses').array().notNull().default(sql`'{}'::text[]`),
    replyTo: text('reply_to'),
    subject: text('subject').notNull(),
    /** sensitive rows keep a sealed body (`v1.…`); the API never returns it and it is erased once sent */
    textBody: text('text_body'),
    htmlBody: text('html_body'),
    sensitive: boolean('sensitive').notNull().default(false),
    /** 1 = high (password reset, one-time codes) · 5 = normal (receipts, notifications) · 9 = bulk (announcements) */
    priority: smallint('priority').notNull().default(5),
    status: text('status', { enum: EMAIL_QUEUE_STATUSES }).notNull().default('not_sent'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    nextAttemptAt: ts('next_attempt_at').notNull().defaultNow(),
    /** set while `sending`; a row stuck for 10 minutes is recovered */
    claimedAt: ts('claimed_at'),
    /** sanitised: never a raw server response */
    lastError: text('last_error'),
    /** what the mail is about: password_reset, receipt, announcement, notification … */
    referenceType: text('reference_type'),
    referenceId: text('reference_id'),
    messageId: text('message_id'),
    sentAt: ts('sent_at'),
    /** account | platform | platform_fallback (the school's account failed and the mail still had to reach the user) */
    sentVia: text('sent_via'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('email_queue_due_idx').on(t.priority, t.createdAt).where(sql`${t.status} = 'not_sent'`),
    index('email_queue_status_idx').on(t.status, t.createdAt.desc()),
    index('email_queue_created_idx').on(t.createdAt.desc()),
    index('email_queue_account_idx').on(t.accountId),
    uniqueIndex('email_queue_one_sending_uq').on(t.status).where(sql`${t.status} = 'sending'`),
  ],
);
