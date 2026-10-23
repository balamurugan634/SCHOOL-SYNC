import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

export const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');

/** Derive an independent 256-bit key from the master secret (HKDF-SHA256). */
export function deriveKey(master: string, info: string): Uint8Array {
  return new Uint8Array(hkdfSync('sha256', master, 'schoolsync-v1', info, 32));
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** AES-256-GCM "secret box" for values at rest (e.g. per-tenant DB URLs). Format: v1.<iv>.<tag>.<ciphertext> */
export function seal(plain: string, master: string): string {
  const key = deriveKey(master, 'secretbox');
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

export function unseal(boxed: string, master: string): string {
  const [v, iv, tag, ct] = boxed.split('.');
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('Bad secret box');
  const d = createDecipheriv('aes-256-gcm', deriveKey(master, 'secretbox'), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
}
