'use client';

import { ApiError } from '../problem';

type Query = Record<string, string | number | boolean | undefined | null>;

export interface PlatformFetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Query;
  signal?: AbortSignal;
}

const DEAD_SESSION = new Set(['SESSION_EXPIRED', 'INVALID_REFRESH', 'ACCOUNT_DISABLED', 'UNAUTHORIZED', 'INVALID_TOKEN', 'TOKEN_EXPIRED', 'OPERATOR_REQUIRED']);
let leaving = false;

function qs(q?: Query): string {
  if (!q) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

/**
 * Browser → console BFF (`/api/platform/bff/*`) → platform API. Cookies carry the session; the browser never sees a token.
 * The server side already refreshed an expired access token and retried, so a 401 that reaches us means the session is over.
 */
export async function pbff<T = unknown>(path: string, opts: PlatformFetchOptions = {}): Promise<T> {
  const hasBody = opts.body !== undefined;
  let res: Response;
  try {
    res = await fetch(`/api/platform/bff${path.startsWith('/') ? path : `/${path}`}${qs(opts.query)}`, {
      method: opts.method ?? (hasBody ? 'POST' : 'GET'),
      headers: { accept: 'application/json', ...(hasBody ? { 'content-type': 'application/json' } : {}) },
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
    if (res.status === 401 && DEAD_SESSION.has(err.code) && typeof window !== 'undefined' && !leaving && !window.location.pathname.startsWith('/platform/sign-in')) {
      leaving = true;
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(`/platform/sign-in?reason=expired&next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
    }
    throw err;
  }
  return data as T;
}

/** Message for any thrown value, with the console's own wording for its error codes. */
export function platformError(e: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (e instanceof ApiError) {
    switch (e.code) {
      case 'INVALID_CREDENTIALS':
        return 'That email or password is not right. Check it and try again.';
      case 'ACCOUNT_LOCKED':
        return 'Too many failed attempts. Sign-in is paused for a short while.';
      case 'ACCOUNT_DISABLED':
        return 'This operator account is disabled. Ask another operator to enable it.';
      case 'RATE_LIMITED':
        return 'Too many attempts. Wait a moment and try again.';
      case 'API_UNREACHABLE':
        return 'The server is unreachable. Check that the API is running and try again.';
      case 'PASSWORD_CHANGE_REQUIRED':
        return 'Choose a new password before you continue.';
    }
    return e.detail ?? e.message ?? fallback;
  }
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}
