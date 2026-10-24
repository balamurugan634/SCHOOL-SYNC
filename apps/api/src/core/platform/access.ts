import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../../config';
import { safeEqual } from '../crypto';
import { AppError, unauthorized } from '../errors';
import { authenticateOperator } from './operators';
import './context';

type Hook = (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

/**
 * Guard for `/api/v1/platform/*`. A request is allowed with EITHER
 *   - the automation key (`X-Platform-Key`, constant-time compare; only when PLATFORM_API_KEY is configured), OR
 *   - an operator's bearer access token (own audience and key, live session, active account).
 * The caller is recorded on `req.platformActor`, which every mutation passes to the platform audit log.
 *
 * `operatorOnly`: the route is about the signed-in operator (me, change password, sign out), so a key is not enough.
 * `allowMustChange`: let an operator whose password is still the temporary one through (otherwise 403 PASSWORD_CHANGE_REQUIRED).
 */
export const platformAccess =
  (opts: { operatorOnly?: boolean; allowMustChange?: boolean } = {}): Hook =>
  async (req) => {
    const meta = { ip: req.ip, userAgent: req.headers['user-agent']?.slice(0, 300) ?? null, requestId: req.id };
    const key = req.headers['x-platform-key'];
    if (key !== undefined) {
      if (opts.operatorOnly) throw unauthorized('Sign in as an operator', 'OPERATOR_REQUIRED');
      if (typeof key !== 'string' || !config.PLATFORM_API_KEY || !safeEqual(key, config.PLATFORM_API_KEY)) throw unauthorized('Invalid platform key', 'INVALID_PLATFORM_KEY');
      req.platformActor = { kind: 'key', id: null, ...meta };
      return;
    }
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw unauthorized(config.PLATFORM_API_KEY ? 'Invalid platform key' : 'Authentication required', config.PLATFORM_API_KEY ? 'INVALID_PLATFORM_KEY' : 'UNAUTHORIZED');
    const { operator, sessionId } = await authenticateOperator(header.slice(7));
    if (operator.mustChangePassword && !opts.allowMustChange) throw new AppError(403, 'PASSWORD_CHANGE_REQUIRED', 'Choose a new password before you continue');
    req.platformActor = { kind: 'operator', id: operator.id, email: operator.email, displayName: operator.displayName, ...meta };
    req.platformSessionId = sessionId;
  };
