import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { siteInfoResponse } from '@school-sync/shared';
import { getLicense } from '../../core/billing/license';
import { config } from '../../config';

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

  app.get('/healthz', { config: { noTenant: true }, schema: { tags: ['Site'], response: { 200: z.object({ ok: z.literal(true) }) } } }, async () => ({ ok: true as const }));
};

export default siteRoutes;
