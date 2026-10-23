import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { licenseResponse } from '@school-sync/shared';
import { licenseSummary } from '../../core/billing/summary';
import { requirePerm } from '../../plugins/guards';

/** Seats used vs. licensed for the school's current academic year (pricing is per student per year). */
const licenseRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/license',
    { preHandler: [requirePerm('settings:view', 'school')], schema: { tags: ['Settings'], summary: 'Subscription period and student-seat usage', response: { 200: licenseResponse } } },
    async (req) => licenseSummary(req.db, req.tenant.id),
  );
};

export default licenseRoutes;
