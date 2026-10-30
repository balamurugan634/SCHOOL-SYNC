import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
import type { ManagementDashboard, ParentDashboard, StudentDashboard, TeacherDashboard } from '@school-sync/shared';
import { AppError, forbidden } from '../../core/errors';
import { addDaysIso, todayIn } from '../../core/http';
import { sectionScope } from '../../core/rbac/scope';
import { getSetting } from '../../core/settings';
import { licenseSummary } from '../../core/billing/summary';
import type { Executor } from '../../core/tenancy/pools';
import type { Principal } from '../../core/rbac/principal';
import type { TenantInfo } from '../../core/tenancy/registry';
import {
  admissions, attendanceCorrections, concessions, enrollments, examPapers, exams, expenses, grades, guardians, homework, homeworkSubmissions, invoices, leaveRequests, markSheets,
  recordCorrectionRequests, refunds, sections, staff, staffLeaveRequests, students, subjects, transportVehicles,
} from '../../db/tenant/schema';
import { currentYear, type Ctx } from '../attendance/common';
import { schoolSummary, studentSummary, todayView } from '../attendance/views.service';
import { calendarFeed } from '../communication/calendar';
import { listFeed, unreadCounts } from '../communication/announcements';
import { unreadCount } from '../communication/inbox';
import { upcoming as upcomingMeetings } from '../communication/meetings';
import { invoiceMath } from '../fees/billing';
import { financeSummary } from '../fees/reports';
import { dayView } from '../learning/timetable.service';
import { listHomework } from '../learning/homework.service';
import { tasksFeed } from '../learning/tasks.service';

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : null);
const n = (rows: { n: number }[] | undefined) => rows?.[0]?.n ?? 0;
const nowCount = sql<number>`count(*)::int`;

// ── shared blocks ───────────────────────────────────────────────────────────────────────────────
async function commonBlocks(ctx: Ctx, today: string) {
  const { db, tenant, p } = ctx;
  const [feed, counts, calendar, unread] = await Promise.all([
    listFeed(db, p, { page: 1, pageSize: 3 }),
    unreadCounts(db, p),
    calendarFeed(db, tenant, p, { from: today, to: addDaysIso(today, 14) }),
    unreadCount(db, p.userId),
  ]);
  return {
    announcements: { unreadCount: counts.unread, pendingAckCount: counts.pendingAck, latest: feed.items },
    calendar: calendar.slice(0, 10),
    notifications: { unreadCount: unread },
  };
}

/** Everything about ONE child's day; used by the student home and by the parent home (selected child). */
async function learnerToday(ctx: Ctx, studentId: string, today: string): Promise<StudentDashboard & ParentDashboard['child']> {
  const { db, tenant, p } = ctx;
  const [row] = await db
    .select({ id: students.id, first: students.firstName, last: students.lastName, admissionNo: students.admissionNo, sectionId: students.currentSectionId, gradeId: students.currentGradeId, section: sections.name, grade: grades.name })
    .from(students)
    .leftJoin(sections, eq(sections.id, students.currentSectionId))
    .leftJoin(grades, eq(grades.id, students.currentGradeId))
    .where(eq(students.id, studentId))
    .limit(1);
  if (!row) throw forbidden();
  const year = await currentYear(db);
  const asParentOf = p.userType === 'parent' ? studentId : undefined;

  const [attendance, todayAtt, timetable, pending, overdue, upcomingExams, results] = await Promise.all([
    year ? studentSummary(ctx, studentId, { from: year.startDate, to: today > year.endDate ? year.endDate : today }).catch(() => null) : Promise.resolve(null),
    todayView(ctx).then((t) => t.children.find((c) => c.studentId === studentId)?.status ?? null),
    dayView(db, tenant, p, { date: today, studentId: asParentOf, onlyToday: true }),
    listHomework(db, tenant, p, { page: 1, pageSize: 5, learnerStatus: 'pending', sort: 'dueAsc', studentId: asParentOf }),
    listHomework(db, tenant, p, { page: 1, pageSize: 1, learnerStatus: 'overdue', studentId: asParentOf }),
    row.gradeId
      ? db
          .select({ examId: exams.id, examName: exams.name, subject: subjects.name, date: examPapers.examDate, startTime: examPapers.startTime, endTime: examPapers.endTime, room: examPapers.room })
          .from(examPapers)
          .innerJoin(exams, eq(exams.id, examPapers.examId))
          .innerJoin(subjects, eq(subjects.id, examPapers.subjectId))
          .where(and(eq(examPapers.gradeId, row.gradeId), gte(examPapers.examDate, today), ne(exams.status, 'draft')))
          .orderBy(asc(examPapers.examDate), asc(examPapers.startTime))
          .limit(5)
      : Promise.resolve([]),
    row.sectionId
      ? db
          .select({ examId: exams.id, examName: exams.name, publishedAt: sql<string>`to_char(max(${markSheets.publishedAt}) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')` })
          .from(markSheets)
          .innerJoin(exams, eq(exams.id, markSheets.examId))
          .where(and(eq(markSheets.sectionId, row.sectionId), eq(markSheets.status, 'published')))
          .groupBy(exams.id, exams.name)
          .orderBy(desc(sql`max(${markSheets.publishedAt})`))
          .limit(3)
      : Promise.resolve([]),
  ]);

  return {
    date: today,
    student: { id: row.id, name: [row.first, row.last].filter(Boolean).join(' '), admissionNo: row.admissionNo, grade: row.grade ?? null, section: row.section ?? null },
    attendance,
    attendanceToday: todayAtt,
    timetable,
    homework: { pendingCount: pending.total, overdueCount: overdue.total, items: pending.rows },
    upcomingExams: upcomingExams.map((e) => ({ examId: e.examId, examName: e.examName, subject: e.subject, date: e.date as string, startTime: hhmm(e.startTime), endTime: hhmm(e.endTime), room: e.room })),
    publishedResults: results.map((r) => ({ examId: r.examId, examName: r.examName, publishedAt: r.publishedAt })),
    // filled by callers
    tasks: [],
    announcements: { unreadCount: 0, pendingAckCount: 0, latest: [] },
    calendar: [],
    notifications: { unreadCount: 0 },
  } as StudentDashboard;
}

// ── student ─────────────────────────────────────────────────────────────────────────────────────
export async function studentDashboard(ctx: Ctx): Promise<StudentDashboard> {
  const { db, tenant, p } = ctx;
  if (!p.studentId) throw new AppError(404, 'NO_STUDENT_PROFILE', 'This account is not linked to a student record');
  const today = todayIn(tenant.timezone);
  const [base, blocks, tasks] = await Promise.all([learnerToday(ctx, p.studentId, today), commonBlocks(ctx, today), tasksFeed(db, p, { limit: 6 })]);
  return { ...base, ...blocks, tasks, date: today };
}

// ── parent ──────────────────────────────────────────────────────────────────────────────────────
export async function parentDashboard(ctx: Ctx, wantedStudentId?: string): Promise<ParentDashboard> {
  const { db, tenant, p } = ctx;
  const today = todayIn(tenant.timezone);
  const blocks = await commonBlocks(ctx, today);
  const meetings = await upcomingMeetings(db, p, 3, tenant.id);
  const empty: ParentDashboard = { date: today, selectedStudentId: null, children: [], child: null, fees: null, meetings, pendingLeaveCount: 0, ...blocks };
  const ids = p.linkedStudentIds; // verified links only
  if (!ids.length) return empty;
  const selected = wantedStudentId && ids.includes(wantedStudentId) ? wantedStudentId : ids[0]!;

  const year = await currentYear(db);
  const feesOn = tenant.features.fees && p.can('fees:view');
  const lateFee = feesOn ? (await getSetting(db, 'fees')).lateFeePerDayMinor : 0;
  const [kids, att, invRows, leave, child] = await Promise.all([
    db
      .select({ id: students.id, first: students.firstName, last: students.lastName, admissionNo: students.admissionNo, section: sections.name, grade: grades.name })
      .from(students)
      .leftJoin(sections, eq(sections.id, students.currentSectionId))
      .leftJoin(grades, eq(grades.id, students.currentGradeId))
      .where(inArray(students.id, ids))
      .orderBy(asc(students.firstName)),
    todayView(ctx),
    feesOn ? db.select().from(invoices).where(and(inArray(invoices.studentId, ids), inArray(invoices.status, ['unpaid', 'partial']))).orderBy(asc(invoices.dueDate)) : Promise.resolve([]),
    db.select({ n: nowCount }).from(leaveRequests).where(and(inArray(leaveRequests.studentId, ids), eq(leaveRequests.status, 'pending'))),
    learnerToday(ctx, selected, today),
  ]);
  const percentages = new Map<string, number | null>();
  await Promise.all(
    ids.map(async (id) => {
      const s = id === selected && child.attendance ? child.attendance : year ? await studentSummary(ctx, id, { from: year.startDate, to: today > year.endDate ? year.endDate : today }).catch(() => null) : null;
      percentages.set(id, s?.totals.percentage ?? null);
    }),
  );
  const math = invRows.map((inv) => ({ inv, m: invoiceMath(inv, today, lateFee) })).filter((x) => x.m.balanceMinor > 0);
  const nameOf = new Map(kids.map((k) => [k.id, [k.first, k.last].filter(Boolean).join(' ')]));
  const outstandingBy = new Map<string, { sum: number; overdue: number }>();
  for (const x of math) {
    const cur = outstandingBy.get(x.inv.studentId) ?? { sum: 0, overdue: 0 };
    cur.sum += x.m.balanceMinor;
    if (x.m.overdue) cur.overdue += 1;
    outstandingBy.set(x.inv.studentId, cur);
  }
  const next = math[0];
  return {
    date: today,
    selectedStudentId: selected,
    children: kids.map((k) => ({
      student: { id: k.id, name: nameOf.get(k.id) ?? '', admissionNo: k.admissionNo, grade: k.grade ?? null, section: k.section ?? null },
      attendanceToday: att.children.find((c) => c.studentId === k.id)?.status ?? null,
      attendancePercentage: percentages.get(k.id) ?? null,
      outstandingMinor: outstandingBy.get(k.id)?.sum ?? 0,
      overdueCount: outstandingBy.get(k.id)?.overdue ?? 0,
    })),
    child: {
      student: child.student,
      attendance: child.attendance,
      attendanceToday: child.attendanceToday,
      timetable: child.timetable,
      homework: child.homework,
      upcomingExams: child.upcomingExams,
      publishedResults: child.publishedResults,
    },
    fees: feesOn
      ? {
          currency: tenant.currency,
          outstandingMinor: math.reduce((a, x) => a + x.m.balanceMinor, 0),
          overdueMinor: math.filter((x) => x.m.overdue).reduce((a, x) => a + x.m.balanceMinor, 0),
          overdueCount: math.filter((x) => x.m.overdue).length,
          nextDue: next ? { invoiceId: next.inv.id, title: next.inv.title, studentName: nameOf.get(next.inv.studentId) ?? '', dueDate: next.inv.dueDate, balanceMinor: next.m.balanceMinor } : null,
        }
      : null,
    meetings,
    pendingLeaveCount: n(leave),
    ...blocks,
  };
}

// ── teacher ─────────────────────────────────────────────────────────────────────────────────────
export async function teacherDashboard(ctx: Ctx): Promise<TeacherDashboard> {
  const { db, tenant, p } = ctx;
  if (!p.staffId) throw new AppError(404, 'NO_STAFF_PROFILE', 'This account is not linked to a staff record');
  const today = todayIn(tenant.timezone);
  const mySheets = p.teaching.length ? or(...p.teaching.map((t) => and(eq(markSheets.sectionId, t.sectionId), eq(markSheets.subjectId, t.subjectId)))) : sql`false`;

  const [[me], blocks, attendance, timetable, review, dueSoon, sheets, leave, meetings] = await Promise.all([
    db.select({ id: staff.id, first: staff.firstName, last: staff.lastName, designation: staff.designation }).from(staff).where(eq(staff.id, p.staffId)).limit(1),
    commonBlocks(ctx, today),
    todayView(ctx),
    dayView(db, tenant, p, { date: today, onlyToday: true }),
    db
      .select({ n: nowCount })
      .from(homeworkSubmissions)
      .innerJoin(homework, eq(homework.id, homeworkSubmissions.homeworkId))
      .where(and(eq(homework.staffId, p.staffId), inArray(homeworkSubmissions.status, ['submitted', 'late']))),
    listHomework(db, tenant, p, { page: 1, pageSize: 5, status: 'published', mine: true, dueFrom: today, dueTo: addDaysIso(today, 3), sort: 'dueAsc' }),
    db
      .select({ sheetId: markSheets.id, examName: exams.name, sectionName: sections.name, gradeName: grades.name, subject: subjects.name, status: markSheets.status })
      .from(markSheets)
      .innerJoin(exams, eq(exams.id, markSheets.examId))
      .innerJoin(sections, eq(sections.id, markSheets.sectionId))
      .innerJoin(grades, eq(grades.id, sections.gradeId))
      .innerJoin(subjects, eq(subjects.id, markSheets.subjectId))
      .where(and(mySheets, eq(exams.status, 'marks_entry'), inArray(markSheets.status, ['draft', 'returned'])))
      .orderBy(asc(exams.startDate))
      .limit(50),
    p.classTeacherSectionIds.length ? db.select({ n: nowCount }).from(leaveRequests).where(and(inArray(leaveRequests.sectionId, p.classTeacherSectionIds), eq(leaveRequests.status, 'pending'))) : Promise.resolve([{ n: 0 }]),
    upcomingMeetings(db, p, 3, tenant.id),
  ]);
  return {
    date: today,
    staff: { id: me?.id ?? p.staffId, name: [me?.first, me?.last].filter(Boolean).join(' ') || p.displayName, designation: me?.designation ?? null },
    attendance,
    timetable,
    homework: { toReviewCount: n(review), dueSoon: dueSoon.rows },
    marks: {
      pendingCount: sheets.length,
      returnedCount: sheets.filter((s) => s.status === 'returned').length,
      items: sheets.slice(0, 5).map((s) => ({ sheetId: s.sheetId, examName: s.examName, sectionName: `${s.gradeName} ${s.sectionName}`, subject: s.subject, status: s.status as 'draft' | 'returned' })),
    },
    pendingLeaveCount: n(leave),
    meetings,
    ...blocks,
  };
}

// ── management ──────────────────────────────────────────────────────────────────────────────────
export async function managementDashboard(ctx: Ctx): Promise<ManagementDashboard> {
  const { db, tenant, p } = ctx;
  const today = todayIn(tenant.timezone);
  const year = await currentYear(db);
  const yearId = year?.id;
  const school = (perm: Parameters<Principal['can']>[0]) => p.can(perm, 'school');
  const when = <T>(ok: boolean, f: () => Promise<T>): Promise<T | null> => (ok ? f() : Promise.resolve(null));
  const pendingCount = async (q: Promise<{ n: number }[]>) => n(await q);

  const [kpis, blocks, attendance, approvals, finance, examsBlock, byGrade, license, vehicles] = await Promise.all([
    Promise.all([
      db.select({ n: nowCount }).from(students).where(and(eq(students.status, 'active'), isNull(students.archivedAt))),
      db.select({ n: nowCount }).from(staff).where(eq(staff.status, 'active')),
      db.select({ n: nowCount }).from(guardians),
      yearId ? db.select({ n: nowCount }).from(sections).where(eq(sections.academicYearId, yearId)) : Promise.resolve([{ n: 0 }]),
      db.select({ n: nowCount }).from(grades).where(eq(grades.isActive, true)),
    ]),
    commonBlocks(ctx, today),
    when(school('attendance:view'), () => schoolSummary(ctx, { trendDays: 7, absenteeLimit: 1 })),
    Promise.all([
      when(p.can('leave:approve'), () => pendingCount(db.select({ n: nowCount }).from(leaveRequests).where(and(eq(leaveRequests.status, 'pending'), sectionScope(p, 'leave:approve', leaveRequests.sectionId))))),
      when(school('staff_leave:approve'), () => pendingCount(db.select({ n: nowCount }).from(staffLeaveRequests).where(eq(staffLeaveRequests.status, 'pending')))),
      when(p.can('attendance:approve'), () => pendingCount(db.select({ n: nowCount }).from(attendanceCorrections).where(and(eq(attendanceCorrections.status, 'pending'), sectionScope(p, 'attendance:approve', attendanceCorrections.sectionId))))),
      when(school('marks:approve'), () => pendingCount(db.select({ n: nowCount }).from(markSheets).where(eq(markSheets.status, 'submitted')))),
      when(school('admissions:view'), () => pendingCount(db.select({ n: nowCount }).from(admissions).where(inArray(admissions.status, ['submitted', 'under_review'])))),
      when(school('students:edit'), () => pendingCount(db.select({ n: nowCount }).from(recordCorrectionRequests).where(eq(recordCorrectionRequests.status, 'pending')))),
      when(tenant.features.fees && school('fees:approve'), () => pendingCount(db.select({ n: nowCount }).from(concessions).where(eq(concessions.status, 'pending')))),
      when(tenant.features.fees && school('payments:approve'), () => pendingCount(db.select({ n: nowCount }).from(refunds).where(eq(refunds.status, 'requested')))),
      when(tenant.features.fees && school('expenses:approve'), () => pendingCount(db.select({ n: nowCount }).from(expenses).where(eq(expenses.status, 'pending')))),
    ]),
    when(tenant.features.fees && school('fees:view') && school('payments:view'), () => financeSummary(db, tenant, p, {})),
    when(p.can('exams:view'), async () => {
      const [upcoming, review] = await Promise.all([
        db.select({ examId: exams.id, name: exams.name, startDate: exams.startDate, status: exams.status }).from(exams).where(and(ne(exams.status, 'draft'), or(isNull(exams.endDate), gte(exams.endDate, today)))).orderBy(asc(exams.startDate)).limit(4),
        db.select({ n: nowCount }).from(exams).where(eq(exams.status, 'under_review')),
      ]);
      return { upcoming, underReviewCount: n(review) };
    }),
    when(school('students:view') && !!yearId, () =>
      db
        .select({ grade: grades.name, students: nowCount })
        .from(enrollments)
        .innerJoin(grades, eq(grades.id, enrollments.gradeId))
        .where(eq(enrollments.academicYearId, yearId!))
        .groupBy(grades.name, grades.ordinal)
        .orderBy(asc(grades.ordinal)),
    ),
    when(school('settings:view'), () => licenseSummary(db, tenant.id)),
    when(tenant.features.transport && school('transport:view'), () => db.select({ n: nowCount }).from(transportVehicles).where(and(eq(transportVehicles.isActive, true), lte(transportVehicles.insuranceExpiry, addDaysIso(today, 30))))),
  ]);

  const [studentsN, staffN, parentsN, sectionsN, gradesN] = kpis;
  const [studentLeave, staffLeave, corrections, sheetsReview, adm, corrReq, conc, ref, exp] = approvals;

  const alerts: ManagementDashboard['alerts'] = [];
  if (attendance && attendance.isWorkingDay && !attendance.holiday && attendance.sectionsTotal > attendance.sectionsMarked) {
    const missing = attendance.sectionsTotal - attendance.sectionsMarked;
    alerts.push({ key: 'attendance_unmarked', severity: 'warning', message: `${missing} ${missing === 1 ? 'class has' : 'classes have'} not marked attendance today`, count: missing, route: '/attendance' });
  }
  if (license?.state === 'expired' || license?.state === 'cancelled') alerts.push({ key: 'license_expired', severity: 'critical', message: 'Subscription expired — the school is read-only until it is renewed', count: null, route: '/settings/license' });
  else if (license?.state === 'grace') alerts.push({ key: 'license_grace', severity: 'warning', message: `Subscription period ended — renew by ${license.graceEndsOn} to avoid read-only mode`, count: null, route: '/settings/license' });
  if (license?.seats.nearLimit) alerts.push({ key: 'license_seats', severity: 'warning', message: `${license.seats.used} of ${license.seats.licensed} student seats are in use`, count: license.seats.used, route: '/settings/license' });
  const vehiclesDue = n(vehicles ?? undefined);
  if (vehiclesDue > 0) alerts.push({ key: 'insurance_expiring', severity: 'warning', message: `${vehiclesDue} ${vehiclesDue === 1 ? 'vehicle has' : 'vehicles have'} insurance expiring within 30 days`, count: vehiclesDue, route: '/transport/vehicles' });

  return {
    date: today,
    kpis: { students: n(studentsN), staff: n(staffN), parents: n(parentsN), sections: n(sectionsN), grades: n(gradesN) },
    attendance: attendance ? { date: attendance.date, mode: attendance.mode, isWorkingDay: attendance.isWorkingDay, holiday: attendance.holiday, totals: attendance.totals, sectionsTotal: attendance.sectionsTotal, sectionsMarked: attendance.sectionsMarked, trend: attendance.trend } : null,
    approvals: { studentLeave, staffLeave, attendanceCorrections: corrections, markSheetsForReview: sheetsReview, admissions: adm, correctionRequests: corrReq, concessions: conc, refunds: ref, expenses: exp },
    finance,
    exams: examsBlock,
    enrollmentByGrade: byGrade ?? [],
    license,
    alerts,
    ...blocks,
  };
}

