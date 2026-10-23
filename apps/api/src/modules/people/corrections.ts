import { and, desc, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { CORRECTION_FIELDS, correctionChanges, type CorrectionOut, type correctionCreateBody, type correctionListQuery } from '@school-sync/shared';
import { audit } from '../../core/audit';
import { AppError, notFound } from '../../core/errors';
import type { Executor } from '../../core/tenancy/pools';
import { recordCorrectionRequests, rolePermissions, userRoles, users, students } from '../../db/tenant/schema';
import { fullName, iso, type PeopleCtx } from './util';

type Row = typeof recordCorrectionRequests.$inferSelect;
const MAX_PENDING_PER_USER = 5;

const toOut = (r: Row, s: { first: string; last: string | null; admissionNo: string }, requester: string | null): CorrectionOut => ({
  id: r.id,
  studentId: r.studentId,
  studentName: fullName(s.first, s.last),
  admissionNo: s.admissionNo,
  requestedBy: r.requestedBy,
  requestedByName: requester,
  requesterRole: r.requesterRole,
  changes: r.changes,
  original: r.original,
  reason: r.reason,
  status: r.status,
  decidedBy: r.decidedBy,
  decidedAt: iso(r.decidedAt),
  decisionNote: r.decisionNote,
  createdAt: r.createdAt.toISOString(),
});

const base = (db: Executor) =>
  db
    .select({ r: recordCorrectionRequests, first: students.firstName, last: students.lastName, admissionNo: students.admissionNo, requester: users.displayName })
    .from(recordCorrectionRequests)
    .innerJoin(students, eq(students.id, recordCorrectionRequests.studentId))
    .leftJoin(users, eq(users.id, recordCorrectionRequests.requestedBy));

/** Reviewers see everything; a parent or student only ever sees the requests they filed themselves. */
const visible = (ctx: PeopleCtx) => (ctx.principal.can('students:edit', 'school') ? sql`true` : eq(recordCorrectionRequests.requestedBy, ctx.principal.userId));

export async function listCorrections(db: Executor, ctx: PeopleCtx, q: z.infer<typeof correctionListQuery>) {
  const where = and(visible(ctx), q.status ? eq(recordCorrectionRequests.status, q.status) : undefined, q.studentId ? eq(recordCorrectionRequests.studentId, q.studentId) : undefined);
  const [rows, [total]] = await Promise.all([
    base(db)
      .where(where)
      .orderBy(desc(recordCorrectionRequests.createdAt), desc(recordCorrectionRequests.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db.select({ n: sql<number>`count(*)::int` }).from(recordCorrectionRequests).where(where),
  ]);
  return { rows: rows.map((r) => toOut(r.r, { first: r.first, last: r.last, admissionNo: r.admissionNo }, r.requester)), total: total?.n ?? 0 };
}

export async function getCorrection(db: Executor, ctx: PeopleCtx, id: string): Promise<CorrectionOut> {
  const [r] = await base(db).where(and(eq(recordCorrectionRequests.id, id), visible(ctx))).limit(1);
  if (!r) throw notFound('Correction request');
  return toOut(r.r, { first: r.first, last: r.last, admissionNo: r.admissionNo }, r.requester);
}

/** Active users who may decide on corrections (school-wide students:edit). */
export async function correctionReviewerIds(db: Executor): Promise<string[]> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
    .where(and(eq(users.status, 'active'), eq(rolePermissions.permission, 'students:edit'), eq(rolePermissions.scope, 'school')))
    .groupBy(users.id);
  return rows.map((r) => r.id);
}

type StudentRow = typeof students.$inferSelect;
const valueOf = (s: StudentRow, field: (typeof CORRECTION_FIELDS)[number]): unknown => s[field] ?? null;

/** A linked parent (verified) or the student themselves asks for a correction. Nothing changes until a reviewer approves. */
export async function createCorrection(tx: Executor, ctx: PeopleCtx, studentId: string, input: z.infer<typeof correctionCreateBody>): Promise<string> {
  const p = ctx.principal;
  const role: 'parent' | 'student' | null = p.userType === 'student' && p.studentId === studentId ? 'student' : p.userType === 'parent' && p.linkedStudentIds.includes(studentId) ? 'parent' : null;
  // anyone else gets "not found" — whether the student exists is none of their business
  if (!role) throw notFound('Student');
  const [s] = await tx.select().from(students).where(eq(students.id, studentId)).limit(1);
  if (!s) throw notFound('Student');

  const changes = input.changes as Record<string, unknown>;
  const fields = Object.keys(changes) as (typeof CORRECTION_FIELDS)[number][];
  const original: Record<string, unknown> = {};
  let different = false;
  for (const f of fields) {
    original[f] = valueOf(s, f);
    if (JSON.stringify(original[f]) !== JSON.stringify(changes[f] ?? null)) different = true;
  }
  if (!different) throw new AppError(422, 'NO_CHANGE', 'The proposed values are the same as the current record');
  const [open] = await tx.select({ n: sql<number>`count(*)::int` }).from(recordCorrectionRequests).where(and(eq(recordCorrectionRequests.requestedBy, p.userId), eq(recordCorrectionRequests.status, 'pending')));
  if ((open?.n ?? 0) >= MAX_PENDING_PER_USER) throw new AppError(429, 'TOO_MANY_PENDING', 'You already have several requests waiting for the school; wait for a decision first');

  const [row] = await tx.insert(recordCorrectionRequests).values({ studentId, requestedBy: p.userId, requesterRole: role, changes, original, reason: input.reason }).returning({ id: recordCorrectionRequests.id });
  await audit(tx, ctx.actor, { action: 'student.correction_request', entity: 'student', entityId: studentId, summary: `${role === 'parent' ? 'Parent' : 'Student'} asked to correct ${fields.join(', ')} for ${fullName(s.firstName, s.lastName)}`, after: { requestId: row!.id, fields } });
  return row!.id;
}

/** Reviewer decision. Approval applies the change to the student record in the same transaction. Returns the requester's user id (for the notification). */
export async function decideCorrection(tx: Executor, ctx: PeopleCtx, id: string, decision: 'approved' | 'rejected', note?: string): Promise<{ requesterId: string; studentId: string }> {
  const [r] = await tx.select().from(recordCorrectionRequests).where(eq(recordCorrectionRequests.id, id)).limit(1).for('update');
  if (!r) throw notFound('Correction request');
  if (r.status !== 'pending') throw new AppError(409, 'NOT_PENDING', `This request is already ${r.status}`);
  const [s] = await tx.select().from(students).where(eq(students.id, r.studentId)).limit(1).for('update');
  if (!s) throw notFound('Student');

  let applied: Record<string, unknown> | null = null;
  if (decision === 'approved') {
    // never trust stored JSON blindly: re-validate against the whitelist before touching the record
    const parsed = correctionChanges.safeParse(r.changes);
    if (!parsed.success) throw new AppError(422, 'INVALID_CHANGES', 'The stored request is not valid any more');
    applied = parsed.data as Record<string, unknown>;
    const before: Record<string, unknown> = {};
    for (const f of Object.keys(applied) as (typeof CORRECTION_FIELDS)[number][]) before[f] = valueOf(s, f);
    await tx.update(students).set(applied as Partial<typeof students.$inferInsert>).where(eq(students.id, s.id));
    if (s.userId && ('firstName' in applied || 'lastName' in applied)) {
      await tx
        .update(users)
        .set({ displayName: fullName((applied.firstName as string | undefined) ?? s.firstName, 'lastName' in applied ? (applied.lastName as string | null) : s.lastName) })
        .where(eq(users.id, s.userId));
    }
    const mask = (o: Record<string, unknown>) => (o.medicalNotes !== undefined ? { ...o, medicalNotes: '[changed]' } : o);
    await audit(tx, ctx.actor, { action: 'student.update', entity: 'student', entityId: s.id, summary: `Applied approved correction request for ${fullName(s.firstName, s.lastName)}`, before: mask(before), after: mask(applied) });
  }
  await tx.update(recordCorrectionRequests).set({ status: decision, decidedBy: ctx.actor.userId ?? null, decidedAt: new Date(), decisionNote: note ?? null }).where(eq(recordCorrectionRequests.id, id));
  await audit(tx, ctx.actor, {
    action: decision === 'approved' ? 'student.correction_approve' : 'student.correction_reject',
    entity: 'student',
    entityId: s.id,
    summary: `${decision === 'approved' ? 'Approved' : 'Rejected'} a correction request for ${fullName(s.firstName, s.lastName)}${note ? ` — ${note}` : ''}`,
    after: { requestId: id, fields: Object.keys(r.changes), note: note ?? null },
  });
  return { requesterId: r.requestedBy, studentId: s.id };
}

/** The person who filed it withdraws a request that is still pending. */
export async function cancelCorrection(tx: Executor, ctx: PeopleCtx, id: string): Promise<void> {
  const [r] = await tx.select().from(recordCorrectionRequests).where(and(eq(recordCorrectionRequests.id, id), eq(recordCorrectionRequests.requestedBy, ctx.principal.userId))).limit(1).for('update');
  if (!r) throw notFound('Correction request');
  if (r.status !== 'pending') throw new AppError(409, 'NOT_PENDING', `This request is already ${r.status}`);
  await tx.update(recordCorrectionRequests).set({ status: 'cancelled', decidedAt: new Date() }).where(eq(recordCorrectionRequests.id, id));
  await audit(tx, ctx.actor, { action: 'student.correction_cancel', entity: 'student', entityId: r.studentId, summary: 'Withdrew a correction request', after: { requestId: id } });
}
