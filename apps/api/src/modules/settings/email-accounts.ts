import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { isEmailAddress, type EmailAccountCreateBody, type EmailAccountOut, type EmailAccountUpdateBody, type EmailAccountsOut, type EmailTestOut } from '@school-sync/shared';
import { audit, type AuditActor } from '../../core/audit';
import { AppError, conflict, notFound, tooMany, unprocessable } from '../../core/errors';
import { auditView, getDefaultAccount, toAccountOut } from '../../core/email/accounts';
import { assertSmtpTargetAllowed, SmtpTargetError } from '../../core/email/guard';
import { sealForTenant } from '../../core/email/secret';
import { sendTestMessage } from '../../core/email/send-test';
import { isPlatformConfigured, platformSenderAddress, type EmailAccountRow } from '../../core/email/transport';
import { getSetting } from '../../core/settings';
import type { Executor } from '../../core/tenancy/pools';
import type { TenantInfo } from '../../core/tenancy/registry';
import type { Principal } from '../../core/rbac/principal';
import { auditLogs, emailAccounts, emailQueue, users } from '../../db/tenant/schema';

export interface EmailCtx {
  actor: AuditActor;
  principal: Principal;
  tenant: TenantInfo;
}

const CONNECTION_FIELDS = ['smtpHost', 'smtpPort', 'smtpSecurity', 'smtpUsername', 'smtpPassword'] as const;

/** Turns a guard refusal into a 422 the form can show next to the host/port field. */
async function assertTargetOk(host: string, port: number): Promise<void> {
  try {
    await assertSmtpTargetAllowed(host, port);
  } catch (e) {
    if (e instanceof SmtpTargetError) throw new AppError(422, e.code === 'PORT_NOT_ALLOWED' ? 'SMTP_PORT_NOT_ALLOWED' : 'SMTP_HOST_BLOCKED', e.message, { field: e.code === 'PORT_NOT_ALLOWED' ? 'smtpPort' : 'smtpHost' });
    throw e;
  }
}

async function requireAccount(db: Executor, id: string): Promise<EmailAccountRow> {
  const [row] = await db.select().from(emailAccounts).where(eq(emailAccounts.id, id)).limit(1);
  if (!row) throw notFound('Email account');
  return row;
}

async function assertNameFree(db: Executor, name: string, exceptId?: string): Promise<void> {
  const [dup] = await db
    .select({ id: emailAccounts.id })
    .from(emailAccounts)
    .where(and(sql`lower(${emailAccounts.name}) = lower(${name})`, exceptId ? ne(emailAccounts.id, exceptId) : undefined))
    .limit(1);
  if (dup) throw conflict('You already have an email account with that name', 'EMAIL_ACCOUNT_NAME_TAKEN');
}

// ── read ────────────────────────────────────────────────────────────────────────────────────────────
export async function listAccounts(db: Executor, tenant: TenantInfo): Promise<EmailAccountsOut> {
  const [rows, def, school, lastOk, lastErr] = await Promise.all([
    db.select().from(emailAccounts).orderBy(desc(emailAccounts.isDefaultOutgoing), asc(emailAccounts.name)),
    getDefaultAccount(db),
    getSetting(db, 'school').catch(() => null),
    db.select({ at: sql<Date | null>`max(${emailQueue.sentAt})` }).from(emailQueue).where(sql`${emailQueue.sentVia} in ('platform', 'platform_fallback')`),
    db
      .select({ at: emailQueue.updatedAt, error: emailQueue.lastError })
      .from(emailQueue)
      .where(and(sql`${emailQueue.accountId} is null`, eq(emailQueue.status, 'error')))
      .orderBy(desc(emailQueue.updatedAt))
      .limit(1),
  ]);
  const sentAt = lastOk[0]?.at ? new Date(lastOk[0].at) : null;
  const err = lastErr[0];
  const contact = school?.email?.trim() ?? '';
  return {
    data: rows.map((r) => toAccountOut(r, tenant)),
    platform: {
      configured: isPlatformConfigured(),
      active: !def,
      senderName: tenant.name,
      senderAddress: platformSenderAddress(),
      replyTo: isEmailAddress(contact) ? contact : null,
      lastSendAt: sentAt ? sentAt.toISOString() : null,
      // only an error that is newer than the last success is worth showing
      lastSendError: err?.error && (!sentAt || err.at > sentAt) ? err.error : null,
    },
  };
}

export async function getAccountOut(db: Executor, tenant: TenantInfo, id: string): Promise<EmailAccountOut> {
  return toAccountOut(await requireAccount(db, id), tenant);
}

// ── write ───────────────────────────────────────────────────────────────────────────────────────────
function assertInsecureAck(security: string, ack: boolean | undefined): void {
  if (security === 'none' && ack !== true) {
    throw new AppError(422, 'INSECURE_NOT_ACKNOWLEDGED', 'Without encryption the password and every email travel across the internet in plain text. Confirm that you accept this to continue.', { field: 'allowInsecure' });
  }
}

function assertCredentials(username: string, hasPassword: boolean): void {
  if (username && !hasPassword) throw new AppError(422, 'PASSWORD_REQUIRED', 'Enter the password (or app password) for this username.', { field: 'smtpPassword' });
}

export async function createAccount(tx: Executor, ctx: EmailCtx, input: EmailAccountCreateBody): Promise<EmailAccountOut> {
  await assertNameFree(tx, input.name);
  assertInsecureAck(input.smtpSecurity, input.allowInsecure);
  await assertTargetOk(input.smtpHost, input.smtpPort);
  const password = input.smtpPassword ?? '';
  const username = input.smtpUsername ?? '';
  assertCredentials(username, password !== '');
  const enabled = input.enabled ?? true;
  if (input.isDefaultOutgoing && !enabled) throw conflict('Switch the account on before making it the default', 'ACCOUNT_DISABLED');

  const id = uuidv7();
  if (input.isDefaultOutgoing) await tx.update(emailAccounts).set({ isDefaultOutgoing: false }).where(eq(emailAccounts.isDefaultOutgoing, true));
  const [row] = await tx
    .insert(emailAccounts)
    .values({
      id,
      name: input.name,
      emailAddress: input.emailAddress,
      senderName: input.senderName ?? '',
      provider: input.provider ?? 'custom',
      smtpHost: input.smtpHost,
      smtpPort: input.smtpPort,
      smtpSecurity: input.smtpSecurity,
      smtpUsername: username,
      smtpPasswordEnc: password ? sealForTenant(password, ctx.tenant.id, id) : null,
      replyTo: input.replyTo ?? null,
      isDefaultOutgoing: !!input.isDefaultOutgoing,
      enabled,
      alwaysUseAccountAddress: input.alwaysUseAccountAddress ?? true,
      dailyLimit: input.dailyLimit ?? null,
      createdBy: ctx.principal.userId,
      updatedBy: ctx.principal.userId,
    })
    .returning();
  const out = toAccountOut(row!, ctx.tenant);
  await audit(tx, ctx.actor, { action: 'email_account.create', entity: 'email_account', entityId: id, summary: `Added email account “${input.name}”`, after: auditView(out) });
  return out;
}

export async function updateAccount(tx: Executor, ctx: EmailCtx, id: string, input: EmailAccountUpdateBody): Promise<EmailAccountOut> {
  const row = await requireAccount(tx, id);
  const before = auditView(toAccountOut(row, ctx.tenant));
  if (input.name !== undefined) await assertNameFree(tx, input.name, id);

  const host = input.smtpHost ?? row.smtpHost;
  const port = input.smtpPort ?? row.smtpPort;
  const security = input.smtpSecurity ?? row.smtpSecurity;
  const username = input.smtpUsername ?? row.smtpUsername;
  const touchesConnection = CONNECTION_FIELDS.some((f) => input[f] !== undefined);
  if (touchesConnection) {
    // switching an account to an unencrypted connection needs the explicit acknowledgement; one that already is unencrypted keeps it
    if (security === 'none' && row.smtpSecurity !== 'none') assertInsecureAck(security, input.allowInsecure);
    if (input.smtpHost !== undefined || input.smtpPort !== undefined) await assertTargetOk(host, port);
  }

  // password: omitted = keep, '' = remove, anything else = replace (write-only: it is never read back)
  let passwordEnc = row.smtpPasswordEnc;
  if (input.smtpPassword !== undefined) passwordEnc = input.smtpPassword === '' ? null : sealForTenant(input.smtpPassword, ctx.tenant.id, id);
  assertCredentials(username, !!passwordEnc);

  const enabled = input.enabled ?? row.enabled;
  // the default must be switched on: switching it off hands the default back to the platform sender
  const isDefault = row.isDefaultOutgoing && enabled;

  const [updated] = await tx
    .update(emailAccounts)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.emailAddress !== undefined ? { emailAddress: input.emailAddress } : {}),
      ...(input.senderName !== undefined ? { senderName: input.senderName } : {}),
      ...(input.provider !== undefined ? { provider: input.provider } : {}),
      smtpHost: host,
      smtpPort: port,
      smtpSecurity: security,
      smtpUsername: username,
      smtpPasswordEnc: passwordEnc,
      ...(input.replyTo !== undefined ? { replyTo: input.replyTo } : {}),
      enabled,
      isDefaultOutgoing: isDefault,
      ...(input.alwaysUseAccountAddress !== undefined ? { alwaysUseAccountAddress: input.alwaysUseAccountAddress } : {}),
      ...(input.dailyLimit !== undefined ? { dailyLimit: input.dailyLimit } : {}),
      // a result that predates a connection change says nothing about the new settings
      ...(touchesConnection ? { lastTestAt: null, lastTestOk: null, lastTestError: null, lastSendError: null } : {}),
      updatedBy: ctx.principal.userId,
    })
    .where(eq(emailAccounts.id, id))
    .returning();
  const out = toAccountOut(updated!, ctx.tenant);
  await audit(tx, ctx.actor, {
    action: 'email_account.update',
    entity: 'email_account',
    entityId: id,
    summary: `Updated email account “${updated!.name}”${input.smtpPassword !== undefined ? (input.smtpPassword === '' ? ' (password removed)' : ' (password replaced)') : ''}`,
    before,
    after: auditView(out),
  });
  return out;
}

export async function deleteAccount(tx: Executor, ctx: EmailCtx, id: string): Promise<void> {
  const row = await requireAccount(tx, id);
  await tx.delete(emailAccounts).where(eq(emailAccounts.id, id)); // queued mail keeps its text; account_id becomes null (= default sender)
  await audit(tx, ctx.actor, { action: 'email_account.delete', entity: 'email_account', entityId: id, summary: `Deleted email account “${row.name}”`, before: auditView(toAccountOut(row, ctx.tenant)) });
}

/** Exactly one default outgoing account: the old default is cleared and the new one set in ONE transaction (and a partial unique index backs it up). */
export async function setDefaultAccount(tx: Executor, ctx: EmailCtx, id: string): Promise<EmailAccountOut> {
  const row = await requireAccount(tx, id);
  if (!row.enabled) throw conflict('Switch the account on before making it the default', 'ACCOUNT_DISABLED');
  if (!row.isDefaultOutgoing) {
    await tx.update(emailAccounts).set({ isDefaultOutgoing: false }).where(eq(emailAccounts.isDefaultOutgoing, true));
    await tx.update(emailAccounts).set({ isDefaultOutgoing: true, updatedBy: ctx.principal.userId }).where(eq(emailAccounts.id, id));
    await audit(tx, ctx.actor, { action: 'email_account.set_default', entity: 'email_account', entityId: id, summary: `“${row.name}” is now the default outgoing email account` });
  }
  return toAccountOut(await requireAccount(tx, id), ctx.tenant);
}

/** Stop using any school account by default: outgoing mail goes through the SchoolSync default sender again. */
export async function usePlatformDefault(tx: Executor, ctx: EmailCtx): Promise<void> {
  const cleared = await tx.update(emailAccounts).set({ isDefaultOutgoing: false, updatedBy: ctx.principal.userId }).where(eq(emailAccounts.isDefaultOutgoing, true)).returning({ name: emailAccounts.name });
  if (cleared.length) await audit(tx, ctx.actor, { action: 'email_account.use_platform_default', entity: 'email_account', summary: 'Switched to the SchoolSync default sender' });
}

// ── test send ───────────────────────────────────────────────────────────────────────────────────────
async function ownEmail(db: Executor, userId: string): Promise<string | null> {
  const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
  return u?.email && isEmailAddress(u.email) ? u.email : null;
}

/**
 * Send a test message right now (not via the queue) to the signed-in admin or, for school accounts, to a typed address, and
 * remember the outcome on the account. Errors are plain-language and sanitised.
 */
/** Test emails per school per hour (counted from the audit log, so it holds across API instances) and the one-at-a-time gate. */
export const TEST_EMAILS_PER_HOUR = 5;
const testing = new Set<string>();

export async function testAccount(db: Executor, ctx: EmailCtx, id: string | null, to?: string): Promise<EmailTestOut> {
  const account = id ? await requireAccount(db, id) : null;
  let recipient = to ?? null;
  if (!recipient || !account) recipient = await ownEmail(db, ctx.principal.userId); // the platform sender only ever writes to the admin's own address
  if (!recipient) throw unprocessable('Your own login has no email address. Type the address to send the test to.', 'NO_TEST_RECIPIENT');

  if (testing.has(ctx.tenant.id)) throw tooMany('A test email is already being sent. Wait for it to finish.');
  testing.add(ctx.tenant.id);
  try {
    const [used] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'email_account.test'), sql`${auditLogs.at} > now() - interval '1 hour'`));
    if ((used?.n ?? 0) >= TEST_EMAILS_PER_HOUR) throw tooMany(`You can send ${TEST_EMAILS_PER_HOUR} test emails per hour. Try again a little later.`);

    const result = await sendTestMessage(ctx.tenant, account, recipient);
    const at = new Date();
    if (account) {
      await db
        .update(emailAccounts)
        .set({ lastTestAt: at, lastTestOk: result.ok, lastTestError: result.error, updatedAt: sql`${emailAccounts.updatedAt}` })
        .where(eq(emailAccounts.id, account.id));
    }
    await audit(db, ctx.actor, {
      action: 'email_account.test',
      entity: 'email_account',
      entityId: account?.id ?? 'platform',
      summary: `Sent a test email through ${account ? `“${account.name}”` : 'the SchoolSync default sender'}: ${result.ok ? 'accepted by the mail server' : 'failed'}`,
      after: { ok: result.ok, to: recipient, error: result.error },
    });
    return { ok: result.ok, error: result.error, sentTo: recipient, testedAt: at.toISOString() };
  } finally {
    testing.delete(ctx.tenant.id);
  }
}
