import { desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod, ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  platformInvoiceIssueBody,
  platformInvoiceIssueOut,
  platformMeterAllOut,
  platformSubscriptionBody,
  platformSubscriptionOut,
  platformTenantCreateBody,
  platformTenantCreateOut,
  platformTenantList,
  platformTenantListQuery,
  platformTenantStatusBody,
  platformTenantStatusOut,
} from '@school-sync/shared';
import { platformAccess } from '../../core/platform/access';
import { actorOfRequest } from '../../core/platform/audit';
import '../../core/platform/context';
import { issueInvoice } from '../../core/platform/invoices';
import * as tenants from '../../core/platform/tenants';
import { controlDb } from '../../core/tenancy/control-db';
import { billingInvoices, usageSnapshots } from '../../db/control/schema';
import platformAuthRoutes from './auth-routes';
import consoleRoutes from './console-routes';

const tag = ['Platform'];
const security: Record<string, string[]>[] = [{ platformKey: [] }, { operatorToken: [] }];
const cfg = { noTenant: true };
const codeParam = z.object({ code: z.string().trim().min(1).max(60) });

/**
 * Platform API (us, not schools): create sites, manage per-student subscriptions, read usage, issue invoices, run the
 * operator console. A request is allowed with EITHER the automation key (`X-Platform-Key`, only when PLATFORM_API_KEY is
 * set) OR an operator's bearer token from `/platform/auth/login`; which one was used is recorded in `platform_audit`.
 * Keep it off the public internet (private network / VPN / separate listener) in production.
 *
 * The first block below is the original key API (same paths); its request bodies and responses only gained fields.
 */
const platformRoutes: FastifyPluginAsyncZod = async (app) => {
  app.decorateRequest('platformActor', undefined as never);
  app.decorateRequest('platformSessionId', '');

  // sign-in routes are public by nature; everything else is behind the key-or-token guard
  await app.register(platformAuthRoutes);

  await app.register(async (guarded) => {
    guarded.addHook('onRequest', platformAccess());
    const g = guarded.withTypeProvider<ZodTypeProvider>();

    g.get(
      '/platform/tenants',
      { config: cfg, schema: { tags: tag, summary: 'All sites with license state, seats and latest usage (filterable, optionally paged)', querystring: platformTenantListQuery, response: { 200: platformTenantList }, security } },
      async (req) => tenants.listTenants(req.query),
    );

    g.post(
      '/platform/tenants',
      { config: cfg, schema: { tags: tag, summary: 'Create a site (new database, default data, first super-admin). The temporary admin password is returned once.', body: platformTenantCreateBody, response: { 201: platformTenantCreateOut }, security } },
      async (req, reply) => reply.status(201).send(await tenants.createSchool(req.body, actorOfRequest(req))),
    );

    g.put(
      '/platform/tenants/:code/subscription',
      { config: cfg, schema: { tags: tag, summary: 'Create/renew the per-student subscription for an academic year', params: codeParam, body: platformSubscriptionBody, response: { 200: platformSubscriptionOut }, security } },
      async (req) => {
        const subscription = await tenants.upsertTenantSubscription(req.params.code, req.body, actorOfRequest(req));
        return { id: subscription.id, academicYear: subscription.academicYear, subscription };
      },
    );

    g.post(
      '/platform/tenants/:code/status',
      { config: cfg, schema: { tags: tag, summary: 'Suspend / resume a site', params: codeParam, body: platformTenantStatusBody, response: { 200: platformTenantStatusOut }, security } },
      async (req) => ({ ok: true as const, status: await tenants.setTenantStatus(req.params.code, req.body.status, req.body.reason, actorOfRequest(req)) }),
    );

    g.get('/platform/tenants/:code/billing', { config: cfg, schema: { tags: tag, summary: 'Raw usage snapshots and invoices of a site', params: codeParam, security } }, async (req) => {
      const t = await tenants.getTenantRow(req.params.code);
      const [usage, invoices] = await Promise.all([controlDb().select().from(usageSnapshots).where(eq(usageSnapshots.tenantId, t.id)).orderBy(desc(usageSnapshots.snapshotDate)).limit(90), controlDb().select().from(billingInvoices).where(eq(billingInvoices.tenantId, t.id)).orderBy(desc(billingInvoices.issuedAt))]);
      return { usage, invoices };
    });

    g.post(
      '/platform/tenants/:code/invoices',
      { config: cfg, schema: { tags: tag, summary: 'Issue the committed-seats invoice or a true-up', params: codeParam, body: platformInvoiceIssueBody, response: { 200: platformInvoiceIssueOut }, security } },
      async (req) => issueInvoice(req.params.code, req.body, actorOfRequest(req)),
    );

    g.post('/platform/billing/snapshot', { config: cfg, schema: { tags: tag, summary: 'Meter all active sites now (also run daily)', response: { 200: platformMeterAllOut }, security } }, async (req) => tenants.meterAll(actorOfRequest(req)));

    await guarded.register(consoleRoutes);
  });
};

export default platformRoutes;
