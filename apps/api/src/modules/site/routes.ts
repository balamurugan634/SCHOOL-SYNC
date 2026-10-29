import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { siteInfoResponse } from '@school-sync/shared';
import { getLicense } from '../../core/billing/license';
import { config } from '../../config';
import { notFound } from '../../core/errors';
import { isBlockedAddress } from '../../core/email/guard';
import { isTlsHostAllowed } from '../../core/tenancy/tls';

export const API_VERSION = '1.0.0';

/** Public (no auth): lets the mobile app verify and brand a school before login. */
const siteRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/site/info',
    { schema: { tags: ['Site'], summary: 'Public school info used by the app during first-run setup', response: { 200: siteInfoResponse } } },
    async (req) => {
      const t = req.tenant;
      const lic = await getLicense(t.id);
      return {
        code: t.code,
        name: t.name,
        shortName: t.branding.shortName ?? null,
        logoUrl: t.branding.logoUrl ?? null,
        primaryColor: t.branding.primaryColor ?? '#2457a5',
        accentColor: t.branding.accentColor ?? null,
        timezone: t.timezone,
        locale: t.locale,
        currency: t.currency,
        features: t.features,
        readOnly: lic.readOnly,
        api: { version: API_VERSION, minAppVersion: config.MIN_APP_VERSION },
      };
    },
  );

  // Used by Caddy (on-demand TLS) over the internal network only: a request that came through the proxy from the internet
  // carries a public client address and is answered as if the route did not exist.
  app.get(
    '/site/tls-allowed',
    { config: { noTenant: true }, schema: { tags: ['Site'], summary: 'Reverse-proxy check: may a certificate be issued for this host? (internal callers only)', querystring: z.object({ domain: z.string().min(1).max(253) }), response: { 200: z.object({ ok: z.literal(true) }) } } },
    async (req) => {
      if (!isBlockedAddress(req.ip)) throw notFound('Route');
      if (!(await isTlsHostAllowed(req.query.domain))) throw notFound('Host');
      return { ok: true as const };
    },
  );

  app.get('/healthz', { config: { noTenant: true }, schema: { tags: ['Site'], response: { 200: z.object({ ok: z.literal(true) }) } } }, async () => ({ ok: true as const }));
};

export default siteRoutes;
