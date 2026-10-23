import { SignJWT, errors, jwtVerify } from 'jose';
import { config } from '../../config';
import { deriveKey } from '../crypto';
import { unauthorized } from '../errors';

export interface AccessClaims {
  userId: string;
  sessionId: string;
  tenantId: string;
  authVersion: number;
}

const ISSUER = 'schoolsync';
const AUDIENCE = 'schoolsync-api';

/** Key is derived per tenant, so an access token minted for school A can never validate at school B. */
const keyFor = (tenantId: string) => deriveKey(config.JWT_SECRET, `access:${tenantId}`);

export async function signAccessToken(c: AccessClaims): Promise<string> {
  return new SignJWT({ tid: c.tenantId, sid: c.sessionId, av: c.authVersion })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(c.userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${config.ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(keyFor(c.tenantId));
}

export async function verifyAccessToken(tenantId: string, token: string): Promise<AccessClaims> {
  try {
    const { payload } = await jwtVerify(token, keyFor(tenantId), { issuer: ISSUER, audience: AUDIENCE, algorithms: ['HS256'], clockTolerance: 5 });
    if (payload.tid !== tenantId || typeof payload.sub !== 'string' || typeof payload.sid !== 'string' || typeof payload.av !== 'number') throw unauthorized('Invalid token', 'INVALID_TOKEN');
    return { userId: payload.sub, sessionId: payload.sid, tenantId, authVersion: payload.av };
  } catch (e) {
    if (e instanceof errors.JWTExpired) throw unauthorized('Access token expired', 'TOKEN_EXPIRED');
    if (e && typeof e === 'object' && 'status' in e) throw e;
    throw unauthorized('Invalid token', 'INVALID_TOKEN');
  }
}
