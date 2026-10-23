import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import type {
  AttendanceSchoolSummaryResponse,
  AttendanceStatus,
  AttendanceStatusCounts,
  AttendanceStudentSummaryResponse,
  AttendanceTodayResponse,
} from '@school-sync/shared';
import { AppError, forbidden, notFound, unprocessable } from '../../core/errors';
import { decodeCursor, encodeCursor, isoWeekday, todayIn } from '../../core/http';
import { assertStudentAccess, sectionScope } from '../../core/rbac/scope';
import type { Executor } from '../../core/tenancy/pools';
import type { TenantInfo } from '../../core/tenancy/registry';
import { getSetting } from '../../core/settings';
import { academicYears, attendanceAlerts, attendanceCorrections, attendanceRecords, attendanceSessions, grades, periods, sections, staff, students, subjects, timetableSlots, timetableSubstitutions } from '../../db/tenant/schema';
import { guardianUsers, insertNotifications, type NotifyRow } from '../learning/notify';
import { deferPush } from '../../core/notify';
import { enqueuePush } from '../../core/notify/queue';
import {
  addDaysIso,
  assertRosterAccess,
  currentYear,
  daysBetween,
  emptyCounts,
  fullName,
  holidayOn,
  holidaysBetween,
  loadSection,
  MAX_RANGE_DAYS,
  percentage,
  resolveRange,
  sectionLabel,
  statusCountCols,
  totalsOf,
  type Ctx,
} from './common';

const r = attendanceRecords;
const sessionOk = and(eq(attendanceSessions.id, r.sessionId), eq(attendanceSessions.status, 'submitted'));

function checkRange(from: string, to: string, max = MAX_RANGE_DAYS) {
  if (from > to) throw unprocessable('`from` must not be after `to`', 'INVALID_RANGE');
  if (daysBetween(from, to) > max) throw unprocessable(`The date range is limited to ${max} days`, 'RANGE_TOO_LARGE');
}

// ── student ─────────────────────────────────────────────────────────────────────────────

export async function studentSummary(ctx: Ctx, studentId: string, q: { from?: string | undefined; to?: string | undefined }): Promise<AttendanceStudentSummaryResponse> {
  const { db, p, tenant } = ctx;
  await assertStudentAccess(db, p, 'attendance:view', studentId);
  const [stu] = await db.select({ firstName: students.firstName, lastName: students.lastName, sectionId: students.currentSectionId }).from(students).where(eq(students.id, studentId)).limit(1);
  if (!stu) throw notFound('Student');
  const [att, year] = await Promise.all([getSetting(db, 'attendance'), currentYear(db)]);
  const today = todayIn(tenant.timezone);
  const { from, to } = resolveRange(q, today, year?.startDate ?? addDaysIso(today, -90));
  checkRange(from, to);

  const month = sql<string>`to_char(${r.date}, 'YYYY-MM')`;
  const rows = await db
    .select({ month, ...statusCountCols(r.status) })
    .from(r)
    .where(and(eq(r.studentId, studentId), gte(r.date, from), lte(r.date, to)))
    .groupBy(month)
    .orderBy(month);
  const total = emptyCounts();
  const months = rows.map((m) => {
    for (const k of Object.keys(total) as AttendanceStatus[]) total[k] += m[k];
    return { month: m.month, ...totalsOf(m) };
  });
  const totals = totalsOf(total);
  return {
    studentId,
    studentName: fullName(stu.firstName, stu.lastName) ?? stu.firstName,
    sectionId: stu.sectionId,
    from,
    to,
    totals,
    shortage: { thresholdPercent: att.shortagePercent, isShort: totals.percentage !== null && totals.percentage < att.shortagePercent },
    months,
  };
}

export async function studentRecords(ctx: Ctx, studentId: string, q: { from?: string | undefined; to?: string | undefined; status?: AttendanceStatus | undefined; cursor?: string | undefined; limit: number }) {
  const { db, p } = ctx;
  await assertStudentAccess(db, p, 'attendance:view', studentId);
  if (q.from && q.to) checkRange(q.from, q.to, 3660);
  const cur = decodeCursor<{ d: string; id: string }>(q.cursor);
  if (q.cursor && (!cur || typeof cur.d !== 'string' || typeof cur.id !== 'string')) throw new AppError(400, 'BAD_CURSOR', 'Invalid cursor');
  const conds: (SQL | undefined)[] = [
    eq(r.studentId, studentId),
    q.from ? gte(r.date, q.from) : undefined,
    q.to ? lte(r.date, q.to) : undefined,
    q.status ? eq(r.status, q.status) : undefined,
    cur ? sql`(${r.date}, ${r.id}) < (${cur.d}::date, ${cur.id}::uuid)` : undefined,
  ];
  const rows = await db
    .select({
      id: r.id,
      date: r.date,
      status: r.status,
      remarks: r.remarks,
      sectionId: r.sectionId,
      periodId: attendanceSessions.periodId,
      periodName: periods.name,
      subjectName: subjects.name,
      markedAt: r.markedAt,
      correctionPending: sql<boolean>`exists (select 1 from ${attendanceCorrections} c where c.record_id = ${r.id} and c.status = 'pending')`,
    })
    .from(r)
    .innerJoin(attendanceSessions, eq(attendanceSessions.id, r.sessionId))
    .leftJoin(periods, eq(periods.id, attendanceSessions.periodId))
    .leftJoin(subjects, eq(subjects.id, attendanceSessions.subjectId))
    .where(and(...conds))
    .orderBy(desc(r.date), desc(r.id))
    .limit(q.limit + 1);
  const page = rows.slice(0, q.limit);
  const last = page[page.length - 1];
  return {
    data: page.map((x) => ({ ...x, markedAt: x.markedAt.toISOString() })),
    nextCursor: rows.length > q.limit && last ? encodeCursor({ d: last.date, id: last.id }) : null,
  };
}

// ── section ─────────────────────────────────────────────────────────────────────────────

export async function sectionSummary(ctx: Ctx, sectionId: string, q: { from?: string | undefined; to?: string | undefined }) {
  const { db, p, tenant } = ctx;
  assertRosterAccess(p, sectionId);
  const section = await loadSection(db, sectionId);
  if (!section) throw notFound('Section');
  const att = await getSetting(db, 'attendance');
  const today = todayIn(tenant.timezone);
  const { from, to } = resolveRange(q, today, addDaysIso(today, -29));
  checkRange(from, to, 366);

  const [days, perStudent, roster] = await Promise.all([
    db
      .select({ date: r.date, ...statusCountCols(r.status) })
      .from(r)
      .innerJoin(attendanceSessions, sessionOk)
      .where(and(eq(r.sectionId, sectionId), gte(r.date, from), lte(r.date, to)))
      .groupBy(r.date)
      .orderBy(asc(r.date)),
    db
      .select({ studentId: r.studentId, ...statusCountCols(r.status) })
      .from(r)
      .innerJoin(attendanceSessions, sessionOk)
      .where(and(eq(r.sectionId, sectionId), gte(r.date, from), lte(r.date, to)))
      .groupBy(r.studentId),
    db
      .select({ id: students.id, firstName: students.firstName, lastName: students.lastName, admissionNo: students.admissionNo, rollNo: students.rollNo })
      .from(students)
      .where(and(eq(students.currentSectionId, sectionId), eq(students.status, 'active'), isNull(students.archivedAt)))
      .orderBy(sql`${students.rollNo} asc nulls last`, asc(students.firstName)),
  ]);
  const byStudent = new Map(perStudent.map((x) => [x.studentId, x]));
  const total = emptyCounts();
  for (const d of days) for (const k of Object.keys(total) as AttendanceStatus[]) total[k] += d[k];
  return {
    sectionId,
    sectionName: section.name,
    gradeName: section.gradeName,
    from,
    to,
    strength: roster.length,
    totals: totalsOf(total),
    days: days.map((d) => ({ date: d.date, present: d.present, absent: d.absent, late: d.late, leave: d.leave, half_day: d.half_day, percentage: percentage(d) })),
    students: roster.map((s) => {
      const t = totalsOf(byStudent.get(s.id) ?? emptyCounts());
      return { ...t, studentId: s.id, name: fullName(s.firstName, s.lastName) ?? s.firstName, admissionNo: s.admissionNo, rollNo: s.rollNo, isShort: t.percentage !== null && t.percentage < att.shortagePercent };
    }),
  };
}

// ── school-wide ─────────────────────────────────────────────────────────────────────────

/** One grouped scan of a single date's records: counts per section (submitted roll calls only). */
async function dayBySection(db: Executor, date: string) {
  return db
    .select({ sectionId: r.sectionId, students: sql<number>`count(distinct ${r.studentId})::int`, ...statusCountCols(r.status) })
    .from(r)
    .innerJoin(attendanceSessions, sessionOk)
    .where(eq(r.date, date))
    .groupBy(r.sectionId);
}

async function activeStrengths(db: Executor): Promise<Map<string, number>> {
  const rows = await db
    .select({ sectionId: students.currentSectionId, n: sql<number>`count(*)::int` })
    .from(students)
    .where(and(eq(students.status, 'active'), isNull(students.archivedAt)))
    .groupBy(students.currentSectionId);
  return new Map(rows.filter((x) => x.sectionId).map((x) => [x.sectionId!, x.n]));
}

async function currentSections(db: Executor) {
  return db
    .select({ id: sections.id, name: sections.name, gradeName: grades.name, gradeOrdinal: grades.ordinal, ctFirst: staff.firstName, ctLast: staff.lastName })
    .from(sections)
    .innerJoin(grades, eq(grades.id, sections.gradeId))
    .innerJoin(academicYears, and(eq(academicYears.id, sections.academicYearId), eq(academicYears.isCurrent, true)))
    .leftJoin(staff, eq(staff.id, sections.classTeacherId))
    .orderBy(asc(grades.ordinal), asc(sections.name));
}

export async function schoolSummary(ctx: Ctx, q: { date?: string | undefined; trendDays: number; absenteeLimit: number }): Promise<AttendanceSchoolSummaryResponse> {
  const { db, tenant } = ctx;
  const [att, acad] = await Promise.all([getSetting(db, 'attendance'), getSetting(db, 'academic')]);
  const today = todayIn(tenant.timezone);
  const date = q.date ?? today;
  const trendFrom = addDaysIso(date, -(q.trendDays - 1));

  const [secRows, perSection, strengths, absentRows, trend, holidays] = await Promise.all([
    currentSections(db),
    dayBySection(db, date),
    activeStrengths(db),
    db
      .select({
        studentId: students.id,
        firstName: students.firstName,
        lastName: students.lastName,
        admissionNo: students.admissionNo,
        rollNo: students.rollNo,
        sectionId: r.sectionId,
        sectionName: sections.name,
        gradeName: grades.name,
        remarks: r.remarks,
        total: sql<number>`(count(*) over ())::int`,
      })
      .from(r)
      .innerJoin(attendanceSessions, sessionOk)
      .innerJoin(students, eq(students.id, r.studentId))
      .innerJoin(sections, eq(sections.id, r.sectionId))
      .innerJoin(grades, eq(grades.id, sections.gradeId))
      .where(and(eq(r.date, date), eq(r.status, 'absent')))
      .orderBy(asc(grades.ordinal), asc(sections.name), sql`${students.rollNo} asc nulls last`, asc(students.id))
      .limit(q.absenteeLimit),
    db
      .select({ date: r.date, ...statusCountCols(r.status) })
      .from(r)
      .innerJoin(attendanceSessions, sessionOk)
      .where(and(gte(r.date, trendFrom), lte(r.date, date)))
      .groupBy(r.date)
      .orderBy(asc(r.date)),
    holidaysBetween(db, date, date),
  ]);

  const agg = new Map(perSection.map((x) => [x.sectionId, x]));
  const totals = emptyCounts();
  let marked = 0;
  let markedStudents = 0;
  const sectionRows = secRows.map((s) => {
    const a = agg.get(s.id);
    const counts = a ? { present: a.present, absent: a.absent, late: a.late, leave: a.leave, half_day: a.half_day } : emptyCounts();
    if (a) {
      marked++;
      markedStudents += a.students;
      for (const k of Object.keys(totals) as AttendanceStatus[]) totals[k] += counts[k];
    }
    return { sectionId: s.id, name: s.name, gradeName: s.gradeName, classTeacherName: s.ctFirst ? fullName(s.ctFirst, s.ctLast) : null, strength: strengths.get(s.id) ?? 0, marked: !!a, ...counts, percentPresent: percentage(counts) };
  });
  const activeStudents = [...strengths.values()].reduce((a, b) => a + b, 0);
  return {
    date,
    mode: att.mode,
    isWorkingDay: acad.workingDays.includes(isoWeekday(date)),
    holiday: holidayOn(holidays, date),
    totals: { ...totals, activeStudents, markedStudents, unmarkedStudents: Math.max(0, activeStudents - markedStudents), percentPresent: percentage(totals) },
    sectionsTotal: sectionRows.length,
    sectionsMarked: marked,
    sections: sectionRows,
    absentees: absentRows.map((a) => ({ studentId: a.studentId, name: fullName(a.firstName, a.lastName) ?? a.firstName, admissionNo: a.admissionNo, rollNo: a.rollNo, sectionId: a.sectionId, sectionName: sectionLabel(a.gradeName, a.sectionName), remarks: a.remarks })),
    absenteesTotal: absentRows[0]?.total ?? 0,
    trend: trend.map((t) => ({ date: t.date, present: t.present, absent: t.absent, late: t.late, leave: t.leave, half_day: t.half_day, percentPresent: percentage(t) })),
  };
}

// ── "today" helper for the dashboards ─────────────────────────────────────────────────────

const DAY_RANK: Record<AttendanceStatus, number> = { absent: 5, half_day: 4, late: 3, leave: 2, present: 1 };

export async function todayView(ctx: Ctx): Promise<AttendanceTodayResponse> {
  const { db, p, tenant } = ctx;
  const [att, acad] = await Promise.all([getSetting(db, 'attendance'), getSetting(db, 'academic')]);
  const date = todayIn(tenant.timezone);
  const holiday = holidayOn(await holidaysBetween(db, date, date), date);
  const isWorkingDay = acad.workingDays.includes(isoWeekday(date));
  const isSchoolDay = isWorkingDay && !holiday;
  const out: AttendanceTodayResponse = { date, mode: att.mode, isWorkingDay, holiday, role: p.userType === 'student' ? 'student' : p.userType === 'parent' ? 'parent' : 'teacher', items: [], pendingCount: 0, children: [], school: null };

  if (p.userType !== 'staff') {
    const ids = p.userType === 'student' ? (p.studentId ? [p.studentId] : []) : p.linkedStudentIds;
    if (!ids.length || !p.scope('attendance:view')) return out;
    const [kids, recs] = await Promise.all([
      db.select({ id: students.id, firstName: students.firstName, lastName: students.lastName, sectionId: students.currentSectionId }).from(students).where(and(inArray(students.id, ids), isNull(students.archivedAt))).orderBy(asc(students.firstName)),
      db.select({ studentId: r.studentId, status: r.status, remarks: r.remarks }).from(r).where(and(inArray(r.studentId, ids), eq(r.date, date))),
    ]);
    const best = new Map<string, { status: AttendanceStatus; remarks: string | null }>();
    for (const x of recs) if (!best.has(x.studentId) || DAY_RANK[x.status] > DAY_RANK[best.get(x.studentId)!.status]) best.set(x.studentId, { status: x.status, remarks: x.remarks });
    out.children = kids.map((k) => ({ studentId: k.id, name: fullName(k.firstName, k.lastName) ?? k.firstName, sectionId: k.sectionId, status: best.get(k.id)?.status ?? null, remarks: best.get(k.id)?.remarks ?? null }));
    return out;
  }

  if (!p.scope('attendance:view') && !p.scope('attendance:create')) throw forbidden();
  const strengths = await activeStrengths(db);

  // teachers: what do I have to mark today?
  if (p.can('attendance:create', 'assigned') && isSchoolDay) {
    type Item = AttendanceTodayResponse['items'][number];
    let wanted: { sectionId: string; periodId: string | null; periodName: string | null; subjectName: string | null; sectionName: string }[] = [];
    if (att.mode === 'daily') {
      if (p.classTeacherSectionIds.length) {
        const secs = await db.select({ id: sections.id, name: sections.name, gradeName: grades.name }).from(sections).innerJoin(grades, eq(grades.id, sections.gradeId)).where(inArray(sections.id, p.classTeacherSectionIds)).orderBy(asc(grades.ordinal), asc(sections.name));
        wanted = secs.map((s) => ({ sectionId: s.id, periodId: null, periodName: null, subjectName: null, sectionName: sectionLabel(s.gradeName, s.name) }));
      }
    } else if (p.staffId) {
      const dow = isoWeekday(date);
      const rows = await db
        .select({ sectionId: timetableSlots.sectionId, periodId: timetableSlots.periodId, periodName: periods.name, ordinal: periods.ordinal, subjectName: subjects.name, sectionName: sections.name, gradeName: grades.name })
        .from(timetableSlots)
        .innerJoin(periods, and(eq(periods.id, timetableSlots.periodId), eq(periods.isBreak, false)))
        .innerJoin(sections, eq(sections.id, timetableSlots.sectionId))
        .innerJoin(grades, eq(grades.id, sections.gradeId))
        .leftJoin(subjects, eq(subjects.id, timetableSlots.subjectId))
        .leftJoin(timetableSubstitutions, and(eq(timetableSubstitutions.slotId, timetableSlots.id), eq(timetableSubstitutions.date, date)))
        .where(and(eq(timetableSlots.dayOfWeek, dow), or(and(isNull(timetableSubstitutions.id), eq(timetableSlots.staffId, p.staffId)), eq(timetableSubstitutions.substituteStaffId, p.staffId))))
        .orderBy(asc(periods.ordinal), asc(grades.ordinal), asc(sections.name));
      wanted = rows.map((x) => ({ sectionId: x.sectionId, periodId: x.periodId, periodName: x.periodName, subjectName: x.subjectName, sectionName: sectionLabel(x.gradeName, x.sectionName) }));
    }
    if (wanted.length) {
      const secIds = [...new Set(wanted.map((w) => w.sectionId))];
      const sess = await db
        .select({ id: attendanceSessions.id, sectionId: attendanceSessions.sectionId, periodId: attendanceSessions.periodId, status: attendanceSessions.status })
        .from(attendanceSessions)
        .where(and(eq(attendanceSessions.date, date), inArray(attendanceSessions.sectionId, secIds)));
      const counts = sess.length
        ? await db
            .select({ sessionId: r.sessionId, ...statusCountCols(r.status) })
            .from(r)
            .where(and(eq(r.date, date), inArray(r.sessionId, sess.map((s) => s.id))))
            .groupBy(r.sessionId)
        : [];
      const countBySession = new Map(counts.map((c) => [c.sessionId, { present: c.present, absent: c.absent, late: c.late, leave: c.leave, half_day: c.half_day }]));
      out.items = wanted.map((w): Item => {
        const s = sess.find((x) => x.sectionId === w.sectionId && x.periodId === w.periodId);
        return { sectionId: w.sectionId, sectionName: w.sectionName, periodId: w.periodId, periodName: w.periodName, subjectName: w.subjectName, strength: strengths.get(w.sectionId) ?? 0, marked: s?.status === 'submitted', sessionStatus: s?.status ?? null, counts: s ? (countBySession.get(s.id) ?? emptyCounts()) : null };
      });
      out.pendingCount = out.items.filter((i) => !i.marked).length;
    }
  }

  // management: school-level snapshot
  if (p.can('attendance:view', 'school')) {
    out.role = 'management';
    const [secRows, perSection] = await Promise.all([currentSections(db), dayBySection(db, date)]);
    const totals = emptyCounts();
    for (const x of perSection) for (const k of Object.keys(totals) as AttendanceStatus[]) totals[k] += x[k];
    out.school = {
      sectionsTotal: secRows.length,
      sectionsMarked: perSection.length,
      activeStudents: [...strengths.values()].reduce((a, b) => a + b, 0),
      present: totals.present,
      absent: totals.absent,
      percentPresent: percentage(totals),
    };
  }
  return out;
}

// ── CSV export (one date at a time → memory stays flat) ──────────────────────────────────────────

export const EXPORT_MAX_DAYS = 93;

export async function* exportRows(ctx: Ctx, q: { from: string; to: string; sectionId?: string | undefined }): AsyncGenerator<(string | number | null)[]> {
  const { db, p } = ctx;
  checkRange(q.from, q.to, EXPORT_MAX_DAYS);
  if (q.sectionId && !p.can('attendance:export', 'school') && !p.assignedSectionIds.includes(q.sectionId)) throw notFound('Section');
  const scope = sectionScope(p, 'attendance:export', r.sectionId);
  for (let d = q.from; d <= q.to; d = addDaysIso(d, 1)) {
    const rows = await db
      .select({ date: r.date, gradeName: grades.name, sectionName: sections.name, rollNo: students.rollNo, admissionNo: students.admissionNo, firstName: students.firstName, lastName: students.lastName, status: r.status, remarks: r.remarks, periodName: periods.name })
      .from(r)
      .innerJoin(attendanceSessions, eq(attendanceSessions.id, r.sessionId))
      .leftJoin(periods, eq(periods.id, attendanceSessions.periodId))
      .innerJoin(students, eq(students.id, r.studentId))
      .innerJoin(sections, eq(sections.id, r.sectionId))
      .innerJoin(grades, eq(grades.id, sections.gradeId))
      .where(and(eq(r.date, d), scope, q.sectionId ? eq(r.sectionId, q.sectionId) : undefined))
      .orderBy(asc(grades.ordinal), asc(sections.name), asc(periods.ordinal), sql`${students.rollNo} asc nulls last`, asc(students.id));
    for (const x of rows) yield [x.date, x.gradeName, x.sectionName, x.periodName, x.rollNo, x.admissionNo, fullName(x.firstName, x.lastName), x.status, x.remarks];
  }
}

// ── shortage scan ──────────────────────────────────────────────────────────────────────────────

/** Students need at least this many counted days before a percentage means anything. */
export const SHORTAGE_MIN_DAYS = 10;

export interface ShortageScanResult {
  month: string;
  thresholdPercent: number;
  checked: number;
  belowThreshold: number;
  alertsSent: number;
  notifications: number;
}

/**
 * Students whose attendance since the start of the academic year is below `attendance.shortagePercent` get ONE alert per
 * month (guardians notified). Idempotent: `attendance_alerts (student, month)` is unique, so a second run — or two
 * instances at once — sends nothing new. Pass `push: 'defer'` when `db` is a job transaction (the push is queued a couple
 * of seconds later, after the commit; the sweeper catches anything missed) or `false` to skip pushing entirely.
 */
export async function scanAttendanceShortage(tenant: TenantInfo, db: Executor, opts: { push?: boolean | 'defer' } = {}): Promise<ShortageScanResult> {
  const att = await getSetting(db, 'attendance');
  const today = todayIn(tenant.timezone);
  const month = today.slice(0, 7);
  const result: ShortageScanResult = { month, thresholdPercent: att.shortagePercent, checked: 0, belowThreshold: 0, alertsSent: 0, notifications: 0 };
  const year = await currentYear(db);
  if (!year || today < year.startDate) return result;

  const agg = await db
    .select({ studentId: r.studentId, firstName: students.firstName, ...statusCountCols(r.status) })
    .from(r)
    .innerJoin(students, eq(students.id, r.studentId))
    .where(and(gte(r.date, year.startDate), lte(r.date, today), eq(students.status, 'active'), isNull(students.archivedAt)))
    .groupBy(r.studentId, students.firstName);
  const below: { studentId: string; firstName: string; pct: number }[] = [];
  for (const a of agg) {
    const counted = a.present + a.absent + a.late + a.half_day;
    if (counted < SHORTAGE_MIN_DAYS) continue;
    result.checked++;
    const pct = percentage(a)!;
    if (pct < att.shortagePercent) below.push({ studentId: a.studentId, firstName: a.firstName, pct });
  }
  result.belowThreshold = below.length;
  if (!below.length) return result;

  const ids = await db.transaction(async (tx) => {
    const created: { studentId: string; firstName: string; pct: number }[] = [];
    for (let i = 0; i < below.length; i += 500) {
      const chunk = below.slice(i, i + 500);
      const inserted = await tx.insert(attendanceAlerts).values(chunk.map((b) => ({ studentId: b.studentId, month, kind: 'shortage' as const, percentage: b.pct }))).onConflictDoNothing().returning({ studentId: attendanceAlerts.studentId });
      const fresh = new Set(inserted.map((x) => x.studentId));
      created.push(...chunk.filter((b) => fresh.has(b.studentId)));
    }
    result.alertsSent = created.length;
    if (!created.length) return [];
    const links = await guardianUsers(tx, created.map((c) => c.studentId));
    const byStudent = new Map(created.map((c) => [c.studentId, c]));
    const rows: NotifyRow[] = links.map((l) => {
      const c = byStudent.get(l.studentId)!;
      return { userId: l.userId, type: 'attendance.shortage', title: 'Attendance alert', body: `${c.firstName}'s attendance is ${c.pct}%, below the required ${att.shortagePercent}%.`, data: { route: '/attendance', studentId: l.studentId, month } };
    });
    result.notifications = rows.length;
    return insertNotifications(tx, rows);
  });
  if (opts.push === 'defer') deferPush(tenant, ids);
  else if (opts.push !== false) enqueuePush(tenant, ids);
  return result;
}
