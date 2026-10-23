import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  concessionCreateBody,
  concessionDecisionBody,
  concessionListQuery,
  concessionOut,
  feeCategoryCreateBody,
  feeCategoryOut,
  feeCategoryUpdateBody,
  generateDuesBody,
  generateDuesOut,
  idParam,
  invoiceCreateBody,
  invoiceDetailOut,
  invoiceListQuery,
  invoiceOut,
  invoiceVoidBody,
  okSchema,
  paged,
  payOnlineBody,
  payOnlineOut,
  planBulkBody,
  planBulkOut,
  planCreateBody,
  planListQuery,
  planOut,
  structureCreateBody,
  structureItemIn,
  structureListQuery,
  structureOut,
  structureUpdateBody,
  uuid,
} from '@school-sync/shared';
import { actorOf } from '../../core/audit';
import { requirePerm } from '../../plugins/guards';
import * as payments from './payments';
import * as svc from './service';

const itemParam = z.object({ id: uuid, itemId: uuid });
const idemHeader = z.object({ 'idempotency-key': z.string().trim().min(8).max(100).optional() });
const T = ['Fees'];

const routes: FastifyPluginAsyncZod = async (app) => {
  // ── categories ────────────────────────────────────────────────────────────────────────────
  app.get('/fees/categories', { preHandler: [requirePerm('fees:view', 'school')], schema: { tags: T, summary: 'Fee categories (tuition, transport, lab ...)', response: { 200: z.object({ data: z.array(feeCategoryOut) }) } } }, async (req) => ({ data: await svc.listCategories(req.db) }));
  app.post('/fees/categories', { preHandler: [requirePerm('fees:create', 'school')], schema: { tags: T, summary: 'Create a fee category', body: feeCategoryCreateBody, response: { 201: feeCategoryOut } } }, async (req, reply) => reply.status(201).send(await req.db.transaction((tx) => svc.createCategory(tx, actorOf(req), req.body))));
  app.patch('/fees/categories/:id', { preHandler: [requirePerm('fees:edit', 'school')], schema: { tags: T, summary: 'Rename or (de)activate a fee category', params: idParam, body: feeCategoryUpdateBody, response: { 200: feeCategoryOut } } }, async (req) => req.db.transaction((tx) => svc.updateCategory(tx, actorOf(req), req.params.id, req.body)));

  // ── structures ────────────────────────────────────────────────────────────────────────────
  app.get('/fees/structures', { preHandler: [requirePerm('fees:view', 'school')], schema: { tags: T, summary: 'Fee structures (per academic year, per grade or all grades) with their instalment items', querystring: structureListQuery, response: { 200: paged(structureOut) } } }, async (req) => svc.listStructures(req.db, req.query));
  app.post('/fees/structures', { preHandler: [requirePerm('fees:create', 'school')], schema: { tags: T, summary: 'Create a fee structure with instalment-level items (each with a due date)', body: structureCreateBody, response: { 201: structureOut } } }, async (req, reply) => reply.status(201).send(await req.db.transaction((tx) => svc.createStructure(tx, actorOf(req), req.body))));
  app.get('/fees/structures/:id', { preHandler: [requirePerm('fees:view', 'school')], schema: { tags: T, summary: 'One fee structure', params: idParam, response: { 200: structureOut } } }, async (req) => svc.getStructure(req.db, req.params.id));
  app.patch('/fees/structures/:id', { preHandler: [requirePerm('fees:edit', 'school')], schema: { tags: T, summary: 'Rename or (de)activate a structure', params: idParam, body: structureUpdateBody, response: { 200: structureOut } } }, async (req) => req.db.transaction((tx) => svc.updateStructure(tx, actorOf(req), req.params.id, req.body)));
  app.post('/fees/structures/:id/items', { preHandler: [requirePerm('fees:edit', 'school')], schema: { tags: T, summary: 'Add an instalment item', params: idParam, body: structureItemIn, response: { 201: structureOut } } }, async (req, reply) => reply.status(201).send(await req.db.transaction((tx) => svc.addStructureItem(tx, actorOf(req), req.params.id, req.body))));
  app.patch('/fees/structures/:id/items/:itemId', { preHandler: [requirePerm('fees:edit', 'school')], schema: { tags: T, summary: 'Edit an item (amount/due date/category are locked once invoices were generated from it)', params: itemParam, body: structureItemIn.partial(), response: { 200: structureOut } } }, async (req) => req.db.transaction((tx) => svc.updateStructureItem(tx, actorOf(req), req.params.id, req.params.itemId, req.body)));
  app.delete('/fees/structures/:id/items/:itemId', { preHandler: [requirePerm('fees:edit', 'school')], schema: { tags: T, summary: 'Remove an item that has not been billed', params: itemParam, response: { 200: structureOut } } }, async (req) => req.db.transaction((tx) => svc.deleteStructureItem(tx, actorOf(req), req.params.id, req.params.itemId)));

  // ── plans & dues ──────────────────────────────────────────────────────────────────────────
  app.get('/fees/plans', { preHandler: [requirePerm('fees:view', 'school')], schema: { tags: T, summary: 'Student fee plans', querystring: planListQuery, response: { 200: paged(planOut) } } }, async (req) => svc.listPlans(req.db, req.query));
  app.post('/fees/plans', { preHandler: [requirePerm('fees:create', 'school')], schema: { tags: T, summary: 'Assign a fee structure to one student (one plan per student per academic year)', body: planCreateBody, response: { 201: planOut } } }, async (req, reply) => reply.status(201).send(await req.db.transaction((tx) => svc.createPlan(tx, actorOf(req), req.body))));
  app.post('/fees/plans/bulk', { preHandler: [requirePerm('fees:create', 'school')], schema: { tags: T, summary: 'Assign a structure to every active student of a grade / section / list (skips students who already have a plan)', body: planBulkBody, response: { 200: planBulkOut } } }, async (req) => req.db.transaction((tx) => svc.bulkAssignPlans(tx, actorOf(req), req.body)));
  app.delete('/fees/plans/:id', { preHandler: [requirePerm('fees:edit', 'school')], schema: { tags: T, summary: 'Remove a plan that has no live invoices', params: idParam, response: { 200: okSchema } } }, async (req) => {
    await req.db.transaction((tx) => svc.deletePlan(tx, actorOf(req), req.params.id));
    return { ok: true as const };
  });
  app.post('/fees/dues/generate', { preHandler: [requirePerm('fees:create', 'school')], schema: { tags: T, summary: 'Generate invoices from plans, grouped by due date. Idempotent (never duplicates a plan + due date); applies only APPROVED concessions', body: generateDuesBody, response: { 200: generateDuesOut } } }, async (req) =>
    req.db.transaction((tx) => svc.generateDues(tx, actorOf(req), req.body)),
  );

  // ── concessions / scholarships ────────────────────────────────────────────────────────────
  app.get('/fees/concessions', { preHandler: [requirePerm('fees:view')], schema: { tags: T, summary: 'Concessions in my scope (parents: their children)', querystring: concessionListQuery, response: { 200: paged(concessionOut) } } }, async (req) => svc.listConcessions(req.db, req.auth, req.query));
  app.post('/fees/concessions', { preHandler: [requirePerm('fees:create', 'school')], schema: { tags: T, summary: 'Request a concession / scholarship (percent in basis points, or a fixed yearly amount); needs approval before it affects dues', body: concessionCreateBody, response: { 201: concessionOut } } }, async (req, reply) => reply.status(201).send(await req.db.transaction((tx) => svc.requestConcession(tx, actorOf(req), req.body))));
  app.post('/fees/concessions/:id/approve', { preHandler: [requirePerm('fees:approve', 'school')], schema: { tags: T, summary: 'Approve a concession (applies to dues generated from now on)', params: idParam, body: concessionDecisionBody, response: { 200: concessionOut } } }, async (req) => req.db.transaction((tx) => svc.decideConcession(tx, actorOf(req), req.params.id, 'approved', req.body.note)));
  app.post('/fees/concessions/:id/reject', { preHandler: [requirePerm('fees:approve', 'school')], schema: { tags: T, summary: 'Reject a concession', params: idParam, body: concessionDecisionBody, response: { 200: concessionOut } } }, async (req) => req.db.transaction((tx) => svc.decideConcession(tx, actorOf(req), req.params.id, 'rejected', req.body.note)));

  // ── invoices ──────────────────────────────────────────────────────────────────────────────
  app.get('/fees/invoices', { preHandler: [requirePerm('fees:view')], schema: { tags: T, summary: 'Invoices in my scope (accounts/principal: all; parent: linked children; student: own) with derived balance, overdue flag and late fee', querystring: invoiceListQuery, response: { 200: paged(invoiceOut) } } }, async (req) => svc.listInvoices(req.db, req.auth, req.tenant, req.query));
  app.post('/fees/invoices', { preHandler: [requirePerm('fees:create', 'school')], schema: { tags: T, summary: 'Create a one-off invoice for a student', body: invoiceCreateBody, response: { 201: invoiceDetailOut } } }, async (req, reply) => reply.status(201).send(await req.db.transaction((tx) => svc.createInvoice(tx, req.tenant, req.auth, actorOf(req), req.body))));
  app.get('/fees/invoices/:id', { preHandler: [requirePerm('fees:view')], schema: { tags: T, summary: 'Invoice with items, payments and refunds (404 outside my scope)', params: idParam, response: { 200: invoiceDetailOut } } }, async (req) => svc.getInvoiceDetail(req.db, req.auth, req.tenant, req.params.id));
  app.post('/fees/invoices/:id/void', { preHandler: [requirePerm('fees:approve', 'school')], schema: { tags: T, summary: 'Void an invoice that has no payments (refund them first)', params: idParam, body: invoiceVoidBody, response: { 200: invoiceDetailOut } } }, async (req) => req.db.transaction((tx) => svc.voidInvoice(tx, req.tenant, req.auth, actorOf(req), req.params.id, req.body.reason)));
  app.post('/fees/invoices/:id/pay', { preHandler: [requirePerm('payments:create', 'linked')], schema: { tags: T, summary: 'Start an ONLINE payment for a linked child’s invoice (needs features.onlinePayments + setting fees.parentsCanPayOnline). Returns the gateway order; the invoice is only marked paid when the signed webhook arrives', params: idParam, headers: idemHeader, body: payOnlineBody, response: { 200: payOnlineOut } } }, async (req) => {
    const key = req.headers['idempotency-key'];
    return payments.startOnlinePayment(req.db, req.tenant, req.auth, actorOf(req), req.params.id, req.body.amountMinor, typeof key === 'string' ? key : undefined);
  });
};

export default routes;
