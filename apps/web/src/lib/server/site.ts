import 'server-only';
import http from 'node:http';
import https from 'node:https';
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { SiteInfo } from '@school-sync/shared';
import { cookieName } from '../cookies';
import { env, SITE_CODE_RE } from '../env';
import { ApiError } from '../problem';
import { requestHost } from './csrf';
import { errorFrom, readBody, upstream } from './upstream';

export type SiteSource = 'host' | 'domain' | 'cookie' | 'env';
export type SiteState =
  | { status: 'ok'; code: string; info: SiteInfo; source: SiteSource }
  | { status: 'none' }
  | { status: 'not_found'; code: string }
  | { status: 'suspended'; code: string }
  | { status: 'unreachable'; code?: string };

const IP_RE = /^(\d{1,3}\.){3}\d{1,3}$|^\[?[0-9a-f:]+\]?$/i;

export type HostKind = { kind: 'site'; code: string } | { kind: 'base' } | { kind: 'custom'; domain: string };

/** `demo.localhost:3000` → site `demo`; `localhost:3000` → base host; `erp.myschool.edu` → custom domain. */
export function classifyHost(hostHeader: string): HostKind {
  const hostname = hostHeader.toLowerCase().replace(/:\d+$/, '');
  const base = env.baseDomain;
  if (!hostname || IP_RE.test(hostname) || hostname === base || hostname === `www.${base}`) return { kind: 'base' };
  if (hostname.endsWith(`.${base}`)) {
    const label = hostname.slice(0, -(base.length + 1));
    if (SITE_CODE_RE.test(label)) return { kind: 'site', code: label };
    return { kind: 'base' };
  }
  return { kind: 'custom', domain: hostname };
}

// ── site info (small TTL cache; the API response is public and cheap, but it is hit by every page) ──
const infoCache = new Map<string, { exp: number; v: Exclude<SiteState, { status: 'none' }> }>();
const TTL = 20_000;

async function fetchSite(code: string, source: SiteSource): Promise<Exclude<SiteState, { status: 'none' }>> {
  const hit = infoCache.get(code);
  if (hit && hit.exp > Date.now()) return hit.v.status === 'ok' ? { ...hit.v, source } : hit.v;
  let v: Exclude<SiteState, { status: 'none' }>;
  try {
    const res = await upstream({ site: code, path: '/site/info' });
    if (res.ok) {
      const info = (await readBody(res)) as SiteInfo;
      v = { status: 'ok', code: info.code, info, source };
    } else {
      const err = await errorFrom(res);
      v = err.code === 'SITE_SUSPENDED' ? { status: 'suspended', code } : err.status === 404 || err.status === 400 ? { status: 'not_found', code } : { status: 'unreachable', code };
    }
  } catch (e) {
    if (e instanceof ApiError && e.code === 'API_UNREACHABLE') return { status: 'unreachable', code }; // never cache an outage
    throw e;
  }
  infoCache.set(code, { exp: Date.now() + (v.status === 'unreachable' ? 2_000 : TTL), v });
  return v;
}

export function invalidateSiteCache(code?: string) {
  if (code) infoCache.delete(code);
  else infoCache.clear();
}

/** Custom domains are resolved by the API from the Host header, which `fetch` will not let us set. */
const domainCache = new Map<string, { exp: number; code: string | null }>();
export function lookupDomain(domain: string): Promise<string | null> {
  const hit = domainCache.get(domain);
  if (hit && hit.exp > Date.now()) return Promise.resolve(hit.code);
  return new Promise((resolve) => {
    const url = new URL(`${env.apiUrl}/api/v1/site/info`);
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(url, { method: 'GET', headers: { host: domain, accept: 'application/json' }, timeout: 4000 }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        let code: string | null = null;
        if (res.statusCode === 200) {
          try {
            code = (JSON.parse(Buffer.concat(chunks).toString('utf8')) as SiteInfo).code;
          } catch {}
        }
        domainCache.set(domain, { exp: Date.now() + 60_000, code });
        resolve(code);
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.end();
  });
}

export const getHost = cache(async (): Promise<string> => requestHost(await headers()));

/** Host → cookie (dev / single-host installs) → NEXT_PUBLIC_DEFAULT_SITE → none. */
export const getSiteState = cache(async (): Promise<SiteState> => {
  const host = await getHost();
  const kind = classifyHost(host);
  if (kind.kind === 'site') return fetchSite(kind.code, 'host');
  if (kind.kind === 'custom') {
    const code = await lookupDomain(kind.domain);
    if (code) return fetchSite(code, 'domain');
  }
  const cookie = (await cookies()).get(cookieName('site'))?.value?.toLowerCase();
  if (cookie && SITE_CODE_RE.test(cookie)) {
    const s = await fetchSite(cookie, 'cookie');
    if (s.status === 'ok' || s.status === 'suspended') return s;
    // a stale cookie falls through to the default site
  }
  if (env.defaultSite) return fetchSite(env.defaultSite, 'env');
  return { status: 'none' };
});

/** For pages that cannot work without a school: bounce to the right recovery screen. */
export async function requireSite(): Promise<SiteInfo> {
  const s = await getSiteState();
  switch (s.status) {
    case 'ok':
      return s.info;
    case 'none':
      return redirect('/find-school');
    case 'not_found':
      return redirect(`/find-school?error=not_found&code=${encodeURIComponent(s.code)}`);
    case 'suspended':
      return redirect('/unavailable?reason=suspended');
    case 'unreachable':
      return redirect('/unavailable?reason=unreachable');
  }
}

export async function requireSiteCode(): Promise<string> {
  return (await requireSite()).code;
}
