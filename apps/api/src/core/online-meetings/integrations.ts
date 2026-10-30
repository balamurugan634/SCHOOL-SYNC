import { createHash } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import { ONLINE_PROVIDER_LABEL, type OnlineProvider } from '@school-sync/shared';
import { AppError } from '../errors';
import { meetingIntegrations } from '../../db/tenant/schema';
import type { Executor } from '../tenancy/pools';
import type { TenantInfo } from '../tenancy/registry';
import { ProviderError } from './errors';
import { GoogleClient, type GoogleCredentials } from './google';
import { openCredentials } from './secret';
import type { MeetingProvider } from './types';
import { ZoomClient, type ZoomCredentials } from './zoom';

export type IntegrationRow = typeof meetingIntegrations.$inferSelect;

export async function getIntegration(db: Executor, provider: OnlineProvider): Promise<IntegrationRow | null> {
  const [row] = await db.select().from(meetingIntegrations).where(eq(meetingIntegrations.provider, provider)).limit(1);
  return row ?? null;
}

/** Providers that can create new meetings right now: credentials saved and switched on. */
export async function usableProviders(db: Executor): Promise<OnlineProvider[]> {
  const rows = await db.select({ provider: meetingIntegrations.provider, creds: meetingIntegrations.credentialsEnc }).from(meetingIntegrations).where(eq(meetingIntegrations.enabled, true));
  return rows.filter((r) => !!r.creds).map((r) => r.provider);
}

/** The school's default provider, if it is still usable. */
export async function defaultProvider(db: Executor): Promise<OnlineProvider | null> {
  const [row] = await db
    .select({ provider: meetingIntegrations.provider, creds: meetingIntegrations.credentialsEnc })
    .from(meetingIntegrations)
    .where(and(eq(meetingIntegrations.isDefault, true), eq(meetingIntegrations.enabled, true)))
    .orderBy(asc(meetingIntegrations.createdAt))
    .limit(1);
  return row?.creds ? row.provider : null;
}

/** Token cache key: one school + one saved set of credentials (re-saving seals again with a new IV, which starts a fresh token). */
const cacheKey = (tenantId: string, row: IntegrationRow) => `${tenantId}:${row.provider}:${createHash('sha256').update(row.credentialsEnc ?? '').digest('hex').slice(0, 24)}`;

export function clientFor(tenant: Pick<TenantInfo, 'id'>, row: IntegrationRow): MeetingProvider {
  if (!row.credentialsEnc) throw new ProviderError('not_connected', row.provider);
  let plain: string;
  let data: Record<string, unknown>;
  try {
    plain = openCredentials(row.credentialsEnc, tenant.id, row.id);
    data = JSON.parse(plain) as Record<string, unknown>;
  } catch {
    // e.g. APP_ENCRYPTION_KEY was rotated: the school has to enter the credentials again
    throw new ProviderError('invalid_credentials', row.provider);
  }
  const key = cacheKey(tenant.id, row);
  if (row.provider === 'zoom') {
    const c: ZoomCredentials = { accountId: String(data.accountId ?? ''), clientId: String(data.clientId ?? ''), clientSecret: String(data.clientSecret ?? ''), hostEmail: row.settings.hostEmail || 'me' };
    return new ZoomClient(c, key);
  }
  const c: GoogleCredentials = { clientEmail: String(data.client_email ?? ''), privateKey: String(data.private_key ?? ''), privateKeyId: typeof data.private_key_id === 'string' ? data.private_key_id : null, organizerEmail: row.settings.organizerEmail ?? '' };
  return new GoogleClient(c, key);
}

/**
 * The client to use for one operation. New meetings need a connected, switched-on provider; managing an existing one (update,
 * cancel) also works while the provider is switched off, so cleaning up never depends on the switch.
 */
export async function providerFor(db: Executor, tenant: Pick<TenantInfo, 'id'>, provider: OnlineProvider, purpose: 'create' | 'manage'): Promise<MeetingProvider> {
  const row = await getIntegration(db, provider);
  if (!row || !row.credentialsEnc) throw new ProviderError('not_connected', provider);
  if (purpose === 'create' && !row.enabled) throw new ProviderError('disabled', provider);
  return clientFor(tenant, row);
}

/** A 422 for a form: the chosen provider is not connected (or switched off) for this school. */
export async function assertProviderUsable(db: Executor, provider: OnlineProvider, field = 'onlineMeeting'): Promise<void> {
  if (!(await usableProviders(db)).includes(provider)) {
    throw new AppError(422, 'ONLINE_PROVIDER_NOT_CONNECTED', `${ONLINE_PROVIDER_LABEL[provider]} is not connected for this school. Connect it in Settings → Online meetings, or choose another option.`, { field });
  }
}
