import { and, asc, eq, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { ONLINE_PROVIDERS, type GoogleSettingsBody, type MeetingProviderOut, type MeetingSettingsOut, type MeetingTestOut, type OnlineProvider, type ZoomSettingsBody } from '@school-sync/shared';
import { audit, type AuditActor } from '../../core/audit';
import { AppError, conflict, tooMany } from '../../core/errors';
import { errorText } from '../../core/online-meetings/errors';
import { parseServiceAccount, ServiceAccountError } from '../../core/online-meetings/google';
import { clientFor, getIntegration, type IntegrationRow } from '../../core/online-meetings/integrations';
import { openCredentials, sealCredentials } from '../../core/online-meetings/secret';
import type { Principal } from '../../core/rbac/principal';
import type { Executor } from '../../core/tenancy/pools';
import type { TenantInfo } from '../../core/tenancy/registry';
import { auditLogs, events, meetingIntegrations, meetings } from '../../db/tenant/schema';

export interface MeetingCtx {
  actor: AuditActor;
  principal: Principal;
  tenant: TenantInfo;
}

/** Connection tests per school per hour (counted from the audit log, so it holds across API instances) and the one-at-a-time gate. */
export const TEST_MEETINGS_PER_HOUR = 5;
const testing = new Set<string>();

const iso = (d: Date | null) => (d ? d.toISOString() : null);

// ── read ────────────────────────────────────────────────────────────────────────────────────────

/** API shape of one provider. Nothing secret is part of it; `secretSet` only says that a secret is saved. */
function toProviderOut(provider: OnlineProvider, row: IntegrationRow | null, live: number): MeetingProviderOut {
  const s = row?.settings ?? {};
  const connected = !!row?.credentialsEnc;
  return {
    provider,
    connected,
    enabled: connected && !!row?.enabled,
    state: !connected ? 'not_connected' : row?.lastTestOk === false ? 'error' : 'connected',
    isDefault: connected && !!row?.isDefault,
    accountId: provider === 'zoom' ? (s.accountId ?? null) : null,
    clientId: provider === 'zoom' ? (s.clientId ?? null) : null,
    hostEmail: provider === 'zoom' ? (s.hostEmail ?? null) : null,
    secretSet: connected,
    organizerEmail: provider === 'google' ? (s.organizerEmail ?? null) : null,
    serviceAccountEmail: provider === 'google' ? (s.serviceAccountEmail ?? null) : null,
    serviceAccountClientId: provider === 'google' ? (s.serviceAccountClientId ?? null) : null,
    lastTestAt: iso(row?.lastTestAt ?? null),
    lastTestOk: row?.lastTestOk ?? null,
    lastTestError: row?.lastTestError ?? null,
    liveMeetings: live,
    updatedAt: iso(row?.updatedAt ?? null),
  };
}

/** Meetings that exist at each provider right now (they stay there if the provider is disconnected). */
async function liveCounts(db: Executor): Promise<Record<OnlineProvider, number>> {
  const out: Record<OnlineProvider, number> = { zoom: 0, google: 0 };
  const [ev, mt] = await Promise.all([
    db.select({ p: events.onlineRemoteProvider, n: sql<number>`count(*)::int` }).from(events).where(sql`${events.onlineMeetingId} is not null`).groupBy(events.onlineRemoteProvider),
    db.select({ p: meetings.onlineRemoteProvider, n: sql<number>`count(*)::int` }).from(meetings).where(sql`${meetings.onlineMeetingId} is not null`).groupBy(meetings.onlineRemoteProvider),
  ]);
  for (const r of [...ev, ...mt]) if (r.p) out[r.p] += r.n;
  return out;
}

export async function getSettings(db: Executor): Promise<MeetingSettingsOut> {
  const [rows, live] = await Promise.all([db.select().from(meetingIntegrations), liveCounts(db)]);
  const providers = ONLINE_PROVIDERS.map((p) => toProviderOut(p, rows.find((r) => r.provider === p) ?? null, live[p]));
  return { providers, defaultProvider: providers.find((p) => p.isDefault && p.enabled)?.provider ?? null };
}

/** What may go into the audit log: no credentials, no ids; only whether secrets were saved or replaced. */
const auditView = (out: MeetingProviderOut) => ({
  provider: out.provider,
  enabled: out.enabled,
  isDefault: out.isDefault,
  hostEmail: out.hostEmail,
  organizerEmail: out.organizerEmail,
  credentialsSaved: out.secretSet,
});

// ── default provider ────────────────────────────────────────────────────────────────────────────

/** At most one default, and only among usable providers (saved credentials, switched on). A school with a single usable provider uses it by default. */
async function normalizeDefault(tx: Executor): Promise<void> {
  const rows = await tx.select().from(meetingIntegrations).orderBy(asc(meetingIntegrations.createdAt));
  const usable = rows.filter((r) => r.enabled && r.credentialsEnc);
  const current = rows.find((r) => r.isDefault);
  if (current && usable.includes(current)) return;
  if (current) await tx.update(meetingIntegrations).set({ isDefault: false }).where(eq(meetingIntegrations.id, current.id));
  const next = usable[0];
  if (next) await tx.update(meetingIntegrations).set({ isDefault: true }).where(eq(meetingIntegrations.id, next.id));
}

export async function setDefault(tx: Executor, ctx: MeetingCtx, provider: OnlineProvider): Promise<MeetingSettingsOut> {
  const row = await getIntegration(tx, provider);
  if (!row?.credentialsEnc || !row.enabled) throw conflict('Connect the provider and switch it on before making it the default', 'PROVIDER_NOT_USABLE');
  if (!row.isDefault) {
    await tx.update(meetingIntegrations).set({ isDefault: false }).where(eq(meetingIntegrations.isDefault, true));
    await tx.update(meetingIntegrations).set({ isDefault: true, updatedBy: ctx.principal.userId }).where(eq(meetingIntegrations.id, row.id));
    await audit(tx, ctx.actor, { action: 'meeting_integration.set_default', entity: 'meeting_integration', entityId: row.id, summary: `${provider === 'zoom' ? 'Zoom' : 'Google Meet'} is now the default for online meetings`, after: { provider } });
  }
  return getSettings(tx);
}

// ── connect / change ────────────────────────────────────────────────────────────────────────────

async function saved<T extends object>(row: IntegrationRow | null, ctx: MeetingCtx): Promise<T | null> {
  if (!row?.credentialsEnc) return null;
  try {
    return JSON.parse(openCredentials(row.credentialsEnc, ctx.tenant.id, row.id)) as T;
  } catch {
    return null; // e.g. the encryption key was rotated: the admin has to enter the credentials again
  }
}

async function persist(tx: Executor, ctx: MeetingCtx, provider: OnlineProvider, row: IntegrationRow | null, id: string, v: { enabled: boolean; credentialsEnc: string; settings: Record<string, string>; changedConnection: boolean }): Promise<IntegrationRow> {
  if (!row) {
    const [created] = await tx.insert(meetingIntegrations).values({ id, provider, enabled: v.enabled, credentialsEnc: v.credentialsEnc, settings: v.settings, createdBy: ctx.principal.userId, updatedBy: ctx.principal.userId }).returning();
    return created!;
  }
  const [updated] = await tx
    .update(meetingIntegrations)
    .set({
      enabled: v.enabled,
      credentialsEnc: v.credentialsEnc,
      settings: v.settings,
      // a result that predates a change of credentials or host says nothing about the new setup
      ...(v.changedConnection ? { lastTestAt: null, lastTestOk: null, lastTestError: null } : {}),
      updatedBy: ctx.principal.userId,
    })
    .where(eq(meetingIntegrations.id, row.id))
    .returning();
  return updated!;
}

interface ZoomSaved {
  accountId: string;
  clientId: string;
  clientSecret: string;
}

export async function saveZoom(tx: Executor, ctx: MeetingCtx, body: ZoomSettingsBody): Promise<MeetingSettingsOut> {
  const row = await getIntegration(tx, 'zoom');
  const id = row?.id ?? uuidv7();
  const old = await saved<ZoomSaved>(row, ctx);
  const clientSecret = body.clientSecret || old?.clientSecret || '';
  if (!clientSecret) throw new AppError(422, 'CLIENT_SECRET_REQUIRED', 'Enter the Client Secret from your Zoom app.', { field: 'clientSecret' });
  const hostEmail = body.hostEmail.trim() || 'me';
  const credsChanged = !old || old.accountId !== body.accountId || old.clientId !== body.clientId || old.clientSecret !== clientSecret;
  const credentialsEnc = credsChanged || !row?.credentialsEnc ? sealCredentials(JSON.stringify({ accountId: body.accountId, clientId: body.clientId, clientSecret }), ctx.tenant.id, id) : row.credentialsEnc;
  const settings = { accountId: body.accountId, clientId: body.clientId, hostEmail };
  const out = await persist(tx, ctx, 'zoom', row, id, { enabled: body.enabled ?? row?.enabled ?? true, credentialsEnc, settings, changedConnection: credsChanged || hostEmail !== (row?.settings.hostEmail ?? '') });
  await normalizeDefault(tx);
  const after = (await getSettings(tx)).providers.find((p) => p.provider === 'zoom')!;
  await audit(tx, ctx.actor, {
    action: row ? 'meeting_integration.update' : 'meeting_integration.connect',
    entity: 'meeting_integration',
    entityId: out.id,
    summary: `${row ? 'Updated' : 'Connected'} Zoom${body.clientSecret ? ' (client secret replaced)' : ''}`,
    before: row ? auditView(toProviderOut('zoom', row, 0)) : undefined,
    after: { ...auditView(after), credentialsReplaced: credsChanged },
  });
  return getSettings(tx);
}

interface GoogleSaved {
  client_email: string;
  private_key: string;
  private_key_id?: string | null;
  client_id?: string | null;
}

export async function saveGoogle(tx: Executor, ctx: MeetingCtx, body: GoogleSettingsBody): Promise<MeetingSettingsOut> {
  const row = await getIntegration(tx, 'google');
  const id = row?.id ?? uuidv7();
  let credentialsEnc = row?.credentialsEnc ?? null;
  let settings: Record<string, string> = { ...(row?.settings ?? {}), organizerEmail: body.organizerEmail };
  let credsChanged = false;
  const pasted = body.serviceAccountJson.trim();
  if (pasted) {
    try {
      const sa = await parseServiceAccount(pasted);
      // keep only what we use: the rest of the key file (token_uri, urls) is dropped
      const keep: GoogleSaved = { client_email: sa.clientEmail, private_key: sa.privateKey, private_key_id: sa.privateKeyId, client_id: sa.clientId };
      credentialsEnc = sealCredentials(JSON.stringify(keep), ctx.tenant.id, id);
      settings = { organizerEmail: body.organizerEmail, serviceAccountEmail: sa.clientEmail, ...(sa.clientId ? { serviceAccountClientId: sa.clientId } : {}) };
      credsChanged = true;
    } catch (e) {
      if (e instanceof ServiceAccountError) throw new AppError(422, 'SERVICE_ACCOUNT_INVALID', e.message, { field: 'serviceAccountJson' });
      throw e;
    }
  } else if (!credentialsEnc) {
    throw new AppError(422, 'SERVICE_ACCOUNT_REQUIRED', 'Paste the service-account key (the JSON file from Google Cloud).', { field: 'serviceAccountJson' });
  }
  const out = await persist(tx, ctx, 'google', row, id, { enabled: body.enabled ?? row?.enabled ?? true, credentialsEnc, settings, changedConnection: credsChanged || body.organizerEmail !== (row?.settings.organizerEmail ?? '') });
  await normalizeDefault(tx);
  const after = (await getSettings(tx)).providers.find((p) => p.provider === 'google')!;
  await audit(tx, ctx.actor, {
    action: row ? 'meeting_integration.update' : 'meeting_integration.connect',
    entity: 'meeting_integration',
    entityId: out.id,
    summary: `${row ? 'Updated' : 'Connected'} Google Meet${credsChanged ? ' (service-account key replaced)' : ''}`,
    before: row ? auditView(toProviderOut('google', row, 0)) : undefined,
    after: { ...auditView(after), credentialsReplaced: credsChanged },
  });
  return getSettings(tx);
}

export async function disconnect(tx: Executor, ctx: MeetingCtx, provider: OnlineProvider): Promise<MeetingSettingsOut> {
  const row = await getIntegration(tx, provider);
  if (!row) throw new AppError(404, 'NOT_FOUND', 'That provider is not connected');
  const live = (await liveCounts(tx))[provider];
  await tx.delete(meetingIntegrations).where(eq(meetingIntegrations.id, row.id));
  await normalizeDefault(tx);
  await audit(tx, ctx.actor, {
    action: 'meeting_integration.disconnect',
    entity: 'meeting_integration',
    entityId: row.id,
    summary: `Disconnected ${provider === 'zoom' ? 'Zoom' : 'Google Meet'}`,
    before: auditView(toProviderOut(provider, row, live)),
    after: { provider, liveMeetings: live },
  });
  return getSettings(tx);
}

// ── test ────────────────────────────────────────────────────────────────────────────────────────

/** Sign in and make one harmless read. Creates nothing. The result is plain language and never contains a provider response. */
export async function testProvider(db: Executor, ctx: MeetingCtx, provider: OnlineProvider): Promise<MeetingTestOut> {
  const row = await getIntegration(db, provider);
  if (!row?.credentialsEnc) throw conflict('Save the credentials before testing the connection', 'PROVIDER_NOT_CONNECTED');
  if (testing.has(ctx.tenant.id)) throw tooMany('A connection test is already running. Wait for it to finish.');
  testing.add(ctx.tenant.id);
  try {
    const [used] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'meeting_integration.test'), sql`${auditLogs.at} > now() - interval '1 hour'`));
    if ((used?.n ?? 0) >= TEST_MEETINGS_PER_HOUR) throw tooMany(`You can test the connection ${TEST_MEETINGS_PER_HOUR} times per hour. Try again a little later.`);

    let error: string | null = null;
    let detail: string | null = null;
    try {
      detail = await clientFor(ctx.tenant, row).test();
    } catch (e) {
      error = errorText(e, provider);
    }
    const at = new Date();
    await db
      .update(meetingIntegrations)
      .set({ lastTestAt: at, lastTestOk: !error, lastTestError: error, updatedAt: sql`${meetingIntegrations.updatedAt}` })
      .where(eq(meetingIntegrations.id, row.id));
    await audit(db, ctx.actor, {
      action: 'meeting_integration.test',
      entity: 'meeting_integration',
      entityId: row.id,
      summary: `Tested the ${provider === 'zoom' ? 'Zoom' : 'Google Meet'} connection: ${error ? 'failed' : 'ok'}`,
      after: { provider, ok: !error, ...(error ? { error } : {}) },
    });
    return { ok: !error, error, detail, testedAt: at.toISOString() };
  } finally {
    testing.delete(ctx.tenant.id);
  }
}
