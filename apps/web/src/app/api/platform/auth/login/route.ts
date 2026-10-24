import { NextResponse, type NextRequest } from 'next/server';
import type { PlatformTokenResponse } from '@school-sync/shared';
import { z } from 'zod';
import { operatorCookies } from '@/lib/platform/cookies';
import { safePlatformNext } from '@/lib/platform/host';
import { platformUpstream, readJson } from '@/lib/platform/upstream';
import { applyCookies } from '@/lib/server/cookie-io';
import { isSameOrigin } from '@/lib/server/csrf';

const body = z.object({ email: z.string().trim().min(3).max(200), password: z.string().min(1).max(200), next: z.string().optional() });

const problem = (status: number, code: string, title: string, detail?: string, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ type: 'about:blank', title, status, code, detail, ...extra }, { status, headers: { 'content-type': 'application/problem+json', 'cache-control': 'no-store' } });

/** Operator sign-in: the API issues the tokens, they go straight into HttpOnly cookies; the browser never sees them. */
export async function POST(req: NextRequest) {
  if (!isSameOrigin('POST', req.headers)) return problem(403, 'CSRF_REJECTED', 'Forbidden');
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return problem(422, 'VALIDATION_ERROR', 'Validation failed', 'Enter your email and password', { errors: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });

  const ua = req.headers.get('user-agent') ?? undefined;
  const xff = req.headers.get('x-forwarded-for') ?? undefined;
  let res: Response;
  try {
    res = await platformUpstream({ path: '/auth/login', method: 'POST', headers: { 'content-type': 'application/json', ...(ua ? { 'user-agent': ua } : {}), ...(xff ? { 'x-forwarded-for': xff } : {}) }, body: JSON.stringify({ email: parsed.data.email, password: parsed.data.password }) });
  } catch {
    return problem(503, 'API_UNREACHABLE', 'The server is unreachable');
  }
  const payload = await readJson(res);
  if (!res.ok) {
    const out = NextResponse.json(payload, { status: res.status, headers: { 'content-type': 'application/problem+json', 'cache-control': 'no-store' } });
    const retry = res.headers.get('retry-after');
    if (retry) out.headers.set('retry-after', retry);
    return out;
  }
  const tokens = payload as PlatformTokenResponse;
  const next = safePlatformNext(parsed.data.next);
  const redirectTo = tokens.operator.mustChangePassword ? `/platform/change-password${next ? `?next=${encodeURIComponent(next)}` : ''}` : (next ?? '/platform/schools');
  return applyCookies(NextResponse.json({ operator: tokens.operator, redirectTo }, { headers: { 'cache-control': 'no-store' } }), operatorCookies(tokens));
}
