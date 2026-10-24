import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  platformAuditList,
  platformAuditQuery,
  platformBillingOverview,
  platformCodeCheck,
  platformCodeCheckQuery,
  platformConsoleConfig,
  platformInvoice,
  platformInvoiceDataList,
  platformInvoiceList,
  platformInvoiceListQuery,
  platformInvoicePayBody,
  platformInvoiceVoidBody,
  platformOperator,
  platformOperatorCreateBody,
  platformOperatorCreateOut,
  platformOperatorList,
  platformOperatorResetOut,
  platformSubscriptionList,
  platformMigrateOut,
  platformTenantDetail,
  platformTenantUpdateBody,
  platformUsageOut,
  platformUsageQuery,
  platformUsageSnapshotOut,
  uuid,
} from '@school-sync/shared';
import { config } from '../../config';
import { actorOfRequest } from '../../core/platform/audit';
import * as invoices from '../../core/platform/invoices';
import * as ops from '../../core/platform/operators';
import * as tenants from '../../core/platform/tenants';
import { API_VERSION } from '../site/routes';

const tag = ['Platform'];
const security: Record<string, string[]>[] = [{ platformKey: [] }, { operatorToken: [] }];
const cfg = { noTenant: true };
const codeParam = z.object({ code: z.string().trim().min(1).max(60) });
const idParam = z.object({ id: uuid });

/** The operator console's endpoints (everything the original key-only API did not cover). Mounted behind the key-or-token guard. */
const consoleRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/platform/config', { config: cfg, schema: { tags: tag, summary: 'What this server allows (demo data, environment)', response: { 200: platformConsoleConfig }, security } }, async () => ({ environment: config.NODE_ENV, demoDataAllowed: tenants.demoDataAllowed(), apiVersion: API_VERSION }));

  // ── operators ──
  app.get('/platform/operators', { config: cfg, schema: { tags: tag, summary: 'Operator accounts', response: { 200: platformOperatorList }, security } }, async () => ({ data: await ops.listOperators() }));

  app.post(
    '/platform/operators',
    { config: cfg, schema: { tags: tag, summary: 'Create an operator (temporary password shown once)', body: platformOperatorCreateBody, response: { 201: platformOperatorCreateOut }, security } },
    async (req, reply) => reply.status(201).send(await ops.createOperator(req.body, actorOfRequest(req))),
  );

  app.post('/platform/operators/:id/disable', { config: cfg, schema: { tags: tag, summary: 'Disable an operator and sign them out', params: idParam, response: { 200: platformOperator }, security } }, async (req) => ops.setOperatorStatus(req.params.id, 'disabled', actorOfRequest(req)));
  app.post('/platform/operators/:id/enable', { config: cfg, schema: { tags: tag, summary: 'Enable an operator again', params: idParam, response: { 200: platformOperator }, security } }, async (req) => ops.setOperatorStatus(req.params.id, 'active', actorOfRequest(req)));
  app.post(
    '/platform/operators/:id/reset-password',
    { config: cfg, schema: { tags: tag, summary: 'Reset an operator’s password to a new temporary one (shown once)', params: idParam, response: { 200: platformOperatorResetOut }, security } },
    async (req) => ops.resetOperatorPassword(req.params.id, actorOfRequest(req)),
  );

  // ── schools ──
  app.post(
    '/platform/tenants/migrate-all',
    { config: cfg, schema: { tags: tag, summary: 'Update every school’s database to the newest structure (what pnpm site:migrate did)', response: { 200: platformMigrateOut }, security } },
    async (req) => tenants.migrateSchools(undefined, actorOfRequest(req)),
  );
  app.post(
    '/platform/tenants/:code/migrate',
    { config: cfg, schema: { tags: tag, summary: 'Update one school’s database to the newest structure', params: codeParam, response: { 200: platformMigrateOut }, security } },
    async (req) => tenants.migrateSchools(req.params.code, actorOfRequest(req)),
  );

  app.get('/platform/tenants/check-code', { config: cfg, schema: { tags: tag, summary: 'Is this site code valid and free?', querystring: platformCodeCheckQuery, response: { 200: platformCodeCheck }, security } }, async (req) => tenants.checkCode(req.query.code));

  app.get('/platform/tenants/:code', { config: cfg, schema: { tags: tag, summary: 'One school: profile, features, domains, subscription state, seats, subscription history', params: codeParam, response: { 200: platformTenantDetail }, security } }, async (req) => tenants.tenantDetail(req.params.code));

  app.patch(
    '/platform/tenants/:code',
    { config: cfg, schema: { tags: tag, summary: 'Update a school’s name, brand colour, time zone and feature switches', params: codeParam, body: platformTenantUpdateBody, response: { 200: platformTenantDetail }, security } },
    async (req) => tenants.updateTenant(req.params.code, req.body, actorOfRequest(req)),
  );

  app.get('/platform/tenants/:code/subscriptions', { config: cfg, schema: { tags: tag, summary: 'Subscription history of a school (newest first)', params: codeParam, response: { 200: platformSubscriptionList }, security } }, async (req) => ({ data: await tenants.listTenantSubscriptions(req.params.code) }));

  app.get('/platform/tenants/:code/usage', { config: cfg, schema: { tags: tag, summary: 'Daily usage snapshots (time series) of a school', params: codeParam, querystring: platformUsageQuery, response: { 200: platformUsageOut }, security } }, async (req) => tenants.tenantUsage(req.params.code, req.query.days));

  app.post('/platform/tenants/:code/usage/snapshot', { config: cfg, schema: { tags: tag, summary: 'Meter this school now', params: codeParam, response: { 200: platformUsageSnapshotOut }, security } }, async (req) => tenants.meterTenant(req.params.code, actorOfRequest(req)));

  app.get('/platform/tenants/:code/invoices', { config: cfg, schema: { tags: tag, summary: 'All invoices of a school (newest first)', params: codeParam, response: { 200: platformInvoiceDataList }, security } }, async (req) => ({ data: await invoices.tenantInvoices(req.params.code) }));

  // ── invoices + billing ──
  app.get('/platform/invoices', { config: cfg, schema: { tags: tag, summary: 'Invoices across all schools', querystring: platformInvoiceListQuery, response: { 200: platformInvoiceList }, security } }, async (req) => invoices.listInvoices(req.query));

  app.post(
    '/platform/invoices/:id/pay',
    { config: cfg, schema: { tags: tag, summary: 'Mark an issued invoice as paid (paid date + reference)', params: idParam, body: platformInvoicePayBody, response: { 200: platformInvoice }, security } },
    async (req) => invoices.markInvoicePaid(req.params.id, req.body, actorOfRequest(req)),
  );

  app.post(
    '/platform/invoices/:id/void',
    { config: cfg, schema: { tags: tag, summary: 'Void an unpaid invoice (reason required)', params: idParam, body: platformInvoiceVoidBody, response: { 200: platformInvoice }, security } },
    async (req) => invoices.voidInvoice(req.params.id, req.body.reason, actorOfRequest(req)),
  );

  app.get('/platform/billing/overview', { config: cfg, schema: { tags: tag, summary: 'Seats vs committed, true-up due and outstanding invoices across schools', response: { 200: platformBillingOverview }, security } }, async () => invoices.billingOverview());

  // ── audit ──
  app.get('/platform/audit', { config: cfg, schema: { tags: tag, summary: 'Platform audit log (newest first, keyset pagination)', querystring: platformAuditQuery, response: { 200: platformAuditList }, security } }, async (req) => invoices.listAudit(req.query));
};

export default consoleRoutes;
