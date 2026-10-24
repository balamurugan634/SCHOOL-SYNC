import { NextResponse, type NextRequest } from 'next/server';
import { clearedOperatorCookies, operatorCookieName, operatorCookies } from '@/lib/platform/cookies';
import { refreshOperator } from '@/lib/platform/refresh';
import { platformUpstream } from '@/lib/platform/upstream';
import { applyCookies } from '@/lib/server/cookie-io';
import { isSameOrigin } from '@/lib/server/csrf';
import type { CookieSpec } from '@/lib/cookies';

/**
 * Backend-for-frontend proxy for the console: `/api/platform/bff/<path>` → API `/api/v1/platform/<path>`.
 * The browser only ever holds HttpOnly cookies; this handler attaches the operator's bearer token, refreshes it on a 401
 * (once, single-flight) and passes the fresh cookies back on the same response. State-changing calls must be same-origin.
 */
const DEDICATED = new Set(['/auth/login', '/auth/refresh', '/auth/logout']);
const PASS_HEADERS = ['content-type', 'content-disposition', 'retry-after', 'x-request-id'];

const problem = (status: number, code: string, title: string, detail?: string) =>
  NextResponse.json({ type: 'about:blank', title, status, code, detail }, { status, headers: { 'content-type': 'application/problem+json', 'cache-control': 'no-store' } });

async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }): Promise<NextResponse> {
  const { path } = await ctx.params;
  if (path.some((p) => !p || p === '.' || p === '..' || /[\\/%]/.test(p))) return problem(404, 'ROUTE_NOT_FOUND', 'Not found');
  const apiPath = `/${path.join('/')}`;
  if (DEDICATED.has(apiPath)) return problem(404, 'ROUTE_NOT_FOUND', 'Not found');
  if (!isSameOrigin(req.method, req.headers)) return problem(403, 'CSRF_REJECTED', 'Forbidden', 'Cross-site request rejected');

  let at = req.cookies.get(operatorCookieName('at'))?.value;
  const rt = req.cookies.get(operatorCookieName('rt'))?.value;
  let fresh: CookieSpec[] | null = null;
  let dead = false;
  const ua = req.headers.get('user-agent') ?? undefined;
  const xff = req.headers.get('x-forwarded-for') ?? undefined;
  const rotate = async (): Promise<boolean> => {
    if (!rt) return false;
    const r = await refreshOperator(rt, ua, xff);
    if (r.ok) {
      at = r.tokens.accessToken;
      fresh = operatorCookies(r.tokens);
      return true;
    }
    if (r.reason === 'expired') dead = true;
    return false;
  };

  const hasBody = !['GET', 'HEAD'].includes(req.method);
  const body = hasBody ? await req.arrayBuffer() : null;
  const ctype = req.headers.get('content-type');
  const send = () =>
    platformUpstream({
      path: apiPath,
      method: req.method,
      query: req.nextUrl.search,
      token: at ?? null,
      headers: { ...(ctype ? { 'content-type': ctype } : {}), ...(ua ? { 'user-agent': ua } : {}), ...(xff ? { 'x-forwarded-for': xff } : {}) },
      body: body && body.byteLength > 0 ? body : null,
    });

  try {
    if (!at) await rotate();
    let res = await send();
    if (res.status === 401 && rt && !fresh) {
      if (await rotate()) res = await send();
    }
    const headers = new Headers();
    for (const h of PASS_HEADERS) {
      const v = res.headers.get(h);
      if (v) headers.set(h, v);
    }
    headers.set('cache-control', 'no-store');
    const out = new NextResponse(res.status === 204 || res.status === 304 ? null : res.body, { status: res.status, headers });
    if (fresh) applyCookies(out, fresh);
    if (dead && res.status === 401) applyCookies(out, clearedOperatorCookies());
    return out;
  } catch {
    return problem(503, 'API_UNREACHABLE', 'The server is unreachable');
  }
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
