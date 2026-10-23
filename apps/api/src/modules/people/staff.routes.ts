import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { idParam, staffCreateBody, staffCreateOut, staffDeactivateBody, staffDetailOut, staffListOut, staffListQuery, staffRolesBody, staffUpdateBody, staffWorkloadOut, userRolesOut } from '@school-sync/shared';
import { notify } from '../../core/notify';
import { requirePerm } from '../../plugins/guards';
import { replaceUserRoles, userRoleKeys } from '../settings/roles';
import { prepareCredential } from './accounts';
import { ctxOf, metaOf } from './http';
import { createStaff, deactivateStaff, getStaffDetail, listStaff, reactivateStaff, staffUserId, staffWorkload, updateStaff } from './staff';
import { refreshPrincipals } from './util';

const routes: FastifyPluginAsyncZod = async (app) => {
  const tag = ['Staff'];

  app.get('/staff', { preHandler: [requirePerm('staff:view')], schema: { tags: tag, summary: 'Staff directory (school-wide for HR / admin; a teacher sees only their own record)', querystring: staffListQuery, response: { 200: staffListOut } } }, async (req) => {
    const { rows, total } = await listStaff(req.db, ctxOf(req), req.query);
    return { data: rows, meta: metaOf(req.query, total) };
  });

  app.get('/staff/:id', { preHandler: [requirePerm('staff:view')], schema: { tags: tag, summary: 'One staff member with login status and roles', params: idParam, response: { 200: staffDetailOut } } }, async (req) => getStaffDetail(req.db, ctxOf(req), req.params.id));

  app.get('/staff/:id/workload', { preHandler: [requirePerm('staff:view')], schema: { tags: tag, summary: 'Sections led, subjects taught and periods per week (current year), from the teaching assignments', params: idParam, response: { 200: staffWorkloadOut } } }, async (req) => staffWorkload(req.db, ctxOf(req), req.params.id));

  app.post(
    '/staff',
    { preHandler: [requirePerm('staff:create', 'school')], schema: { tags: tag, summary: 'Add a teacher or non-teaching staff member: employee id, login (temporary password shown once), roles (teacher is automatic for teaching staff; others need roles:edit)', body: staffCreateBody, response: { 201: staffCreateOut } } },
    async (req, reply) => {
      const ctx = ctxOf(req);
      const cred = req.body.createLogin ? await prepareCredential() : undefined;
      const r = await req.db.transaction((tx) => createStaff(tx, ctx, req.body, cred));
      return reply.status(201).send({ ...(await getStaffDetail(req.db, ctx, r.id)), credentials: r.credential });
    },
  );

  app.patch('/staff/:id', { preHandler: [requirePerm('staff:edit', 'school')], schema: { tags: tag, summary: 'Edit a staff member (the login’s name / phone / email follow)', params: idParam, body: staffUpdateBody, response: { 200: staffDetailOut } } }, async (req) => {
    const ctx = ctxOf(req);
    await req.db.transaction((tx) => updateStaff(tx, ctx, req.params.id, req.body));
    return getStaffDetail(req.db, ctx, req.params.id);
  });

  app.post(
    '/staff/:id/deactivate',
    { preHandler: [requirePerm('staff:delete', 'school')], schema: { tags: tag, summary: 'Deactivate (resigned / terminated): login off, sessions revoked. Refused while they still lead sections or teach subjects, unless releaseAssignments is set', params: idParam, body: staffDeactivateBody, response: { 200: staffDetailOut } } },
    async (req) => {
      const ctx = ctxOf(req);
      const r = await req.db.transaction((tx) => deactivateStaff(tx, ctx, req.params.id, req.body));
      refreshPrincipals(req.tenant.id, r.userIds);
      return getStaffDetail(req.db, ctx, req.params.id);
    },
  );

  app.post('/staff/:id/reactivate', { preHandler: [requirePerm('staff:edit', 'school')], schema: { tags: tag, summary: 'Reactivate a deactivated staff member and their login', params: idParam, response: { 200: staffDetailOut } } }, async (req) => {
    const ctx = ctxOf(req);
    const r = await req.db.transaction((tx) => reactivateStaff(tx, ctx, req.params.id));
    refreshPrincipals(req.tenant.id, r.userIds);
    return getStaffDetail(req.db, ctx, req.params.id);
  });

  app.put(
    '/staff/:id/roles',
    { preHandler: [requirePerm('staff:edit', 'school')], schema: { tags: tag, summary: 'Replace the roles of a staff member’s login (needs roles:edit; bumps the auth version so their tokens refresh)', params: idParam, body: staffRolesBody, response: { 200: userRolesOut } } },
    async (req) => {
      const ctx = ctxOf(req);
      const userId = await staffUserId(req.db, ctx, req.params.id);
      const r = await req.db.transaction((tx) => replaceUserRoles(tx, { actor: ctx.actor, principal: ctx.principal, tenantId: req.tenant.id }, userId, req.body.roleIds));
      refreshPrincipals(req.tenant.id, [userId]);
      if (r.changed) await notify(req.db, req.tenant, { userIds: [userId], type: 'system.access_changed', title: 'Your access was updated', body: 'The school changed what you can do in the app.', data: { route: '/profile' } });
      return { userId, roles: await userRoleKeys(req.db, userId), changed: r.changed };
    },
  );
};

export default routes;
