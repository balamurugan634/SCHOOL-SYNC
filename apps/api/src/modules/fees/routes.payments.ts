import type { FastifyPluginAsyncZod, ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  idParam,
  paged,
  paymentCreateBody,
  paymentListQuery,
  paymentOut,
  receiptOut,
  refundApproveBody,
  refundCreateBody,
  refundListQuery,
  refundOut,
  refundProcessBody,
  refundRejectBody,
  uuid,
  webhookOut,
  webhookProviderParam,
} from '@school-sync/shared';
import { actorOf } from '../../core/audit';
import { AppError } from '../../core/errors';
import { isProd } from '../../config';
import { requirePerm } from '../../plugins/guards';
import { toCsv } from '../exams/common';
import * as svc from './payments';

const T = ['Payments'];
const idemHeader = z.object({ 'idempotency-key': z.string().trim().min(8).max(100).optional() });
const refundParam = z.object({ id: uuid });

const routes: FastifyPluginAsyncZod = async (app) => {
  const afterCommit = (req: { log: { error: (o: unknown, m?: string) => void } }, fn: () => Promise<void>) => fn().catch((err) => req.log.error({ err }, 'post-commit notification failed'));

  // ── list / detail ─────────────────────────────────────────────────────────────────────────
  app.get('/payments', { preHandler: [requirePerm('payments:view')], schema: { tags: T, summary: 'Payments in my scope — payment history (parents: their children; accounts: all)', querystring: paymentListQuery, response: { 200: paged(paymentOut) } } }, async (req) => svc.listPayments(req.db, req.auth, req.tenant, req.query));

  app.post('/payments', { preHandler: [requirePerm('payments:create', 'school')], schema: { tags: T, summary: 'Record an offline payment (cash/cheque/bank/UPI/card). Send an Idempotency-Key header so a retry never records it twice (replays answer 200 with the original payment, new payments 201)', headers: idemHeader, body: paymentCreateBody, response: { 200: paymentOut, 201: paymentOut } } }, async (req, reply) => {
    const key = req.headers['idempotency-key'];
    const r = await req.db.transaction((tx) => svc.recordPayment(tx, req.tenant, actorOf(req), { ...req.body, idempotencyKey: typeof key === 'string' ? key : undefined }));
    if (r.replay) void reply.header('Idempotent-Replayed', 'true');
    return reply.status(r.replay ? 200 : 201).send(r.payment);
  });

  app.get('/payments/export', { preHandler: [requirePerm('payments:export', 'school')], schema: { tags: T, summary: 'CSV export of payments (same filters as the list, up to 5000 rows)', querystring: paymentListQuery.omit({ page: true, pageSize: true }), response: { 200: z.string().meta({ description: 'text/csv' }) } } }, async (req, reply) => {
    const r = await svc.listPayments(req.db, req.auth, req.tenant, { ...req.query, page: 1, pageSize: 100 });
    // page through up to 5000 rows
    const rows = [...r.data];
    for (let page = 2; page <= Math.min(r.meta.totalPages, 50); page++) rows.push(...(await svc.listPayments(req.db, req.auth, req.tenant, { ...req.query, page, pageSize: 100 })).data);
    const csv = toCsv(
      ['Receipt no', 'Date', 'Invoice', 'Student', 'Method', 'Reference', 'Amount (minor)', 'Refunded (minor)', 'Status', 'Received by'],
      rows.map((p) => [p.receiptNo, p.paidAt?.slice(0, 10), p.invoiceNo, p.studentName, p.method, p.reference, p.amountMinor, p.refundedMinor, p.status, p.receivedByName]),
    );
    return reply.type('text/csv; charset=utf-8').header('Content-Disposition', 'attachment; filename="payments.csv"').send(csv);
  });

  // ── refunds (static paths first) ──────────────────────────────────────────────────────────
  app.get('/payments/refunds', { preHandler: [requirePerm('payments:view', 'school')], schema: { tags: T, summary: 'Refund requests', querystring: refundListQuery, response: { 200: paged(refundOut) } } }, async (req) => svc.listRefunds(req.db, req.query));
  app.post('/payments/refunds/:id/approve', { preHandler: [requirePerm('payments:approve', 'school')], schema: { tags: T, summary: 'Approve a refund request and (by default) process it: payment and invoice are adjusted in one transaction. Online payments are returned through the gateway first', params: refundParam, body: refundApproveBody, response: { 200: refundOut } } }, async (req) => {
    let reference = req.body.reference ?? null;
    if (req.body.process) {
      const gw = await svc.refundGatewayInfo(req.db, req.params.id);
      if (gw?.gateway.refund) {
        try {
          reference = (await gw.gateway.refund({ gatewayPaymentId: gw.gatewayPaymentId, amountMinor: gw.amountMinor, notes: { refund: req.params.id } })).id;
        } catch (err) {
          throw new AppError(502, 'GATEWAY_ERROR', 'The payment gateway could not refund this payment', { detail: err instanceof Error ? err.message.slice(0, 200) : undefined });
        }
      }
    }
    return req.db.transaction((tx) => svc.approveRefund(tx, actorOf(req), req.params.id, { note: req.body.note, reference, process: req.body.process }));
  });
  app.post('/payments/refunds/:id/reject', { preHandler: [requirePerm('payments:approve', 'school')], schema: { tags: T, summary: 'Reject a refund request', params: refundParam, body: refundRejectBody, response: { 200: refundOut } } }, async (req) => req.db.transaction((tx) => svc.rejectRefund(tx, actorOf(req), req.params.id, req.body.note)));
  app.post('/payments/refunds/:id/process', { preHandler: [requirePerm('payments:approve', 'school')], schema: { tags: T, summary: 'Process a previously approved refund (adjusts payment + invoice)', params: refundParam, body: refundProcessBody, response: { 200: refundOut } } }, async (req) => req.db.transaction((tx) => svc.processRefund(tx, actorOf(req), req.params.id, req.body.reference)));

  app.get('/payments/:id', { preHandler: [requirePerm('payments:view')], schema: { tags: T, summary: 'One payment (404 outside my scope). Poll this after starting an online payment', params: idParam, response: { 200: paymentOut } } }, async (req) => svc.getPayment(req.db, req.auth, req.params.id));
  app.get('/payments/:id/receipt', { preHandler: [requirePerm('payments:view')], schema: { tags: T, summary: 'Receipt data (JSON)', params: idParam, response: { 200: receiptOut } } }, async (req) => svc.getReceipt(req.db, req.auth, req.tenant, req.params.id));
  app.get('/payments/:id/receipt/pdf', { preHandler: [requirePerm('payments:view')], schema: { tags: T, summary: 'Receipt as a PDF', params: idParam, response: { 200: z.string().meta({ format: 'binary', description: 'application/pdf' }) } } }, async (req, reply) => {
    const rc = await svc.getReceipt(req.db, req.auth, req.tenant, req.params.id);
    const pdf = await svc.receiptPdf(rc);
    return reply.type('application/pdf').header('Content-Disposition', `inline; filename="${rc.receiptNo}.pdf"`).send(pdf as unknown as string);
  });
  app.post('/payments/:id/refunds', { preHandler: [requirePerm('payments:create', 'school')], schema: { tags: T, summary: 'Request a refund (full or partial) of a payment; needs payments:approve to take effect', params: idParam, body: refundCreateBody, response: { 201: refundOut } } }, async (req, reply) => {
    const out = await req.db.transaction((tx) => svc.requestRefund(tx, actorOf(req), req.params.id, req.body));
    await afterCommit(req, () => svc.notifyRefundRequested(req.db, req.tenant, out.id, req.auth.userId));
    return reply.status(201).send(out);
  });

  // ── online payments ───────────────────────────────────────────────────────────────────────
  app.post('/payments/:id/sync', { preHandler: [requirePerm('payments:view')], schema: { tags: T, summary: 'Ask the gateway (server to server) for the outcome of a pending online payment — use when the webhook is late. The client redirect is never trusted', params: idParam, response: { 200: paymentOut } } }, async (req) => svc.syncOnlinePayment(req.db, req.tenant, req.auth, req.params.id));

  if (!isProd) {
    app.post('/payments/:id/mock-complete', { preHandler: [requirePerm('payments:create', 'linked')], schema: { tags: T, summary: 'DEV ONLY (mock gateway, absent in production): simulate the payer completing checkout; runs through the real webhook path', params: idParam, response: { 200: paymentOut } } }, async (req) => svc.mockComplete(req.db, req.tenant, req.auth, req.params.id));
  }

  // The webhook is public (no bearer token) and needs the RAW body to verify the signature, so it lives in its own
  // encapsulated scope with a buffer parser. It is signature-verified before anything else happens.
  await app.register(async (scope) => {
    const wh = scope.withTypeProvider<ZodTypeProvider>();
    wh.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
    wh.post(
      '/payments/webhook/:provider',
      {
        config: { noTenant: true },
        schema: { tags: T, summary: 'Payment-gateway webhook (public; HMAC-signature verified over the raw body; idempotent). Resolves the school from X-Tenant, else the order metadata, else the Host. Responds 200 for any validly signed event. NOTE: the Razorpay adapter is untested against the live Razorpay API', params: webhookProviderParam, response: { 200: webhookOut } },
      },
      async (req) => {
        const raw = req.body as Buffer;
        const r = await svc.handleWebhook({ provider: req.params.provider, rawBody: Buffer.isBuffer(raw) ? raw : Buffer.from(JSON.stringify(raw ?? {})), headers: req.headers, host: req.headers.host });
        return { ok: true as const, result: r.result };
      },
    );
  });
};

export default routes;
