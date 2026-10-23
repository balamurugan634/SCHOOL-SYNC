import { NextResponse, type NextRequest } from 'next/server';
import type { TokenResponse } from '@school-sync/shared';
import { z } from 'zod';
import { homeFor } from '@/lib/experience';
import { sessionCookies } from '@/lib/cookies';
import { applyCookies } from '@/lib/server/cookie-io';
import { isSameOrigin } from '@/lib/server/csrf';
import { deviceName } from '@/lib/server/device';
import { getSiteState } from '@/lib/server/site';
import { safeNext } from '@/lib/server/session';
import { readBody, upstream } from '@/lib/server/upstream';

const body = z.object({ identifier: z.string().trim().min(2).max(120), password: z.string().min(1).max(200), next: z.string().optional() });

const problem = (status: number, code: string, title: string, detail?: string, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ type: 'about:blank', title, status, code, detail, ...extra }, { status, headers: { 'content-type': 'application/problem+json', 'cache-control': 'no-store' } });

export async function POST(req: NextRequest) {
  if (!isSameOrigin('POST', req.headers)) return problem(403, 'CSRF_REJECTED', 'Forbidden');
  const site = await getSiteState();
  if (site.status === 'suspended') return problem(403, 'SITE_SUSPENDED', 'This school site is suspended', 'Please contact the school.');
  if (site.status === 'unreachable') return problem(503, 'API_UNREACHABLE', 'The school server is unreachable');
  if (site.status !== 'ok') return problem(404, 'SITE_NOT_FOUND', 'School not found');

  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return problem(422, 'VALIDATION_ERROR', 'Validation failed', 'Enter your username and password', { errors: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });

  const ua = req.headers.get('user-agent') ?? undefined;
  const xff = req.headers.get('x-forwarded-for') ?? undefined;
  let res: Response;
  try {
    res = await upstream({
      site: site.code,
      path: '/auth/login',
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(ua ? { 'user-agent': ua } : {}), ...(xff ? { 'x-forwarded-for': xff } : {}) },
      body: JSON.stringify({ identifier: parsed.data.identifier, password: parsed.data.password, device: { platform: 'web', name: deviceName(ua) } }),
    });
  } catch {
    return problem(503, 'API_UNREACHABLE', 'The school server is unreachable');
  }
  const payload = await readBody(res);
  if (!res.ok) {
    const out = NextResponse.json(payload, { status: res.status, headers: { 'content-type': 'application/problem+json', 'cache-control': 'no-store' } });
    const retry = res.headers.get('retry-after');
    if (retry) out.headers.set('retry-after', retry);
    return out;
  }
  const tokens = payload as TokenResponse;
  const next = safeNext(parsed.data.next);
  const redirectTo = tokens.user.mustChangePassword ? `/change-password${next ? `?next=${encodeURIComponent(next)}` : ''}` : (next ?? homeFor(tokens.user.experience));
  const out = NextResponse.json({ user: tokens.user, redirectTo }, { headers: { 'cache-control': 'no-store' } });
  return applyCookies(out, sessionCookies(site.code, tokens));
}
