import { NextResponse, type NextRequest } from 'next/server';
import { clearedOperatorCookies, operatorCookieName, operatorCookies, operatorRefreshGuardCookie } from '@/lib/platform/cookies';
import { safePlatformNext } from '@/lib/platform/host';
import { refreshOperator } from '@/lib/platform/refresh';
import { env } from '@/lib/env';
import { applyCookies } from '@/lib/server/cookie-io';
import { requestOrigin } from '@/lib/server/csrf';

/**
 * Server components cannot set cookies, so when one meets a 401 it redirects here: we rotate the tokens (single-flight; handles
 * the API's 409 REFRESH_RACE) and send the operator back where they were.
 */
export async function GET(req: NextRequest) {
  const origin = requestOrigin(req.headers, env.secureCookies ? 'https' : 'http');
  const abs = (path: string) => new URL(path, origin);
  const next = safePlatformNext(req.nextUrl.searchParams.get('next')) ?? '/platform/schools';
  const attempt = Number(req.nextUrl.searchParams.get('n') ?? '0');
  const toSignIn = (reason: string) => {
    const dest = abs('/platform/sign-in');
    dest.searchParams.set('reason', reason);
    if (next !== '/platform/schools') dest.searchParams.set('next', next);
    return applyCookies(NextResponse.redirect(dest), clearedOperatorCookies());
  };
  const rt = req.cookies.get(operatorCookieName('rt'))?.value;
  // we refreshed moments ago and still got a 401: the session is genuinely over; do not loop
  if (!rt || req.cookies.get(operatorCookieName('rf'))) return toSignIn('expired');

  const r = await refreshOperator(rt, req.headers.get('user-agent') ?? undefined, req.headers.get('x-forwarded-for') ?? undefined);
  if (r.ok) return applyCookies(NextResponse.redirect(abs(next)), [...operatorCookies(r.tokens), operatorRefreshGuardCookie()]);
  if (r.reason === 'race' && attempt < 4) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const again = abs('/api/platform/auth/refresh');
    again.searchParams.set('next', next);
    again.searchParams.set('n', String(attempt + 1));
    return NextResponse.redirect(again);
  }
  if (r.reason === 'unreachable') return new NextResponse('The server is unreachable. Try again in a moment.', { status: 503 });
  return toSignIn('expired');
}
