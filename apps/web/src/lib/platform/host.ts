import { classifyHost } from '../server/site';

/**
 * The console is for us, not for schools: it is served on the base host (`localhost:3000`, `schoolsync.app`), on the
 * reserved `admin.` / `platform.` sub-domains, or on hosts listed in PLATFORM_CONSOLE_HOSTS (comma separated, exact).
 * A school's own host (`demo.localhost`, a custom domain) answers 404, so operator sign-in never happens on a school's origin.
 */
export function platformHostAllowed(hostHeader: string): boolean {
  const host = hostHeader.toLowerCase();
  const extra = (process.env.PLATFORM_CONSOLE_HOSTS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (extra.includes(host) || extra.includes(host.replace(/:\d+$/, ''))) return true;
  const kind = classifyHost(host);
  if (kind.kind === 'base') return true;
  return kind.kind === 'site' && (kind.code === 'admin' || kind.code === 'platform');
}

export const isPlatformPath = (p: string): boolean => p === '/platform' || p.startsWith('/platform/') || p.startsWith('/api/platform/');

/** Only same-console redirects: a `next` that is not under /platform is dropped. */
export const safePlatformNext = (v: string | null | undefined): string | null => (v && /^\/platform(\/|\?|$)/.test(v) && !v.startsWith('//') ? v : null);
