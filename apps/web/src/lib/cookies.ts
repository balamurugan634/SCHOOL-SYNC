import { env } from './env';

/**
 * Cookie names. In production (Secure) they get the `__Host-` prefix: browsers then guarantee
 * Path=/, Secure and no Domain, i.e. the cookie is bound to exactly this host — one school.
 */
const BASE = { at: 'ss_at', rt: 'ss_rt', ts: 'ss_ts', rf: 'ss_rf', site: 'ss_site' } as const;
export type CookieKey = keyof typeof BASE;

export function cookieName(key: CookieKey): string {
  return env.secureCookies && key !== 'site' ? `__Host-${BASE[key]}` : BASE[key];
}

interface CookieOpts {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax';
  path: '/';
  maxAge: number;
}
const opts = (maxAge: number, httpOnly = true): CookieOpts => ({ httpOnly, secure: env.secureCookies, sameSite: 'lax', path: '/', maxAge });

export interface CookieSpec {
  name: string;
  value: string;
  options: CookieOpts;
}

const REFRESH_COOKIE_DAYS = 30;

/** All cookies that make up a signed-in session for `site`. Tokens are HttpOnly: JS never sees them. */
export function sessionCookies(site: string, tokens: { accessToken: string; refreshToken: string; expiresIn: number }): CookieSpec[] {
  const refreshAge = REFRESH_COOKIE_DAYS * 86_400;
  return [
    // expire slightly before the JWT so a missing cookie (not a 401) is the normal "needs refresh" signal
    { name: cookieName('at'), value: tokens.accessToken, options: opts(Math.max(30, tokens.expiresIn - 30)) },
    { name: cookieName('rt'), value: tokens.refreshToken, options: opts(refreshAge) },
    { name: cookieName('ts'), value: site, options: opts(refreshAge) },
  ];
}

export function clearedSessionCookies(): CookieSpec[] {
  return (['at', 'rt', 'ts'] as const).map((k) => ({ name: cookieName(k), value: '', options: opts(0) }));
}

/** Marks "we just refreshed" for 10 s so a 401 right after cannot cause a refresh redirect loop. */
export function refreshGuardCookie(): CookieSpec {
  return { name: cookieName('rf'), value: '1', options: opts(10) };
}

export function siteCookie(code: string): CookieSpec {
  return { name: cookieName('site'), value: code, options: opts(365 * 86_400, false) };
}
