import type { PlatformTokenResponse } from '@school-sync/shared';
import { platformUpstream, readJson } from './upstream';

export type OperatorRefreshResult = { ok: true; tokens: PlatformTokenResponse } | { ok: false; reason: 'expired' | 'race' | 'unreachable' };

/**
 * Single-flight refresh, same reasoning as the school session: the API rotates refresh tokens and treats a replay as theft,
 * so concurrent requests carrying the same old token must share ONE refresh call. The result is kept for 15 s.
 */
type Store = Map<string, { p: Promise<OperatorRefreshResult>; at: number }>;
const g = globalThis as unknown as { __ssOpRefresh?: Store };
const store: Store = (g.__ssOpRefresh ??= new Map());
const KEEP_MS = 15_000;

async function call(refreshToken: string, userAgent?: string, xff?: string): Promise<OperatorRefreshResult> {
  let res: Response;
  try {
    res = await platformUpstream({ path: '/auth/refresh', method: 'POST', headers: { 'content-type': 'application/json', ...(userAgent ? { 'user-agent': userAgent } : {}), ...(xff ? { 'x-forwarded-for': xff } : {}) }, body: JSON.stringify({ refreshToken }) });
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
  if (res.ok) return { ok: true, tokens: (await readJson(res)) as PlatformTokenResponse };
  if (res.status === 409) return { ok: false, reason: 'race' };
  if (res.status >= 500) return { ok: false, reason: 'unreachable' };
  return { ok: false, reason: 'expired' };
}

export function refreshOperator(refreshToken: string, userAgent?: string, xff?: string): Promise<OperatorRefreshResult> {
  const now = Date.now();
  for (const [k, v] of store) if (now - v.at > KEEP_MS) store.delete(k);
  const hit = store.get(refreshToken);
  if (hit) return hit.p;
  const p = call(refreshToken, userAgent, xff);
  store.set(refreshToken, { p, at: now });
  void p.then((r) => {
    if (!r.ok && r.reason !== 'expired') store.delete(refreshToken);
  });
  return p;
}
