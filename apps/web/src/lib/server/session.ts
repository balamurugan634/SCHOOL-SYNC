import 'server-only';
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Me } from '@school-sync/shared';
import { cookieName } from '../cookies';
import { ApiError } from '../problem';
import { requireSiteCode } from './site';
import { errorFrom, readBody, upstream } from './upstream';

export interface Session {
  site: string;
  /** access token, only when it belongs to this school */
  token: string | null;
  hasRefresh: boolean;
  justRefreshed: boolean;
}

export const getSession = cache(async (): Promise<Session> => {
  const site = await requireSiteCode();
  const jar = await cookies();
  const ts = jar.get(cookieName('ts'))?.value;
  const mine = ts === site;
  return {
    site,
    token: mine ? (jar.get(cookieName('at'))?.value ?? null) : null,
    hasRefresh: mine && !!jar.get(cookieName('rt'))?.value,
    justRefreshed: !!jar.get(cookieName('rf'))?.value,
  };
});

/** The URL the visitor asked for (set by proxy.ts), for `?next=` round-trips. */
export async function currentUrl(): Promise<string> {
  const h = await headers();
  return h.get('x-url-path') ?? '/';
}

export const safeNext = (v: string | null | undefined): string | null => (v && v.startsWith('/') && !v.startsWith('//') && !v.startsWith('/api/') ? v : null);

interface ApiOpts {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  /** what to do on 401: bounce through the refresh route (default) or just throw */
  onUnauthorized?: 'refresh' | 'throw';
}

/**
 * Authenticated API call from a server component / route handler. Tokens never leave the server.
 * A 401 sends the visitor through `/api/auth/refresh` (a route handler, which — unlike a server
 * component — is allowed to set cookies) and back to the page they asked for.
 */
export async function api<T>(path: string, opts: ApiOpts = {}): Promise<T> {
  const s = await getSession();
  if (!s.token) {
    if (opts.onUnauthorized === 'throw') throw new ApiError({ status: 401, code: 'UNAUTHORIZED' });
    return redirectToRefresh();
  }
  const res = await upstream({
    site: s.site,
    path,
    method: opts.method,
    query: opts.query,
    token: s.token,
    headers: opts.body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) {
    if (opts.onUnauthorized === 'throw') throw await errorFrom(res);
    return redirectToRefresh();
  }
  if (!res.ok) throw await errorFrom(res);
  return (await readBody(res)) as T;
}

async function redirectToRefresh(): Promise<never> {
  const next = await currentUrl();
  return redirect(`/api/auth/refresh?next=${encodeURIComponent(next)}`);
}

/** The signed-in user, or null (never redirects) — for public pages that adapt to a session. */
export const getMe = cache(async (): Promise<Me | null> => {
  const s = await getSession();
  if (!s.token) return null;
  try {
    return await api<Me>('/auth/me', { onUnauthorized: 'throw' });
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return null;
    throw e;
  }
});

/** The signed-in user, or a redirect to sign in (through the refresh route when a refresh is possible). */
export const requireMe = cache(async (): Promise<Me> => {
  const s = await getSession();
  if (!s.token) {
    const next = await currentUrl();
    if (s.hasRefresh && !s.justRefreshed) return redirect(`/api/auth/refresh?next=${encodeURIComponent(next)}`);
    return redirect(`/login${next && next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`);
  }
  return api<Me>('/auth/me');
});
