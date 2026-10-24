import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { okSchema, platformChangePasswordBody, platformLoginBody, platformOperator, platformRefreshBody, platformTokenResponse } from '@school-sync/shared';
import { config } from '../../config';
import { platformAccess } from '../../core/platform/access';
import * as svc from '../../core/platform/operators';

const tag = ['Platform auth'];
const meta = (req: { ip: string; headers: { 'user-agent'?: string } }) => ({ ip: req.ip, userAgent: req.headers['user-agent'] });
const limit = (max: number) => ({ rateLimit: { max, timeWindow: '1 minute', keyGenerator: (req: { ip: string }) => `platform-auth:${req.ip}` } });
const signedIn = platformAccess({ operatorOnly: true, allowMustChange: true });
const operatorSecurity: Record<string, string[]>[] = [{ operatorToken: [] }];

/**
 * Operator sign-in for the platform console. Same security model as the school sign-in: Argon2id, generic errors,
 * lockout after repeated failures, per-client rate limits, rotating refresh tokens with reuse detection, audit.
 * These routes are NOT behind the key-or-token guard (you cannot hold a token before you sign in).
 */
const platformAuthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/platform/auth/login',
    { config: { noTenant: true, ...limit(config.PLATFORM_LOGIN_RATE_LIMIT_MAX) }, schema: { tags: tag, summary: 'Operator sign-in (email + password)', body: platformLoginBody, response: { 200: platformTokenResponse }, security: [] } },
    async (req) => svc.login(req.body, meta(req)),
  );

  app.post(
    '/platform/auth/refresh',
    { config: { noTenant: true, ...limit(config.PLATFORM_LOGIN_RATE_LIMIT_MAX * 3) }, schema: { tags: tag, summary: 'Rotate the refresh token and get a new access token', body: platformRefreshBody, response: { 200: platformTokenResponse }, security: [] } },
    async (req) => svc.refresh(req.body.refreshToken, meta(req)),
  );

  app.post(
    '/platform/auth/logout',
    { onRequest: [signedIn], config: { noTenant: true }, schema: { tags: tag, summary: 'End this operator session', response: { 200: okSchema }, security: operatorSecurity } },
    async (req) => {
      await svc.logout(req.platformActor.id!, req.platformSessionId, meta(req));
      return { ok: true as const };
    },
  );

  app.get('/platform/auth/me', { onRequest: [signedIn], config: { noTenant: true }, schema: { tags: tag, summary: 'The signed-in operator', response: { 200: platformOperator }, security: operatorSecurity } }, async (req) => svc.toOperator(await svc.loadOperator(req.platformActor.id!)));

  app.post(
    '/platform/auth/change-password',
    { onRequest: [signedIn], config: { noTenant: true, ...limit(config.PLATFORM_LOGIN_RATE_LIMIT_MAX) }, schema: { tags: tag, summary: 'Change my password (signs out my other sessions)', body: platformChangePasswordBody, response: { 200: okSchema }, security: operatorSecurity } },
    async (req) => {
      await svc.changePassword(await svc.loadOperator(req.platformActor.id!), req.platformSessionId, req.body, meta(req));
      return { ok: true as const };
    },
  );
};

export default platformAuthRoutes;
