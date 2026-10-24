import { and, asc, eq } from 'drizzle-orm';
import type { EmailAccountOut } from '@school-sync/shared';
import { emailAccounts } from '../../db/tenant/schema';
import { todayIn } from '../http';
import type { Executor } from '../tenancy/pools';
import type { TenantInfo } from '../tenancy/registry';
import type { EmailAccountRow } from './transport';

/** The enabled default outgoing account, or null (= the platform default sender is in use). */
export async function getDefaultAccount(db: Executor): Promise<EmailAccountRow | null> {
  const [row] = await db
    .select()
    .from(emailAccounts)
    .where(and(eq(emailAccounts.isDefaultOutgoing, true), eq(emailAccounts.enabled, true)))
    .orderBy(asc(emailAccounts.createdAt))
    .limit(1);
  return row ?? null;
}

export async function getEnabledAccount(db: Executor, id: string): Promise<EmailAccountRow | null> {
  const [row] = await db
    .select()
    .from(emailAccounts)
    .where(and(eq(emailAccounts.id, id), eq(emailAccounts.enabled, true)))
    .limit(1);
  return row ?? null;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** API shape of an account. The sealed password is NEVER part of it; only `passwordSet`. */
export function toAccountOut(row: EmailAccountRow, tenant: Pick<TenantInfo, 'timezone'>): EmailAccountOut {
  return {
    id: row.id,
    name: row.name,
    emailAddress: row.emailAddress,
    senderName: row.senderName,
    provider: row.provider,
    smtpHost: row.smtpHost,
    smtpPort: row.smtpPort,
    smtpSecurity: row.smtpSecurity,
    smtpUsername: row.smtpUsername,
    passwordSet: !!row.smtpPasswordEnc,
    replyTo: row.replyTo,
    isDefaultOutgoing: row.isDefaultOutgoing,
    enabled: row.enabled,
    alwaysUseAccountAddress: row.alwaysUseAccountAddress,
    dailyLimit: row.dailyLimit,
    sentToday: row.sentCountDay === todayIn(tenant.timezone) ? row.sentCount : 0,
    lastTestAt: iso(row.lastTestAt),
    lastTestOk: row.lastTestOk,
    lastTestError: row.lastTestError,
    lastSendAt: iso(row.lastSendAt),
    lastSendError: row.lastSendError,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** What may go into the audit log: everything but the secret (the audit helper redacts password-ish keys as well). */
export function auditView(out: EmailAccountOut) {
  const { passwordSet, sentToday: _sentToday, lastTestAt: _a, lastTestOk: _b, lastTestError: _c, lastSendAt: _d, lastSendError: _e, createdAt: _f, updatedAt: _g, ...rest } = out;
  return { ...rest, credentialsSaved: passwordSet };
}
