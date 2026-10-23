import type { TokenResponse } from '@school-sync/shared';
import { upstream, readBody } from './upstream';

export type RefreshResult =
  | { ok: true; tokens: TokenResponse }
  | { ok: false; reason: 'expired' | 'race' | 'unreachable' };

/**
 * Single-flight refresh. The API rotates refresh tokens and treats a replay as theft, so two
 * concurrent requests carrying the same old token must share ONE refresh call. The successful
 * result is kept for 15 s so slightly-later requests with the same old cookie reuse it instead of
 * replaying (the API's own grace window for that is 10 s → 409 REFRESH_RACE).
 */
type Store = Map<string, { p: Promise<RefreshResult>; at: number }>;
const g = globalThis as unknown as { __ssRefresh?: Store };
const store: Store = (g.__ssRefresh ??= new Map());

const KEEP_MS = 15_000;

function sweep() {
  const now = Date.now();
  for (const [k, v] of store) if (now - v.at > KEEP_MS) store.delete(k);
}

async function callRefresh(site: string, refreshToken: string, userAgent?: string): Promise<RefreshResult> {
  let res: Response;
  try {
    res = await upstream({
      site,
      path: '/auth/refresh',
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(userAgent ? { 'user-agent': userAgent } : {}) },
      body: JSON.stringify({ refreshToken }),
    });
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
  if (res.ok) return { ok: true, tokens: (await readBody(res)) as TokenResponse };
  if (res.status === 409) return { ok: false, reason: 'race' };
  if (res.status >= 500) return { ok: false, reason: 'unreachable' };
  return { ok: false, reason: 'expired' };
}

export function refreshTokens(site: string, refreshToken: string, userAgent?: string): Promise<RefreshResult> {
  sweep();
  const key = `${site}:${refreshToken}`;
  const hit = store.get(key);
  if (hit) return hit.p;
  const p = callRefresh(site, refreshToken, userAgent);
  store.set(key, { p, at: Date.now() });
  // failures must not be sticky (except a definitive "expired" which is safe to repeat)
  void p.then((r) => {
    if (!r.ok && r.reason !== 'expired') store.delete(key);
  });
  return p;
}
