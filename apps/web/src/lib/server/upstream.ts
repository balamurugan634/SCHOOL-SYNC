import 'server-only';
import { ApiError } from '../problem';
import { env } from '../env';

export interface UpstreamInit {
  /** school (site) code → `X-Tenant` */
  site: string;
  /** path below `/api/v1`, e.g. `/auth/me` */
  path: string;
  method?: string;
  query?: URLSearchParams | Record<string, string | number | boolean | undefined | null> | string;
  body?: BodyInit | null;
  headers?: Record<string, string>;
  token?: string | null;
  signal?: AbortSignal;
}

/** The only place that talks to the Fastify API. Server-side only. */
export async function upstream(init: UpstreamInit): Promise<Response> {
  const url = new URL(`${env.apiUrl}/api/v1${init.path.startsWith('/') ? init.path : `/${init.path}`}`);
  if (typeof init.query === 'string') {
    const q = init.query.replace(/^\?/, '');
    if (q) url.search = q;
  } else if (init.query instanceof URLSearchParams) {
    url.search = init.query.toString();
  } else if (init.query) {
    for (const [k, v] of Object.entries(init.query)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  const headers: Record<string, string> = { accept: 'application/json, application/problem+json, */*', 'x-tenant': init.site, ...init.headers };
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  try {
    return await fetch(url, { method: init.method ?? 'GET', headers, body: init.body ?? null, signal: init.signal, cache: 'no-store', redirect: 'manual' });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new ApiError({ status: 503, code: 'API_UNREACHABLE', title: 'The school server is unreachable' });
  }
}

export async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { detail: text.slice(0, 300) };
  }
}

export async function errorFrom(res: Response): Promise<ApiError> {
  return ApiError.fromProblem(res.status, await readBody(res));
}

export async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw await errorFrom(res);
  return (await readBody(res)) as T;
}
