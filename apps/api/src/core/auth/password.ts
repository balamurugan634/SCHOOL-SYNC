import { hash, verify, type Algorithm } from '@node-rs/argon2';
import { randomBytes } from 'node:crypto';

// OWASP 2024 Argon2id baseline (19 MiB, t=2, p=1). Tune upward on beefier hosts.
// Algorithm is an ambient const enum in @node-rs/argon2 (unusable under isolatedModules); 2 === Algorithm.Argon2id
const OPTS = { algorithm: 2 as Algorithm, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (plain: string): Promise<string> => hash(plain, OPTS);

export async function verifyPassword(hashed: string, plain: string): Promise<boolean> {
  try {
    return await verify(hashed, plain);
  } catch {
    return false;
  }
}

/** Constant-ish time failure path for unknown users, so response time doesn't reveal which accounts exist. */
let dummy: Promise<string> | undefined;
export async function burnPasswordCheck(plain: string): Promise<void> {
  dummy ??= hashPassword('not-a-real-password');
  await verifyPassword(await dummy, plain);
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
/** Readable temporary password that satisfies the policy (upper, lower, digit). */
export function generatePassword(length = 14): string {
  const bytes = randomBytes(length);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return `${out.slice(0, length - 3)}Aa7`.slice(0, length);
}
