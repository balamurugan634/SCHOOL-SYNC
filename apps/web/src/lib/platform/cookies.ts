import { env } from '../env';
import type { CookieSpec } from '../cookies';

/**
 * Operator console cookies. Deliberately different names from the school session cookies (`ss_at` / `ss_rt`), so a school
 * session can never be mistaken for an operator session (or the other way round); the API also rejects the wrong token kind.
 * In production (Secure) they carry the `__Host-` prefix: Path=/, Secure, no Domain, bound to exactly this host.
 */
const BASE = { at: 'ss_pat', rt: 'ss_prt', rf: 'ss_prf' } as const;
export type OperatorCookieKey = keyof typeof BASE;

export const operatorCookieName = (key: OperatorCookieKey): string => (env.secureCookies ? `__Host-${BASE[key]}` : BASE[key]);

const opts = (maxAge: number): CookieSpec['options'] => ({ httpOnly: true, secure: env.secureCookies, sameSite: 'lax', path: '/', maxAge });

/** Matches the API: refresh tokens live 7 days (sliding), the access token 15 minutes. */
const REFRESH_COOKIE_DAYS = 7;

export function operatorCookies(tokens: { accessToken: string; refreshToken: string; expiresIn: number }): CookieSpec[] {
  return [
    // expire a little before the JWT so a missing cookie (not a 401) is the normal "needs refresh" signal
    { name: operatorCookieName('at'), value: tokens.accessToken, options: opts(Math.max(30, tokens.expiresIn - 30)) },
    { name: operatorCookieName('rt'), value: tokens.refreshToken, options: opts(REFRESH_COOKIE_DAYS * 86_400) },
  ];
}

export const clearedOperatorCookies = (): CookieSpec[] => (['at', 'rt'] as const).map((k) => ({ name: operatorCookieName(k), value: '', options: opts(0) }));

/** "We refreshed 10 seconds ago" marker: a 401 right after must not cause a refresh redirect loop. */
export const operatorRefreshGuardCookie = (): CookieSpec => ({ name: operatorCookieName('rf'), value: '1', options: opts(10) });
