import { randomUUID } from 'node:crypto';
import { SignJWT, importPKCS8 } from 'jose';
import { LRUCache } from 'lru-cache';
import { config } from '../../config';
import { kindFromStatus, ProviderError } from './errors';
import { obj, providerRequest, str, type ProviderResponse } from './http';
import { onlineMeetingTuning } from './tuning';
import type { MeetingProvider, MeetingSpec, RemoteMeeting } from './types';

export const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

/** The parts of a Google service-account key file we use. */
export interface GoogleCredentials {
  clientEmail: string;
  privateKey: string;
  privateKeyId: string | null;
  /** the Workspace user the service account acts for (domain-wide delegation `sub`) */
  organizerEmail: string;
}

interface CachedToken {
  token: string;
  until: number;
}
const tokens = new LRUCache<string, CachedToken>({ max: 500 });
const inflight = new Map<string, Promise<string>>();
const MARGIN_MS = 60_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const clearGoogleTokens = (): void => tokens.clear();

export interface ParsedServiceAccount {
  clientEmail: string;
  privateKey: string;
  privateKeyId: string | null;
  clientId: string | null;
}

/** Why a pasted key file was refused (always plain language, never the file's content). */
export class ServiceAccountError extends Error {}

/** Shape check + a real attempt to read the private key, so a bad paste fails at save time and not at the first meeting. */
export async function parseServiceAccount(raw: string): Promise<ParsedServiceAccount> {
  let j: unknown;
  try {
    j = JSON.parse(raw);
  } catch {
    throw new ServiceAccountError('That is not valid JSON. Paste the whole contents of the key file you downloaded from Google Cloud.');
  }
  const o = obj(j);
  if (!o || o.type !== 'service_account') throw new ServiceAccountError('This is not a service-account key. In Google Cloud choose “Create key” → JSON on a service account.');
  const clientEmail = str(o.client_email);
  const privateKey = str(o.private_key);
  if (!clientEmail || !/^[^\s@]+@[^\s@]+$/.test(clientEmail)) throw new ServiceAccountError('The key file has no client_email. Download a fresh JSON key.');
  if (!privateKey || !privateKey.includes('PRIVATE KEY')) throw new ServiceAccountError('The key file has no private_key. Download a fresh JSON key.');
  try {
    await importPKCS8(privateKey, 'RS256');
  } catch {
    throw new ServiceAccountError('The private key in the file could not be read. Download a fresh JSON key.');
  }
  const cid = o.client_id;
  return { clientEmail, privateKey, privateKeyId: str(o.private_key_id), clientId: typeof cid === 'string' || typeof cid === 'number' ? String(cid) : null };
}

/** Google's OAuth error codes we recognise (a short fixed vocabulary; the free-text description is never read). */
const KNOWN_TOKEN_ERRORS = new Set(['invalid_grant', 'unauthorized_client', 'invalid_client', 'invalid_scope', 'access_denied', 'invalid_request']);

/**
 * Google Workspace service account with domain-wide delegation: a signed JWT (RS256) names the Workspace user to act for
 * (`sub`) and is exchanged for an access token. The only no-redirect way for a school to connect; a personal Gmail
 * account cannot use it. The key file's own `token_uri` is ignored: the token endpoint comes from the server's configuration.
 */
export class GoogleClient implements MeetingProvider {
  readonly provider = 'google' as const;

  constructor(
    private readonly creds: GoogleCredentials,
    private readonly cacheKey: string,
  ) {}

  private async fetchToken(): Promise<string> {
    let assertion: string;
    try {
      const key = await importPKCS8(this.creds.privateKey, 'RS256');
      assertion = await new SignJWT({ scope: GOOGLE_SCOPE })
        .setProtectedHeader({ alg: 'RS256', typ: 'JWT', ...(this.creds.privateKeyId ? { kid: this.creds.privateKeyId } : {}) })
        .setIssuer(this.creds.clientEmail)
        .setSubject(this.creds.organizerEmail)
        .setAudience(config.GOOGLE_TOKEN_URL)
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(key);
    } catch {
      throw new ProviderError('invalid_credentials', 'google');
    }
    const res = await providerRequest('google', 'POST', config.GOOGLE_TOKEN_URL, { form: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }) });
    if (res.status >= 500) throw new ProviderError('unavailable', 'google');
    if (res.status === 429) throw new ProviderError('rate_limited', 'google');
    if (res.status >= 400) {
      const code = str(res.json?.error);
      if (code === 'unauthorized_client' || code === 'access_denied') throw new ProviderError('not_permitted', 'google');
      throw new ProviderError(code && KNOWN_TOKEN_ERRORS.has(code) ? 'invalid_credentials' : 'auth', 'google');
    }
    const token = str(res.json?.access_token);
    if (!token) throw new ProviderError('unavailable', 'google');
    const ttl = typeof res.json?.expires_in === 'number' && res.json.expires_in > 0 ? res.json.expires_in * 1000 : 3_300_000;
    tokens.set(this.cacheKey, { token, until: Date.now() + Math.max(0, ttl - MARGIN_MS) });
    return token;
  }

  private async token(force = false): Promise<string> {
    if (!force) {
      const hit = tokens.get(this.cacheKey);
      if (hit && hit.until > Date.now()) return hit.token;
    }
    let p = inflight.get(this.cacheKey);
    if (!p) {
      p = this.fetchToken().finally(() => inflight.delete(this.cacheKey));
      inflight.set(this.cacheKey, p);
    }
    return p;
  }

  private async api(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, json?: unknown): Promise<ProviderResponse> {
    const url = `${config.GOOGLE_CALENDAR_BASE.replace(/\/+$/, '')}${path}`;
    for (let attempt = 0; ; attempt++) {
      const token = await this.token(attempt > 0);
      const res = await providerRequest('google', method, url, { headers: { authorization: `Bearer ${token}` }, json });
      if (res.status === 401 && attempt === 0) continue;
      return res;
    }
  }

  private times(spec: MeetingSpec) {
    return { start: { dateTime: spec.startLocal, timeZone: spec.timeZone }, end: { dateTime: spec.endLocal, timeZone: spec.timeZone } };
  }

  /** The Meet link of an event resource, once the conference is ready. */
  private linkOf(ev: Record<string, unknown> | null): string | null {
    const direct = str(ev?.hangoutLink);
    if (direct) return direct;
    const entry = (Array.isArray(obj(ev?.conferenceData)?.entryPoints) ? (obj(ev?.conferenceData)?.entryPoints as unknown[]) : []).map(obj).find((e) => e?.entryPointType === 'video');
    return str(entry?.uri);
  }

  private failedConference(ev: Record<string, unknown> | null): boolean {
    const status = obj(obj(obj(ev?.conferenceData)?.createRequest)?.status);
    return status?.statusCode === 'failure';
  }

  /** The conference is created asynchronously: look at the event a few times, about a second apart, until the link is there. */
  private async waitForLink(id: string, first: Record<string, unknown> | null): Promise<string | null> {
    let ev = first;
    for (let i = 0; ; i++) {
      const link = this.linkOf(ev);
      if (link) return link;
      if (this.failedConference(ev) || i >= onlineMeetingTuning.pollTries) return null;
      await sleep(onlineMeetingTuning.pollDelayMs);
      const res = await this.api('GET', `/calendars/primary/events/${encodeURIComponent(id)}?conferenceDataVersion=1`);
      if (res.status < 200 || res.status >= 300) throw new ProviderError(kindFromStatus(res.status), 'google');
      ev = res.json;
    }
  }

  async create(spec: MeetingSpec): Promise<RemoteMeeting> {
    const res = await this.api('POST', '/calendars/primary/events?conferenceDataVersion=1&sendUpdates=none', {
      summary: spec.topic.slice(0, 1000),
      description: spec.agenda.slice(0, 8000),
      ...this.times(spec),
      conferenceData: { createRequest: { requestId: randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } } },
    });
    if (res.status < 200 || res.status >= 300) throw new ProviderError(kindFromStatus(res.status), 'google');
    const id = str(res.json?.id);
    if (!id) throw new ProviderError('unavailable', 'google');
    // Whatever happens while waiting for the link, the event now exists: hand its id back (link null) so a retry finishes THIS
    // event instead of creating a second one.
    const joinUrl = await this.waitForLink(id, res.json).catch(() => null);
    return { id, joinUrl, startUrl: null, passcode: null };
  }

  async update(id: string, spec: MeetingSpec, opts: { needLink?: boolean } = {}): Promise<{ joinUrl: string | null }> {
    const res = await this.api('PATCH', `/calendars/primary/events/${encodeURIComponent(id)}?conferenceDataVersion=1&sendUpdates=none`, {
      summary: spec.topic.slice(0, 1000),
      description: spec.agenda.slice(0, 8000),
      ...this.times(spec),
    });
    if (res.status < 200 || res.status >= 300) throw new ProviderError(kindFromStatus(res.status), 'google');
    const link = this.linkOf(res.json);
    if (link || !opts.needLink) return { joinUrl: link };
    return { joinUrl: await this.waitForLink(id, res.json) };
  }

  async cancel(id: string): Promise<void> {
    const res = await this.api('DELETE', `/calendars/primary/events/${encodeURIComponent(id)}?sendUpdates=none`);
    if ((res.status >= 200 && res.status < 300) || res.status === 404 || res.status === 410) return;
    throw new ProviderError(kindFromStatus(res.status), 'google');
  }

  async test(): Promise<string> {
    const res = await this.api('GET', '/calendars/primary/events?maxResults=1');
    if (res.status < 200 || res.status >= 300) throw new ProviderError(kindFromStatus(res.status), 'google');
    return 'Signed in to Google Calendar as the organizer. Nothing was created.';
  }
}
