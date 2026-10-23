import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { changePasswordBody, forgotPasswordBody, loginBody, meResponse, okSchema, refreshBody, registerDeviceBody, resetPasswordBody, sessionInfo, tokenResponse, uuid } from '@school-sync/shared';
import { and, eq } from 'drizzle-orm';
import { actorOf, audit } from '../../core/audit';
import * as svc from '../../core/auth/service';
import { notFound } from '../../core/errors';
import { devices } from '../../db/tenant/schema';
import { config } from '../../config';
import { requireAuth } from '../../plugins/guards';

const authLimit = { rateLimit: { max: config.AUTH_RATE_LIMIT_MAX, timeWindow: '1 minute', keyGenerator: (req: { ip: string; tenant?: { id: string } }) => `${req.tenant?.id}:${req.ip}` } };
const tag = ['Auth'];

const authRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/auth/login',
    { config: { ...authLimit, allowWhenReadOnly: true }, schema: { tags: tag, summary: 'Sign in with username / email / phone / admission no. / employee id', body: loginBody, response: { 200: tokenResponse } } },
    async (req) => svc.login(req.db, req.tenant, req.body, { ip: req.ip, userAgent: req.headers['user-agent'] }, actorOf(req)),
  );

  app.post(
    '/auth/refresh',
    { config: { ...authLimit, rateLimit: { ...authLimit.rateLimit, max: config.AUTH_RATE_LIMIT_MAX * 3 }, allowWhenReadOnly: true }, schema: { tags: tag, summary: 'Rotate the refresh token and get a new access token', body: refreshBody, response: { 200: tokenResponse } } },
    async (req) => svc.refresh(req.db, req.tenant, req.body, { ip: req.ip, userAgent: req.headers['user-agent'] }, actorOf(req)),
  );

  app.post(
    '/auth/logout',
    { preHandler: [requireAuth], config: { allowWhenReadOnly: true }, schema: { tags: tag, summary: 'End this session and stop push to this device', body: z.object({ pushToken: z.string().optional() }).optional(), response: { 200: okSchema } } },
    async (req) => {
      await svc.logout(req.db, req.tenant, req.sessionId, actorOf(req), req.body?.pushToken);
      return { ok: true as const };
    },
  );

  app.get('/auth/me', { preHandler: [requireAuth], schema: { tags: tag, summary: 'Current user, roles, permissions and linked children', response: { 200: meResponse } } }, async (req) => svc.buildMe(req.db, req.auth));

  app.post(
    '/auth/change-password',
    { preHandler: [requireAuth], config: { allowWhenReadOnly: true, ...authLimit }, schema: { tags: tag, body: changePasswordBody, response: { 200: okSchema } } },
    async (req) => {
      await svc.changePassword(req.db, req.tenant, req.auth, req.body, req.sessionId, actorOf(req));
      return { ok: true as const };
    },
  );

  app.post(
    '/auth/forgot-password',
    { config: { ...authLimit, rateLimit: { ...authLimit.rateLimit, max: Math.max(3, Math.floor(config.AUTH_RATE_LIMIT_MAX / 2)) }, allowWhenReadOnly: true }, schema: { tags: tag, summary: 'Email a reset link (always answers 202 — never reveals whether the account exists)', body: forgotPasswordBody, response: { 202: okSchema } } },
    async (req, reply) => {
      await svc.requestPasswordReset(req.db, req.tenant, req.body.identifier, req.log);
      return reply.status(202).send({ ok: true as const });
    },
  );

  app.post(
    '/auth/reset-password',
    { config: { ...authLimit, allowWhenReadOnly: true }, schema: { tags: tag, body: resetPasswordBody, response: { 200: okSchema } } },
    async (req) => {
      await svc.resetPassword(req.db, req.tenant, req.body, actorOf(req));
      return { ok: true as const };
    },
  );

  app.get('/auth/sessions', { preHandler: [requireAuth], schema: { tags: tag, summary: 'Devices signed in to this account', response: { 200: z.object({ data: z.array(sessionInfo) }) } } }, async (req) => ({ data: await svc.listSessions(req.db, req.auth.userId, req.sessionId) }));

  app.delete(
    '/auth/sessions/:id',
    { preHandler: [requireAuth], config: { allowWhenReadOnly: true }, schema: { tags: tag, summary: 'Sign out one device', params: z.object({ id: uuid }), response: { 200: okSchema } } },
    async (req) => {
      if (!(await svc.revokeSession(req.db, req.tenant.id, req.auth.userId, req.params.id))) throw notFound('Session');
      await audit(req.db, actorOf(req), { action: 'auth.session_revoked', entity: 'session', entityId: req.params.id });
      return { ok: true as const };
    },
  );

  app.post(
    '/auth/sessions/revoke-others',
    { preHandler: [requireAuth], config: { allowWhenReadOnly: true }, schema: { tags: tag, summary: 'Sign out everywhere except here', response: { 200: okSchema } } },
    async (req) => {
      await svc.revokeAllSessions(req.db, req.tenant.id, req.auth.userId, 'revoked_by_user', req.sessionId);
      return { ok: true as const };
    },
  );

  // ── push registration ──
  app.post(
    '/devices',
    { preHandler: [requireAuth], config: { allowWhenReadOnly: true }, schema: { tags: ['Devices'], summary: 'Register / refresh this device’s FCM token', body: registerDeviceBody, response: { 200: okSchema } } },
    async (req) => {
      const d = req.body;
      await req.db
        .insert(devices)
        .values({ userId: req.auth.userId, sessionId: req.sessionId, pushToken: d.pushToken, platform: d.platform, deviceName: d.name ?? null, appVersion: d.appVersion ?? null })
        .onConflictDoUpdate({ target: devices.pushToken, set: { userId: req.auth.userId, sessionId: req.sessionId, platform: d.platform, deviceName: d.name ?? null, appVersion: d.appVersion ?? null, enabled: true, lastSeenAt: new Date() } });
      return { ok: true as const };
    },
  );

  app.post(
    '/devices/unregister',
    { preHandler: [requireAuth], config: { allowWhenReadOnly: true }, schema: { tags: ['Devices'], body: z.object({ pushToken: z.string().min(20) }), response: { 200: okSchema } } },
    async (req) => {
      await req.db.update(devices).set({ enabled: false }).where(and(eq(devices.pushToken, req.body.pushToken), eq(devices.userId, req.auth.userId)));
      return { ok: true as const };
    },
  );
};

export default authRoutes;
