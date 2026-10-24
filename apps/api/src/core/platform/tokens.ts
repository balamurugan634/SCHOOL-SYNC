import { SignJWT, errors, jwtVerify } from 'jose';
import { config } from '../../config';
import { deriveKey } from '../crypto';
import { unauthorized } from '../errors';

/**
 * Operator access tokens. They use their own issuer, audience and signing key (HKDF from the master secret, a different
 * `info` label than the per-school keys), so a school token never validates here and an operator token never validates
 * on a school's routes, even though both are HS256 JWTs signed from the same master secret.
 */
const ISSUER = 'schoolsync-platform';
const AUDIENCE = 'schoolsync-platform-console';
let key: Uint8Array | undefined;
const signingKey = () => (key ??= deriveKey(config.JWT_SECRET, 'platform-access:v1'));

export async function signPlatformToken(c: { operatorId: string; sessionId: string }): Promise<string> {
  return new SignJWT({ sid: c.sessionId, typ: 'op' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(c.operatorId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${config.ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(signingKey());
}

export async function verifyPlatformToken(token: string): Promise<{ operatorId: string; sessionId: string }> {
  try {
    const { payload } = await jwtVerify(token, signingKey(), { issuer: ISSUER, audience: AUDIENCE, algorithms: ['HS256'], clockTolerance: 5 });
    if (payload.typ !== 'op' || typeof payload.sub !== 'string' || typeof payload.sid !== 'string') throw unauthorized('Invalid token', 'INVALID_TOKEN');
    return { operatorId: payload.sub, sessionId: payload.sid };
  } catch (e) {
    if (e instanceof errors.JWTExpired) throw unauthorized('Access token expired', 'TOKEN_EXPIRED');
    if (e && typeof e === 'object' && 'status' in e) throw e;
    throw unauthorized('Invalid token', 'INVALID_TOKEN');
  }
}
