import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { config } from '../../config';
import { deriveKey } from '../crypto';

/**
 * Secrets a school stores with us (SMTP passwords, one-time mail bodies) are sealed with AES-256-GCM.
 * The key is derived per school with HKDF-SHA256 from the master secret and the school id (the same construction as the
 * per-school access-token key), so one school's ciphertext cannot be opened with another school's key. The row id is bound in
 * as GCM additional data, so a ciphertext copied to another row (or school) fails authentication.
 * Format: v1.<iv>.<tag>.<ciphertext> (base64url). Never log, return or audit either side of this function.
 */
const keyFor = (tenantId: string): Uint8Array => deriveKey(config.APP_ENCRYPTION_KEY, `email-secret:${tenantId}`);

export function sealForTenant(plain: string, tenantId: string, bindTo: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', keyFor(tenantId), iv);
  c.setAAD(Buffer.from(bindTo, 'utf8'));
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

export function openForTenant(boxed: string, tenantId: string, bindTo: string): string {
  const [v, iv, tag, ct] = boxed.split('.');
  if (v !== 'v1' || !iv || !tag || ct === undefined) throw new Error('Bad secret box');
  const d = createDecipheriv('aes-256-gcm', keyFor(tenantId), Buffer.from(iv, 'base64url'));
  d.setAAD(Buffer.from(bindTo, 'utf8'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
}

export const isSealed = (s: string | null | undefined): boolean => !!s && /^v1\.[\w-]+\.[\w-]+\.[\w-]*$/.test(s);
