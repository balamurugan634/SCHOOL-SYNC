'use client';

import { ApiError } from '../problem';
import { readOnlyStore } from './readonly-store';

type Query = Record<string, string | number | boolean | undefined | null>;

export interface BffOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Query;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

const DEAD_SESSION = new Set(['SESSION_EXPIRED', 'INVALID_REFRESH', 'ACCOUNT_DISABLED', 'UNAUTHORIZED', 'INVALID_TOKEN', 'TOKEN_EXPIRED', 'TOKEN_STALE']);
let leaving = false;

function qs(q?: Query): string {
  if (!q) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

/**
 * Browser → BFF (`/api/bff/*`) → API. Cookies carry the session; the browser never sees a token.
 * The server side already refreshed an expired access token and retried, so a 401 that reaches us means the
 * session is genuinely over → go to the sign-in page. A 402 flips the app into read-only mode.
 */
export async function bff<T = unknown>(path: string, opts: BffOptions = {}): Promise<T> {
  const hasBody = opts.body !== undefined;
  let res: Response;
  try {
    res = await fetch(`/api/bff${path.startsWith('/') ? path : `/${path}`}${qs(opts.query)}`, {
      method: opts.method ?? (hasBody ? 'POST' : 'GET'),
      headers: { accept: 'application/json', ...(hasBody ? { 'content-type': 'application/json' } : {}), ...opts.headers },
      body: hasBody ? JSON.stringify(opts.body) : undefined,
      credentials: 'same-origin',
      signal: opts.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new ApiError({ status: 0, code: 'API_UNREACHABLE', title: 'Network error' });
  }
  if (res.status === 204) return null as T;
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { detail: text.slice(0, 200) };
    }
  }
  if (!res.ok) {
    const err = ApiError.fromProblem(res.status, data);
    if (err.isReadOnly) readOnlyStore.set(true);
    if (res.status === 401 && DEAD_SESSION.has(err.code) && typeof window !== 'undefined' && !leaving && !window.location.pathname.startsWith('/login')) {
      leaving = true;
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(`/login?reason=expired&next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
    }
    throw err;
  }
  return data as T;
}
