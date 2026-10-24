import { and, asc, eq, inArray, isNull, lt, lte, notInArray, or, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { EMAIL_PRIORITY, EMAIL_QUEUE_RETENTION, isEmailAddress } from '@school-sync/shared';
import { config, isProd } from '../../config';
import { emailAccounts, emailQueue } from '../../db/tenant/schema';
import { todayIn } from '../http';
import { getSetting } from '../settings';
import { tenantDb, type Executor } from '../tenancy/pools';
import type { TenantInfo } from '../tenancy/registry';
import { getDefaultAccount, getEnabledAccount } from './accounts';
import { classifyMailError, type MailFailure } from './errors';
import { isSealed, openForTenant, sealForTenant } from './secret';
import { emailTestHooks } from './test-hooks';
import { isPlatformConfigured, parseFromHeader, platformSenderAddress, TransportSession, type EmailAccountRow, type OutgoingMessage, type SendResult } from './transport';

export type EmailQueueRow = typeof emailQueue.$inferSelect;

// ── tunables (documented in docs/SECURITY.md and docs/ARCHITECTURE.md) ──────────────────────────────
/** wait before retry n (1-based): 1 min, 5 min, 30 min. With the default max_attempts of 3 the third failure is final. */
export const BACKOFF_MINUTES = [1, 5, 30] as const;
/** a row `sending` for longer than this belongs to a crashed worker and is recovered */
export const STUCK_AFTER_MS = 10 * 60_000;
/** messages one school may send per worker run, so a big bulk send cannot starve the other schools */
export const PER_SCHOOL_CAP = 50;
export const MAX_RECIPIENTS = 50;
const MAX_SUBJECT = 300;
const MAX_TEXT = 200_000;
const MAX_HTML = 400_000;

/** Raised for input the caller got wrong (bad address, unknown account). Callers that must not fail (notifications) catch it. */
export class EmailInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmailInputError';
  }
}

export interface EnqueueInput {
  to: string | string[];
  cc?: string[];
  subject: string;
  text: string;
  html?: string;
  /** 1 high · 5 normal (default) · 9 bulk. `sendNow` forces 1. */
  priority?: number;
  /** send through this account (must be enabled); default: the school's default account, else the platform sender */
  accountId?: string;
  /** ask for another From address on the account's domain; honoured only when the account does not force its own address */
  fromEmail?: string;
  replyTo?: string;
  /** what the mail is about: password_reset, receipt, announcement, notification … */
  referenceType?: string;
  referenceId?: string;
  createdBy?: string | null;
  /** the body is a one-time secret (reset link): stored sealed, never shown in the admin UI, erased once sent */
  sensitive?: boolean;
  /** priority 1 + an immediate NON-BLOCKING flush: the HTTP request never waits for SMTP */
  sendNow?: boolean;
  maxAttempts?: number;
}

const stripControl = (s: string) => s.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
const domainOf = (addr: string) => addr.slice(addr.lastIndexOf('@') + 1).toLowerCase();

/** `"Name" <a@b.c>` with nothing in the name that could break the header. */
export function formatAddress(name: string, address: string): string {
  const n = stripControl(name).replace(/["<>\\]/g, '');
  return n ? `"${n}" <${address}>` : address;
}

function addresses(list: string | string[] | undefined, what: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of Array.isArray(list) ? list : list ? [list] : []) {
    const a = typeof raw === 'string' ? raw.trim() : '';
    if (!isEmailAddress(a)) throw new EmailInputError(`Invalid ${what} address`);
    if (!seen.has(a.toLowerCase())) {
      seen.add(a.toLowerCase());
      out.push(a);
    }
  }
  return out;
}

// ── enqueue ─────────────────────────────────────────────────────────────────────────────────────────
/**
 * Queue emails (one multi-row insert, one account lookup). Nothing here talks to a mail server: the worker does, one message
 * at a time per school. Throws EmailInputError for bad input; pass `db` to queue inside the caller's transaction.
 */
export async function enqueueMails(tenant: TenantInfo, mails: EnqueueInput[], opts: { db?: Executor } = {}): Promise<{ id: string }[]> {
  if (!mails.length) return [];
  const db = opts.db ?? tenantDb(tenant);
  let defaultAcct: EmailAccountRow | null | undefined;
  const explicit = new Map<string, EmailAccountRow | null>();
  const rows: (typeof emailQueue.$inferInsert)[] = [];
  const base = Date.now();

  for (const [i, m] of mails.entries()) {
    const to = addresses(m.to, 'recipient');
    const cc = addresses(m.cc, 'cc');
    if (!to.length) throw new EmailInputError('An email needs at least one recipient');
    if (to.length + cc.length > MAX_RECIPIENTS) throw new EmailInputError(`An email can have at most ${MAX_RECIPIENTS} recipients`);
    const subject = stripControl(m.subject).slice(0, MAX_SUBJECT);
    if (!subject) throw new EmailInputError('An email needs a subject');
    if (typeof m.text !== 'string' || m.text.length > MAX_TEXT || (m.html && m.html.length > MAX_HTML)) throw new EmailInputError('The email body is missing or too large');
    const replyTo = m.replyTo ? addresses(m.replyTo, 'reply-to')[0]! : null;
    const fromEmail = m.fromEmail ? addresses(m.fromEmail, 'from')[0]! : null;

    let acct: EmailAccountRow | null;
    if (m.accountId) {
      if (!explicit.has(m.accountId)) explicit.set(m.accountId, await getEnabledAccount(db, m.accountId));
      acct = explicit.get(m.accountId) ?? null;
      if (!acct) throw new EmailInputError('That email account does not exist or is switched off');
    } else {
      defaultAcct ??= await getDefaultAccount(db);
      acct = defaultAcct;
    }
    const address = acct ? (fromEmail && !acct.alwaysUseAccountAddress && domainOf(fromEmail) === domainOf(acct.emailAddress) ? fromEmail : acct.emailAddress) : platformSenderAddress();
    const name = (acct?.senderName || tenant.name) ?? '';

    const id = uuidv7();
    const sensitive = !!m.sensitive;
    rows.push({
      id,
      accountId: acct?.id ?? null,
      sender: formatAddress(name, address),
      toAddresses: to,
      ccAddresses: cc,
      replyTo,
      subject,
      textBody: sensitive ? sealForTenant(m.text, tenant.id, id) : m.text,
      htmlBody: m.html ? (sensitive ? sealForTenant(m.html, tenant.id, id) : m.html) : null,
      sensitive,
      priority: Math.min(9, Math.max(1, Math.trunc(m.sendNow ? EMAIL_PRIORITY.high : (m.priority ?? EMAIL_PRIORITY.normal)))),
      status: 'not_sent',
      attempts: 0,
      maxAttempts: Math.min(10, Math.max(1, Math.trunc(m.maxAttempts ?? 3))),
      nextAttemptAt: new Date(base),
      referenceType: m.referenceType?.slice(0, 40) ?? null,
      referenceId: m.referenceId?.slice(0, 80) ?? null,
      createdBy: m.createdBy ?? null,
      createdAt: new Date(base + i), // strictly increasing, so "oldest first" is deterministic inside one batch
    });
  }
  for (let i = 0; i < rows.length; i += 500) await db.insert(emailQueue).values(rows.slice(i, i + 500));
  if (mails.some((m) => m.sendNow)) kickFlush(tenant);
  return rows.map((r) => ({ id: r.id! }));
}

export async function enqueueMail(tenant: TenantInfo, mail: EnqueueInput, opts: { db?: Executor } = {}): Promise<{ id: string }> {
  const [r] = await enqueueMails(tenant, [mail], opts);
  return r!;
}

// ── worker ──────────────────────────────────────────────────────────────────────────────────────────
export interface FlushOptions {
  /** max messages this run (default PER_SCHOOL_CAP) */
  limit?: number;
  /** only these queue rows (the admin's "Send now") */
  ids?: string[];
}
export interface FlushStats {
  sent: number;
  failed: number;
  retrying: number;
  /** another worker (this or another process) is mid-send for this school */
  busy: boolean;
}

const chains = new Map<string, Promise<unknown>>();
const queuedGeneral = new Map<string, Promise<FlushStats>>();

/**
 * Process one school's due mail, strictly one message at a time. Runs for the same school never overlap inside this process
 * (a promise chain) nor across processes (a try-advisory lock in the claim transaction + the one-`sending`-row unique index).
 * A flush requested while one runs is coalesced into ONE follow-up run, so it never misses a row that arrived mid-run.
 */
export function flushSchool(tenant: TenantInfo, opts: FlushOptions = {}): Promise<FlushStats> {
  const general = !opts.ids;
  if (general) {
    const waiting = queuedGeneral.get(tenant.id);
    if (waiting) return waiting;
  }
  const prev = chains.get(tenant.id) ?? Promise.resolve();
  const run: Promise<FlushStats> = prev
    .then(
      () => undefined,
      () => undefined,
    )
    .then(() => {
      if (general) queuedGeneral.delete(tenant.id);
      return runOnce(tenant, opts);
    });
  if (general) queuedGeneral.set(tenant.id, run);
  chains.set(tenant.id, run);
  void run
    .finally(() => {
      if (chains.get(tenant.id) === run) chains.delete(tenant.id);
    })
    .catch(() => undefined);
  return run;
}

/** Non-blocking: start a flush shortly after the caller returns. Does nothing on instances with RUN_WORKERS=false (their mail waits for the next worker tick). */
export function kickFlush(tenant: TenantInfo, opts: { ids?: string[] } = {}): void {
  if (!(config.RUN_WORKERS || emailTestHooks.forceKick)) return;
  const timer = setTimeout(() => {
    flushSchool(tenant, opts).catch((e) => console.error(`[mail:${tenant.code}] flush failed`, classifyMailError(e).message));
  }, 25);
  timer.unref();
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const sendInterval = () => emailTestHooks.sendIntervalMs ?? config.EMAIL_SEND_INTERVAL_MS;

const pgCode = (e: unknown): string | undefined => {
  const err = e as { code?: string; cause?: { code?: string } } | null;
  return err?.cause?.code ?? err?.code;
};

/** Rows left in `sending` by a crashed worker go back in the queue (or to `error` when out of attempts). */
export async function recoverStuck(db: Executor, now = Date.now()): Promise<number> {
  const rows = await db
    .update(emailQueue)
    .set({
      status: sql`case when ${emailQueue.attempts} + 1 >= ${emailQueue.maxAttempts} then 'error' else 'not_sent' end`,
      attempts: sql`${emailQueue.attempts} + 1`,
      claimedAt: null,
      nextAttemptAt: new Date(now + 60_000),
      lastError: 'Sending was interrupted before the mail server confirmed it. It is tried again automatically.',
      updatedAt: new Date(now),
    })
    .where(and(eq(emailQueue.status, 'sending'), lt(emailQueue.claimedAt, new Date(now - STUCK_AFTER_MS))))
    .returning({ id: emailQueue.id });
  return rows.length;
}

/** Accounts that already sent their daily limit today (school-local day): their rows stay queued until tomorrow. */
async function accountsOverLimit(db: Executor, tenant: TenantInfo): Promise<string[]> {
  const rows = await db
    .select({ id: emailAccounts.id })
    .from(emailAccounts)
    .where(and(sql`${emailAccounts.dailyLimit} is not null`, sql`${emailAccounts.sentCountDay} = ${todayIn(tenant.timezone)}::date`, sql`${emailAccounts.sentCount} >= ${emailAccounts.dailyLimit}`));
  return rows.map((r) => r.id);
}

/** Claim the next due row (priority, then oldest) and mark it `sending`; null when nothing is due; 'busy' when another worker is mid-send. */
async function claimNext(db: Executor, o: { ids?: string[]; blocked: string[] }): Promise<EmailQueueRow | null | 'busy'> {
  try {
    return await db.transaction(async (tx0) => {
      const tx = tx0 as unknown as Executor;
      // per-school advisory lock (advisory locks are per database, and every school has its own): one claimer at a time
      const lock = await tx.execute<{ ok: boolean }>(sql`select pg_try_advisory_xact_lock(hashtext('email.queue')) as ok`);
      if (!lock.rows[0]?.ok) return 'busy' as const;
      const [inflight] = await tx.select({ id: emailQueue.id }).from(emailQueue).where(eq(emailQueue.status, 'sending')).limit(1);
      if (inflight) return 'busy' as const;
      const conds = [eq(emailQueue.status, 'not_sent'), lte(emailQueue.nextAttemptAt, sql`now()`)];
      if (o.ids) conds.push(inArray(emailQueue.id, o.ids));
      if (o.blocked.length) conds.push(or(isNull(emailQueue.accountId), notInArray(emailQueue.accountId, o.blocked))!);
      const [pick] = await tx
        .select({ id: emailQueue.id })
        .from(emailQueue)
        .where(and(...conds))
        .orderBy(asc(emailQueue.priority), asc(emailQueue.createdAt), asc(emailQueue.id))
        .limit(1)
        .for('update', { skipLocked: true });
      if (!pick) return null;
      const [row] = await tx.update(emailQueue).set({ status: 'sending', claimedAt: new Date(), updatedAt: new Date() }).where(eq(emailQueue.id, pick.id)).returning();
      return row ?? null;
    });
  } catch (e) {
    if (pgCode(e) === '23505') return 'busy'; // unique "one sending row" index: someone else got there first
    throw e;
  }
}

interface RunCtx {
  tenant: TenantInfo;
  db: Executor;
  session: TransportSession;
  today: string;
  /** accounts that hit their daily limit during this run */
  blocked: Set<string>;
  schoolEmail?: string | null;
}

async function schoolContactEmail(ctx: RunCtx): Promise<string | null> {
  if (ctx.schoolEmail === undefined) {
    const email = (await getSetting(ctx.db, 'school').catch(() => null))?.email?.trim() ?? '';
    ctx.schoolEmail = isEmailAddress(email) ? email : null;
  }
  return ctx.schoolEmail;
}

function bodiesOf(row: EmailQueueRow, tenantId: string): { text: string | null; html: string | null } {
  const open = (v: string | null) => {
    if (v === null) return null;
    return row.sensitive && isSealed(v) ? openForTenant(v, tenantId, row.id) : v;
  };
  return { text: open(row.textBody), html: open(row.htmlBody) };
}

const NO_SERVER: MailFailure = { message: 'No mail server is set up for this school. Add an email account in Settings, or ask the platform operator to configure the default sender.', retryable: false };

async function runOnce(tenant: TenantInfo, opts: FlushOptions): Promise<FlushStats> {
  const db = tenantDb(tenant);
  const stats: FlushStats = { sent: 0, failed: 0, retrying: 0, busy: false };
  const ctx: RunCtx = { tenant, db, session: new TransportSession(tenant.id), today: todayIn(tenant.timezone), blocked: new Set() };
  const limit = Math.min(opts.limit ?? PER_SCHOOL_CAP, 500);
  try {
    await recoverStuck(db);
    for (let n = 0; n < limit; ) {
      const claimed = await claimNext(db, { ids: opts.ids, blocked: [...new Set([...(await accountsOverLimit(db, tenant)), ...ctx.blocked])] });
      if (claimed === 'busy') {
        stats.busy = true;
        break;
      }
      if (!claimed) break;
      const outcome = await deliver(ctx, claimed);
      if (outcome === 'released') continue; // not counted: nothing was attempted
      n++;
      if (outcome === 'sent') stats.sent++;
      else if (outcome === 'retry') stats.retrying++;
      else stats.failed++;
      if (n < limit) await sleep(sendInterval());
    }
  } finally {
    ctx.session.close();
  }
  return stats;
}

type Outcome = 'sent' | 'retry' | 'error' | 'released';

async function deliver(ctx: RunCtx, row: EmailQueueRow): Promise<Outcome> {
  const { tenant, db } = ctx;
  try {
    const bodies = bodiesOf(row, tenant.id);
    if (bodies.text === null && bodies.html === null) return await failRow(ctx, row, { message: 'The message content is no longer available.', retryable: false });

    // the account recorded at queue time; if it was switched off or deleted since, today's default (else the platform sender)
    let acct: EmailAccountRow | null = null;
    if (row.accountId) acct = (await getEnabledAccount(db, row.accountId)) ?? (await getDefaultAccount(db));
    if (acct && acct.dailyLimit !== null && acct.sentCountDay === ctx.today && acct.sentCount >= acct.dailyLimit) {
      ctx.blocked.add(acct.id);
      await db.update(emailQueue).set({ status: 'not_sent', claimedAt: null, updatedAt: new Date() }).where(eq(emailQueue.id, row.id));
      return 'released';
    }

    const msg = await buildMessage(ctx, row, acct, bodies);
    let via: 'account' | 'platform' | 'platform_fallback' = acct ? 'account' : 'platform';
    let res: SendResult | null = null;
    let note: string | null = null;
    try {
      if (acct) res = await ctx.session.sendViaAccount(acct, msg);
      else {
        res = await ctx.session.sendViaPlatform(msg);
        if (!res) {
          if (!isProd) console.info(`[mail:${tenant.code}:dev] not sent (SMTP_URL unset)`, { to: row.toAddresses, subject: row.subject, text: bodies.text });
          return await failRow(ctx, row, NO_SERVER);
        }
      }
    } catch (e) {
      const failure = classifyMailError(e);
      if (acct) await recordAccountSend(db, acct.id, failure.message);
      // password resets / one-time codes must not strand a user because the school's own mail server is down
      if (acct && row.priority <= EMAIL_PRIORITY.high && isPlatformConfigured()) {
        try {
          res = await ctx.session.sendViaPlatform({ ...msg, from: { name: tenant.name, address: platformSenderAddress() }, replyTo: msg.replyTo ?? (await schoolContactEmail(ctx)) });
          via = 'platform_fallback';
          note = `The school’s account “${acct.name}” failed (${failure.message}); sent through the SchoolSync default sender instead.`;
          console.warn(`[mail:${tenant.code}] account "${acct.name}" failed (${failure.message}); sent via platform default`);
        } catch (e2) {
          return await failRow(ctx, row, classifyMailError(e2));
        }
      } else {
        return await failRow(ctx, row, failure);
      }
    }
    if (!res) return await failRow(ctx, row, NO_SERVER);
    if (acct && via === 'account') await recordAccountSend(db, acct.id, null, ctx.today);
    await db
      .update(emailQueue)
      .set({
        status: 'sent',
        sentAt: new Date(),
        attempts: row.attempts + 1,
        messageId: res.messageId,
        sentVia: via,
        claimedAt: null,
        lastError: note,
        // one-time messages do not outlive their delivery
        ...(row.sensitive ? { textBody: null, htmlBody: null } : {}),
        updatedAt: new Date(),
      })
      .where(eq(emailQueue.id, row.id));
    return 'sent';
  } catch (e) {
    // anything unexpected (database hiccup, decryption failure): count it as a failed attempt, never leave the row `sending`
    return failRow(ctx, row, classifyMailError(e)).catch(() => 'error' as const);
  }
}

async function buildMessage(ctx: RunCtx, row: EmailQueueRow, acct: EmailAccountRow | null, bodies: { text: string | null; html: string | null }): Promise<OutgoingMessage> {
  const requested = parseFromHeader(row.sender).address;
  const from = acct
    ? { name: acct.senderName || ctx.tenant.name, address: !acct.alwaysUseAccountAddress && domainOf(requested) === domainOf(acct.emailAddress) ? requested : acct.emailAddress }
    : { name: ctx.tenant.name, address: platformSenderAddress() };
  // platform sender: replies should reach the school, not the no-reply address
  const replyTo = row.replyTo ?? acct?.replyTo ?? (acct ? null : await schoolContactEmail(ctx));
  return { from, to: row.toAddresses, cc: row.ccAddresses, replyTo, subject: row.subject, text: bodies.text, html: bodies.html };
}

async function recordAccountSend(db: Executor, accountId: string, error: string | null, today?: string): Promise<void> {
  await db
    .update(emailAccounts)
    .set({
      lastSendAt: new Date(),
      lastSendError: error,
      ...(today ? { sentCount: sql`case when ${emailAccounts.sentCountDay} = ${today}::date then ${emailAccounts.sentCount} + 1 else 1 end`, sentCountDay: today } : {}),
      // runtime statistics are not a settings change
      updatedAt: sql`${emailAccounts.updatedAt}`,
    })
    .where(eq(emailAccounts.id, accountId));
}

async function failRow(ctx: RunCtx, row: EmailQueueRow, failure: MailFailure): Promise<'retry' | 'error'> {
  const attempts = row.attempts + 1;
  const final = !failure.retryable || attempts >= row.maxAttempts;
  const wait = BACKOFF_MINUTES[Math.min(attempts, BACKOFF_MINUTES.length) - 1]!;
  await ctx.db
    .update(emailQueue)
    .set({
      status: final ? 'error' : 'not_sent',
      attempts,
      lastError: failure.message,
      claimedAt: null,
      ...(final ? {} : { nextAttemptAt: new Date(Date.now() + wait * 60_000) }),
      updatedAt: new Date(),
    })
    .where(eq(emailQueue.id, row.id));
  return final ? 'error' : 'retry';
}

/** Cheap "is there anything for the worker to do" probe used by the 10-second tick. */
export async function hasWork(db: Executor): Promise<boolean> {
  const [row] = await db
    .select({ id: emailQueue.id })
    .from(emailQueue)
    .where(or(and(eq(emailQueue.status, 'not_sent'), lte(emailQueue.nextAttemptAt, sql`now()`)), and(eq(emailQueue.status, 'sending'), lt(emailQueue.claimedAt, sql`now() - interval '10 minutes'`))))
    .limit(1);
  return !!row;
}

/** Retention: sent mail is kept 30 days, failed/cancelled 90 days (EMAIL_QUEUE_RETENTION). Idempotent. */
export async function purgeFinished(db: Executor, now = Date.now()): Promise<number> {
  const day = 86_400_000;
  const rows = await db
    .delete(emailQueue)
    .where(
      or(
        and(eq(emailQueue.status, 'sent'), lt(emailQueue.sentAt, new Date(now - EMAIL_QUEUE_RETENTION.sentDays * day))),
        and(inArray(emailQueue.status, ['error', 'cancelled']), lt(emailQueue.updatedAt, new Date(now - EMAIL_QUEUE_RETENTION.failedDays * day))),
      ),
    )
    .returning({ id: emailQueue.id });
  return rows.length;
}
