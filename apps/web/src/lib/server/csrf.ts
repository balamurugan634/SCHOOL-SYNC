/**
 * CSRF defence for the BFF: cookies are SameSite=Lax, and on top of that every state-changing request
 * must come from this very host. `Origin` must match the Host the request was addressed to; if the browser
 * sent no Origin we fall back to `Sec-Fetch-Site`, and refuse when neither proves same-origin.
 */
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

export function requestHost(headers: Headers): string {
  return (headers.get('x-forwarded-host') ?? headers.get('host') ?? '').split(',')[0]!.trim().toLowerCase();
}

export function isSameOrigin(method: string, headers: Headers): boolean {
  if (SAFE.has(method.toUpperCase())) return true;
  const origin = headers.get('origin');
  const host = requestHost(headers);
  if (origin && origin !== 'null') {
    try {
      return new URL(origin).host.toLowerCase() === host;
    } catch {
      return false;
    }
  }
  const sfs = headers.get('sec-fetch-site');
  return sfs === 'same-origin' || sfs === 'none';
}

/** Public origin of the request (scheme + the host the visitor used), for building absolute redirects. */
export function requestOrigin(headers: Headers, fallbackProto = 'http'): string {
  const proto = (headers.get('x-forwarded-proto') ?? fallbackProto).split(',')[0]!.trim();
  return `${proto}://${requestHost(headers)}`;
}
