import { and, asc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import type { GuardianOut, guardianCreateBody, guardianListQuery, guardianUpdateBody, studentGuardianLinkBody, studentGuardianUpdateBody } from '@school-sync/shared';
import { audit } from '../../core/audit';
import { revokeAllSessions } from '../../core/auth/service';
import { AppError, conflict, notFound } from '../../core/errors';
import { ilikeAny } from '../../core/http';
import { assertStudentAccess, studentScope } from '../../core/rbac/scope';
import type { Executor } from '../../core/tenancy/pools';
import { grades, guardians, sections, studentGuardians, students, users } from '../../db/tenant/schema';
import { assertContactFree, createLogin, normalizeEmail, normalizePhone, type Credential } from './accounts';
import { definedOnly, diff, fullName, type PeopleCtx } from './util';

type GuardianRow = typeof guardians.$inferSelect;

/** The name a parent signs in with: their phone number, else their email. */
export function loginIdentity(g: { phone?: string | null; email?: string | null }): string | null {
  if (g.phone) return normalizePhone(g.phone);
  if (g.email) return normalizeEmail(g.email);
  return null;
}

export async function findGuardianByPhone(db: Executor, phone: string): Promise<{ id: string; userId: string | null } | null> {
  const [g] = await db.select({ id: guardians.id, userId: guardians.userId }).from(guardians).where(eq(guardians.phone, normalizePhone(phone))).limit(1);
  return g ?? null;
}

export interface NewGuardian {
  firstName: string;
  lastName?: string | null;
  phone?: string | null;
  email?: string | null;
  occupation?: string | null;
  address?: GuardianRow['address'];
  createLogin: boolean;
}

/** Create a guardian (and, if asked and possible, their parent login). Refuses a phone number another guardian already has. */
export async function createGuardianRecord(tx: Executor, ctx: PeopleCtx, g: NewGuardian, cred?: Credential): Promise<{ id: string; userId: string | null; credential: { username: string; temporaryPassword: string } | null }> {
  const phone = g.phone ? normalizePhone(g.phone) : null;
  const email = g.email ? normalizeEmail(g.email) : null;
  if (phone) {
    const existing = await findGuardianByPhone(tx, phone);
    if (existing) throw new AppError(409, 'GUARDIAN_EXISTS', 'A parent with this phone number is already registered; link that parent instead', { guardianId: existing.id });
  }
  let userId: string | null = null;
  let credential: { username: string; temporaryPassword: string } | null = null;
  const identity = loginIdentity({ phone, email });
  if (g.createLogin && identity) {
    const login = await createLogin(tx, { username: identity, displayName: fullName(g.firstName, g.lastName), userType: 'parent', email, phone, roleKeys: ['parent'], credential: cred }, ctx.actor.userId);
    userId = login.userId;
    credential = { username: login.username, temporaryPassword: login.temporaryPassword };
  }
  const [row] = await tx
    .insert(guardians)
    .values({ userId, firstName: g.firstName, lastName: g.lastName ?? null, phone, email, occupation: g.occupation ?? null, address: g.address ?? null })
    .returning({ id: guardians.id });
  await audit(tx, ctx.actor, { action: 'guardian.create', entity: 'guardian', entityId: row!.id, summary: `Added parent ${fullName(g.firstName, g.lastName)}${userId ? ' with a login' : ''}`, after: { name: fullName(g.firstName, g.lastName), phone, email, hasLogin: !!userId } });
  return { id: row!.id, userId, credential };
}

// ── reads ───────────────────────────────────────────────────────────────────────────────────────
/** Guardians the caller may see: school scope = all; narrower scopes = parents of children inside the scope. */
function guardianVisible(ctx: PeopleCtx): SQL {
  const p = ctx.principal;
  if (p.scope('guardians:view') === 'school') return sql`true`;
  return sql`exists (select 1 from ${studentGuardians} sg join ${students} on ${students.id} = sg.student_id where sg.guardian_id = ${guardians.id} and ${studentScope(p, 'guardians:view')})`;
}

async function toGuardianOuts(db: Executor, ctx: PeopleCtx, rows: GuardianRow[]): Promise<GuardianOut[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const links = await db
    .select({ guardianId: studentGuardians.guardianId, studentId: students.id, first: students.firstName, last: students.lastName, admissionNo: students.admissionNo, gradeName: grades.name, sectionName: sections.name, relationship: studentGuardians.relationship, verifiedAt: studentGuardians.verifiedAt })
    .from(studentGuardians)
    .innerJoin(students, eq(students.id, studentGuardians.studentId))
    .leftJoin(sections, eq(sections.id, students.currentSectionId))
    .leftJoin(grades, eq(grades.id, students.currentGradeId))
    .where(and(inArray(studentGuardians.guardianId, ids), studentScope(ctx.principal, 'guardians:view')))
    .orderBy(asc(students.firstName));
  const byGuardian = Map.groupBy(links, (l) => l.guardianId);
  const userIds = rows.map((r) => r.userId).filter((x): x is string => !!x);
  const names = ctx.principal.scope('users:view') && userIds.length ? new Map((await db.select({ id: users.id, username: users.username }).from(users).where(inArray(users.id, userIds))).map((u) => [u.id, u.username])) : new Map<string, string>();
  return rows.map((g) => ({
    id: g.id,
    firstName: g.firstName,
    lastName: g.lastName,
    name: fullName(g.firstName, g.lastName),
    phone: g.phone,
    email: g.email,
    occupation: g.occupation,
    address: g.address ?? null,
    hasLogin: !!g.userId,
    username: g.userId ? (names.get(g.userId) ?? null) : null,
    children: (byGuardian.get(g.id) ?? []).map((l) => ({ studentId: l.studentId, name: fullName(l.first, l.last), admissionNo: l.admissionNo, gradeName: l.gradeName, sectionName: l.sectionName, relationship: l.relationship, verified: !!l.verifiedAt })),
    createdAt: g.createdAt.toISOString(),
  }));
}

export async function listGuardians(db: Executor, ctx: PeopleCtx, q: z.infer<typeof guardianListQuery>) {
  const where = and(
    guardianVisible(ctx),
    q.q ? ilikeAny(q.q, guardians.firstName, guardians.lastName, guardians.phone, guardians.email) : undefined,
    q.studentId ? sql`exists (select 1 from ${studentGuardians} sg where sg.guardian_id = ${guardians.id} and sg.student_id = ${q.studentId})` : undefined,
    q.hasLogin ? (q.hasLogin === 'true' ? sql`${guardians.userId} is not null` : sql`${guardians.userId} is null`) : undefined,
  );
  const [rows, [total]] = await Promise.all([
    db
      .select()
      .from(guardians)
      .where(where)
      .orderBy(asc(guardians.firstName), asc(guardians.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db.select({ n: sql<number>`count(*)::int` }).from(guardians).where(where),
  ]);
  return { rows: await toGuardianOuts(db, ctx, rows), total: total?.n ?? 0 };
}

export async function getGuardian(db: Executor, ctx: PeopleCtx, id: string): Promise<GuardianOut> {
  const [row] = await db
    .select()
    .from(guardians)
    .where(and(eq(guardians.id, id), guardianVisible(ctx)))
    .limit(1);
  if (!row) throw notFound('Parent');
  return (await toGuardianOuts(db, ctx, [row]))[0]!;
}

// ── write ───────────────────────────────────────────────────────────────────────────────────────
export async function updateGuardian(tx: Executor, ctx: PeopleCtx, id: string, patch: z.infer<typeof guardianUpdateBody>): Promise<string | null> {
  const [before] = await tx.select().from(guardians).where(and(eq(guardians.id, id), guardianVisible(ctx))).limit(1).for('update');
  if (!before) throw notFound('Parent');
  const next = definedOnly({
    firstName: patch.firstName,
    lastName: patch.lastName,
    phone: patch.phone === undefined ? undefined : patch.phone ? normalizePhone(patch.phone) : null,
    email: patch.email === undefined ? undefined : patch.email ? normalizeEmail(patch.email) : null,
    occupation: patch.occupation,
    address: patch.address,
  });
  if (next.phone && next.phone !== before.phone) {
    const other = await findGuardianByPhone(tx, next.phone);
    if (other && other.id !== id) throw new AppError(409, 'GUARDIAN_EXISTS', 'Another parent already has this phone number', { guardianId: other.id });
  }
  if (!Object.keys(next).length) return before.userId;
  if (before.userId) await assertContactFree(tx, { email: next.email, phone: next.phone, exceptUserId: before.userId });
  await tx.update(guardians).set(next).where(eq(guardians.id, id));
  if (before.userId) {
    // keep the login's contact details and display name in step
    const userPatch = definedOnly({ phone: next.phone, email: next.email, displayName: next.firstName !== undefined || next.lastName !== undefined ? fullName(next.firstName ?? before.firstName, next.lastName === undefined ? before.lastName : next.lastName) : undefined });
    if (Object.keys(userPatch).length) await tx.update(users).set(userPatch).where(eq(users.id, before.userId));
  }
  const d = diff(before, next);
  await audit(tx, ctx.actor, { action: 'guardian.update', entity: 'guardian', entityId: id, summary: `Updated parent ${fullName(before.firstName, before.lastName)}`, before: d.before, after: d.after });
  return before.userId;
}

export async function deleteGuardian(tx: Executor, ctx: PeopleCtx, id: string): Promise<void> {
  const [g] = await tx.select().from(guardians).where(and(eq(guardians.id, id), guardianVisible(ctx))).limit(1).for('update');
  if (!g) throw notFound('Parent');
  const [links] = await tx.select({ n: sql<number>`count(*)::int` }).from(studentGuardians).where(eq(studentGuardians.guardianId, id));
  if ((links?.n ?? 0) > 0) throw conflict('This parent is still linked to students; unlink them first', 'GUARDIAN_HAS_LINKS');
  if (g.userId) {
    await tx.update(users).set({ status: 'deactivated', authVersion: sql`${users.authVersion} + 1` }).where(eq(users.id, g.userId));
    await revokeAllSessions(tx, ctx.tenant.id, g.userId, 'account_deactivated');
  }
  await tx.delete(guardians).where(eq(guardians.id, id));
  await audit(tx, ctx.actor, { action: 'guardian.delete', entity: 'guardian', entityId: id, summary: `Removed parent ${fullName(g.firstName, g.lastName)}`, before: { name: fullName(g.firstName, g.lastName), phone: g.phone, email: g.email, hadLogin: !!g.userId } });
}

/** Give an existing guardian (without one) a parent login. */
export async function createGuardianLogin(tx: Executor, ctx: PeopleCtx, id: string, cred: Credential): Promise<{ username: string; temporaryPassword: string }> {
  const [g] = await tx.select().from(guardians).where(and(eq(guardians.id, id), guardianVisible(ctx))).limit(1).for('update');
  if (!g) throw notFound('Parent');
  if (g.userId) throw conflict('This parent already has a login', 'GUARDIAN_HAS_LOGIN');
  const identity = loginIdentity(g);
  if (!identity) throw new AppError(422, 'CONTACT_REQUIRED', 'Add a phone number or email first; it becomes the username');
  const login = await createLogin(tx, { username: identity, displayName: fullName(g.firstName, g.lastName), userType: 'parent', email: g.email, phone: g.phone, roleKeys: ['parent'], credential: cred }, ctx.actor.userId);
  await tx.update(guardians).set({ userId: login.userId }).where(eq(guardians.id, id));
  await audit(tx, ctx.actor, { action: 'guardian.login_create', entity: 'guardian', entityId: id, summary: `Created a parent login for ${fullName(g.firstName, g.lastName)}`, after: { username: login.username } });
  return { username: login.username, temporaryPassword: login.temporaryPassword };
}

// ── links (student ↔ guardian) ──────────────────────────────────────────────────────────────────
export interface LinkEffect {
  /** the parent's login, whose cached access must be refreshed after commit (null: no login yet) */
  userId: string | null;
  studentName: string;
  changed: boolean;
}

async function loadLinkTargets(tx: Executor, ctx: PeopleCtx, studentId: string, guardianId: string) {
  await assertStudentAccess(tx, ctx.principal, 'guardians:edit', studentId);
  const [[s], [g]] = await Promise.all([
    tx.select({ first: students.firstName, last: students.lastName }).from(students).where(eq(students.id, studentId)).limit(1),
    tx.select({ id: guardians.id, userId: guardians.userId, first: guardians.firstName, last: guardians.lastName }).from(guardians).where(eq(guardians.id, guardianId)).limit(1),
  ]);
  if (!s) throw notFound('Student');
  if (!g) throw notFound('Parent');
  return { studentName: fullName(s.first, s.last), guardian: g };
}

export async function linkGuardian(tx: Executor, ctx: PeopleCtx, studentId: string, input: z.infer<typeof studentGuardianLinkBody>): Promise<LinkEffect> {
  const { studentName, guardian } = await loadLinkTargets(tx, ctx, studentId, input.guardianId);
  const [dupe] = await tx.select({ g: studentGuardians.guardianId }).from(studentGuardians).where(and(eq(studentGuardians.studentId, studentId), eq(studentGuardians.guardianId, input.guardianId))).limit(1);
  if (dupe) throw conflict('This parent is already linked to the student', 'LINK_EXISTS');
  if (input.isPrimary) await tx.update(studentGuardians).set({ isPrimary: false }).where(eq(studentGuardians.studentId, studentId));
  const [existingPrimary] = await tx.select({ g: studentGuardians.guardianId }).from(studentGuardians).where(and(eq(studentGuardians.studentId, studentId), eq(studentGuardians.isPrimary, true))).limit(1);
  const now = new Date();
  await tx.insert(studentGuardians).values({
    studentId,
    guardianId: input.guardianId,
    relationship: input.relationship,
    isPrimary: input.isPrimary ?? !existingPrimary,
    canPickup: input.canPickup ?? true,
    isEmergencyContact: input.isEmergencyContact ?? false,
    verifiedAt: input.verified ? now : null,
    verifiedBy: input.verified ? (ctx.actor.userId ?? null) : null,
  });
  await audit(tx, ctx.actor, {
    action: 'student.guardian_link',
    entity: 'student',
    entityId: studentId,
    summary: `Linked ${fullName(guardian.first, guardian.last)} to ${studentName}${input.verified ? ' (verified)' : ' (awaiting verification)'}`,
    after: { guardianId: input.guardianId, relationship: input.relationship, verified: input.verified },
  });
  return { userId: guardian.userId, studentName, changed: true };
}

export async function updateLink(tx: Executor, ctx: PeopleCtx, studentId: string, guardianId: string, patch: z.infer<typeof studentGuardianUpdateBody>): Promise<LinkEffect> {
  const { studentName, guardian } = await loadLinkTargets(tx, ctx, studentId, guardianId);
  const [before] = await tx.select().from(studentGuardians).where(and(eq(studentGuardians.studentId, studentId), eq(studentGuardians.guardianId, guardianId))).limit(1);
  if (!before) throw notFound('Link');
  const next = definedOnly(patch);
  if (!Object.keys(next).length) return { userId: guardian.userId, studentName, changed: false };
  if (next.isPrimary) await tx.update(studentGuardians).set({ isPrimary: false }).where(eq(studentGuardians.studentId, studentId));
  await tx.update(studentGuardians).set(next).where(and(eq(studentGuardians.studentId, studentId), eq(studentGuardians.guardianId, guardianId)));
  const d = diff(before, next);
  await audit(tx, ctx.actor, { action: 'student.guardian_update', entity: 'student', entityId: studentId, summary: `Updated the link between ${studentName} and ${fullName(guardian.first, guardian.last)}`, before: d.before, after: d.after });
  return { userId: guardian.userId, studentName, changed: true };
}

/** Verify (the school has checked the relationship → parent gets access) or withdraw the verification. */
export async function setLinkVerified(tx: Executor, ctx: PeopleCtx, studentId: string, guardianId: string, verified: boolean): Promise<LinkEffect> {
  const { studentName, guardian } = await loadLinkTargets(tx, ctx, studentId, guardianId);
  const [before] = await tx.select().from(studentGuardians).where(and(eq(studentGuardians.studentId, studentId), eq(studentGuardians.guardianId, guardianId))).limit(1).for('update');
  if (!before) throw notFound('Link');
  if (!!before.verifiedAt === verified) return { userId: guardian.userId, studentName, changed: false };
  await tx
    .update(studentGuardians)
    .set({ verifiedAt: verified ? new Date() : null, verifiedBy: verified ? (ctx.actor.userId ?? null) : null })
    .where(and(eq(studentGuardians.studentId, studentId), eq(studentGuardians.guardianId, guardianId)));
  await audit(tx, ctx.actor, {
    action: verified ? 'student.guardian_verify' : 'student.guardian_unverify',
    entity: 'student',
    entityId: studentId,
    summary: `${verified ? 'Verified' : 'Withdrew verification of'} ${fullName(guardian.first, guardian.last)} as a guardian of ${studentName}`,
    before: { guardianId, verified: !!before.verifiedAt },
    after: { guardianId, verified },
  });
  return { userId: guardian.userId, studentName, changed: true };
}

export async function unlinkGuardian(tx: Executor, ctx: PeopleCtx, studentId: string, guardianId: string): Promise<LinkEffect> {
  const { studentName, guardian } = await loadLinkTargets(tx, ctx, studentId, guardianId);
  const removed = await tx.delete(studentGuardians).where(and(eq(studentGuardians.studentId, studentId), eq(studentGuardians.guardianId, guardianId))).returning({ verifiedAt: studentGuardians.verifiedAt });
  if (!removed.length) throw notFound('Link');
  await audit(tx, ctx.actor, {
    action: 'student.guardian_unlink',
    entity: 'student',
    entityId: studentId,
    summary: `Unlinked ${fullName(guardian.first, guardian.last)} from ${studentName}`,
    before: { guardianId, verified: !!removed[0]!.verifiedAt },
  });
  return { userId: guardian.userId, studentName, changed: true };
}

export const guardianCreateInput = (b: z.infer<typeof guardianCreateBody>): NewGuardian => ({ firstName: b.firstName, lastName: b.lastName ?? null, phone: b.phone ?? null, email: b.email ?? null, occupation: b.occupation ?? null, address: b.address ?? null, createLogin: b.createLogin });
