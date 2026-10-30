import { onlineMeetingTuning } from './tuning';
import { ProviderError } from './errors';
import type { OnlineProvider } from '@school-sync/shared';

export interface ProviderResponse {
  status: number;
  /** parsed JSON body, or null when the body was empty / not JSON. Only ever read for fields we know; never logged or copied. */
  json: Record<string, unknown> | null;
}

const MAX_BODY = 256 * 1024;

/**
 * One HTTP call to a provider with a hard timeout. HTTP error statuses are NOT thrown here (callers map them); network
 * failures and timeouts are, as ProviderErrors without any detail.
 */
export async function providerRequest(provider: OnlineProvider, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, init: { headers?: Record<string, string>; json?: unknown; form?: URLSearchParams } = {}): Promise<ProviderResponse> {
  const headers: Record<string, string> = { accept: 'application/json', ...init.headers };
  let body: string | undefined;
  if (init.json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(init.json);
  } else if (init.form) {
    headers['content-type'] = 'application/x-www-form-urlencoded';
    body = init.form.toString();
  }
  let res: Response;
  try {
    res = await fetch(url, { method, headers, body, redirect: 'error', signal: AbortSignal.timeout(onlineMeetingTuning.timeoutMs) });
  } catch (e) {
    const name = e && typeof e === 'object' && 'name' in e ? String((e as { name: unknown }).name) : '';
    throw new ProviderError(name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'unavailable', provider);
  }
  let json: Record<string, unknown> | null = null;
  try {
    const text = (await res.text()).slice(0, MAX_BODY);
    if (text) {
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) json = parsed as Record<string, unknown>;
    }
  } catch {
    // empty, truncated or not JSON: callers only need the status then
  }
  return { status: res.status, json };
}

export const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
export const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
