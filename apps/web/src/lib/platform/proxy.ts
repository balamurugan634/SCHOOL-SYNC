import { NextResponse, type NextRequest } from 'next/server';
import { applyCookies } from '../server/cookie-io';
import { requestHost, requestOrigin } from '../server/csrf';
import { env } from '../env';
import { clearedOperatorCookies, operatorCookieName, operatorCookies } from './cookies';
import { platformHostAllowed } from './host';
import { refreshOperator } from './refresh';

/**
 * The operator console branch of `proxy.ts` (`/platform/**` and `/api/platform/**`). It never looks at a school: no site
 * resolution, no school cookies. It
 *   1. answers 404 unless the request arrived on a console host (never on a school's host),
 *   2. rotates the operator tokens ahead of time when the short-lived access cookie is gone but the refresh cookie is there
 *      (and hands the fresh cookies to the page being rendered, which cannot set cookies itself),
 *   3. keeps signed-out visitors out of the console pages (the API re-checks everything).
 */
const PUBLIC_PAGES = ['/platform/sign-in'];

const notFound = (isApi: boolean) =>
  isApi
    ? NextResponse.json({ type: 'about:blank', title: 'Not found', status: 404, code: 'ROUTE_NOT_FOUND' }, { status: 404, headers: { 'content-type': 'application/problem+json' } })
    : new NextResponse('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });

export async function platformProxy(req: NextRequest): Promise<NextResponse> {
  const { pathname, search } = req.nextUrl;
  const isApi = pathname.startsWith('/api/');
  if (!platformHostAllowed(requestHost(req.headers))) return notFound(isApi);

  let at = req.cookies.get(operatorCookieName('at'))?.value;
  const rt = req.cookies.get(operatorCookieName('rt'))?.value;
  let fresh: ReturnType<typeof operatorCookies> | null = null;
  let cleared = false;

  const dedicated = pathname.startsWith('/api/platform/auth/');
  if (!at && rt && !dedicated) {
    const r = await refreshOperator(rt, req.headers.get('user-agent') ?? undefined, req.headers.get('x-forwarded-for') ?? undefined);
    if (r.ok) {
      fresh = operatorCookies(r.tokens);
      for (const c of fresh) req.cookies.set(c.name, c.value);
      at = r.tokens.accessToken;
    } else if (r.reason === 'expired') {
      cleared = true;
      for (const c of clearedOperatorCookies()) req.cookies.delete(c.name);
    }
    // 'race' / 'unreachable': leave it to the page (it routes through /api/platform/auth/refresh)
  }

  const isPage = !isApi;
  if (isPage && !PUBLIC_PAGES.includes(pathname) && !at && (cleared || !rt)) {
    const url = new URL('/platform/sign-in', requestOrigin(req.headers, env.secureCookies ? 'https' : 'http'));
    url.searchParams.set('next', pathname + search);
    if (cleared) url.searchParams.set('reason', 'expired');
    const res = NextResponse.redirect(url);
    return cleared ? applyCookies(res, clearedOperatorCookies()) : res;
  }

  const headers = new Headers(req.headers);
  headers.set('x-url-path', pathname + search);
  const res = NextResponse.next({ request: { headers } });
  if (fresh) applyCookies(res, fresh);
  if (cleared) applyCookies(res, clearedOperatorCookies());
  // the console is private: nothing here may be kept by a shared cache
  res.headers.set('cache-control', 'no-store');
  return res;
}
