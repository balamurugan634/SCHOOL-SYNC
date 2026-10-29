/**
 * Runtime environment readers. Dynamic `process.env[...]` access is deliberate: Next inlines
 * `process.env.NEXT_PUBLIC_*` at build time, but the site/base-domain settings must be changeable
 * per deployment without rebuilding.
 */
const read = (name: string): string | undefined => {
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
};

export const env = {
  get apiUrl() {
    return (read('API_URL') ?? 'http://localhost:4000').replace(/\/$/, '');
  },
  /** DNS base domain for school sub-domains, without port: `localhost` or `schoolsync.app`. */
  get baseDomain() {
    return (read('BASE_DOMAIN') ?? 'localhost').toLowerCase();
  },
  /** host[:port] used when building links to a school: `localhost:3000` or `schoolsync.app`. */
  get publicBase() {
    const explicit = read('NEXT_PUBLIC_BASE_DOMAIN');
    if (explicit) return explicit.toLowerCase();
    // in production the browser reaches the app through the reverse proxy on the standard port; `:3000` is only the local development default
    return this.isProd ? this.baseDomain : `${this.baseDomain}:3000`;
  },
  get defaultSite() {
    return read('NEXT_PUBLIC_DEFAULT_SITE')?.toLowerCase();
  },
  get selectMode(): 'cookie' | 'redirect' {
    const v = read('SITE_SELECT_MODE');
    if (v === 'cookie' || v === 'redirect') return v;
    return process.env.NODE_ENV === 'production' ? 'redirect' : 'cookie';
  },
  get secureCookies() {
    const v = read('COOKIE_SECURE');
    if (v) return v === 'true' || v === '1';
    return process.env.NODE_ENV === 'production';
  },
  get devPreview() {
    return process.env.NODE_ENV !== 'production' && read('ENABLE_DEV_PREVIEW') === 'true';
  },
  get isProd() {
    return process.env.NODE_ENV === 'production';
  },
};

export const SITE_CODE_RE = /^[a-z][a-z0-9-]{1,40}$/;
