import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { AppError } from '../../core/errors';
import billing from './routes.billing';
import payments from './routes.payments';
import reports from './routes.reports';

/**
 * Fees & finance: /fees/*, /payments/*, /expenses/*, /finance/*.
 * The whole module is switched off per school by `tenant.features.fees` (403 FEATURE_DISABLED).
 */
const routes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', async (req) => {
    // the public payment webhook resolves its own school (and decides for itself); OPTIONS has no tenant yet
    if (req.routeOptions.config.noTenant || req.method === 'OPTIONS' || !req.tenant) return;
    if (!req.tenant.features.fees) throw new AppError(403, 'FEATURE_DISABLED', 'The fees module is not enabled for this school');
  });
  await app.register(billing);
  await app.register(payments);
  await app.register(reports);
};

export default routes;
