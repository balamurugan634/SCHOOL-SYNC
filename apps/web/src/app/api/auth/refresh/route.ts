import { NextResponse, type NextRequest } from 'next/server';
import { clearedSessionCookies, cookieName, refreshGuardCookie, sessionCookies } from '@/lib/cookies';
import { applyCookies } from '@/lib/server/cookie-io';
import { requestOrigin } from '@/lib/server/csrf';
import { env } from '@/lib/env';
import { refreshTokens } from '@/lib/server/refresh';
import { safeNext } from '@/lib/server/session';

/**
 * Server components cannot set cookies, so when one hits a 401 it redirects here: we rotate the
 * tokens (single-flight; handles the API's 409 REFRESH_RACE) and send the visitor back where they were.
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  // NextRequest.nextUrl reports the dev server's own hostname; redirect on the host the visitor actually used
  const origin = requestOrigin(req.headers, env.secureCookies ? 'https' : 'http');
  const abs = (path: string) => new URL(path, origin);
  const next = safeNext(url.searchParams.get('next')) ?? '/';
  const attempt = Number(url.searchParams.get('n') ?? '0');
  const toLogin = (reason: string) => {
    const dest = abs('/login');
    dest.searchParams.set('reason', reason);
    if (next !== '/') dest.searchParams.set('next', next);
    return applyCookies(NextResponse.redirect(dest), clearedSessionCookies());
  };

  const site = req.cookies.get(cookieName('ts'))?.value;
  const rt = req.cookies.get(cookieName('rt'))?.value;
  // we refreshed moments ago and still got a 401 → the session is genuinely dead; do not loop
  if (!site || !rt || req.cookies.get(cookieName('rf'))) return toLogin('expired');

  const r = await refreshTokens(site, rt, req.headers.get('user-agent') ?? undefined);
  if (r.ok) {
    const res = NextResponse.redirect(abs(next));
    return applyCookies(res, [...sessionCookies(site, r.tokens), refreshGuardCookie()]);
  }
  if (r.reason === 'race' && attempt < 4) {
    // another request is rotating the same token; give it a moment, then come back with the new cookies
    await new Promise((resolve) => setTimeout(resolve, 500));
    const again = abs('/api/auth/refresh');
    again.searchParams.set('next', next);
    again.searchParams.set('n', String(attempt + 1));
    return NextResponse.redirect(again);
  }
  if (r.reason === 'unreachable') return NextResponse.redirect(abs('/unavailable?reason=unreachable'));
  return toLogin('expired');
}
