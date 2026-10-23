import { and, eq, inArray, ne, or } from 'drizzle-orm';
import { generatePassword, hashPassword } from '../../core/auth/password';
import { conflict } from '../../core/errors';
import type { Executor } from '../../core/tenancy/pools';
import { roles, userRoles, users } from '../../db/tenant/schema';

/** Same normalisation the login lookup applies to phone numbers (spaces, dashes, brackets removed). */
export const normalizePhone = (p: string): string => p.replace(/[\s\-()]/g, '');
export const normalizeEmail = (e: string): string => e.trim().toLowerCase();

export interface Credential {
  password: string;
  hash: string;
}
/** Generate a temporary password and its Argon2 hash. Hashing is slow: do it BEFORE opening a transaction. */
export async function prepareCredential(): Promise<Credential> {
  const password = generatePassword();
  return { password, hash: await hashPassword(password) };
}

export interface NewLogin {
  username: string;
  displayName: string;
  userType: 'student' | 'parent' | 'staff';
  email?: string | null;
  phone?: string | null;
  /** system or custom role keys to assign */
  roleKeys: string[];
  credential?: Credential;
}

/** 409 (with a stable code) if the username / email / phone is already used by another account. */
export async function assertLoginFree(db: Executor, input: { username: string; email?: string | null; phone?: string | null }): Promise<void> {
  const rows = await db
    .select({ username: users.username, email: users.email, phone: users.phone })
    .from(users)
    .where(or(eq(users.username, input.username), input.email ? eq(users.email, input.email) : undefined, input.phone ? eq(users.phone, input.phone) : undefined))
    .limit(5);
  for (const r of rows) {
    if (r.username === input.username) throw conflict(`The username "${input.username}" is already in use`, 'USERNAME_TAKEN');
    if (input.email && r.email === input.email) throw conflict(`The email ${input.email} is already used by another account`, 'EMAIL_TAKEN');
    if (input.phone && r.phone === input.phone) throw conflict(`The phone number ${input.phone} is already used by another account`, 'PHONE_TAKEN');
  }
}

/**
 * Create a login (users row + role assignments) with a temporary password the user must change on first sign-in.
 * Returns the plaintext password ONCE — the caller shows it to the admin and never stores it.
 */
export async function createLogin(db: Executor, input: NewLogin, grantedBy?: string | null): Promise<{ userId: string; username: string; temporaryPassword: string }> {
  const username = input.username.trim().toLowerCase();
  const email = input.email ? normalizeEmail(input.email) : null;
  const phone = input.phone ? normalizePhone(input.phone) : null;
  await assertLoginFree(db, { username, email, phone });
  const cred = input.credential ?? (await prepareCredential());
  const [u] = await db
    .insert(users)
    .values({ userType: input.userType, username, email, phone, displayName: input.displayName, passwordHash: cred.hash, mustChangePassword: true, passwordChangedAt: new Date() })
    .returning({ id: users.id });
  if (input.roleKeys.length) {
    const roleRows = await db.select({ id: roles.id, key: roles.key }).from(roles).where(inArray(roles.key, input.roleKeys));
    if (roleRows.length) await db.insert(userRoles).values(roleRows.map((r) => ({ userId: u!.id, roleId: r.id, grantedBy: grantedBy ?? null })));
  }
  return { userId: u!.id, username, temporaryPassword: cred.password };
}

/** 409 when another account (not `exceptUserId`) already uses this email or phone — checked up front so the caller gets a clear message instead of a raw constraint error. */
export async function assertContactFree(db: Executor, input: { email?: string | null; phone?: string | null; exceptUserId: string }): Promise<void> {
  if (!input.email && !input.phone) return;
  const rows = await db
    .select({ email: users.email, phone: users.phone })
    .from(users)
    .where(and(ne(users.id, input.exceptUserId), or(input.email ? eq(users.email, input.email) : undefined, input.phone ? eq(users.phone, input.phone) : undefined)))
    .limit(3);
  if (input.email && rows.some((r) => r.email === input.email)) throw conflict(`The email ${input.email} is already used by another account`, 'EMAIL_TAKEN');
  if (input.phone && rows.some((r) => r.phone === input.phone)) throw conflict(`The phone number ${input.phone} is already used by another account`, 'PHONE_TAKEN');
}
