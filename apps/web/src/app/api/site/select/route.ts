import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { siteCookie } from '@/lib/cookies';
import { env, SITE_CODE_RE } from '@/lib/env';
import { applyCookies } from '@/lib/server/cookie-io';
import { isSameOrigin } from '@/lib/server/csrf';
import { classifyHost, lookupDomain } from '@/lib/server/site';
import { errorFrom, readBody, upstream } from '@/lib/server/upstream';
import type { SiteInfo } from '@school-sync/shared';

const body = z.object({ input: z.string().trim().min(2).max(200), commit: z.boolean().optional() });

const problem = (status: number, code: string, title: string, detail?: string) =>
  NextResponse.json({ type: 'about:blank', title, status, code, detail }, { status, headers: { 'content-type': 'application/problem+json', 'cache-control': 'no-store' } });

/** Accepts a site code ("greenvalley"), a school URL, or a custom domain. */
function parseInput(raw: string): { code: string } | { domain: string } | null {
  const v = raw.trim().toLowerCase();
  if (SITE_CODE_RE.test(v)) return { code: v };
  let host: string;
  try {
    host = new URL(/^[a-z]+:\/\//.test(v) ? v : `https://${v}`).hostname;
  } catch {
    return null;
  }
  const kind = classifyHost(host);
  if (kind.kind === 'site') return { code: kind.code };
  if (kind.kind === 'custom' && host.includes('.')) return { domain: kind.domain };
  return null;
}

/** Verify a school and tell the client where to go. `commit` also remembers it (cookie mode). */
export async function POST(req: NextRequest) {
  if (!isSameOrigin('POST', req.headers)) return problem(403, 'CSRF_REJECTED', 'Forbidden');
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return problem(422, 'VALIDATION_ERROR', 'Enter your school code or web address');
  const target = parseInput(parsed.data.input);
  if (!target) return problem(404, 'SITE_NOT_FOUND', 'We could not find that school', 'Check the code or address your school gave you.');

  let code: string | null = 'code' in target ? target.code : await lookupDomain(target.domain);
  if (!code) return problem(404, 'SITE_NOT_FOUND', 'We could not find that school', 'Check the code or address your school gave you.');
  const res = await upstream({ site: code, path: '/site/info' });
  if (!res.ok) {
    const err = await errorFrom(res);
    return problem(err.status, err.code, err.status === 404 ? 'We could not find that school' : (err.message ?? 'School unavailable'), err.status === 404 ? 'Check the code or address your school gave you.' : undefined);
  }
  const site = (await readBody(res)) as SiteInfo;
  code = site.code;

  const proto = env.isProd || env.secureCookies ? 'https' : 'http';
  const mode = 'domain' in target ? 'redirect' : env.selectMode;
  const redirectTo = mode === 'redirect' ? ('domain' in target ? `${proto}://${target.domain}/` : `${proto}://${code}.${env.publicBase}/`) : '/';
  const out = NextResponse.json({ site, redirectTo, mode }, { headers: { 'cache-control': 'no-store' } });
  return parsed.data.commit && mode === 'cookie' ? applyCookies(out, [siteCookie(code)]) : out;
}
