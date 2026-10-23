import { and, desc, eq, gte, inArray, lte, sql, type SQL } from 'drizzle-orm';
import type { LeaveCreateBody, LeaveItem, LeaveStatus } from '@school-sync/shared';
import { audit } from '../../core/audit';
import { assertFilesExist } from '../../core/files';
import { conflict, forbidden, notFound, unprocessable } from '../../core/errors';
import { todayIn } from '../../core/http';
import { studentIdScope } from '../../core/rbac/scope';
import { getSetting } from '../../core/settings';
import type { Executor } from '../../core/tenancy/pools';
import { attendanceRecords, attendanceSessions, grades, leaveRequests, sections, staff, students } from '../../db/tenant/schema';
import { resolveStudent } from '../learning/common';
import { guardianUsers, notifyRows, type NotifyRow } from '../learning/notify';
import { addDaysIso, canDecideFor, daysBetween, fullName, holidayOn, holidaysBetween, isoWeekday, prettyDate, schoolDaysBetween, sectionLabel, userNames, type Ctx } from './common';

const MAX_LEAVE_DAYS = 60;
/** how far back a leave may start (parents often report an illness afterwards) */
const MAX_BACKDATE_DAYS = 30;

const toIso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const L = leaveRequests;

const leaveSelect = (db: Executor) =>
  db
    .select({ l: L, firstName: students.firstName, lastName: students.lastName, admissionNo: students.admissionNo, sectionNow: students.currentSectionId, sectionName: sections.name, gradeName: grades.name })
    .from(L)
    .innerJoin(students, eq(students.id, L.studentId))
    .leftJoin(sections, eq(sections.id, L.sectionId))
    .leftJoin(grades, eq(grades.id, sections.gradeId));

type LeaveRow = Awaited<ReturnType<ReturnType<typeof leaveSelect>['limit']>>[number];

async function shape(ctx: Ctx, rows: LeaveRow[]): Promise<LeaveItem[]> {
  if (!rows.length) return [];
  const { db, p } = ctx;
  const acad = await getSetting(db, 'academic');
  const from = rows.reduce((m, x) => (x.l.fromDate < m ? x.l.fromDate : m), rows[0]!.l.fromDate);
  const to = rows.reduce((m, x) => (x.l.toDate > m ? x.l.toDate : m), rows[0]!.l.toDate);
  const holidays = daysBetween(from, to) <= 800 ? await holidaysBetween(db, from, to) : [];
  const names = await userNames(db, rows.flatMap((x) => [x.l.requestedBy, x.l.decidedBy]));
  return rows.map(({ l, firstName, lastName, admissionNo, sectionNow, sectionName, gradeName }) => {
    let days = 0;
    for (let d = l.fromDate; d <= l.toDate && days < 400; d = addDaysIso(d, 1)) if (acad.workingDays.includes(isoWeekday(d)) && !holidayOn(holidays, d)) days++;
    return {
      id: l.id,
      studentId: l.studentId,
      studentName: fullName(firstName, lastName) ?? firstName,
      admissionNo,
      sectionId: l.sectionId,
      sectionName: sectionName && gradeName ? sectionLabel(gradeName, sectionName) : null,
      leaveType: l.leaveType,
      fromDate: l.fromDate,
      toDate: l.toDate,
      days,
      reason: l.reason,
      attachmentFileId: l.attachmentFileId,
      status: l.status,
      requestedBy: l.requestedBy,
      requestedByName: names.get(l.requestedBy) ?? null,
      decidedBy: l.decidedBy,
      decidedByName: l.decidedBy ? (names.get(l.decidedBy) ?? null) : null,
      decidedAt: toIso(l.decidedAt),
      decisionNote: l.decisionNote,
      createdAt: l.createdAt.toISOString(),
      canDecide: l.status === 'pending' && !!p.scope('leave:approve') && canDecideFor(p, 'leave:approve', sectionNow ?? l.sectionId),
      canCancel: l.status === 'pending' && l.requestedBy === p.userId,
    };
  });
}

// ── create ──────────────────────────────────────────────────────────────────────────────

export async function createLeave(ctx: Ctx, body: LeaveCreateBody): Promise<LeaveItem> {
  const { db, p, tenant, actor } = ctx;
  const stu = await resolveStudent(db, p, 'leave:create', body.studentId);
  if (!stu) throw notFound('Student');
  const [row] = await db.select({ status: students.status }).from(students).where(eq(students.id, stu.id)).limit(1);
  if (row?.status !== 'active') throw unprocessable('Leave can only be requested for active students', 'STUDENT_NOT_ACTIVE');

  const today = todayIn(tenant.timezone);
  if (daysBetween(body.fromDate, body.toDate) + 1 > MAX_LEAVE_DAYS) throw unprocessable(`A leave request can cover at most ${MAX_LEAVE_DAYS} days`, 'LEAVE_TOO_LONG');
  if (body.fromDate < addDaysIso(today, -MAX_BACKDATE_DAYS)) throw unprocessable(`Leave cannot start more than ${MAX_BACKDATE_DAYS} days in the past`, 'LEAVE_TOO_OLD');
  const acad = await getSetting(db, 'academic');
  const schoolDays = await schoolDaysBetween(db, acad.workingDays, body.fromDate, body.toDate);
  if (!schoolDays.length) throw unprocessable('The selected dates contain no school days', 'NO_WORKING_DAYS');
  if (body.attachmentFileId) await assertFilesExist(db, [body.attachmentFileId], { uploadedBy: p.userId });

  const created = await db.transaction(async (tx) => {
    // serialise per student so two parents cannot create overlapping requests at once
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`leave:${stu.id}`}))`);
    const [overlap] = await tx
      .select({ id: L.id })
      .from(L)
      .where(and(eq(L.studentId, stu.id), inArray(L.status, ['pending', 'approved']), lte(L.fromDate, body.toDate), gte(L.toDate, body.fromDate)))
      .limit(1);
    if (overlap) throw conflict('A leave request for these dates already exists', 'LEAVE_OVERLAP');
    const [l] = await tx
      .insert(L)
      .values({ studentId: stu.id, sectionId: stu.sectionId, requestedBy: p.userId, leaveType: body.leaveType, fromDate: body.fromDate, toDate: body.toDate, reason: body.reason.trim(), attachmentFileId: body.attachmentFileId ?? null })
      .returning();
    await audit(tx, actor, { action: 'leave.request', entity: 'leave_request', entityId: l!.id, summary: `${stu.name}: ${body.fromDate} → ${body.toDate}`, after: { studentId: stu.id, leaveType: body.leaveType, fromDate: body.fromDate, toDate: body.toDate } });
    return l!;
  });

  // tell the class teacher
  try {
    if (stu.sectionId) {
      const [ct] = await db.select({ userId: staff.userId }).from(sections).innerJoin(staff, eq(staff.id, sections.classTeacherId)).where(eq(sections.id, stu.sectionId)).limit(1);
      if (ct?.userId && ct.userId !== p.userId) await notifyRows(db, tenant, [{ userId: ct.userId, type: 'leave.requested', title: 'Leave request', body: 'A leave request is waiting for your decision.', data: { route: `/leave/${created.id}`, id: created.id } }]);
    }
  } catch (err) {
    ctx.log.error({ err }, 'leave request notification failed');
  }
  return (await getLeave(ctx, created.id))!;
}

// ── read ────────────────────────────────────────────────────────────────────────────────

export interface LeaveListQuery {
  status?: LeaveStatus | undefined;
  studentId?: string | undefined;
  sectionId?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  page: number;
  pageSize: number;
}

export async function listLeave(ctx: Ctx, q: LeaveListQuery) {
  const { db, p } = ctx;
  const conds: (SQL | undefined)[] = [
    studentIdScope(p, 'leave:view', L.studentId),
    q.status ? eq(L.status, q.status) : undefined,
    q.studentId ? eq(L.studentId, q.studentId) : undefined,
    q.sectionId ? eq(L.sectionId, q.sectionId) : undefined,
    q.from ? gte(L.toDate, q.from) : undefined,
    q.to ? lte(L.fromDate, q.to) : undefined,
  ];
  const where = and(...conds);
  const [rows, [cnt]] = await Promise.all([
    leaveSelect(db)
      .where(where)
      // pending first (what needs action), then newest
      .orderBy(sql`case ${L.status} when 'pending' then 0 else 1 end`, desc(L.fromDate), desc(L.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db.select({ n: sql<number>`count(*)::int` }).from(L).where(where),
  ]);
  return { rows: await shape(ctx, rows), total: cnt?.n ?? 0 };
}

export async function getLeave(ctx: Ctx, id: string): Promise<LeaveItem | null> {
  const rows = await leaveSelect(ctx.db).where(and(eq(L.id, id), studentIdScope(ctx.p, 'leave:view', L.studentId))).limit(1);
  return (await shape(ctx, rows))[0] ?? null;
}

export async function getLeaveOr404(ctx: Ctx, id: string): Promise<LeaveItem> {
  const item = await getLeave(ctx, id);
  if (!item) throw notFound('Leave request');
  return item;
}

// ── decide ──────────────────────────────────────────────────────────────────────────────

export async function decideLeave(ctx: Ctx, id: string, decision: 'approved' | 'rejected', note: string | undefined): Promise<LeaveItem> {
  const { db, p, actor } = ctx;
  if (decision === 'rejected' && !note?.trim()) throw unprocessable('Say why the request is rejected', 'NOTE_REQUIRED');
  const out = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ l: L, sectionNow: students.currentSectionId })
      .from(L)
      .innerJoin(students, eq(students.id, L.studentId))
      .where(and(eq(L.id, id), studentIdScope(p, 'leave:approve', L.studentId)))
      .for('update', { of: L })
      .limit(1);
    if (!row) throw notFound('Leave request');
    const sectionId = row.sectionNow ?? row.l.sectionId;
    if (!canDecideFor(p, 'leave:approve', sectionId)) throw forbidden('Only the class teacher of this student (or the school office) can decide leave', 'NOT_CLASS_TEACHER');
    if (row.l.status !== 'pending') throw conflict('This request was already decided or cancelled', 'ALREADY_DECIDED');

    await tx.update(L).set({ status: decision, decidedBy: p.userId, decidedAt: new Date(), decisionNote: note?.trim() || null }).where(eq(L.id, id));
    let marked = { updated: 0, inserted: 0, draftSessions: 0 };
    if (decision === 'approved') {
      const att = await getSetting(tx, 'attendance');
      if (att.leaveMarksAttendance && sectionId) marked = await applyLeaveToAttendance(tx, { studentId: row.l.studentId, sectionId, fromDate: row.l.fromDate, toDate: row.l.toDate, userId: p.userId, createDrafts: att.mode === 'daily' });
    }
    await audit(tx, actor, {
      action: decision === 'approved' ? 'leave.approve' : 'leave.reject',
      entity: 'leave_request',
      entityId: id,
      summary: `${row.l.fromDate} → ${row.l.toDate} ${decision}`,
      before: { status: 'pending' },
      after: { status: decision, studentId: row.l.studentId, fromDate: row.l.fromDate, toDate: row.l.toDate, note: note ?? null, attendance: marked },
    });
    return row.l;
  });

  try {
    const [stu] = await db.select({ userId: students.userId }).from(students).where(eq(students.id, out.studentId)).limit(1);
    const links = await guardianUsers(db, [out.studentId]);
    const recipients = new Set([...links.map((x) => x.userId), out.requestedBy, ...(stu?.userId ? [stu.userId] : [])]);
    const range = out.fromDate === out.toDate ? prettyDate(out.fromDate) : `${prettyDate(out.fromDate)} to ${prettyDate(out.toDate)}`;
    const rows: NotifyRow[] = [...recipients].map((userId) => ({ userId, type: 'leave.decided', title: 'Leave request update', body: `The leave request for ${range} was ${decision}.`, data: { route: `/leave/${id}`, id, status: decision } }));
    await notifyRows(db, ctx.tenant, rows);
  } catch (err) {
    ctx.log.error({ err }, 'leave decision notification failed');
  }
  return getLeaveOr404(ctx, id);
}

/**
 * Approved leave → attendance `leave`: existing sessions of the student's section get/keep a `leave` record, and in
 * daily mode a draft session (with just this student's `leave` mark) is created for school days that have none yet, so
 * the roll call opens pre-marked. (Period mode: only existing sessions change; the roster pre-fills the rest.)
 */
export async function applyLeaveToAttendance(
  tx: Executor,
  o: { studentId: string; sectionId: string; fromDate: string; toDate: string; userId: string; createDrafts: boolean },
): Promise<{ updated: number; inserted: number; draftSessions: number }> {
  const acad = await getSetting(tx, 'academic');
  const days = await schoolDaysBetween(tx, acad.workingDays, o.fromDate, o.toDate);
  const out = { updated: 0, inserted: 0, draftSessions: 0 };
  if (!days.length) return out;

  let sess = await tx.select({ id: attendanceSessions.id, date: attendanceSessions.date, periodId: attendanceSessions.periodId }).from(attendanceSessions).where(and(eq(attendanceSessions.sectionId, o.sectionId), inArray(attendanceSessions.date, days)));
  if (o.createDrafts) {
    const have = new Set(sess.filter((s) => s.periodId === null).map((s) => s.date));
    const missing = days.filter((d) => !have.has(d));
    if (missing.length) {
      const created = await tx.insert(attendanceSessions).values(missing.map((date) => ({ sectionId: o.sectionId, date, periodId: null, status: 'draft' as const }))).onConflictDoNothing().returning({ id: attendanceSessions.id });
      out.draftSessions = created.length;
      sess = await tx.select({ id: attendanceSessions.id, date: attendanceSessions.date, periodId: attendanceSessions.periodId }).from(attendanceSessions).where(and(eq(attendanceSessions.sectionId, o.sectionId), inArray(attendanceSessions.date, days)));
    }
  }
  if (!sess.length) return out;
  const recs = await tx.select({ id: attendanceRecords.id, sessionId: attendanceRecords.sessionId, status: attendanceRecords.status }).from(attendanceRecords).where(and(eq(attendanceRecords.studentId, o.studentId), inArray(attendanceRecords.sessionId, sess.map((s) => s.id))));
  const bySession = new Map(recs.map((x) => [x.sessionId, x]));
  const toUpdate: string[] = [];
  const toInsert: (typeof attendanceRecords.$inferInsert)[] = [];
  for (const s of sess) {
    const rec = bySession.get(s.id);
    if (!rec) toInsert.push({ sessionId: s.id, studentId: o.studentId, sectionId: o.sectionId, date: s.date, status: 'leave', updatedBy: o.userId });
    else if (rec.status !== 'leave') toUpdate.push(rec.id);
  }
  if (toUpdate.length) await tx.update(attendanceRecords).set({ status: 'leave', updatedBy: o.userId, updatedAt: new Date() }).where(inArray(attendanceRecords.id, toUpdate));
  if (toInsert.length) await tx.insert(attendanceRecords).values(toInsert).onConflictDoNothing();
  out.updated = toUpdate.length;
  out.inserted = toInsert.length;
  return out;
}

// ── cancel ──────────────────────────────────────────────────────────────────────────────

export async function cancelLeave(ctx: Ctx, id: string): Promise<LeaveItem> {
  const { db, p, actor } = ctx;
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ l: L })
      .from(L)
      .where(and(eq(L.id, id), studentIdScope(p, 'leave:view', L.studentId)))
      .for('update')
      .limit(1);
    if (!row) throw notFound('Leave request');
    if (row.l.requestedBy !== p.userId) throw forbidden('Only the person who applied can cancel a leave request', 'NOT_REQUESTER');
    if (row.l.status !== 'pending') throw conflict('Only pending requests can be cancelled', 'NOT_PENDING');
    await tx.update(L).set({ status: 'cancelled' }).where(eq(L.id, id));
    await audit(tx, actor, { action: 'leave.cancel', entity: 'leave_request', entityId: id, before: { status: 'pending' }, after: { status: 'cancelled' } });
  });
  return getLeaveOr404(ctx, id);
}

