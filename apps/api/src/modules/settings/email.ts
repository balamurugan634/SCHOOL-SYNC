import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  emailAccountCreateBody,
  emailAccountOut,
  emailAccountUpdateBody,
  emailAccountsOut,
  emailQueueBulkBody,
  emailQueueBulkOut,
  emailQueueClearBody,
  emailQueueClearOut,
  emailQueueDetail,
  emailQueueFlushOut,
  emailQueueListOut,
  emailQueueQuery,
  emailQueueSummaryOut,
  emailTestBody,
  emailTestOut,
  idParam,
  okSchema,
  type EmailQueueAction,
} from '@school-sync/shared';
import { actorOf } from '../../core/audit';
import { kickFlush } from '../../core/email';
import { pageArgs, paged as pagedResult } from '../../core/http';
import { requirePerm } from '../../plugins/guards';
import * as accounts from './email-accounts';
import * as queue from './email-queue';

/**
 * A school's outgoing email: its own mail accounts (like Frappe's Email Account) and the email queue (Email Queue).
 * Reading needs settings:view, changing anything needs settings:edit, both at school scope (school administrators).
 * The SMTP password is write-only: no route returns it and it never reaches the audit log.
 */
const routes: FastifyPluginAsyncZod = async (app) => {
  const tag = ['Email'];
  const ctxOf = (req: Parameters<typeof actorOf>[0] & { tenant: accounts.EmailCtx['tenant']; auth: accounts.EmailCtx['principal'] }): accounts.EmailCtx => ({ actor: actorOf(req), principal: req.auth, tenant: req.tenant });
  const view = [requirePerm('settings:view', 'school')];
  const edit = [requirePerm('settings:edit', 'school')];

  // ── accounts ──────────────────────────────────────────────────────────────────────────────────
  app.get('/settings/email/accounts', { preHandler: view, schema: { tags: tag, summary: 'The school’s email accounts plus the read-only SchoolSync default (platform) sender. Passwords are never returned (`passwordSet` only)', response: { 200: emailAccountsOut } } }, async (req) => accounts.listAccounts(req.db, req.tenant));

  app.post(
    '/settings/email/accounts',
    { preHandler: edit, schema: { tags: tag, summary: 'Add an email account (SMTP). The password is encrypted at rest and write-only. Ports 25/465/587/2525 only; private/loopback/metadata hosts are refused', body: emailAccountCreateBody, response: { 201: emailAccountOut } } },
    async (req, reply) => reply.status(201).send(await req.db.transaction((tx) => accounts.createAccount(tx, ctxOf(req), req.body))),
  );

  app.patch(
    '/settings/email/accounts/:id',
    { preHandler: edit, schema: { tags: tag, summary: 'Change an account (any subset). `smtpPassword` omitted = keep, "" = remove, text = replace. Switching the default account off hands the default back to the platform sender', params: idParam, body: emailAccountUpdateBody, response: { 200: emailAccountOut } } },
    async (req) => req.db.transaction((tx) => accounts.updateAccount(tx, ctxOf(req), req.params.id, req.body)),
  );

  app.delete('/settings/email/accounts/:id', { preHandler: edit, schema: { tags: tag, summary: 'Delete an account. Mail already queued for it goes out through the default sender', params: idParam, response: { 200: okSchema } } }, async (req) => {
    await req.db.transaction((tx) => accounts.deleteAccount(tx, ctxOf(req), req.params.id));
    return { ok: true as const };
  });

  app.post('/settings/email/accounts/:id/default', { preHandler: edit, schema: { tags: tag, summary: 'Make this the default outgoing account (the previous default is cleared in the same transaction; the account must be enabled)', params: idParam, response: { 200: emailAccountOut } } }, async (req) =>
    req.db.transaction((tx) => accounts.setDefaultAccount(tx, ctxOf(req), req.params.id)),
  );

  app.post('/settings/email/use-platform-default', { preHandler: edit, schema: { tags: tag, summary: 'Stop using a school account by default: mail goes through the SchoolSync default sender again', response: { 200: okSchema } } }, async (req) => {
    await req.db.transaction((tx) => accounts.usePlatformDefault(tx, ctxOf(req)));
    return { ok: true as const };
  });

  app.post(
    '/settings/email/accounts/:id/test',
    { preHandler: edit, schema: { tags: tag, summary: 'Send a test email through this account right now (to the signed-in admin, or a typed address). Answers 200 with { ok, error }: the error is plain-language and sanitised. 5 per hour per school (429 beyond that), 10 s connect/greeting timeouts', params: idParam, body: emailTestBody, response: { 200: emailTestOut } } },
    async (req) => accounts.testAccount(req.db, ctxOf(req), req.params.id, req.body.to),
  );

  app.post(
    '/settings/email/platform/test',
    { preHandler: edit, schema: { tags: tag, summary: 'Send a test email through the SchoolSync default sender to the signed-in admin’s own address', response: { 200: emailTestOut } } },
    async (req) => accounts.testAccount(req.db, ctxOf(req), null),
  );

  // ── queue ─────────────────────────────────────────────────────────────────────────────────────
  app.get('/settings/email/queue/summary', { preHandler: view, schema: { tags: tag, summary: 'Counts per status, next due time and retention', response: { 200: emailQueueSummaryOut } } }, async (req) => queue.queueSummary(req.db));

  app.get('/settings/email/queue', { preHandler: view, schema: { tags: tag, summary: 'The email queue, newest first (filter by status, account, date range, search in recipients / subject)', querystring: emailQueueQuery, response: { 200: emailQueueListOut } } }, async (req) => {
    const { page, pageSize, q, status, accountId, from, to } = req.query;
    const { data, total } = await queue.listQueue(req.db, req.tenant, { q, status, accountId, from, to }, pageArgs({ page, pageSize }));
    return pagedResult(data, total, { page, pageSize });
  });

  app.get('/settings/email/queue/:id', { preHandler: view, schema: { tags: tag, summary: 'One queued email with its error and a body preview (one-time messages such as password resets show no body)', params: idParam, response: { 200: emailQueueDetail } } }, async (req) => queue.getQueueItem(req.db, req.params.id));

  const single = (action: EmailQueueAction, summary: string) =>
    app.post(`/settings/email/queue/:id/${action.replace('_', '-')}`, { preHandler: edit, schema: { tags: tag, summary, params: idParam, response: { 200: emailQueueDetail } } }, async (req) => {
      const affected = await req.db.transaction((tx) => queue.applySingleAction(tx, ctxOf(req), action, req.params.id));
      queue.kickAfter(req.tenant, action, affected);
      return queue.getQueueItem(req.db, req.params.id);
    });
  single('send_now', 'Send this email as soon as the worker can (Not Sent or Error; the retry wait is skipped). It still goes out one message at a time');
  single('retry', 'Put a failed or cancelled email back in the queue with fresh attempts');
  single('cancel', 'Cancel an email that has not been sent yet');

  app.delete('/settings/email/queue/:id', { preHandler: edit, schema: { tags: tag, summary: 'Delete a queue entry (not while it is being sent)', params: idParam, response: { 200: okSchema } } }, async (req) => {
    await req.db.transaction((tx) => queue.applySingleAction(tx, ctxOf(req), 'delete', req.params.id));
    return { ok: true as const };
  });

  app.post('/settings/email/queue/bulk', { preHandler: edit, schema: { tags: tag, summary: 'Apply send_now / retry / cancel / delete to up to 200 entries; entries in a state the action does not apply to are skipped', body: emailQueueBulkBody, response: { 200: emailQueueBulkOut } } }, async (req) => {
    const r = await req.db.transaction((tx) => queue.applyQueueAction(tx, ctxOf(req), req.body.action, req.body.ids));
    queue.kickAfter(req.tenant, req.body.action, r.affected);
    return { affected: r.affected.length, skipped: r.skipped };
  });

  app.post('/settings/email/queue/flush', { preHandler: edit, schema: { tags: tag, summary: 'Flush now: make every waiting email due and start the worker (non-blocking; sending stays one message at a time)', response: { 200: emailQueueFlushOut } } }, async (req) => {
    const due = await req.db.transaction((tx) => queue.flushQueue(tx, ctxOf(req)));
    kickFlush(req.tenant);
    return { ok: true as const, due };
  });

  app.post('/settings/email/queue/clear', { preHandler: edit, schema: { tags: tag, summary: 'Delete finished entries (sent / error / cancelled) older than N days (0 = all of them)', body: emailQueueClearBody, response: { 200: emailQueueClearOut } } }, async (req) => ({
    deleted: await req.db.transaction((tx) => queue.clearFinished(tx, ctxOf(req), req.body)),
  }));
};

export default routes;
