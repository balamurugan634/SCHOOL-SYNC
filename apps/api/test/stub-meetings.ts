import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { jwtVerify } from 'jose';

/**
 * Local stand-ins for Zoom and Google (Calendar + OAuth) so the integration can be exercised end to end without the real
 * services. They follow the documented request/response shapes of the calls the API makes and record every call.
 * `rules` inject failures: the first matching rule answers instead of the normal behaviour.
 */

export interface StubCall {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: IncomingMessage['headers'];
  /** parsed JSON or form body */
  body: any;
}

export interface StubRule {
  match: (c: StubCall) => boolean;
  /** how many calls it answers (default: all until removed) */
  times?: number;
  status?: number;
  /** never answer (a timeout) */
  hang?: boolean;
  /** answer normally, but only after this many ms */
  delayMs?: number;
  body?: unknown;
}

abstract class Stub {
  readonly calls: StubCall[] = [];
  rules: StubRule[] = [];
  protected server!: Server;
  url = '';
  private hanging: ServerResponse[] = [];

  protected abstract handle(c: StubCall, res: ServerResponse): void;

  async start(): Promise<this> {
    this.server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (d) => chunks.push(d));
      req.on('end', () => {
        const u = new URL(req.url ?? '/', 'http://stub');
        const raw = Buffer.concat(chunks).toString('utf8');
        let body: any = null;
        if (raw) {
          const ct = String(req.headers['content-type'] ?? '');
          try {
            body = ct.includes('json') ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw));
          } catch {
            body = raw;
          }
        }
        const call: StubCall = { method: req.method ?? 'GET', path: u.pathname, query: u.searchParams, headers: req.headers, body };
        this.calls.push(call);
        const rule = this.rules.find((r) => r.match(call));
        if (rule) {
          if (rule.times !== undefined && --rule.times <= 0) this.rules = this.rules.filter((r) => r !== rule);
          if (rule.hang) {
            this.hanging.push(res);
            return;
          }
          if (rule.delayMs) {
            setTimeout(() => this.handle(call, res), rule.delayMs);
            return;
          }
          this.send(res, rule.status ?? 500, rule.body ?? { message: 'SENTINEL-PROVIDER-BODY account acct-1 user host@school.test' });
          return;
        }
        this.handle(call, res);
      });
    });
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this;
  }

  send(res: ServerResponse, status: number, body?: unknown): void {
    if (body === undefined || status === 204) {
      res.writeHead(status).end();
      return;
    }
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  }

  /** answer matching calls with `status` (and the sentinel body) */
  fail(match: (c: StubCall) => boolean, status = 500, times?: number): void {
    this.rules.push({ match, status, times });
  }
  hang(match: (c: StubCall) => boolean, times?: number): void {
    this.rules.push({ match, hang: true, times });
  }
  /** answer matching calls normally, but late */
  delay(match: (c: StubCall) => boolean, delayMs: number, times?: number): void {
    this.rules.push({ match, delayMs, times });
  }
  heal(): void {
    this.rules = [];
  }
  callsTo(method: string, pathPart: string): StubCall[] {
    return this.calls.filter((c) => c.method === method && c.path.includes(pathPart));
  }
  async close(): Promise<void> {
    for (const r of this.hanging) r.destroy();
    this.server.closeAllConnections?.();
    await new Promise<void>((r) => this.server.close(() => r()));
  }
}

// ── Zoom ──────────────────────────────────────────────────────────────────────────────────────────

export interface ZoomMeeting {
  id: number;
  host: string;
  body: any;
}

export class StubZoom extends Stub {
  accounts: Record<string, { clientId: string; clientSecret: string }> = { 'acct-1': { clientId: 'cid-1', clientSecret: 'csec-1' } };
  hosts = new Set(['host@school.test']);
  tokens = new Set<string>();
  tokenCalls = 0;
  expiresIn = 3600;
  meetings = new Map<string, ZoomMeeting>();
  private seq = 81_000_000_000;

  protected handle(c: StubCall, res: ServerResponse): void {
    if (c.path === '/oauth/token' && c.method === 'POST') {
      const acct = this.accounts[c.query.get('account_id') ?? ''];
      const basic = String(c.headers.authorization ?? '').replace(/^Basic /, '');
      const [cid, sec] = Buffer.from(basic, 'base64').toString('utf8').split(':');
      if (c.query.get('grant_type') !== 'account_credentials' || !acct || acct.clientId !== cid || acct.clientSecret !== sec) return this.send(res, 400, { reason: 'Invalid client_id or client_secret', error: 'invalid_client' });
      const token = `ztok-${++this.tokenCalls}`;
      this.tokens.add(token);
      return this.send(res, 200, { access_token: token, token_type: 'bearer', expires_in: this.expiresIn, scope: 'meeting:write:admin' });
    }
    if (!c.path.startsWith('/v2/')) return this.send(res, 404, {});
    const token = String(c.headers.authorization ?? '').replace(/^Bearer /, '');
    if (!this.tokens.has(token)) return this.send(res, 401, { code: 124, message: 'Invalid access token.' });
    const create = /^\/v2\/users\/([^/]+)\/meetings$/.exec(c.path);
    if (create && c.method === 'POST') {
      const host = decodeURIComponent(create[1]!);
      if (host !== 'me' && !this.hosts.has(host)) return this.send(res, 404, { code: 1001, message: 'User does not exist' });
      const id = ++this.seq;
      this.meetings.set(String(id), { id, host, body: c.body });
      return this.send(res, 201, { id, host_email: host, topic: c.body?.topic, join_url: `https://zoom.example/j/${id}?pwd=abc`, start_url: `https://zoom.example/s/${id}?zak=HOSTSECRET`, password: '123456', start_time: c.body?.start_time, timezone: c.body?.timezone });
    }
    const one = /^\/v2\/meetings\/([^/]+)$/.exec(c.path);
    if (one) {
      const id = decodeURIComponent(one[1]!);
      const m = this.meetings.get(id);
      if (!m) return this.send(res, 404, { code: 3001, message: 'Meeting does not exist' });
      if (c.method === 'PATCH') {
        m.body = { ...m.body, ...c.body };
        return this.send(res, 204);
      }
      if (c.method === 'DELETE') {
        this.meetings.delete(id);
        return this.send(res, 204);
      }
    }
    const user = /^\/v2\/users\/([^/]+)$/.exec(c.path);
    if (user && c.method === 'GET') {
      const u = decodeURIComponent(user[1]!);
      if (u !== 'me' && !this.hosts.has(u)) return this.send(res, 404, { code: 1001, message: 'User does not exist' });
      return this.send(res, 200, { id: 'u1', email: u === 'me' ? 'owner@school.test' : u, status: 'active' });
    }
    this.send(res, 404, {});
  }

  get oauthBase(): string {
    return this.url;
  }
  get apiBase(): string {
    return `${this.url}/v2`;
  }
}

// ── Google ────────────────────────────────────────────────────────────────────────────────────────

export interface GoogleEvent {
  id: string;
  body: any;
  /** polls (GET) still needed before the Meet link exists; 0 = ready at once, Infinity = never */
  pollsLeft: number;
  link: string;
}

export class StubGoogle extends Stub {
  readonly clientEmail = 'meet-sa@school-project.iam.gserviceaccount.com';
  readonly clientId = '112233445566778899001';
  readonly privateKeyPem: string;
  private readonly publicKey: KeyObject;
  allowedSubjects = new Set(['office@school.test']);
  /** false: the Workspace admin has not authorised the service account (domain-wide delegation) */
  delegationAllowed = true;
  tokens = new Set<string>();
  tokenCalls = 0;
  claims: any[] = [];
  events = new Map<string, GoogleEvent>();
  /** polls a new conference stays `pending` for */
  pendingPolls = 0;
  private seq = 0;

  constructor() {
    super();
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    this.privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    this.publicKey = publicKey;
  }

  /** the key file a school admin would paste */
  keyFile(over: Record<string, unknown> = {}): string {
    return JSON.stringify({ type: 'service_account', project_id: 'school-project', private_key_id: 'kid-1', private_key: this.privateKeyPem, client_email: this.clientEmail, client_id: this.clientId, token_uri: 'https://oauth2.googleapis.com/token', ...over });
  }

  private view(e: GoogleEvent, ready: boolean) {
    return { id: e.id, summary: e.body?.summary, start: e.body?.start, end: e.body?.end, ...(ready ? { hangoutLink: e.link, conferenceData: { createRequest: { status: { statusCode: 'success' } }, entryPoints: [{ entryPointType: 'video', uri: e.link }] } } : { conferenceData: { createRequest: { requestId: e.body?.conferenceData?.createRequest?.requestId, status: { statusCode: 'pending' } } } }) };
  }

  protected handle(c: StubCall, res: ServerResponse): void {
    if (c.path === '/token' && c.method === 'POST') {
      void this.token(c, res);
      return;
    }
    if (!c.path.startsWith('/calendar/v3/')) return this.send(res, 404, {});
    const token = String(c.headers.authorization ?? '').replace(/^Bearer /, '');
    if (!this.tokens.has(token)) return this.send(res, 401, { error: { code: 401, message: 'Invalid Credentials' } });
    const base = '/calendar/v3/calendars/primary/events';
    if (c.path === base && c.method === 'POST') {
      const id = `gev${++this.seq}`;
      const e: GoogleEvent = { id, body: c.body, pollsLeft: this.pendingPolls, link: `https://meet.google.com/abc-${String(this.seq).padStart(4, '0')}-xyz` };
      this.events.set(id, e);
      return this.send(res, 200, this.view(e, e.pollsLeft === 0));
    }
    if (c.path === base && c.method === 'GET') return this.send(res, 200, { items: [] });
    const one = new RegExp(`^${base}/([^/]+)$`).exec(c.path);
    if (one) {
      const id = decodeURIComponent(one[1]!);
      const e = this.events.get(id);
      if (!e) return this.send(res, 404, { error: { code: 404, message: 'Not Found' } });
      if (c.method === 'GET') {
        if (e.pollsLeft > 0) e.pollsLeft--;
        return this.send(res, 200, this.view(e, e.pollsLeft === 0));
      }
      if (c.method === 'PATCH') {
        e.body = { ...e.body, ...c.body };
        return this.send(res, 200, this.view(e, e.pollsLeft === 0));
      }
      if (c.method === 'DELETE') {
        this.events.delete(id);
        return this.send(res, 204);
      }
    }
    this.send(res, 404, {});
  }

  private async token(c: StubCall, res: ServerResponse): Promise<void> {
    try {
      if (c.body?.grant_type !== 'urn:ietf:params:oauth:grant-type:jwt-bearer') return this.send(res, 400, { error: 'unsupported_grant_type' });
      const { payload, protectedHeader } = await jwtVerify(String(c.body.assertion), this.publicKey, { issuer: this.clientEmail, audience: `${this.url}/token`, algorithms: ['RS256'] });
      this.claims.push({ ...payload, alg: protectedHeader.alg, kid: protectedHeader.kid });
      if (payload.scope !== 'https://www.googleapis.com/auth/calendar.events') return this.send(res, 400, { error: 'invalid_scope', error_description: 'SENTINEL-PROVIDER-BODY' });
      if (!this.delegationAllowed) return this.send(res, 401, { error: 'unauthorized_client', error_description: 'Client is unauthorized to retrieve access tokens using this method SENTINEL-PROVIDER-BODY' });
      if (!this.allowedSubjects.has(String(payload.sub))) return this.send(res, 400, { error: 'invalid_grant', error_description: 'Not a valid email or user ID SENTINEL-PROVIDER-BODY' });
      const token = `gtok-${++this.tokenCalls}`;
      this.tokens.add(token);
      this.send(res, 200, { access_token: token, expires_in: 3599, token_type: 'Bearer' });
    } catch {
      this.send(res, 400, { error: 'invalid_grant', error_description: 'Invalid JWT Signature. SENTINEL-PROVIDER-BODY' });
    }
  }

  get tokenUrl(): string {
    return `${this.url}/token`;
  }
  get calendarBase(): string {
    return `${this.url}/calendar/v3`;
  }
}

export const startStubZoom = () => new StubZoom().start();
export const startStubGoogle = () => new StubGoogle().start();
