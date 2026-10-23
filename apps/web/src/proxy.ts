import { NextResponse, type NextRequest } from 'next/server';
import { clearedSessionCookies, cookieName, sessionCookies } from '@/lib/cookies';
import { SITE_CODE_RE } from '@/lib/env';
import { applyCookies } from '@/lib/server/cookie-io';
import { isSameOrigin, requestHost, requestOrigin } from '@/lib/server/csrf';
import { env } from '@/lib/env';
import { refreshTokens } from '@/lib/server/refresh';
import { classifyHost } from '@/lib/server/site';

/**
 * Next 16 `proxy` (formerly middleware). Runs before every page / route handler and does four jobs:
 *   1. CSRF: state-changing /api requests must be same-origin.
 *   2. Hands the requested URL to server components (`x-url-path`) for ?next= round-trips.
 *   3. Pre-emptive session refresh: the access-token cookie expires just before the JWT does; when it is gone
 *      but the refresh cookie is there we rotate tokens HERE (single-flight) and pass the fresh cookies on to
 *      the page being rendered — server components may not set cookies themselves.
 *   4. Coarse gate: signed-out visitors never reach the role areas.
 * The API re-checks everything; this is only the fast path.
 */

const PROTECTED = ['/student', '/parent', '/teacher', '/admin', '/account', '/change-password', '/dev'];
const isProtected = (p: string) => PROTECTED.some((x) => p === x || p.startsWith(`${x}/`));

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|txt|woff2?)$).*)'],
};

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const isApi = pathname.startsWith('/api/');

  if (isApi && !isSameOrigin(req.method, req.headers)) {
    return NextResponse.json({ type: 'about:blank', title: 'Forbidden', status: 403, code: 'CSRF_REJECTED', detail: 'Cross-site request rejected' }, { status: 403, headers: { 'content-type': 'application/problem+json' } });
  }

  let at = req.cookies.get(cookieName('at'))?.value;
  const rt = req.cookies.get(cookieName('rt'))?.value;
  const ts = req.cookies.get(cookieName('ts'))?.value;
  let toSet: ReturnType<typeof sessionCookies> | null = null;
  let cleared = false;

  // a session that belongs to a different school than this host's must not be used
  const hostKind = classifyHost(requestHost(req.headers));
  const foreign = hostKind.kind === 'site' && ts !== undefined && ts !== hostKind.code;

  const wantsRefresh = !at && !!rt && !!ts && SITE_CODE_RE.test(ts) && !foreign && !pathname.startsWith('/api/auth/') && !pathname.startsWith('/api/bff/');
  if (wantsRefresh) {
    const r = await refreshTokens(ts!, rt!, req.headers.get('user-agent') ?? undefined);
    if (r.ok) {
      toSet = sessionCookies(ts!, r.tokens);
      for (const c of toSet) req.cookies.set(c.name, c.value);
      at = r.tokens.accessToken;
    } else if (r.reason === 'expired') {
      cleared = true;
      for (const c of clearedSessionCookies()) req.cookies.delete(c.name);
    }
    // 'race' / 'unreachable': leave it to the page (it will route through /api/auth/refresh)
  }

  if (isProtected(pathname) && !at && (cleared || !rt || foreign)) {
    const url = new URL('/login', requestOrigin(req.headers, env.secureCookies ? 'https' : 'http'));
    url.searchParams.set('next', pathname + search);
    if (cleared) url.searchParams.set('reason', 'expired');
    const res = NextResponse.redirect(url);
    return cleared ? applyCookies(res, clearedSessionCookies()) : res;
  }

  const headers = new Headers(req.headers);
  headers.set('x-url-path', pathname + search);
  const res = NextResponse.next({ request: { headers } });
  if (toSet) applyCookies(res, toSet);
  if (cleared) applyCookies(res, clearedSessionCookies());
  return res;
}
