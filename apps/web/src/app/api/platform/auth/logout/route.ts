import { NextResponse, type NextRequest } from 'next/server';
import { clearedOperatorCookies, operatorCookieName } from '@/lib/platform/cookies';
import { refreshOperator } from '@/lib/platform/refresh';
import { platformUpstream } from '@/lib/platform/upstream';
import { applyCookies } from '@/lib/server/cookie-io';
import { isSameOrigin } from '@/lib/server/csrf';

/** Revokes the operator session at the API (so the refresh token is dead everywhere) and clears the cookies. */
export async function POST(req: NextRequest) {
  if (!isSameOrigin('POST', req.headers)) return NextResponse.json({ code: 'CSRF_REJECTED' }, { status: 403 });
  let at = req.cookies.get(operatorCookieName('at'))?.value;
  const rt = req.cookies.get(operatorCookieName('rt'))?.value;
  try {
    if (!at && rt) {
      const r = await refreshOperator(rt);
      if (r.ok) {
        at = r.tokens.accessToken;
      }
    }
    if (at) await platformUpstream({ path: '/auth/logout', method: 'POST', token: at, headers: { 'content-type': 'application/json' }, body: '{}' });
  } catch {
    // signing out locally must always work, even if the API is down
  }
  return applyCookies(NextResponse.json({ ok: true }, { headers: { 'cache-control': 'no-store' } }), clearedOperatorCookies());
}
