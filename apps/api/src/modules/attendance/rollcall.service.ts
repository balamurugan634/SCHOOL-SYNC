import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import type {
  AttendanceCorrectionItem,
  AttendanceRosterResponse,
  AttendanceStatus,
  AttendanceSubmitBody,
  AttendanceSubmitResponse,
} from '@school-sync/shared';
import { audit } from '../../core/audit';
import { AppError, conflict, forbidden, notFound, unprocessable } from '../../core/errors';
import { todayIn } from '../../core/http';
import { getSetting } from '../../core/settings';
import { attendanceCorrections, attendanceRecords, attendanceSessions, grades, periods, sections, staff, students, subjects, timetableSlots, timetableSubstitutions } from '../../db/tenant/schema';
import { guardianUsers, notifyRows, type NotifyRow } from '../learning/notify';
import {
  addDaysIso,
  assertMarkRight,
  assertRosterAccess,
  canDecideFor,
  approvableSections,
  currentYear,
  emptyCounts,
  fullName,
  holidayOn,
  holidaysBetween,
  isoWeekday,
  loadSection,
  markRight,
  prettyDate,
  sectionLabel,
  STATUS_WORDS,
  studentsOnLeave,
  usersWithPermission,
  userNames,
  zonedDayStart,
  type Ctx,
  type MarkRight,
} from './common';

const toIso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

// ── period / slot resolution ────────────────────────────────────────────────────────────

interface PeriodCtx {
  periodId: string | null;
  periodName: string | null;
  subjectId: string | null;
  subjectName: string | null;
  /** staff allowed to take this period (slot teacher or the day's substitute); null = no slot defined */
  slotStaffId: string | null;
  slotExists: boolean;
}

async function resolvePeriod(db: Ctx['db'], mode: 'daily' | 'period', sectionId: string, date: string, periodId: string | undefined, strict: boolean): Promise<PeriodCtx> {
  const none: PeriodCtx = { periodId: null, periodName: null, subjectId: null, subjectName: null, slotStaffId: null, slotExists: false };
  if (mode === 'daily') {
    if (periodId && strict) throw unprocessable('This school takes whole-day attendance; do not pass periodId', 'PERIOD_NOT_ALLOWED');
    return none;
  }
  if (!periodId) {
    if (strict) throw unprocessable('This school takes attendance per period; pass periodId', 'PERIOD_REQUIRED');
    return none;
  }
  const [period] = await db.select({ id: periods.id, name: periods.name, isBreak: periods.isBreak }).from(periods).where(eq(periods.id, periodId)).limit(1);
  if (!period) throw unprocessable('Unknown period', 'PERIOD_NOT_FOUND');
  if (period.isBreak) throw unprocessable('Attendance is not taken in a break', 'PERIOD_IS_BREAK');
  const [slot] = await db
    .select({ id: timetableSlots.id, subjectId: timetableSlots.subjectId, staffId: timetableSlots.staffId, subjectName: subjects.name })
    .from(timetableSlots)
    .leftJoin(subjects, eq(subjects.id, timetableSlots.subjectId))
    .where(and(eq(timetableSlots.sectionId, sectionId), eq(timetableSlots.dayOfWeek, isoWeekday(date)), eq(timetableSlots.periodId, periodId)))
    .limit(1);
  let staffId = slot?.staffId ?? null;
  if (slot) {
    const [sub] = await db.select({ staffId: timetableSubstitutions.substituteStaffId }).from(timetableSubstitutions).where(and(eq(timetableSubstitutions.slotId, slot.id), eq(timetableSubstitutions.date, date))).limit(1);
    if (sub) staffId = sub.staffId;
  }
  return { periodId, periodName: period.name, subjectId: slot?.subjectId ?? null, subjectName: slot?.subjectName ?? null, slotStaffId: staffId, slotExists: !!slot };
}

// ── the single place that decides "may this roll call be submitted now?" ───────────────────

interface Gate {
  code: string;
  status: number;
  message: string;
  extra?: Record<string, unknown>;
}

interface GateInput {
  ctx: Ctx;
  sectionId: string;
  mode: 'daily' | 'period';
  date: string;
  today: string;
  workingDays: number[];
  holiday: string | null;
  period: PeriodCtx;
  session: { status: 'draft' | 'submitted'; submittedAt: Date | null } | null;
  windowHours: number;
  now: Date;
}

const editableUntil = (submittedAt: Date, windowHours: number) => new Date(submittedAt.getTime() + windowHours * 3_600_000);

function evaluateGate(i: GateInput): Gate | null {
  if (i.mode === 'period' && !i.period.periodId) return { code: 'PERIOD_REQUIRED', status: 422, message: 'This school takes attendance per period; pass periodId' };
  if (i.date > i.today) return { code: 'FUTURE_DATE', status: 422, message: 'Attendance cannot be taken for a future date' };
  if (!i.workingDays.includes(isoWeekday(i.date))) return { code: 'NOT_A_WORKING_DAY', status: 422, message: 'That date is not a school working day' };
  if (i.holiday) return { code: 'HOLIDAY', status: 422, message: `That date is a holiday (${i.holiday})` };
  const r = markRight(i.ctx.p, i.sectionId, i.mode);
  if (!('right' in r)) {
    return r.denied === 'NOT_CLASS_TEACHER'
      ? { code: 'NOT_CLASS_TEACHER', status: 403, message: 'Only the class teacher can take daily attendance for this section' }
      : { code: 'NOT_ALLOWED_TO_MARK', status: 403, message: 'You may not take attendance for this section' };
  }
  if (r.right === 'subject' && i.period.slotExists && i.period.slotStaffId !== i.ctx.p.staffId) return { code: 'NOT_YOUR_PERIOD', status: 403, message: 'This period is taken by another teacher' };
  if (r.right !== 'school') {
    // teachers: re-submit within `editWindowHours` of the first submission; first submissions/backfills until the end of the date + window
    if (i.session?.status === 'submitted' && i.session.submittedAt) {
      const until = editableUntil(i.session.submittedAt, i.windowHours);
      if (i.now > until) return { code: 'EDIT_WINDOW_CLOSED', status: 403, message: 'The edit window for this roll call has closed; request a correction instead', extra: { editableUntil: until.toISOString() } };
    } else {
      const until = editableUntil(zonedDayStart(addDaysIso(i.date, 1), i.ctx.tenant.timezone), i.windowHours);
      if (i.now > until) return { code: 'EDIT_WINDOW_CLOSED', status: 403, message: 'This date is too old to take attendance directly; ask the administrator', extra: { editableUntil: until.toISOString() } };
    }
  }
  return null;
}

const throwGate = (g: Gate): never => {
  throw new AppError(g.status, g.code, g.message, g.extra);
};

// ── roster ──────────────────────────────────────────────────────────────────────────────

async function rosterStudents(db: Ctx['db'], sectionId: string) {
  return db
    .select({ id: students.id, firstName: students.firstName, lastName: students.lastName, admissionNo: students.admissionNo, rollNo: students.rollNo })
    .from(students)
    .where(and(eq(students.currentSectionId, sectionId), eq(students.status, 'active'), isNull(students.archivedAt)))
    .orderBy(sql`${students.rollNo} asc nulls last`, asc(students.firstName), asc(students.id));
}

export async function getRoster(ctx: Ctx, sectionId: string, q: { date?: string | undefined; periodId?: string | undefined }): Promise<AttendanceRosterResponse> {
  const { db, p, tenant } = ctx;
  assertRosterAccess(p, sectionId);
  const section = await loadSection(db, sectionId);
  if (!section) throw notFound('Section');
  const [att, acad] = await Promise.all([getSetting(db, 'attendance'), getSetting(db, 'academic')]);
  const now = new Date();
  const today = todayIn(tenant.timezone, now);
  const date = q.date ?? today;
  const period = await resolvePeriod(db, att.mode, sectionId, date, q.periodId, false);
  const holidays = await holidaysBetween(db, date, date);
  const holiday = holidayOn(holidays, date);
  const isWorkingDay = acad.workingDays.includes(isoWeekday(date));

  const periodCond = period.periodId ? eq(attendanceSessions.periodId, period.periodId) : isNull(attendanceSessions.periodId);
  const [list, [session]] = await Promise.all([
    rosterStudents(db, sectionId),
    db
      .select({ id: attendanceSessions.id, status: attendanceSessions.status, submittedAt: attendanceSessions.submittedAt, takenByUserId: attendanceSessions.takenByUserId })
      .from(attendanceSessions)
      .where(and(eq(attendanceSessions.sectionId, sectionId), eq(attendanceSessions.date, date), periodCond))
      .limit(1),
  ]);
  const records = session
    ? await db.select({ id: attendanceRecords.id, studentId: attendanceRecords.studentId, status: attendanceRecords.status, remarks: attendanceRecords.remarks, markedAt: attendanceRecords.markedAt }).from(attendanceRecords).where(eq(attendanceRecords.sessionId, session.id))
    : [];
  const recMap = new Map(records.map((r) => [r.studentId, r]));
  const onLeave = att.leaveMarksAttendance ? await studentsOnLeave(db, list.map((s) => s.id), date) : new Set<string>();
  const takers = session?.takenByUserId ? await userNames(db, [session.takenByUserId]) : new Map<string, string>();

  const counts = { ...emptyCounts(), unmarked: 0 };
  let preMarked = 0;
  const rows = list.map((s) => {
    const rec = recMap.get(s.id);
    const leaveNow = onLeave.has(s.id);
    let status: AttendanceStatus | null = null;
    let source: 'marked' | 'leave' | null = null;
    if (rec) {
      status = rec.status;
      source = 'marked';
    } else if (leaveNow) {
      status = 'leave';
      source = 'leave';
      preMarked++;
    }
    if (status) counts[status]++;
    else counts.unmarked++;
    return { studentId: s.id, name: fullName(s.firstName, s.lastName) ?? s.firstName, admissionNo: s.admissionNo, rollNo: s.rollNo, recordId: rec?.id ?? null, status, remarks: rec?.remarks ?? null, source, onApprovedLeave: leaveNow, markedAt: toIso(rec?.markedAt) };
  });

  const gate = evaluateGate({ ctx, sectionId, mode: att.mode, date, today, workingDays: acad.workingDays, holiday, period, session: session ?? null, windowHours: att.editWindowHours, now });
  const submitted = session?.status === 'submitted';
  const warnings: string[] = [];
  if (!isWorkingDay) warnings.push('NOT_A_WORKING_DAY');
  if (holiday) warnings.push('HOLIDAY');
  if (preMarked) warnings.push('PRE_MARKED_FROM_LEAVE');
  if (date > today) warnings.push('FUTURE_DATE');

  return {
    sectionId,
    sectionName: section.name,
    gradeName: section.gradeName,
    date,
    mode: att.mode,
    periodId: period.periodId,
    periodName: period.periodName,
    subjectId: period.subjectId,
    subjectName: period.subjectName,
    isWorkingDay,
    holiday,
    isFuture: date > today,
    session: session
      ? { id: session.id, status: session.status, takenByName: session.takenByUserId ? (takers.get(session.takenByUserId) ?? null) : null, submittedAt: toIso(session.submittedAt), editableUntil: submitted && session.submittedAt ? editableUntil(session.submittedAt, att.editWindowHours).toISOString() : null }
      : null,
    canSubmit: gate === null,
    blockedReason: gate?.code ?? null,
    // the roll call exists, is closed for direct edits, and the caller could have marked it
    canRequestCorrection: submitted && gate?.code === 'EDIT_WINDOW_CLOSED',
    warnings,
    counts,
    students: rows,
  };
}

// ── submit ──────────────────────────────────────────────────────────────────────────────

export async function submitRollCall(ctx: Ctx, sectionId: string, body: AttendanceSubmitBody): Promise<AttendanceSubmitResponse> {
  const { db, p, tenant, actor } = ctx;
  // authorisation first, so an out-of-reach section is a 404 before anything else is revealed
  const [att, acad] = await Promise.all([getSetting(db, 'attendance'), getSetting(db, 'academic')]);
  assertMarkRight(p, sectionId, att.mode);
  const section = await loadSection(db, sectionId);
  if (!section) throw notFound('Section');

  const now = new Date();
  const today = todayIn(tenant.timezone, now);
  const date = body.date ?? today;
  const period = await resolvePeriod(db, att.mode, sectionId, date, body.periodId, true);
  const year = await currentYear(db);
  if (year && (date < year.startDate || date > year.endDate)) throw unprocessable('That date is outside the current academic year', 'OUTSIDE_ACADEMIC_YEAR');
  const holiday = holidayOn(await holidaysBetween(db, date, date), date);
  const baseGate = { ctx, sectionId, mode: att.mode, date, today, workingDays: acad.workingDays, holiday, period, windowHours: att.editWindowHours, now };
  const early = evaluateGate({ ...baseGate, session: null });
  // window problems depend on the stored session, which is re-checked under lock below
  if (early && early.code !== 'EDIT_WINDOW_CLOSED') throwGate(early);

  const roster = await rosterStudents(db, sectionId);
  const rosterIds = new Set(roster.map((s) => s.id));
  const listed = new Map<string, { status: AttendanceStatus; remarks: string | null }>();
  for (const r of body.records) {
    if (!rosterIds.has(r.studentId)) throw new AppError(422, 'STUDENT_NOT_IN_SECTION', 'A listed student is not in this section', { studentId: r.studentId });
    if (listed.has(r.studentId)) throw unprocessable('A student is listed twice', 'DUPLICATE_STUDENT');
    listed.set(r.studentId, { status: r.status, remarks: r.remarks?.trim() || null });
  }
  const onLeave = att.leaveMarksAttendance ? await studentsOnLeave(db, roster.map((s) => s.id), date) : new Set<string>();
  const finalRows: { studentId: string; status: AttendanceStatus; remarks: string | null }[] = [];
  const missing: string[] = [];
  for (const s of roster) {
    const l = listed.get(s.id);
    if (l) finalRows.push({ studentId: s.id, ...l });
    else if (onLeave.has(s.id)) finalRows.push({ studentId: s.id, status: 'leave', remarks: null });
    else if (body.defaultStatus) finalRows.push({ studentId: s.id, status: body.defaultStatus, remarks: null });
    else missing.push(s.id);
  }
  if (missing.length) throw new AppError(422, 'INCOMPLETE_ROLL_CALL', 'Every student must be marked (or pass defaultStatus)', { missing });
  if (!finalRows.length) throw unprocessable('This section has no active students', 'EMPTY_SECTION');

  const result = await db.transaction(async (tx) => {
    await tx
      .insert(attendanceSessions)
      .values({ sectionId, date, periodId: period.periodId, subjectId: period.subjectId, status: 'draft' })
      .onConflictDoNothing();
    const periodCond = period.periodId ? eq(attendanceSessions.periodId, period.periodId) : isNull(attendanceSessions.periodId);
    const [session] = await tx
      .select()
      .from(attendanceSessions)
      .where(and(eq(attendanceSessions.sectionId, sectionId), eq(attendanceSessions.date, date), periodCond))
      .for('update')
      .limit(1);
    if (!session) throw conflict('Could not open the roll call, try again');

    const gate = evaluateGate({ ...baseGate, ctx: { ...ctx, db: tx as unknown as Ctx['db'] }, session: { status: session.status, submittedAt: session.submittedAt } });
    if (gate) throwGate(gate);

    const existing = await tx.select().from(attendanceRecords).where(eq(attendanceRecords.sessionId, session.id));
    const exMap = new Map(existing.map((r) => [r.studentId, r]));
    const before = emptyCounts();
    for (const r of existing) before[r.status]++;

    const toInsert: (typeof attendanceRecords.$inferInsert)[] = [];
    const toUpdate: (typeof attendanceRecords.$inferInsert)[] = [];
    const changes: { studentId: string; from: AttendanceStatus | null; to: AttendanceStatus }[] = [];
    const counts = emptyCounts();
    for (const r of finalRows) {
      counts[r.status]++;
      const ex = exMap.get(r.studentId);
      const row = { sessionId: session.id, studentId: r.studentId, sectionId, date, status: r.status, remarks: r.remarks, updatedBy: p.userId };
      if (!ex) {
        toInsert.push(row);
        changes.push({ studentId: r.studentId, from: null, to: r.status });
      } else if (ex.status !== r.status || (ex.remarks ?? null) !== r.remarks) {
        toUpdate.push(row);
        if (ex.status !== r.status) changes.push({ studentId: r.studentId, from: ex.status, to: r.status });
      }
    }
    for (let i = 0; i < toInsert.length; i += 500) await tx.insert(attendanceRecords).values(toInsert.slice(i, i + 500));
    for (let i = 0; i < toUpdate.length; i += 500) {
      await tx
        .insert(attendanceRecords)
        .values(toUpdate.slice(i, i + 500))
        .onConflictDoUpdate({ target: [attendanceRecords.sessionId, attendanceRecords.studentId], set: { status: sql`excluded.status`, remarks: sql`excluded.remarks`, updatedBy: p.userId, updatedAt: new Date() } });
    }

    const firstSubmission = session.status !== 'submitted';
    const submittedAt = session.submittedAt ?? now;
    await tx
      .update(attendanceSessions)
      .set({ status: 'submitted', submittedAt, takenBy: p.staffId ?? session.takenBy, takenByUserId: p.userId, subjectId: period.subjectId ?? session.subjectId, updatedAt: now })
      .where(eq(attendanceSessions.id, session.id));

    const total = finalRows.length;
    await audit(tx, actor, {
      action: firstSubmission ? 'attendance.submit' : 'attendance.resubmit',
      entity: 'attendance_session',
      entityId: session.id,
      summary: `${sectionLabel(section.gradeName, section.name)} ${date}${period.periodName ? ` ${period.periodName}` : ''}: ${counts.present} present, ${counts.absent} absent`,
      before: firstSubmission ? null : { counts: before, submittedAt: toIso(session.submittedAt) },
      after: { counts: { ...counts, total }, changed: changes.slice(0, 100), changedCount: changes.length, sectionId, date, periodId: period.periodId },
    });

    const newlyAbsent = finalRows.filter((r) => r.status === 'absent' && exMap.get(r.studentId)?.status !== 'absent').map((r) => r.studentId);
    return { session, firstSubmission, counts, total, changed: changes.length, newlyAbsent, submittedAt };
  });

  // after commit: tell the guardians of newly absent students
  let notified = 0;
  if (att.notifyParentsOnAbsent && result.newlyAbsent.length) {
    try {
      notified = await notifyAbsent(ctx, result.newlyAbsent, roster, date, period.periodName);
    } catch (err) {
      ctx.log.error({ err }, 'absence notification failed');
    }
  }
  return {
    sessionId: result.session.id,
    sectionId,
    date,
    periodId: period.periodId,
    status: 'submitted',
    firstSubmission: result.firstSubmission,
    counts: { ...result.counts, total: result.total },
    changed: result.changed,
    notifiedGuardians: notified,
    editableUntil: editableUntil(result.submittedAt, att.editWindowHours).toISOString(),
  };
}

async function notifyAbsent(ctx: Ctx, studentIds: string[], roster: { id: string; firstName: string }[], date: string, periodName: string | null): Promise<number> {
  const names = new Map(roster.map((s) => [s.id, s.firstName]));
  const links = await guardianUsers(ctx.db, studentIds);
  const rows: NotifyRow[] = links.map((l) => ({
    userId: l.userId,
    type: 'attendance.absent',
    title: 'Attendance update',
    body: `${names.get(l.studentId) ?? 'Your child'} was marked absent on ${prettyDate(date)}${periodName ? ` (${periodName})` : ''}.`,
    data: { route: '/attendance', studentId: l.studentId, date },
  }));
  await notifyRows(ctx.db, ctx.tenant, rows);
  return rows.length;
}

// ── corrections ──────────────────────────────────────────────────────────────────────────

type CorrRow = typeof attendanceCorrections.$inferSelect;

const corrSelect = (db: Ctx['db']) =>
  db
    .select({
      c: attendanceCorrections,
      firstName: students.firstName,
      lastName: students.lastName,
      admissionNo: students.admissionNo,
      rollNo: students.rollNo,
      sectionName: sections.name,
      gradeName: grades.name,
    })
    .from(attendanceCorrections)
    .innerJoin(students, eq(students.id, attendanceCorrections.studentId))
    .innerJoin(sections, eq(sections.id, attendanceCorrections.sectionId))
    .innerJoin(grades, eq(grades.id, sections.gradeId));

async function shapeCorrections(ctx: Ctx, rows: Awaited<ReturnType<ReturnType<typeof corrSelect>['limit']>>): Promise<AttendanceCorrectionItem[]> {
  const names = await userNames(ctx.db, rows.flatMap((r) => [r.c.requestedBy, r.c.decidedBy]));
  return rows.map(({ c, firstName, lastName, admissionNo, rollNo, sectionName, gradeName }) => ({
    id: c.id,
    recordId: c.recordId,
    studentId: c.studentId,
    studentName: fullName(firstName, lastName) ?? firstName,
    admissionNo,
    rollNo,
    sectionId: c.sectionId,
    sectionName: sectionLabel(gradeName, sectionName),
    date: c.date,
    fromStatus: c.fromStatus,
    toStatus: c.toStatus,
    reason: c.reason,
    requestedBy: c.requestedBy,
    requestedByName: names.get(c.requestedBy) ?? null,
    status: c.status,
    decidedBy: c.decidedBy,
    decidedByName: c.decidedBy ? (names.get(c.decidedBy) ?? null) : null,
    decidedAt: toIso(c.decidedAt),
    decisionNote: c.decisionNote,
    createdAt: c.createdAt.toISOString(),
    canDecide: c.status === 'pending' && canDecideFor(ctx.p, 'attendance:approve', c.sectionId) && (c.requestedBy !== ctx.p.userId || ctx.p.can('attendance:approve', 'school')),
  }));
}

export async function requestCorrection(ctx: Ctx, recordId: string, body: { toStatus: AttendanceStatus; reason: string }): Promise<AttendanceCorrectionItem> {
  const { db, p, tenant, actor } = ctx;
  const [rec] = await db
    .select({ id: attendanceRecords.id, studentId: attendanceRecords.studentId, sectionId: attendanceRecords.sectionId, date: attendanceRecords.date, status: attendanceRecords.status, periodId: attendanceSessions.periodId, sessionStatus: attendanceSessions.status })
    .from(attendanceRecords)
    .innerJoin(attendanceSessions, eq(attendanceSessions.id, attendanceRecords.sessionId))
    .where(eq(attendanceRecords.id, recordId))
    .limit(1);
  if (!rec) throw notFound('Attendance record');
  assertMarkRight(p, rec.sectionId, rec.periodId ? 'period' : 'daily');
  if (rec.date > todayIn(tenant.timezone)) throw unprocessable('Future records cannot be corrected', 'FUTURE_DATE');
  if (rec.status === body.toStatus) throw unprocessable('The record already has that status', 'NO_CHANGE');

  const created = await db.transaction(async (tx) => {
    const [pending] = await tx.select({ id: attendanceCorrections.id }).from(attendanceCorrections).where(and(eq(attendanceCorrections.recordId, recordId), eq(attendanceCorrections.status, 'pending'))).limit(1);
    if (pending) throw conflict('A correction for this record is already waiting for a decision', 'CORRECTION_PENDING');
    const [row] = await tx
      .insert(attendanceCorrections)
      .values({ recordId, studentId: rec.studentId, sectionId: rec.sectionId, date: rec.date, fromStatus: rec.status, toStatus: body.toStatus, reason: body.reason.trim(), requestedBy: p.userId })
      .returning();
    await audit(tx, actor, { action: 'attendance.correction.request', entity: 'attendance_correction', entityId: row!.id, summary: `${rec.date}: ${rec.status} → ${body.toStatus}`, after: { recordId, studentId: rec.studentId, date: rec.date, from: rec.status, to: body.toStatus, reason: body.reason } });
    return row!;
  });

  // tell whoever can decide it: the class teacher, or the school-level approvers when the class teacher asked
  try {
    const [sec] = await db.select({ classTeacherUserId: staff.userId }).from(sections).leftJoin(staff, eq(staff.id, sections.classTeacherId)).where(eq(sections.id, rec.sectionId)).limit(1);
    const deciders = p.leadsSection(rec.sectionId) ? await usersWithPermission(db, 'attendance:approve', true) : sec?.classTeacherUserId ? [sec.classTeacherUserId] : await usersWithPermission(db, 'attendance:approve', true);
    await notifyRows(
      db,
      tenant,
      deciders.filter((u) => u !== p.userId).map((userId) => ({ userId, type: 'attendance.correction', title: 'Attendance correction requested', body: 'A teacher asked to correct an attendance record. Open the app to review.', data: { route: '/attendance/corrections', correctionId: created.id } })),
    );
  } catch (err) {
    ctx.log.error({ err }, 'correction request notification failed');
  }
  const [shaped] = await shapeCorrections(ctx, await corrSelect(db).where(eq(attendanceCorrections.id, created.id)).limit(1));
  return shaped!;
}

export async function listCorrections(ctx: Ctx, q: { status?: CorrRow['status'] | undefined; sectionId?: string | undefined; mine?: boolean | undefined; page: number; pageSize: number }) {
  const { db, p } = ctx;
  const canApprove = !!p.scope('attendance:approve') && p.userType === 'staff';
  if (!canApprove && !p.scope('attendance:create')) throw forbidden();
  const conds: (SQL | undefined)[] = [eq(attendanceCorrections.status, q.status ?? 'pending'), q.sectionId ? eq(attendanceCorrections.sectionId, q.sectionId) : undefined];
  if (q.mine || !canApprove) conds.push(eq(attendanceCorrections.requestedBy, p.userId));
  else {
    const a = approvableSections(p, 'attendance:approve');
    if (a !== 'all') conds.push(a.length ? inArray(attendanceCorrections.sectionId, a) : sql`false`);
  }
  const where = and(...conds);
  const [rows, [cnt]] = await Promise.all([
    corrSelect(db)
      .where(where)
      .orderBy(desc(attendanceCorrections.createdAt), desc(attendanceCorrections.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db.select({ n: sql<number>`count(*)::int` }).from(attendanceCorrections).where(where),
  ]);
  return { rows: await shapeCorrections(ctx, rows), total: cnt?.n ?? 0 };
}

export async function decideCorrection(ctx: Ctx, id: string, decision: 'approved' | 'rejected', note: string | undefined): Promise<AttendanceCorrectionItem> {
  const { db, p, actor } = ctx;
  if (decision === 'rejected' && !note?.trim()) throw unprocessable('Say why the correction is rejected', 'NOTE_REQUIRED');
  const out = await db.transaction(async (tx) => {
    const [c] = await tx.select().from(attendanceCorrections).where(eq(attendanceCorrections.id, id)).for('update').limit(1);
    if (!c) throw notFound('Correction');
    // only the class teacher of that section or school scope may even see it; anyone else gets 404
    if (!canDecideFor(p, 'attendance:approve', c.sectionId)) throw notFound('Correction');
    if (c.requestedBy === p.userId && !p.can('attendance:approve', 'school')) throw forbidden('You cannot decide your own correction request', 'SELF_APPROVAL');
    if (c.status !== 'pending') throw conflict('This correction was already decided', 'ALREADY_DECIDED');

    let recordBefore: { status: AttendanceStatus } | null = null;
    if (decision === 'approved') {
      const [rec] = await tx.select({ id: attendanceRecords.id, status: attendanceRecords.status }).from(attendanceRecords).where(eq(attendanceRecords.id, c.recordId)).for('update').limit(1);
      if (!rec) throw conflict('The attendance record no longer exists', 'RECORD_GONE');
      recordBefore = { status: rec.status };
      await tx.update(attendanceRecords).set({ status: c.toStatus, updatedBy: p.userId, updatedAt: new Date() }).where(eq(attendanceRecords.id, c.recordId));
    }
    await tx.update(attendanceCorrections).set({ status: decision, decidedBy: p.userId, decidedAt: new Date(), decisionNote: note?.trim() || null }).where(eq(attendanceCorrections.id, id));
    await audit(tx, actor, {
      action: decision === 'approved' ? 'attendance.correction.approve' : 'attendance.correction.reject',
      entity: 'attendance_correction',
      entityId: id,
      summary: `${c.date}: ${c.fromStatus} → ${c.toStatus} ${decision}`,
      before: { status: 'pending', recordStatus: recordBefore?.status ?? c.fromStatus },
      after: { status: decision, recordStatus: decision === 'approved' ? c.toStatus : (recordBefore?.status ?? c.fromStatus), studentId: c.studentId, date: c.date, note: note ?? null },
    });
    return c;
  });

  try {
    const rows: NotifyRow[] = [{ userId: out.requestedBy, type: 'attendance.correction', title: `Attendance correction ${decision}`, body: 'Open the app to see the decision.', data: { route: '/attendance/corrections', correctionId: id } }];
    if (decision === 'approved') {
      const [stu] = await db.select({ userId: students.userId, firstName: students.firstName }).from(students).where(eq(students.id, out.studentId)).limit(1);
      const links = await guardianUsers(db, [out.studentId]);
      const body = `Attendance for ${prettyDate(out.date)} was updated to ${STATUS_WORDS[out.toStatus]}.`;
      const data = { route: '/attendance', studentId: out.studentId, date: out.date };
      for (const u of new Set([...links.map((l) => l.userId), ...(stu?.userId ? [stu.userId] : [])])) rows.push({ userId: u, type: 'attendance.corrected', title: 'Attendance update', body, data });
    }
    await notifyRows(db, ctx.tenant, rows);
  } catch (err) {
    ctx.log.error({ err }, 'correction decision notification failed');
  }
  const [shaped] = await shapeCorrections(ctx, await corrSelect(db).where(eq(attendanceCorrections.id, id)).limit(1));
  return shaped!;
}

export type { MarkRight };
