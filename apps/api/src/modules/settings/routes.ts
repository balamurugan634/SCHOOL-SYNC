import { Readable } from 'node:stream';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  auditDetailOut,
  auditExportQuery,
  auditListOut,
  auditQuery,
  brandingOut,
  brandingUpdateBody,
  featuresOut,
  featuresUpdateBody,
  forceLogoutOut,
  idParam,
  okSchema,
  passwordResetOut,
  permissionCatalogOut,
  roleCreateBody,
  roleDetailOut,
  roleGrantsBody,
  roleOut,
  roleUpdateBody,
  setupStatusOut,
  settingsAllOut,
  settingsGroupBody,
  settingsGroupOut,
  settingsGroupParam,
  userCreateBody,
  userCreateOut,
  userDetailOut,
  userListOut,
  userListQuery,
  userRoleAddBody,
  userRolesBody,
  userRolesOut,
  userSessionsOut,
  uuid,
} from '@school-sync/shared';
import { actorOf, audit } from '../../core/audit';
import { revokeSession } from '../../core/auth/service';
import { forbidden, notFound } from '../../core/errors';
import { pageArgs, paged as pagedResult, todayIn } from '../../core/http';
import { notify } from '../../core/notify';
import { invalidatePrincipal } from '../../core/rbac/principal';
import { requirePerm } from '../../plugins/guards';
import { prepareCredential } from '../people/accounts';
import { auditCsv, getAuditEntry, listAudit } from './audit';
import * as roleSvc from './roles';
import { getAllSettings, getBranding, getFeatures, getGroup, requireGroup, updateBranding, updateFeatures, updateGroup } from './school';
import emailRoutes from './email';
import { setupStatus } from './setup';
import * as userSvc from './users';

const routes: FastifyPluginAsyncZod = async (app) => {
  const tag = (t: string) => [t];
  const ctxOf = (req: Parameters<typeof actorOf>[0]) => ({ actor: actorOf(req), principal: req.auth, tenantId: req.tenant.id });

  // ── permission catalog ─────────────────────────────────────────────────────────────────────────
  app.get(
    '/permissions/catalog',
    { preHandler: [requirePerm('roles:view')], schema: { tags: tag('Roles'), summary: 'Every resource/action, grouped by module, plus the factory role presets (for the role editor)', response: { 200: permissionCatalogOut } } },
    async () => roleSvc.buildPermissionCatalog(),
  );

  // ── roles ──────────────────────────────────────────────────────────────────────────────────────
  app.get('/roles', { preHandler: [requirePerm('roles:view')], schema: { tags: tag('Roles'), summary: 'All roles with user and permission counts', response: { 200: z.object({ data: z.array(roleOut) }) } } }, async (req) => ({ data: await roleSvc.listRoles(req.db) }));

  app.get('/roles/:id', { preHandler: [requirePerm('roles:view')], schema: { tags: tag('Roles'), summary: 'A role with its grants as { permission: scope }', params: idParam, response: { 200: roleDetailOut } } }, async (req) => roleSvc.getRoleDetail(req.db, req.params.id));

  app.post(
    '/roles',
    { preHandler: [requirePerm('roles:create')], schema: { tags: tag('Roles'), summary: 'Create a custom role (optionally cloned from another role)', body: roleCreateBody, response: { 201: roleDetailOut } } },
    async (req, reply) => {
      const id = await req.db.transaction((tx) => roleSvc.createRole(tx, ctxOf(req), req.body));
      return reply.status(201).send(await roleSvc.getRoleDetail(req.db, id));
    },
  );

  app.patch(
    '/roles/:id',
    { preHandler: [requirePerm('roles:edit')], schema: { tags: tag('Roles'), summary: 'Rename a role / change its description (the key never changes)', params: idParam, body: roleUpdateBody, response: { 200: roleDetailOut } } },
    async (req) => {
      await req.db.transaction((tx) => roleSvc.updateRole(tx, ctxOf(req), req.params.id, req.body));
      return roleSvc.getRoleDetail(req.db, req.params.id);
    },
  );

  app.put(
    '/roles/:id/permissions',
    {
      preHandler: [requirePerm('roles:edit')],
      schema: {
        tags: tag('Roles'),
        summary: 'Change a role’s grants with a partial { permission: scope | null } map (null removes). Holders’ tokens go stale and refresh; every cached principal is dropped',
        params: idParam,
        body: roleGrantsBody,
        response: { 200: roleDetailOut },
      },
    },
    async (req) => {
      const { changed } = await req.db.transaction((tx) => roleSvc.setRoleGrants(tx, ctxOf(req), req.params.id, req.body.grants));
      if (changed) invalidatePrincipal(req.tenant.id);
      return roleSvc.getRoleDetail(req.db, req.params.id);
    },
  );

  app.delete('/roles/:id', { preHandler: [requirePerm('roles:delete')], schema: { tags: tag('Roles'), summary: 'Delete a custom role that nobody holds (system roles cannot be deleted)', params: idParam, response: { 200: okSchema } } }, async (req) => {
    await req.db.transaction((tx) => roleSvc.deleteRole(tx, ctxOf(req), req.params.id));
    return { ok: true as const };
  });

  // ── users ──────────────────────────────────────────────────────────────────────────────────────
  const utag = tag('Users');
  app.get('/users', { preHandler: [requirePerm('users:view')], schema: { tags: utag, summary: 'User accounts (search by name / username / email / phone; filter by type, role, status)', querystring: userListQuery, response: { 200: userListOut } } }, async (req) => {
    const { data, total } = await userSvc.listUsers(req.db, req.query, pageArgs(req.query));
    return pagedResult(data, total, req.query);
  });

  app.get('/users/:id', { preHandler: [requirePerm('users:view')], schema: { tags: utag, summary: 'One account', params: idParam, response: { 200: userDetailOut } } }, async (req) => userSvc.getUserDetail(req.db, req.params.id));

  app.post(
    '/users',
    { preHandler: [requirePerm('users:create')], schema: { tags: utag, summary: 'Create a staff login (temporary password returned once). Assigning roles needs roles:edit', body: userCreateBody, response: { 201: userCreateOut } } },
    async (req, reply) => {
      const created = await req.db.transaction((tx) => userSvc.createStaffUser(tx, ctxOf(req), req.body));
      return reply.status(201).send({ ...(await userSvc.getUserDetail(req.db, created.userId)), temporaryPassword: created.temporaryPassword });
    },
  );

  const rolesOut = async (req: { db: Parameters<typeof roleSvc.userRoleKeys>[0] }, userId: string, changed: boolean) => ({ userId, roles: await roleSvc.userRoleKeys(req.db, userId), changed });
  const afterRoleChange = async (req: Parameters<typeof actorOf>[0], userId: string, changed: boolean) => {
    invalidatePrincipal(req.tenant.id, userId);
    if (changed) await notify(req.db, req.tenant, { userIds: [userId], type: 'system.access_changed', title: 'Your access was updated', body: 'The school changed what you can do in the app.', data: { route: '/profile' } });
  };

  app.put(
    '/users/:id/roles',
    { preHandler: [requirePerm('users:edit')], schema: { tags: utag, summary: 'Replace the roles of a user (needs roles:edit; the user’s tokens go stale and refresh)', params: idParam, body: userRolesBody, response: { 200: userRolesOut } } },
    async (req) => {
      const r = await req.db.transaction((tx) => roleSvc.replaceUserRoles(tx, ctxOf(req), req.params.id, req.body.roleIds));
      await afterRoleChange(req, req.params.id, r.changed);
      return rolesOut(req, req.params.id, r.changed);
    },
  );

  app.post(
    '/users/:id/roles',
    { preHandler: [requirePerm('users:edit')], schema: { tags: utag, summary: 'Add one role to a user', params: idParam, body: userRoleAddBody, response: { 200: userRolesOut } } },
    async (req) => {
      const r = await req.db.transaction(async (tx) => {
        const current = await roleSvc.userRoleKeys(tx, req.params.id);
        return roleSvc.replaceUserRoles(tx, ctxOf(req), req.params.id, [...new Set([...current.map((c) => c.id), req.body.roleId])]);
      });
      await afterRoleChange(req, req.params.id, r.changed);
      return rolesOut(req, req.params.id, r.changed);
    },
  );

  app.delete(
    '/users/:id/roles/:roleId',
    { preHandler: [requirePerm('users:edit')], schema: { tags: utag, summary: 'Remove one role from a user (never the last active super administrator)', params: z.object({ id: uuid, roleId: uuid }), response: { 200: userRolesOut } } },
    async (req) => {
      const r = await req.db.transaction(async (tx) => {
        const current = await roleSvc.userRoleKeys(tx, req.params.id);
        return roleSvc.replaceUserRoles(tx, ctxOf(req), req.params.id, current.map((c) => c.id).filter((id) => id !== req.params.roleId));
      });
      await afterRoleChange(req, req.params.id, r.changed);
      return rolesOut(req, req.params.id, r.changed);
    },
  );

  app.post('/users/:id/deactivate', { preHandler: [requirePerm('users:delete')], schema: { tags: utag, summary: 'Deactivate an account: signs the user out everywhere and blocks sign-in (never the last super administrator)', params: idParam, response: { 200: userDetailOut } } }, async (req) => {
    await req.db.transaction((tx) => userSvc.deactivateUser(tx, ctxOf(req), req.params.id));
    invalidatePrincipal(req.tenant.id, req.params.id);
    return userSvc.getUserDetail(req.db, req.params.id);
  });

  app.post('/users/:id/reactivate', { preHandler: [requirePerm('users:edit')], schema: { tags: utag, summary: 'Reactivate a deactivated account', params: idParam, response: { 200: userDetailOut } } }, async (req) => {
    await req.db.transaction((tx) => userSvc.reactivateUser(tx, ctxOf(req), req.params.id));
    invalidatePrincipal(req.tenant.id, req.params.id);
    return userSvc.getUserDetail(req.db, req.params.id);
  });

  app.post(
    '/users/:id/reset-password',
    { preHandler: [requirePerm('users:edit')], schema: { tags: utag, summary: 'Admin password reset: temporary password returned once, must be changed at next sign-in, all sessions revoked', params: idParam, response: { 200: passwordResetOut } } },
    async (req) => {
      const credential = await prepareCredential(); // Argon2 is slow: keep it out of the transaction
      const out = await req.db.transaction((tx) => userSvc.resetUserPassword(tx, ctxOf(req), req.params.id, credential));
      invalidatePrincipal(req.tenant.id, req.params.id);
      return out;
    },
  );

  app.post('/users/:id/unlock', { preHandler: [requirePerm('users:edit')], schema: { tags: utag, summary: 'Clear a sign-in lockout', params: idParam, response: { 200: userDetailOut } } }, async (req) => {
    await req.db.transaction((tx) => userSvc.unlockUser(tx, ctxOf(req), req.params.id));
    return userSvc.getUserDetail(req.db, req.params.id);
  });

  app.post('/users/:id/force-logout', { preHandler: [requirePerm('users:edit')], schema: { tags: utag, summary: 'Sign the user out of every device', params: idParam, response: { 200: forceLogoutOut } } }, async (req) => {
    const revoked = await req.db.transaction((tx) => userSvc.forceLogout(tx, ctxOf(req), req.params.id));
    return { ok: true as const, revoked };
  });

  app.get('/users/:id/sessions', { preHandler: [requirePerm('users:view')], schema: { tags: utag, summary: 'Active sessions (devices) of a user', params: idParam, response: { 200: userSessionsOut } } }, async (req) => ({ data: await userSvc.listUserSessions(req.db, req.params.id) }));

  app.delete(
    '/users/:id/sessions/:sessionId',
    { preHandler: [requirePerm('users:edit')], schema: { tags: utag, summary: 'Sign one device of a user out', params: z.object({ id: uuid, sessionId: uuid }), response: { 200: okSchema } } },
    async (req) => {
      const username = await userSvc.assertManageableForSession(req.db, req.auth, req.params.id);
      if (!(await revokeSession(req.db, req.tenant.id, req.params.id, req.params.sessionId))) throw notFound('Session');
      await audit(req.db, actorOf(req), { action: 'user.session_revoked', entity: 'user', entityId: req.params.id, summary: `Signed ${username} out of one device`, after: { sessionId: req.params.sessionId } });
      return { ok: true as const };
    },
  );

  // ── school settings ────────────────────────────────────────────────────────────────────────────
  const stag = tag('Settings');
  // outgoing email: the school's own mail accounts + the email queue (/settings/email/…)
  await app.register(emailRoutes);
  app.get('/settings', { preHandler: [requirePerm('settings:view', 'school')], schema: { tags: stag, summary: 'Every settings group in one call', response: { 200: settingsAllOut } } }, async (req) => getAllSettings(req.db));

  app.get('/settings/branding', { preHandler: [requirePerm('settings:view', 'school')], schema: { tags: stag, summary: 'School name, short name, logo and colours (what /site/info shows)', response: { 200: brandingOut } } }, async (req) => getBranding(req.tenant));

  app.put('/settings/branding', { preHandler: [requirePerm('settings:edit', 'school')], schema: { tags: stag, summary: 'Update the school profile / branding (any subset); /site/info reflects it immediately', body: brandingUpdateBody, response: { 200: brandingOut } } }, async (req) =>
    req.db.transaction((tx) => updateBranding(tx, ctxOf(req), req.tenant, req.body)),
  );

  app.get('/settings/features', { preHandler: [requirePerm('settings:view', 'school')], schema: { tags: stag, summary: 'Feature toggles: fees, transport, library, onlinePayments, studentLogin', response: { 200: featuresOut } } }, async (req) => getFeatures(req.tenant));

  app.put(
    '/settings/features',
    { preHandler: [requirePerm('settings:edit', 'school')], schema: { tags: stag, summary: 'Switch features on/off — super administrators only', body: featuresUpdateBody, response: { 200: featuresOut } } },
    async (req) => {
      if (!req.auth.hasRole(roleSvc.SUPER_ADMIN)) throw forbidden('Only a super administrator can change feature toggles', 'ONLY_SUPER_ADMIN');
      return req.db.transaction((tx) => updateFeatures(tx, ctxOf(req), req.tenant, req.body));
    },
  );

  app.get('/settings/:group', { preHandler: [requirePerm('settings:view', 'school')], schema: { tags: stag, summary: 'One settings group (attendance, academic, school, exams, fees, notifications, …) with defaults filled in', params: settingsGroupParam, response: { 200: settingsGroupOut } } }, async (req) => getGroup(req.db, requireGroup(req.params.group)));

  app.put('/settings/:group', { preHandler: [requirePerm('settings:edit', 'school')], schema: { tags: stag, summary: 'Update any subset of a settings group (validated against the group’s schema)', params: settingsGroupParam, body: settingsGroupBody, response: { 200: settingsGroupOut } } }, async (req) => {
    const group = requireGroup(req.params.group);
    return req.db.transaction((tx) => updateGroup(tx, ctxOf(req), group, req.body));
  });

  // ── audit ──────────────────────────────────────────────────────────────────────────────────────
  const atag = tag('Audit');
  app.get('/audit', { preHandler: [requirePerm('audit:view', 'school')], schema: { tags: atag, summary: 'Audit trail, newest first (keyset pagination; filter by actor, entity, action prefix, date range)', querystring: auditQuery, response: { 200: auditListOut } } }, async (req) => {
    const { cursor, limit, ...filter } = req.query;
    return listAudit(req.db, { ...filter, cursor, limit }, req.tenant.timezone);
  });

  app.get(
    '/audit/export',
    { preHandler: [requirePerm('audit:export', 'school')], schema: { tags: atag, summary: 'CSV export of the audit trail (same filters, capped at 50 000 rows); the export itself is audited', querystring: auditExportQuery, response: { 200: z.string() } } },
    async (req, reply) => {
      await audit(req.db, actorOf(req), { action: 'audit.export', entity: 'audit', summary: 'Exported the audit log', after: req.query });
      const file = `audit-${todayIn(req.tenant.timezone)}.csv`;
      return reply
        .type('text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${file}"`)
        // a stream, not a string: the zod response type only documents "text/csv" in OpenAPI
        .send(Readable.from(auditCsv(req.db, req.query, req.tenant.timezone), { objectMode: false }) as unknown as string);
    },
  );

  app.get('/audit/:id', { preHandler: [requirePerm('audit:view', 'school')], schema: { tags: atag, summary: 'One audit entry with its before / after snapshots', params: idParam, response: { 200: auditDetailOut } } }, async (req) => getAuditEntry(req.db, req.params.id));

  // ── onboarding checklist ───────────────────────────────────────────────────────────────────────
  app.get('/setup/status', { preHandler: [requirePerm('settings:view', 'school')], schema: { tags: tag('Settings'), summary: '“Get your school ready” checklist: per step { key, done, count, hint } plus the license summary', response: { 200: setupStatusOut } } }, async (req) =>
    setupStatus(req.db, req.tenant),
  );
};

export default routes;
