import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { guardianCreateBody, guardianCreateOut, guardianListOut, guardianListQuery, guardianLoginOut, guardianOut, guardianUpdateBody, idParam, okSchema } from '@school-sync/shared';
import { requirePerm } from '../../plugins/guards';
import { prepareCredential } from './accounts';
import { createGuardianLogin, createGuardianRecord, deleteGuardian, getGuardian, guardianCreateInput, listGuardians, updateGuardian } from './guardians';
import { ctxOf, metaOf } from './http';
import { refreshPrincipals } from './util';

const routes: FastifyPluginAsyncZod = async (app) => {
  const tag = ['Guardians'];

  app.get('/guardians', { preHandler: [requirePerm('guardians:view')], schema: { tags: tag, summary: 'Parents / guardians (teachers see those of children in their assigned sections)', querystring: guardianListQuery, response: { 200: guardianListOut } } }, async (req) => {
    const { rows, total } = await listGuardians(req.db, ctxOf(req), req.query);
    return { data: rows, meta: metaOf(req.query, total) };
  });

  app.get('/guardians/:id', { preHandler: [requirePerm('guardians:view')], schema: { tags: tag, summary: 'One parent with their children and link status (404 outside my scope)', params: idParam, response: { 200: guardianOut } } }, async (req) => getGuardian(req.db, ctxOf(req), req.params.id));

  app.post(
    '/guardians',
    { preHandler: [requirePerm('guardians:create', 'school')], schema: { tags: tag, summary: 'Register a parent; with createLogin the parent login (username = phone or email) is created with a temporary password shown once', body: guardianCreateBody, response: { 201: guardianCreateOut } } },
    async (req, reply) => {
      const ctx = ctxOf(req);
      const cred = req.body.createLogin ? await prepareCredential() : undefined;
      const r = await req.db.transaction((tx) => createGuardianRecord(tx, ctx, guardianCreateInput(req.body), cred));
      return reply.status(201).send({ ...(await getGuardian(req.db, ctx, r.id)), credentials: r.credential });
    },
  );

  app.patch('/guardians/:id', { preHandler: [requirePerm('guardians:edit', 'school')], schema: { tags: tag, summary: 'Edit a parent’s details (the login’s phone / email follow)', params: idParam, body: guardianUpdateBody, response: { 200: guardianOut } } }, async (req) => {
    const ctx = ctxOf(req);
    const userId = await req.db.transaction((tx) => updateGuardian(tx, ctx, req.params.id, req.body));
    refreshPrincipals(req.tenant.id, [userId]);
    return getGuardian(req.db, ctx, req.params.id);
  });

  app.delete('/guardians/:id', { preHandler: [requirePerm('guardians:delete', 'school')], schema: { tags: tag, summary: 'Remove a parent who has no linked students (their login is deactivated)', params: idParam, response: { 200: okSchema } } }, async (req) => {
    await req.db.transaction((tx) => deleteGuardian(tx, ctxOf(req), req.params.id));
    return { ok: true as const };
  });

  app.post(
    '/guardians/:id/login',
    { preHandler: [requirePerm('guardians:edit', 'school')], schema: { tags: tag, summary: 'Create the parent login for a parent who has none (temporary password shown once)', params: idParam, response: { 200: guardianLoginOut } } },
    async (req) => {
      const cred = await prepareCredential();
      return req.db.transaction((tx) => createGuardianLogin(tx, ctxOf(req), req.params.id, cred));
    },
  );
};

export default routes;
