import { LRUCache } from 'lru-cache';
import { config } from '../../config';
import { kindFromStatus, ProviderError } from './errors';
import { providerRequest, str, type ProviderResponse } from './http';
import type { MeetingProvider, MeetingSpec, RemoteMeeting } from './types';

export interface ZoomCredentials {
  accountId: string;
  clientId: string;
  clientSecret: string;
  /** the host's email, or `me` */
  hostEmail: string;
}

interface CachedToken {
  token: string;
  /** epoch ms; already reduced by the safety margin */
  until: number;
}
const tokens = new LRUCache<string, CachedToken>({ max: 500 });
const inflight = new Map<string, Promise<string>>();
const MARGIN_MS = 60_000;

/** Test hook: forget every cached token. */
export const clearZoomTokens = (): void => tokens.clear();

/**
 * Zoom Server-to-Server OAuth (a "Server-to-Server OAuth" app in the school's own Zoom Marketplace account). The access token
 * lasts an hour and is cached until a minute before it expires; a 401 from the API drops it and retries once.
 */
export class ZoomClient implements MeetingProvider {
  readonly provider = 'zoom' as const;

  /** `cacheKey` ties the cached token to one school + one saved set of credentials, so changed credentials never reuse an old token. */
  constructor(
    private readonly creds: ZoomCredentials,
    private readonly cacheKey: string,
  ) {}

  private async fetchToken(): Promise<string> {
    const url = new URL('/oauth/token', config.ZOOM_OAUTH_BASE);
    url.searchParams.set('grant_type', 'account_credentials');
    url.searchParams.set('account_id', this.creds.accountId);
    const basic = Buffer.from(`${this.creds.clientId}:${this.creds.clientSecret}`, 'utf8').toString('base64');
    const res = await providerRequest('zoom', 'POST', url.toString(), { headers: { authorization: `Basic ${basic}` } });
    if (res.status >= 500) throw new ProviderError('unavailable', 'zoom');
    if (res.status === 429) throw new ProviderError('rate_limited', 'zoom');
    if (res.status >= 400) throw new ProviderError('invalid_credentials', 'zoom');
    const token = str(res.json?.access_token);
    if (!token) throw new ProviderError('unavailable', 'zoom');
    const ttl = typeof res.json?.expires_in === 'number' && res.json.expires_in > 0 ? res.json.expires_in * 1000 : 3_600_000;
    tokens.set(this.cacheKey, { token, until: Date.now() + Math.max(0, ttl - MARGIN_MS) });
    return token;
  }

  private async token(force = false): Promise<string> {
    if (!force) {
      const hit = tokens.get(this.cacheKey);
      if (hit && hit.until > Date.now()) return hit.token;
    }
    // one token request at a time per school + credentials, however many meetings are being handled at once
    let p = inflight.get(this.cacheKey);
    if (!p) {
      p = this.fetchToken().finally(() => inflight.delete(this.cacheKey));
      inflight.set(this.cacheKey, p);
    }
    return p;
  }

  private async api(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, json?: unknown): Promise<ProviderResponse> {
    const url = `${config.ZOOM_API_BASE.replace(/\/+$/, '')}${path}`;
    for (let attempt = 0; ; attempt++) {
      const token = await this.token(attempt > 0);
      const res = await providerRequest('zoom', method, url, { headers: { authorization: `Bearer ${token}` }, json });
      if (res.status === 401 && attempt === 0) continue; // expired or revoked token: get a fresh one once
      return res;
    }
  }

  private host(): string {
    const h = this.creds.hostEmail.trim();
    return encodeURIComponent(h && h.toLowerCase() !== 'me' ? h : 'me');
  }

  private body(spec: MeetingSpec) {
    return {
      topic: spec.topic.slice(0, 200),
      type: 2,
      start_time: spec.startLocal,
      timezone: spec.timeZone,
      duration: spec.durationMin,
      agenda: spec.agenda.slice(0, 2000),
    };
  }

  async create(spec: MeetingSpec): Promise<RemoteMeeting> {
    const res = await this.api('POST', `/users/${this.host()}/meetings`, {
      ...this.body(spec),
      settings: { join_before_host: false, waiting_room: true, host_video: true, participant_video: true, mute_upon_entry: true, approval_type: 2, audio: 'both', auto_recording: 'none' },
    });
    if (res.status < 200 || res.status >= 300) throw new ProviderError(kindFromStatus(res.status), 'zoom');
    const id = res.json?.id;
    const joinUrl = str(res.json?.join_url);
    if ((typeof id !== 'number' && typeof id !== 'string') || !joinUrl) throw new ProviderError('unavailable', 'zoom');
    return { id: String(id), joinUrl, startUrl: str(res.json?.start_url), passcode: str(res.json?.password) };
  }

  async update(id: string, spec: MeetingSpec): Promise<{ joinUrl: string | null }> {
    const res = await this.api('PATCH', `/meetings/${encodeURIComponent(id)}`, this.body(spec));
    if (res.status < 200 || res.status >= 300) throw new ProviderError(kindFromStatus(res.status), 'zoom');
    return { joinUrl: null }; // Zoom answers 204; the join link never changes
  }

  async cancel(id: string): Promise<void> {
    const res = await this.api('DELETE', `/meetings/${encodeURIComponent(id)}`);
    if ((res.status >= 200 && res.status < 300) || res.status === 404 || res.status === 410) return;
    throw new ProviderError(kindFromStatus(res.status), 'zoom');
  }

  async test(): Promise<string> {
    const res = await this.api('GET', `/users/${this.host()}`);
    if (res.status < 200 || res.status >= 300) throw new ProviderError(kindFromStatus(res.status), 'zoom');
    const state = res.json?.status;
    if (state === 'inactive' || state === 'pending') throw new ProviderError('not_found', 'zoom'); // the host exists but cannot host
    return 'Signed in to Zoom and found the host user. Nothing was created.';
  }
}
