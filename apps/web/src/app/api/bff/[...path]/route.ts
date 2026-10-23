import { NextResponse, type NextRequest } from 'next/server';
import { clearedSessionCookies, cookieName, sessionCookies, type CookieSpec } from '@/lib/cookies';
import { applyCookies } from '@/lib/server/cookie-io';
import { isSameOrigin } from '@/lib/server/csrf';
import { refreshTokens } from '@/lib/server/refresh';
import { getSiteState } from '@/lib/server/site';
import { upstream } from '@/lib/server/upstream';

/**
 * Backend-for-frontend proxy: `/api/bff/<path>` → API `/api/v1/<path>`.
 * The browser only ever holds HttpOnly cookies; this handler attaches the bearer token, refreshes it on a 401
 * (once, single-flight) and passes the fresh cookies back on the same response.
 */

const DEDICATED = new Set(['/auth/login', '/auth/refresh', '/auth/logout']);
const PASS_HEADERS = ['content-type', 'content-disposition', 'content-language', 'etag', 'last-modified', 'retry-after', 'x-request-id'];

const problem = (status: number, code: string, title: string, detail?: string) =>
  NextResponse.json({ type: 'about:blank', title, status, code, detail }, { status, headers: { 'content-type': 'application/problem+json', 'cache-control': 'no-store' } });

async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }): Promise<NextResponse> {
  const { path } = await ctx.params;
  const apiPath = `/${path.join('/')}`;
  if (DEDICATED.has(apiPath)) return problem(404, 'ROUTE_NOT_FOUND', 'Not found');
  if (!isSameOrigin(req.method, req.headers)) return problem(403, 'CSRF_REJECTED', 'Forbidden', 'Cross-site request rejected');

  const site = await getSiteState();
  if (site.status === 'suspended') return problem(403, 'SITE_SUSPENDED', 'This school site is suspended');
  if (site.status === 'unreachable') return problem(503, 'API_UNREACHABLE', 'The school server is unreachable');
  if (site.status !== 'ok') return problem(404, 'SITE_NOT_FOUND', 'School not found');
  const code = site.code;

  const mine = req.cookies.get(cookieName('ts'))?.value === code;
  let at = mine ? req.cookies.get(cookieName('at'))?.value : undefined;
  const rt = mine ? req.cookies.get(cookieName('rt'))?.value : undefined;
  let fresh: CookieSpec[] | null = null;
  let dead = false;

  const ua = req.headers.get('user-agent') ?? undefined;
  const rotate = async (): Promise<boolean> => {
    if (!rt) return false;
    const r = await refreshTokens(code, rt, ua);
    if (r.ok) {
      at = r.tokens.accessToken;
      fresh = sessionCookies(code, r.tokens);
      return true;
    }
    if (r.reason === 'expired') dead = true;
    return false;
  };

  const hasBody = !['GET', 'HEAD'].includes(req.method);
  const body = hasBody ? await req.arrayBuffer() : null;
  const ctype = req.headers.get('content-type');
  // retries of a payment must replay, not repeat: forward the caller's Idempotency-Key untouched
  const idem = req.headers.get('idempotency-key');
  const send = () =>
    upstream({
      site: code,
      path: apiPath,
      method: req.method,
      query: req.nextUrl.search,
      token: at ?? null,
      headers: { ...(ctype ? { 'content-type': ctype } : {}), ...(ua ? { 'user-agent': ua } : {}), ...(idem ? { 'idempotency-key': idem } : {}) },
      body: body && body.byteLength > 0 ? body : null,
    });

  try {
    if (!at) await rotate();
    let res = await send();
    if (res.status === 401 && rt && !fresh) {
      // the access token may be expired or stale (permissions changed): rotate once and retry
      if (await rotate()) res = await send();
    }
    // changing the password bumps the token generation → mint a fresh access token for this device
    if (apiPath === '/auth/change-password' && res.ok && rt) {
      const r = await refreshTokens(code, (fresh as CookieSpec[] | null)?.find((c) => c.name === cookieName('rt'))?.value ?? rt, ua);
      if (r.ok) fresh = sessionCookies(code, r.tokens);
    }

    const headers = new Headers();
    for (const h of PASS_HEADERS) {
      const v = res.headers.get(h);
      if (v) headers.set(h, v);
    }
    headers.set('cache-control', res.headers.get('cache-control') && res.ok && req.method === 'GET' && apiPath.startsWith('/files/') ? res.headers.get('cache-control')! : 'no-store');
    const out = new NextResponse(res.status === 204 || res.status === 304 ? null : res.body, { status: res.status, headers });
    if (fresh) applyCookies(out, fresh);
    if (dead && res.status === 401) applyCookies(out, clearedSessionCookies());
    return out;
  } catch (e) {
    const code2 = e instanceof Error && 'code' in e ? String((e as { code: string }).code) : 'API_UNREACHABLE';
    return problem(503, code2, 'The school server is unreachable');
  }
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
