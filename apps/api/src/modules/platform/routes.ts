import { desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { config } from '../../config';
import { issueSeatInvoice, issueTrueUp, upsertSubscription } from '../../core/billing/invoicing';
import { getLicense, invalidateLicense } from '../../core/billing/license';
import { snapshotAllTenants } from '../../core/billing/metering';
import { safeEqual } from '../../core/crypto';
import { AppError, notFound, unauthorized } from '../../core/errors';
import { controlDb } from '../../core/tenancy/control-db';
import { createTenant } from '../../core/tenancy/provision';
import { invalidateTenant } from '../../core/tenancy/registry';
import { billingInvoices, platformAudit, tenants, usageSnapshots } from '../../db/control/schema';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const subscriptionBody = z.object({
  academicYear: z.string().regex(/^\d{4}-\d{2}$/),
  startsOn: dateStr,
  endsOn: dateStr,
  pricePerStudent: z.number().min(0),
  licensedStudents: z.number().int().min(0).nullable().optional(),
  overagePolicy: z.enum(['allow_and_bill', 'block']).optional(),
  graceDays: z.number().int().min(0).max(180).optional(),
  trial: z.boolean().optional(),
  currency: z.string().length(3).optional(),
});

/**
 * Platform operator API (us, not schools): create sites, manage per-student subscriptions, read usage, issue invoices.
 * Authenticated with `X-Platform-Key`; disabled entirely unless PLATFORM_API_KEY is set. Keep it off the public internet
 * (private network / VPN / separate listener) in production.
 */
const platformRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', async (req) => {
    if (!config.PLATFORM_API_KEY) throw notFound('Route');
    const key = req.headers['x-platform-key'];
    if (typeof key !== 'string' || !safeEqual(key, config.PLATFORM_API_KEY)) throw unauthorized('Invalid platform key', 'INVALID_PLATFORM_KEY');
  });
  const cfg = { noTenant: true };
  const tag = ['Platform'];

  app.get('/platform/tenants', { config: cfg, schema: { tags: tag, summary: 'All sites with license state and latest usage' } }, async () => {
    const list = await controlDb().select().from(tenants).orderBy(tenants.code);
    const data = [];
    for (const t of list) {
      const lic = await getLicense(t.id);
      const [snap] = await controlDb().select().from(usageSnapshots).where(eq(usageSnapshots.tenantId, t.id)).orderBy(desc(usageSnapshots.snapshotDate)).limit(1);
      data.push({ code: t.code, name: t.name, status: t.status, dbName: t.dbName, license: { state: lic.state, readOnly: lic.readOnly, academicYear: lic.subscription?.academicYear ?? null, licensedStudents: lic.licensedStudents, pricePerStudentMinor: lic.subscription?.pricePerStudentMinor ?? null, endsOn: lic.subscription?.endsOn ?? null }, usage: snap ? { date: snap.snapshotDate, billableStudents: snap.billableStudents, activeStudents: snap.activeStudents, staff: snap.staff } : null });
    }
    return { data };
  });

  app.post(
    '/platform/tenants',
    { config: cfg, schema: { tags: tag, summary: 'Create a site (new database, default data, first super-admin)', body: z.object({ code: z.string(), name: z.string().min(2), adminName: z.string().optional(), adminEmail: z.email().optional(), adminPassword: z.string().min(10).optional(), timezone: z.string().optional(), currency: z.string().length(3).optional(), subscription: subscriptionBody.partial({ academicYear: true, startsOn: true, endsOn: true }).optional() }) } },
    async (req, reply) => {
      const r = await createTenant(req.body).catch((e: Error) => {
        throw new AppError(400, 'CREATE_FAILED', e.message);
      });
      return reply.status(201).send({ code: r.tenant.code, name: r.tenant.name, admin: r.admin });
    },
  );

  app.put('/platform/tenants/:code/subscription', { config: cfg, schema: { tags: tag, summary: 'Create/renew the per-student subscription for an academic year', params: z.object({ code: z.string() }), body: subscriptionBody } }, async (req) => {
    const sub = await upsertSubscription({ ...req.body, tenantCode: req.params.code }, 'platform-api').catch((e: Error) => {
      throw new AppError(400, 'SUBSCRIBE_FAILED', e.message);
    });
    return { id: sub.id, academicYear: sub.academicYear };
  });

  app.post('/platform/tenants/:code/status', { config: cfg, schema: { tags: tag, summary: 'Suspend / resume a site', params: z.object({ code: z.string() }), body: z.object({ status: z.enum(['active', 'suspended', 'archived']) }) } }, async (req) => {
    const [t] = await controlDb().update(tenants).set({ status: req.body.status }).where(eq(tenants.code, req.params.code)).returning();
    if (!t) throw notFound('Site');
    invalidateTenant(t.code);
    invalidateLicense(t.id);
    await controlDb().insert(platformAudit).values({ actor: 'platform-api', action: `tenant.${req.body.status}`, tenantCode: t.code });
    return { ok: true };
  });

  app.get('/platform/tenants/:code/billing', { config: cfg, schema: { tags: tag, params: z.object({ code: z.string() }) } }, async (req) => {
    const [t] = await controlDb().select().from(tenants).where(eq(tenants.code, req.params.code)).limit(1);
    if (!t) throw notFound('Site');
    const [usage, invoices] = await Promise.all([controlDb().select().from(usageSnapshots).where(eq(usageSnapshots.tenantId, t.id)).orderBy(desc(usageSnapshots.snapshotDate)).limit(90), controlDb().select().from(billingInvoices).where(eq(billingInvoices.tenantId, t.id)).orderBy(desc(billingInvoices.issuedAt))]);
    return { usage, invoices };
  });

  app.post('/platform/tenants/:code/invoices', { config: cfg, schema: { tags: tag, summary: 'Issue the committed-seats invoice or a true-up', params: z.object({ code: z.string() }), body: z.object({ kind: z.enum(['seats', 'true_up']), academicYear: z.string() }) } }, async (req) => {
    const [t] = await controlDb().select().from(tenants).where(eq(tenants.code, req.params.code)).limit(1);
    if (!t) throw notFound('Site');
    const lic = await getLicense(t.id);
    if (!lic.subscription || lic.subscription.academicYear !== req.body.academicYear) throw new AppError(400, 'NO_SUBSCRIPTION', 'No subscription for that academic year');
    const inv = await (req.body.kind === 'seats' ? issueSeatInvoice(lic.subscription.id) : issueTrueUp(lic.subscription.id)).catch((e: Error) => {
      throw new AppError(409, 'INVOICE_FAILED', e.message);
    });
    return { invoice: inv };
  });

  app.post('/platform/billing/snapshot', { config: cfg, schema: { tags: tag, summary: 'Meter all active sites now (also run daily)' } }, async () => ({ data: await snapshotAllTenants() }));
};

export default platformRoutes;
