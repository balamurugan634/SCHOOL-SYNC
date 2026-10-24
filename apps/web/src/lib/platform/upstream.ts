import 'server-only';
import { env } from '../env';
import { ApiError } from '../problem';

export interface PlatformUpstreamInit {
  /** path below `/api/v1/platform`, e.g. `/auth/me` */
  path: string;
  method?: string;
  query?: URLSearchParams | Record<string, string | number | boolean | undefined | null> | string;
  body?: BodyInit | null;
  headers?: Record<string, string>;
  token?: string | null;
  signal?: AbortSignal;
}

/** The only place the web app talks to the platform API. Server side only; never sends a school (`X-Tenant`) header. */
export async function platformUpstream(init: PlatformUpstreamInit): Promise<Response> {
  const url = new URL(`${env.apiUrl}/api/v1/platform${init.path.startsWith('/') ? init.path : `/${init.path}`}`);
  if (typeof init.query === 'string') {
    const q = init.query.replace(/^\?/, '');
    if (q) url.search = q;
  } else if (init.query instanceof URLSearchParams) {
    url.search = init.query.toString();
  } else if (init.query) {
    for (const [k, v] of Object.entries(init.query)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  const headers: Record<string, string> = { accept: 'application/json, application/problem+json', ...init.headers };
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  try {
    return await fetch(url, { method: init.method ?? 'GET', headers, body: init.body ?? null, signal: init.signal, cache: 'no-store', redirect: 'manual' });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new ApiError({ status: 503, code: 'API_UNREACHABLE', title: 'The server is unreachable' });
  }
}

export async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { detail: text.slice(0, 300) };
  }
}
