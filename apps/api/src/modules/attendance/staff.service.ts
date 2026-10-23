import { and, asc, desc, eq, gte, inArray, isNull, lte, sql, type SQL } from 'drizzle-orm';
import type { AttendanceStatus, StaffAttendanceItem, StaffAttendanceRecord, StaffLeaveItem, LeaveStatus } from '@school-sync/shared';
import { audit } from '../../core/audit';
import { AppError, conflict, forbidden, notFound, unprocessable } from '../../core/errors';
import { ilikeAny, isoWeekday, todayIn } from '../../core/http';
import { getSetting } from '../../core/settings';
import type { Executor } from '../../core/tenancy/pools';
import { periods, staff, staffAttendance, staffLeaveRequests } from '../../db/tenant/schema';
import { notifyRows } from '../learning/notify';
import {
  addDaysIso,
  currentYear,
  daysBetween,
  emptyCounts,
  fullName,
  holidayOn,
  holidaysBetween,
  localTime,
  prettyDate,
  schoolDaysBetween,
  statusCountCols,
  totalsOf,
  userNames,
  usersWithPermission,
  type Ctx,
} from './common';

const SA = staffAttendance;
const SL = staffLeaveRequests;
const hhmm = (t: string | null | undefined) => (t ? t.slice(0, 5) : null);
const toIso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
/** a teacher checking in later than this many minutes after the first period starts is `late` */
const LATE_GRACE_MINUTES = 10;
const MAX_LEAVE_DAYS = 60;
const MAX_BACKDATE_DAYS = 30;

const recordOf = (r: typeof SA.$inferSelect): StaffAttendanceRecord => ({ id: r.id, staffId: r.staffId, date: r.date, status: r.status, checkIn: hhmm(r.checkIn), checkOut: hhmm(r.checkOut), note: r.note });

/** Rules shared by HR bulk marking and self check-in. */
async function assertSchoolDay(db: Executor, date: string, today: string): Promise<void> {
  if (date > today) throw unprocessable('Attendance cannot be recorded for a future date', 'FUTURE_DATE');
  const acad = await getSetting(db, 'academic');
  if (!acad.workingDays.includes(isoWeekday(date))) throw unprocessable('That date is not a school working day', 'NOT_A_WORKING_DAY');
  const holiday = holidayOn(await holidaysBetween(db, date, date), date);
  if (holiday) throw unprocessable(`That date is a holiday (${holiday})`, 'HOLIDAY');
}

const onLeaveOn = (date: string) => sql<boolean>`exists (select 1 from ${SL} l where l.staff_id = ${staff.id} and l.status = 'approved' and l.from_date <= ${date}::date and l.to_date >= ${date}::date)`;

// ── roster (HR) ─────────────────────────────────────────────────────────────────────────

export async function listStaffAttendance(ctx: Ctx, q: { date?: string | undefined; department?: string | undefined; q?: string | undefined; page: number; pageSize: number }) {
  const { db, p, tenant } = ctx;
  const date = q.date ?? todayIn(tenant.timezone);
  const school = p.can('staff_attendance:view', 'school');
  const conds: (SQL | undefined)[] = [
    inArray(staff.status, ['active', 'on_leave']),
    school ? undefined : p.staffId ? eq(staff.id, p.staffId) : sql`false`,
    q.department ? eq(staff.department, q.department) : undefined,
    q.q ? ilikeAny(q.q, staff.firstName, staff.lastName, staff.employeeId) : undefined,
  ];
  const where = and(...conds);
  const [rows, countRows, [total]] = await Promise.all([
    db
      .select({ s: staff, rec: SA, onLeave: onLeaveOn(date) })
      .from(staff)
      .leftJoin(SA, and(eq(SA.staffId, staff.id), eq(SA.date, date)))
      .where(where)
      .orderBy(asc(staff.firstName), asc(staff.employeeId))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db.select({ ...statusCountCols(SA.status) }).from(staff).innerJoin(SA, and(eq(SA.staffId, staff.id), eq(SA.date, date))).where(where),
    db.select({ n: sql<number>`count(*)::int` }).from(staff).where(where),
  ]);
  const c = countRows[0] ?? emptyCounts();
  const totalStaff = total?.n ?? 0;
  const marked = c.present + c.absent + c.late + c.leave + c.half_day;
  const data: StaffAttendanceItem[] = rows.map(({ s, rec, onLeave }) => ({
    staffId: s.id,
    name: fullName(s.firstName, s.lastName) ?? s.firstName,
    employeeId: s.employeeId,
    designation: s.designation,
    department: s.department,
    recordId: rec?.id ?? null,
    status: rec?.status ?? null,
    checkIn: hhmm(rec?.checkIn),
    checkOut: hhmm(rec?.checkOut),
    note: rec?.note ?? null,
    onApprovedLeave: onLeave,
  }));
  return { rows: data, total: totalStaff, date, counts: { present: c.present, absent: c.absent, late: c.late, leave: c.leave, half_day: c.half_day, unmarked: Math.max(0, totalStaff - marked) } };
}

export async function markStaffAttendance(ctx: Ctx, body: { date?: string | undefined; records: { staffId: string; status: AttendanceStatus; checkIn?: string | null | undefined; checkOut?: string | null | undefined; note?: string | null | undefined }[] }) {
  const { db, p, tenant, actor } = ctx;
  const today = todayIn(tenant.timezone);
  const date = body.date ?? today;
  await assertSchoolDay(db, date, today);
  const seen = new Set<string>();
  for (const r of body.records) {
    if (seen.has(r.staffId)) throw unprocessable('A staff member is listed twice', 'DUPLICATE_STAFF');
    seen.add(r.staffId);
    if (r.checkIn && r.checkOut && r.checkOut < r.checkIn) throw new AppError(422, 'INVALID_TIMES', 'Check-out is before check-in', { staffId: r.staffId });
  }
  const ids = [...seen];
  const known = await db.select({ id: staff.id }).from(staff).where(and(inArray(staff.id, ids), inArray(staff.status, ['active', 'on_leave'])));
  if (known.length !== ids.length) {
    const ok = new Set(known.map((k) => k.id));
    throw new AppError(422, 'STAFF_NOT_FOUND', 'A listed staff member does not exist or is no longer active', { staffIds: ids.filter((i) => !ok.has(i)) });
  }

  const counts = emptyCounts();
  await db.transaction(async (tx) => {
    const before = await tx.select({ staffId: SA.staffId, status: SA.status }).from(SA).where(and(eq(SA.date, date), inArray(SA.staffId, ids)));
    for (let i = 0; i < body.records.length; i += 500) {
      const chunk = body.records.slice(i, i + 500);
      await tx
        .insert(SA)
        .values(chunk.map((r) => ({ staffId: r.staffId, date, status: r.status, checkIn: r.checkIn ?? null, checkOut: r.checkOut ?? null, note: r.note?.trim() || null, markedBy: p.userId })))
        .onConflictDoUpdate({ target: [SA.staffId, SA.date], set: { status: sql`excluded.status`, checkIn: sql`excluded.check_in`, checkOut: sql`excluded.check_out`, note: sql`excluded.note`, markedBy: p.userId } });
    }
    for (const r of body.records) counts[r.status]++;
    const prev = emptyCounts();
    for (const b of before) prev[b.status]++;
    await audit(tx, actor, { action: 'staff_attendance.mark', entity: 'staff_attendance', entityId: null, summary: `${date}: ${body.records.length} staff marked`, before: before.length ? { counts: prev, records: before.length } : null, after: { date, counts, records: body.records.length } });
  });
  return { date, saved: body.records.length, counts };
}

export async function updateStaffRecord(ctx: Ctx, id: string, body: { status?: AttendanceStatus | undefined; checkIn?: string | null | undefined; checkOut?: string | null | undefined; note?: string | null | undefined }): Promise<StaffAttendanceRecord> {
  const { db, actor, p } = ctx;
  return db.transaction(async (tx) => {
    const [cur] = await tx.select().from(SA).where(eq(SA.id, id)).for('update').limit(1);
    if (!cur) throw notFound('Staff attendance record');
    const next = { status: body.status ?? cur.status, checkIn: body.checkIn === undefined ? cur.checkIn : (body.checkIn ?? null), checkOut: body.checkOut === undefined ? cur.checkOut : (body.checkOut ?? null), note: body.note === undefined ? cur.note : (body.note?.trim() || null) };
    if (next.checkIn && next.checkOut && next.checkOut.slice(0, 5) < next.checkIn.slice(0, 5)) throw unprocessable('Check-out is before check-in', 'INVALID_TIMES');
    const [row] = await tx.update(SA).set({ ...next, markedBy: p.userId }).where(eq(SA.id, id)).returning();
    await audit(tx, actor, { action: 'staff_attendance.update', entity: 'staff_attendance', entityId: id, summary: cur.date, before: { status: cur.status, checkIn: hhmm(cur.checkIn), checkOut: hhmm(cur.checkOut), note: cur.note }, after: { status: next.status, checkIn: hhmm(next.checkIn), checkOut: hhmm(next.checkOut), note: next.note } });
    return recordOf(row!);
  });
}

// ── self service ────────────────────────────────────────────────────────────────────────

function requireStaffId(ctx: Ctx): string {
  if (!ctx.p.staffId) throw forbidden('Only staff members can record their own attendance', 'NOT_STAFF');
  return ctx.p.staffId;
}

export async function checkIn(ctx: Ctx): Promise<StaffAttendanceRecord> {
  const { db, tenant, actor, p } = ctx;
  const staffId = requireStaffId(ctx);
  const now = new Date();
  const today = todayIn(tenant.timezone, now);
  await assertSchoolDay(db, today, today);
  const time = localTime(now, tenant.timezone);
  const [first] = await db.select({ start: periods.startTime }).from(periods).where(eq(periods.isBreak, false)).orderBy(asc(periods.ordinal)).limit(1);
  let status: AttendanceStatus = 'present';
  if (first) {
    const [h, m] = first.start.slice(0, 5).split(':').map(Number) as [number, number];
    if (time > `${String(Math.floor((h * 60 + m + LATE_GRACE_MINUTES) / 60)).padStart(2, '0')}:${String((h * 60 + m + LATE_GRACE_MINUTES) % 60).padStart(2, '0')}`) status = 'late';
  }
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(SA).where(and(eq(SA.staffId, staffId), eq(SA.date, today))).for('update').limit(1);
    if (existing?.checkIn) throw conflict('You already checked in today', 'ALREADY_CHECKED_IN');
    if (existing) throw conflict('Your attendance for today was already recorded by the office', 'ALREADY_MARKED');
    const [row] = await tx.insert(SA).values({ staffId, date: today, status, checkIn: time, markedBy: p.userId }).onConflictDoNothing().returning();
    if (!row) throw conflict('You already checked in today', 'ALREADY_CHECKED_IN');
    await audit(tx, actor, { action: 'staff_attendance.check_in', entity: 'staff_attendance', entityId: row.id, summary: `${today} ${time}`, after: { status, checkIn: time } });
    return recordOf(row);
  });
}

export async function checkOut(ctx: Ctx): Promise<StaffAttendanceRecord> {
  const { db, tenant, actor, p } = ctx;
  const staffId = requireStaffId(ctx);
  const now = new Date();
  const today = todayIn(tenant.timezone, now);
  const time = localTime(now, tenant.timezone);
  return db.transaction(async (tx) => {
    const [cur] = await tx.select().from(SA).where(and(eq(SA.staffId, staffId), eq(SA.date, today))).for('update').limit(1);
    if (!cur?.checkIn) throw conflict('Check in first', 'NOT_CHECKED_IN');
    if (cur.checkOut) throw conflict('You already checked out today', 'ALREADY_CHECKED_OUT');
    const [row] = await tx.update(SA).set({ checkOut: time, markedBy: p.userId }).where(eq(SA.id, cur.id)).returning();
    await audit(tx, actor, { action: 'staff_attendance.check_out', entity: 'staff_attendance', entityId: cur.id, summary: `${today} ${time}`, before: { checkOut: null }, after: { checkOut: time } });
    return recordOf(row!);
  });
}

export async function myStaffAttendance(ctx: Ctx, q: { from?: string | undefined; to?: string | undefined }) {
  const { db, tenant } = ctx;
  const staffId = requireStaffId(ctx);
  const today = todayIn(tenant.timezone);
  const to = q.to ?? today;
  const from = q.from ?? addDaysIso(to, -29);
  if (from > to) throw unprocessable('`from` must not be after `to`', 'INVALID_RANGE');
  if (daysBetween(from, to) > 366) throw unprocessable('The date range is limited to 366 days', 'RANGE_TOO_LARGE');
  const rows = await db.select().from(SA).where(and(eq(SA.staffId, staffId), gte(SA.date, from), lte(SA.date, to))).orderBy(desc(SA.date));
  const counts = emptyCounts();
  for (const r of rows) counts[r.status]++;
  const [todayRow] = await db.select().from(SA).where(and(eq(SA.staffId, staffId), eq(SA.date, today))).limit(1);
  return { staffId, from, to, today: todayRow ? recordOf(todayRow) : null, totals: totalsOf(counts), records: rows.map(recordOf) };
}

// ── summaries & export ────────────────────────────────────────────────────────────────────

export async function staffSummary(ctx: Ctx, q: { from?: string | undefined; to?: string | undefined; department?: string | undefined }) {
  const { db, tenant } = ctx;
  const today = todayIn(tenant.timezone);
  const to = q.to ?? today;
  const from = q.from ?? `${to.slice(0, 7)}-01`;
  if (from > to) throw unprocessable('`from` must not be after `to`', 'INVALID_RANGE');
  if (daysBetween(from, to) > 366) throw unprocessable('The date range is limited to 366 days', 'RANGE_TOO_LARGE');
  const base = [inArray(staff.status, ['active', 'on_leave']), q.department ? eq(staff.department, q.department) : undefined];
  const [perStaff, dayCounts, [total]] = await Promise.all([
    db
      .select({ s: { id: staff.id, firstName: staff.firstName, lastName: staff.lastName, employeeId: staff.employeeId, designation: staff.designation, department: staff.department }, ...statusCountCols(SA.status) })
      .from(staff)
      .leftJoin(SA, and(eq(SA.staffId, staff.id), gte(SA.date, from), lte(SA.date, to)))
      .where(and(...base))
      .groupBy(staff.id)
      .orderBy(asc(staff.firstName), asc(staff.employeeId))
      .limit(1000),
    db.select({ ...statusCountCols(SA.status) }).from(staff).innerJoin(SA, and(eq(SA.staffId, staff.id), eq(SA.date, to))).where(and(...base)),
    db.select({ n: sql<number>`count(*)::int` }).from(staff).where(and(...base)),
  ]);
  const d = dayCounts[0] ?? emptyCounts();
  const marked = d.present + d.absent + d.late + d.leave + d.half_day;
  return {
    from,
    to,
    today: { date: to, present: d.present, absent: d.absent, late: d.late, leave: d.leave, half_day: d.half_day, unmarked: Math.max(0, (total?.n ?? 0) - marked) },
    staff: perStaff.map((r) => ({ ...totalsOf(r), staffId: r.s.id, name: fullName(r.s.firstName, r.s.lastName) ?? r.s.firstName, employeeId: r.s.employeeId, designation: r.s.designation, department: r.s.department })),
  };
}

export async function* exportStaffRows(ctx: Ctx, q: { from: string; to: string }): AsyncGenerator<(string | number | null)[]> {
  const { db } = ctx;
  if (q.from > q.to) throw unprocessable('`from` must not be after `to`', 'INVALID_RANGE');
  if (daysBetween(q.from, q.to) > 93) throw unprocessable('Exports are limited to 93 days', 'RANGE_TOO_LARGE');
  const rows = await db
    .select({ date: SA.date, employeeId: staff.employeeId, firstName: staff.firstName, lastName: staff.lastName, department: staff.department, status: SA.status, checkIn: SA.checkIn, checkOut: SA.checkOut, note: SA.note })
    .from(SA)
    .innerJoin(staff, eq(staff.id, SA.staffId))
    .where(and(gte(SA.date, q.from), lte(SA.date, q.to)))
    .orderBy(asc(SA.date), asc(staff.employeeId))
    .limit(200_000);
  for (const x of rows) yield [x.date, x.employeeId, fullName(x.firstName, x.lastName), x.department, x.status, hhmm(x.checkIn), hhmm(x.checkOut), x.note];
}

// ── staff leave ─────────────────────────────────────────────────────────────────────────

const leaveSelect = (db: Executor) =>
  db
    .select({ l: SL, firstName: staff.firstName, lastName: staff.lastName, employeeId: staff.employeeId, designation: staff.designation })
    .from(SL)
    .innerJoin(staff, eq(staff.id, SL.staffId));
type SlRow = Awaited<ReturnType<ReturnType<typeof leaveSelect>['limit']>>[number];

async function shapeLeave(ctx: Ctx, rows: SlRow[]): Promise<StaffLeaveItem[]> {
  if (!rows.length) return [];
  const { db, p } = ctx;
  const acad = await getSetting(db, 'academic');
  const from = rows.reduce((m, x) => (x.l.fromDate < m ? x.l.fromDate : m), rows[0]!.l.fromDate);
  const to = rows.reduce((m, x) => (x.l.toDate > m ? x.l.toDate : m), rows[0]!.l.toDate);
  const holidays = daysBetween(from, to) <= 800 ? await holidaysBetween(db, from, to) : [];
  const names = await userNames(db, rows.map((x) => x.l.decidedBy));
  const approver = p.can('staff_leave:approve', 'school');
  return rows.map(({ l, firstName, lastName, employeeId, designation }) => {
    let days = 0;
    for (let d = l.fromDate; d <= l.toDate && days < 400; d = addDaysIso(d, 1)) if (acad.workingDays.includes(isoWeekday(d)) && !holidayOn(holidays, d)) days++;
    return {
      id: l.id,
      staffId: l.staffId,
      staffName: fullName(firstName, lastName) ?? firstName,
      employeeId,
      designation,
      leaveType: l.leaveType,
      fromDate: l.fromDate,
      toDate: l.toDate,
      days,
      reason: l.reason,
      status: l.status,
      decidedBy: l.decidedBy,
      decidedByName: l.decidedBy ? (names.get(l.decidedBy) ?? null) : null,
      decidedAt: toIso(l.decidedAt),
      decisionNote: l.decisionNote,
      createdAt: l.createdAt.toISOString(),
      canDecide: l.status === 'pending' && approver && l.staffId !== p.staffId,
      canCancel: l.status === 'pending' && l.staffId === p.staffId,
    };
  });
}

/** who may see which staff leave: school scope → everyone, otherwise only my own */
function leaveVisibility(ctx: Ctx): SQL {
  const { p } = ctx;
  if (p.can('staff_leave:view', 'school')) return sql`true`;
  return p.staffId ? eq(SL.staffId, p.staffId) : sql`false`;
}

export async function createStaffLeave(ctx: Ctx, body: { leaveType: StaffLeaveItem['leaveType']; fromDate: string; toDate: string; reason: string }): Promise<StaffLeaveItem> {
  const { db, p, tenant, actor } = ctx;
  const staffId = requireStaffId(ctx);
  const today = todayIn(tenant.timezone);
  if (daysBetween(body.fromDate, body.toDate) + 1 > MAX_LEAVE_DAYS) throw unprocessable(`A leave request can cover at most ${MAX_LEAVE_DAYS} days`, 'LEAVE_TOO_LONG');
  if (body.fromDate < addDaysIso(today, -MAX_BACKDATE_DAYS)) throw unprocessable(`Leave cannot start more than ${MAX_BACKDATE_DAYS} days in the past`, 'LEAVE_TOO_OLD');
  const acad = await getSetting(db, 'academic');
  if (!(await schoolDaysBetween(db, acad.workingDays, body.fromDate, body.toDate)).length) throw unprocessable('The selected dates contain no school days', 'NO_WORKING_DAYS');
  const created = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`staff-leave:${staffId}`}))`);
    const [overlap] = await tx.select({ id: SL.id }).from(SL).where(and(eq(SL.staffId, staffId), inArray(SL.status, ['pending', 'approved']), lte(SL.fromDate, body.toDate), gte(SL.toDate, body.fromDate))).limit(1);
    if (overlap) throw conflict('A leave request for these dates already exists', 'LEAVE_OVERLAP');
    const [l] = await tx.insert(SL).values({ staffId, leaveType: body.leaveType, fromDate: body.fromDate, toDate: body.toDate, reason: body.reason.trim() }).returning();
    await audit(tx, actor, { action: 'staff_leave.request', entity: 'staff_leave_request', entityId: l!.id, summary: `${body.fromDate} → ${body.toDate}`, after: { staffId, leaveType: body.leaveType, fromDate: body.fromDate, toDate: body.toDate } });
    return l!;
  });
  try {
    const approvers = (await usersWithPermission(db, 'staff_leave:approve', true)).filter((u) => u !== p.userId);
    await notifyRows(db, tenant, approvers.map((userId) => ({ userId, type: 'leave.requested', title: 'Staff leave request', body: 'A staff leave request is waiting for your decision.', data: { route: `/staff-leave/${created.id}`, id: created.id } })));
  } catch (err) {
    ctx.log.error({ err }, 'staff leave request notification failed');
  }
  return (await getStaffLeaveOr404(ctx, created.id))!;
}

export async function listStaffLeave(ctx: Ctx, q: { status?: LeaveStatus | undefined; staffId?: string | undefined; from?: string | undefined; to?: string | undefined; page: number; pageSize: number }) {
  const { db } = ctx;
  const where = and(leaveVisibility(ctx), q.status ? eq(SL.status, q.status) : undefined, q.staffId ? eq(SL.staffId, q.staffId) : undefined, q.from ? gte(SL.toDate, q.from) : undefined, q.to ? lte(SL.fromDate, q.to) : undefined);
  const [rows, [cnt]] = await Promise.all([
    leaveSelect(db)
      .where(where)
      .orderBy(sql`case ${SL.status} when 'pending' then 0 else 1 end`, desc(SL.fromDate), desc(SL.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db.select({ n: sql<number>`count(*)::int` }).from(SL).where(where),
  ]);
  return { rows: await shapeLeave(ctx, rows), total: cnt?.n ?? 0 };
}

export async function getStaffLeaveOr404(ctx: Ctx, id: string): Promise<StaffLeaveItem> {
  const rows = await leaveSelect(ctx.db).where(and(eq(SL.id, id), leaveVisibility(ctx))).limit(1);
  const item = (await shapeLeave(ctx, rows))[0];
  if (!item) throw notFound('Leave request');
  return item;
}

export async function decideStaffLeave(ctx: Ctx, id: string, decision: 'approved' | 'rejected', note: string | undefined): Promise<StaffLeaveItem> {
  const { db, p, actor } = ctx;
  if (!p.can('staff_leave:approve', 'school')) throw forbidden();
  if (decision === 'rejected' && !note?.trim()) throw unprocessable('Say why the request is rejected', 'NOTE_REQUIRED');
  const row = await db.transaction(async (tx) => {
    const [l] = await tx.select().from(SL).where(eq(SL.id, id)).for('update').limit(1);
    if (!l) throw notFound('Leave request');
    if (l.staffId === p.staffId) throw forbidden('You cannot decide your own leave request', 'SELF_APPROVAL');
    if (l.status !== 'pending') throw conflict('This request was already decided or cancelled', 'ALREADY_DECIDED');
    await tx.update(SL).set({ status: decision, decidedBy: p.userId, decidedAt: new Date(), decisionNote: note?.trim() || null }).where(eq(SL.id, id));
    let marked = 0;
    if (decision === 'approved') {
      // days up to today become `leave` in the staff register (days already checked in stay as they are); later days are pre-filled by the HR roster
      const today = todayIn(ctx.tenant.timezone);
      const acad = await getSetting(tx, 'academic');
      const days = await schoolDaysBetween(tx, acad.workingDays, l.fromDate, l.toDate < today ? l.toDate : today);
      for (let i = 0; i < days.length; i += 500) {
        const res = await tx
          .insert(SA)
          .values(days.slice(i, i + 500).map((date) => ({ staffId: l.staffId, date, status: 'leave' as const, markedBy: p.userId })))
          .onConflictDoUpdate({ target: [SA.staffId, SA.date], set: { status: 'leave', markedBy: p.userId }, setWhere: isNull(SA.checkIn) })
          .returning({ id: SA.id });
        marked += res.length;
      }
    }
    await audit(tx, actor, { action: decision === 'approved' ? 'staff_leave.approve' : 'staff_leave.reject', entity: 'staff_leave_request', entityId: id, summary: `${l.fromDate} → ${l.toDate} ${decision}`, before: { status: 'pending' }, after: { status: decision, staffId: l.staffId, fromDate: l.fromDate, toDate: l.toDate, note: note ?? null, registerDaysMarked: marked } });
    return l;
  });
  try {
    const [st] = await db.select({ userId: staff.userId }).from(staff).where(eq(staff.id, row.staffId)).limit(1);
    if (st?.userId) {
      const range = row.fromDate === row.toDate ? prettyDate(row.fromDate) : `${prettyDate(row.fromDate)} to ${prettyDate(row.toDate)}`;
      await notifyRows(db, ctx.tenant, [{ userId: st.userId, type: 'leave.decided', title: 'Leave request update', body: `Your leave request for ${range} was ${decision}.`, data: { route: `/staff-leave/${id}`, id, status: decision } }]);
    }
  } catch (err) {
    ctx.log.error({ err }, 'staff leave decision notification failed');
  }
  return getStaffLeaveOr404(ctx, id);
}

export async function cancelStaffLeave(ctx: Ctx, id: string): Promise<StaffLeaveItem> {
  const { db, p, actor } = ctx;
  await db.transaction(async (tx) => {
    const [l] = await tx.select().from(SL).where(and(eq(SL.id, id), leaveVisibility(ctx))).for('update').limit(1);
    if (!l) throw notFound('Leave request');
    if (l.staffId !== p.staffId) throw forbidden('Only the applicant can cancel a leave request', 'NOT_REQUESTER');
    if (l.status !== 'pending') throw conflict('Only pending requests can be cancelled', 'NOT_PENDING');
    await tx.update(SL).set({ status: 'cancelled' }).where(eq(SL.id, id));
    await audit(tx, actor, { action: 'staff_leave.cancel', entity: 'staff_leave_request', entityId: id, before: { status: 'pending' }, after: { status: 'cancelled' } });
  });
  return getStaffLeaveOr404(ctx, id);
}

/** Leave taken (approved) and waiting (pending) this academic year, in school days, per leave type. */
export async function staffLeaveBalance(ctx: Ctx, staffId: string | undefined) {
  const { db, p } = ctx;
  const target = staffId ?? p.staffId;
  if (!target) throw forbidden('Only staff members have a leave balance', 'NOT_STAFF');
  if (target !== p.staffId && !p.can('staff_leave:view', 'school')) throw notFound('Staff member');
  const [member] = await db.select({ id: staff.id }).from(staff).where(eq(staff.id, target)).limit(1);
  if (!member) throw notFound('Staff member');
  const year = await currentYear(db);
  const acad = await getSetting(db, 'academic');
  const rows = year
    ? await db.select().from(SL).where(and(eq(SL.staffId, target), inArray(SL.status, ['approved', 'pending']), lte(SL.fromDate, year.endDate), gte(SL.toDate, year.startDate)))
    : [];
  const holidays = year ? await holidaysBetween(db, year.startDate, year.endDate) : [];
  const byType = new Map<string, { approvedDays: number; pendingDays: number }>();
  for (const l of rows) {
    const from = l.fromDate < year!.startDate ? year!.startDate : l.fromDate;
    const to = l.toDate > year!.endDate ? year!.endDate : l.toDate;
    let days = 0;
    for (let d = from; d <= to; d = addDaysIso(d, 1)) if (acad.workingDays.includes(isoWeekday(d)) && !holidayOn(holidays, d)) days++;
    const slot = byType.get(l.leaveType) ?? { approvedDays: 0, pendingDays: 0 };
    if (l.status === 'approved') slot.approvedDays += days;
    else slot.pendingDays += days;
    byType.set(l.leaveType, slot);
  }
  const list = [...byType.entries()].map(([leaveType, v]) => ({ leaveType: leaveType as StaffLeaveItem['leaveType'], ...v }));
  return { staffId: target, academicYear: year?.name ?? null, byType: list, totalApprovedDays: list.reduce((a, b) => a + b.approvedDays, 0), totalPendingDays: list.reduce((a, b) => a + b.pendingDays, 0) };
}

