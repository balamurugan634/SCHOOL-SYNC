import { NextResponse, type NextRequest } from 'next/server';
import { clearedSessionCookies, cookieName } from '@/lib/cookies';
import { applyCookies } from '@/lib/server/cookie-io';
import { isSameOrigin } from '@/lib/server/csrf';
import { refreshTokens } from '@/lib/server/refresh';
import { upstream } from '@/lib/server/upstream';

/** Revokes the session at the API (so the refresh token is dead everywhere) and clears the cookies. */
export async function POST(req: NextRequest) {
  if (!isSameOrigin('POST', req.headers)) return NextResponse.json({ code: 'CSRF_REJECTED' }, { status: 403 });
  const site = req.cookies.get(cookieName('ts'))?.value;
  let at = req.cookies.get(cookieName('at'))?.value;
  const rt = req.cookies.get(cookieName('rt'))?.value;
  try {
    if (site && !at && rt) {
      const r = await refreshTokens(site, rt);
      if (r.ok) at = r.tokens.accessToken;
    }
    if (site && at) await upstream({ site, path: '/auth/logout', method: 'POST', token: at, headers: { 'content-type': 'application/json' }, body: '{}' });
  } catch {
    // signing out locally must always work, even if the API is down
  }
  return applyCookies(NextResponse.json({ ok: true }, { headers: { 'cache-control': 'no-store' } }), clearedSessionCookies());
}
