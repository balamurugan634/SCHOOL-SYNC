import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { upsertSubscription } from '../src/core/billing/invoicing';
import { invalidateLicense } from '../src/core/billing/license';
import { addDaysIso, isoWeekday, todayIn } from '../src/core/http';
import { runJobOnce } from '../src/core/jobs';
import { putSetting } from '../src/core/settings';
import {
  attendanceAlerts,
  attendanceCorrections,
  attendanceRecords,
  attendanceSessions,
  auditLogs,
  events,
  leaveRequests,
  notifications,
  periods,
  staff,
  staffAttendance,
  teachingAssignments,
  timetableSlots,
  timetableSubstitutions,
  userRoles,
  users,
} from '../src/db/tenant/schema';
import { jobs } from '../src/modules/attendance/jobs';
import { createTestSchool, type TestSchool } from './helpers';

type Student = TestSchool['ctx']['students'][number];
type Section = TestSchool['ctx']['sections'][number];

let s: TestSchool;
const tokens = new Map<string, string>();
const T = (who: string): string => {
  const t = tokens.get(who);
  if (!t) throw new Error(`no token for ${who}`);
  return t;
};

let secA: Section;
let secB: Section;
let studentsA: Student[];
let studentsB: Student[];
let userOfStaff: (staffId: string) => string;
let today: string;
let workingDays = [1, 2, 3, 4, 5, 6];
let D0: string; // most recent school day ≤ today (today unless it is a Sunday)
let D1: string;
let D2: string;
let userIdOf: Record<string, string> = {};

const isWork = (d: string) => workingDays.includes(isoWeekday(d));
const schoolDayBack = (n: number): string => {
  let d = today;
  while (!isWork(d)) d = addDaysIso(d, -1);
  for (let i = 0; i < n; i++) {
    d = addDaysIso(d, -1);
    while (!isWork(d)) d = addDaysIso(d, -1);
  }
  return d;
};
const nextSchoolDay = (from: string): string => {
  let d = addDaysIso(from, 1);
  while (!isWork(d)) d = addDaysIso(d, 1);
  return d;
};
const lastSunday = (): string => {
  let d = today;
  while (isoWeekday(d) !== 7) d = addDaysIso(d, -1);
  return d;
};
const guardianOf = (studentId: string) => s.ctx.guardians.find((g) => g.studentIds.includes(studentId))!;
const notifsOf = (type: string, userIds?: string[]) => s.db.select().from(notifications).where(userIds ? and(eq(notifications.type, type), inArray(notifications.userId, userIds)) : eq(notifications.type, type));
const auditOf = (action: string) => s.db.select().from(auditLogs).where(eq(auditLogs.action, action)).orderBy(asc(auditLogs.at));
const submit = (who: string, sectionId: string, body: unknown) => s.req('PUT', `/attendance/sections/${sectionId}`, T(who), body);
const roster = (who: string, sectionId: string, qs = '') => s.req('GET', `/attendance/sections/${sectionId}${qs}`, T(who));
const pct = (present: number, absent: number, late: number, half: number) => {
  const denom = present + absent + late + half;
  return denom ? Math.round(((present + late + half * 0.5) / denom) * 1000) / 10 : null;
};

async function addTeacher(username: string) {
  const [u] = await s.db.insert(users).values({ userType: 'staff', username, displayName: `Extra ${username}`, passwordHash: s.ctx.passwordHash, passwordChangedAt: new Date() }).returning({ id: users.id });
  const [st] = await s.db.insert(staff).values({ userId: u!.id, employeeId: `EMPX-${username}`, firstName: 'Extra', lastName: username }).returning({ id: staff.id });
  await s.db.insert(userRoles).values({ userId: u!.id, roleId: s.ctx.roleIds['teacher']! });
  return { userId: u!.id, staffId: st!.id };
}

beforeAll(async () => {
  s = await createTestSchool();
  today = todayIn(s.tenant.timezone);
  D0 = schoolDayBack(0);
  D1 = schoolDayBack(1);
  D2 = schoolDayBack(2);
  [secA, secB] = [s.ctx.sections[0]!, s.ctx.sections[1]!];
  studentsA = s.ctx.students.filter((x) => x.sectionId === secA.id).sort((a, b) => a.rollNo - b.rollNo);
  studentsB = s.ctx.students.filter((x) => x.sectionId === secB.id).sort((a, b) => a.rollNo - b.rollNo);
  userOfStaff = (id) => s.ctx.teachers.find((t) => t.id === id)!.userId;

  // isolate the two class teachers: A's teacher only has section A, B's teacher only section B (the seed spreads subject teaching over both)
  await s.db.delete(teachingAssignments).where(and(eq(teachingAssignments.staffId, secB.classTeacherId), eq(teachingAssignments.sectionId, secA.id)));
  await s.db.delete(teachingAssignments).where(and(eq(teachingAssignments.staffId, secA.classTeacherId), eq(teachingAssignments.sectionId, secB.id)));
  const none = await addTeacher('t_none');
  const ctAUser = s.ctx.teachers.find((t) => t.id === secA.classTeacherId)!;
  const ctBUser = s.ctx.teachers.find((t) => t.id === secB.classTeacherId)!;
  const subs = s.ctx.teachers.filter((t) => t.id !== secA.classTeacherId && t.id !== secB.classTeacherId);
  const logins: Record<string, string> = {
    ctA: ctAUser.username,
    ctB: ctBUser.username,
    sub: subs[0]!.username, // teaches in A and B, not a class teacher
    sub2: subs[1]!.username,
    none: 't_none',
    principal: 'principal',
    office: 'office',
    hr: 'hr',
    accounts: 'accounts',
    student: studentsA[0]!.username,
    student2: studentsA[1]!.username,
    studentB: studentsB[0]!.username,
    parent: guardianOf(studentsA[1]!.id).username,
    parentB: guardianOf(studentsB[0]!.id).username,
    unverified: '9099999999',
  };
  for (const [k, u] of Object.entries(logins)) tokens.set(k, await s.login(u));
  userIdOf = { ctA: ctAUser.userId, ctB: ctBUser.userId, sub: subs[0]!.userId, sub2: subs[1]!.userId, none: none.userId, principal: s.ctx.staff['principal']!.userId, office: s.ctx.staff['office']!.userId, hr: s.ctx.staff['hr']!.userId };
  const [unv] = await s.db.select({ id: users.id }).from(users).where(eq(users.username, '9099999999'));
  userIdOf['unverified'] = unv!.id;
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
describe('permission matrix', () => {
  const R = (): string => `/attendance/sections/${secA.id}`;
  const future = (): string => addDaysIso(today, 1);
  type Case = [string, 'GET' | 'POST' | 'PUT' | 'PATCH', () => string, (() => unknown) | undefined, Record<string, number>];
  const cases: Case[] = [
    ['roster', 'GET', R, undefined, { ctA: 200, ctB: 404, sub: 200, none: 404, principal: 200, office: 200, hr: 403, accounts: 403, student: 403, parent: 403, unverified: 403 }],
    // authorisation is checked before the body is evaluated: a future date proves the caller got past the rights check (422) or not (403/404)
    ['submit', 'PUT', R, () => ({ date: future(), records: [] }), { ctA: 422, ctB: 404, sub: 403, none: 404, principal: 403, office: 422, hr: 403, accounts: 403, student: 403, parent: 403, unverified: 403 }],
    ['school summary', 'GET', () => '/attendance/summary', undefined, { ctA: 403, sub: 403, principal: 200, office: 200, hr: 403, accounts: 403, student: 403, parent: 403 }],
    ['today', 'GET', () => '/attendance/today', undefined, { ctA: 200, sub: 200, principal: 200, office: 200, student: 200, parent: 200, unverified: 200, hr: 403, accounts: 403 }],
    ['export', 'GET', () => `/attendance/export?from=${today}&to=${today}`, undefined, { principal: 200, office: 200, ctA: 403, sub: 403, hr: 403, student: 403, parent: 403 }],
    ['shortage scan', 'POST', () => '/attendance/shortage-scan', undefined, { principal: 200, office: 200, ctA: 403, sub: 403, hr: 403, student: 403, parent: 403 }],
    ['corrections list', 'GET', () => '/attendance/corrections', undefined, { principal: 200, ctA: 200, sub: 200, office: 403, hr: 403, student: 403, parent: 403 }],
    ['correction approve', 'POST', () => `/attendance/corrections/${s.ctx.sections[0]!.id}/approve`, () => ({}), { principal: 404, ctA: 404, sub: 403, office: 403, student: 403, parent: 403 }],
    ['student summary (stranger)', 'GET', () => `/attendance/students/${studentsB[0]!.id}/summary`, undefined, { ctB: 200, ctA: 404, principal: 200, parentB: 200, parent: 404, studentB: 200, student: 404, unverified: 404, hr: 403 }],
    ['leave list', 'GET', () => '/leave', undefined, { student: 200, parent: 200, unverified: 200, ctA: 200, principal: 200, office: 200, hr: 403, accounts: 403 }],
    // validation runs before the route guard, so send a valid body: callers who may apply get past the guard and hit the record scope (another family's child → 404)
    ['leave apply', 'POST', () => '/leave', () => ({ studentId: studentsB[1]!.id, fromDate: today, toDate: today, reason: 'Fever' }), { student: 404, parent: 404, ctA: 403, sub: 403, principal: 403, office: 403, hr: 403 }],
    ['leave approve', 'POST', () => `/leave/${secA.id}/approve`, () => ({}), { student: 403, parent: 403, sub: 403, ctA: 404, principal: 404, office: 404, hr: 403 }],
    ['staff register', 'GET', () => '/staff-attendance', undefined, { hr: 200, principal: 200, sub: 200, accounts: 200, student: 403, parent: 403 }],
    ['staff mark', 'PUT', () => '/staff-attendance', () => ({ records: [{ staffId: secA.id, status: 'present' }] }), { hr: 422, principal: 403, office: 403, sub: 403, student: 403, parent: 403 }],
    ['staff summary', 'GET', () => '/staff-attendance/summary', undefined, { hr: 200, principal: 200, sub: 403, student: 403 }],
    ['staff export', 'GET', () => `/staff-attendance/export?from=${today}&to=${today}`, undefined, { hr: 200, principal: 403, sub: 403, student: 403 }],
    ['staff check-in', 'POST', () => '/staff-attendance/check-in', undefined, { student: 403, parent: 403 }],
    ['staff leave list', 'GET', () => '/staff-leave', undefined, { hr: 200, principal: 200, sub: 200, office: 403, accounts: 403, student: 403, parent: 403 }],
    ['staff leave apply', 'POST', () => '/staff-leave', () => ({ fromDate: addDaysIso(today, -90), toDate: addDaysIso(today, -90), reason: 'Old' }), { sub: 422, hr: 422, student: 403, parent: 403 }],
    ['staff leave approve', 'POST', () => `/staff-leave/${secA.id}/approve`, () => ({}), { hr: 404, principal: 404, sub: 403, office: 403, student: 403, parent: 403 }],
  ];
  for (const [name, method, path, body, expected] of cases) {
    for (const [who, status] of Object.entries(expected)) {
      it(`${name}: ${who} → ${status}`, async () => {
        const r = await s.req(method, path(), T(who), body?.());
        expect(r.status, JSON.stringify(r.body)).toBe(status);
      });
    }
  }
  it('requires authentication', async () => {
    expect((await s.req('GET', '/attendance/today')).status).toBe(401);
    expect((await s.req('PUT', R(), null, { records: [] })).status).toBe(401);
    expect((await s.req('GET', '/leave')).status).toBe(401);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
describe('roll call: submit, idempotency, notifications, audit', () => {
  it('the roster starts unmarked, and shows who may submit', async () => {
    const r = await roster('ctA', secA.id, `?date=${D0}`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ sectionId: secA.id, date: D0, mode: 'daily', session: null, canSubmit: true, blockedReason: null, isFuture: false, isWorkingDay: true });
    expect(r.body.students).toHaveLength(6);
    expect(r.body.students.map((x: any) => x.rollNo)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(r.body.students.every((x: any) => x.status === null && x.recordId === null)).toBe(true);
    expect(r.body.counts).toMatchObject({ unmarked: 6, present: 0 });
    // a subject teacher can look but not mark in daily mode; management can look but not mark
    expect(await roster('sub', secA.id, `?date=${D0}`).then((x) => [x.body.canSubmit, x.body.blockedReason])).toEqual([false, 'NOT_CLASS_TEACHER']);
    expect(await roster('principal', secA.id, `?date=${D0}`).then((x) => [x.body.canSubmit, x.body.blockedReason])).toEqual([false, 'NOT_ALLOWED_TO_MARK']);
  });

  it('the class teacher submits the whole roll call; guardians of absent students are notified (verified links only)', async () => {
    const a = studentsA;
    const r = await submit('ctA', secA.id, {
      date: D0,
      records: [
        { studentId: a[0]!.id, status: 'absent', remarks: 'Fever' },
        { studentId: a[1]!.id, status: 'absent' },
        { studentId: a[2]!.id, status: 'late', remarks: 'Bus delay' },
        { studentId: a[3]!.id, status: 'present' },
        { studentId: a[4]!.id, status: 'present', remarks: '=HYPERLINK("http://evil")' },
        { studentId: a[5]!.id, status: 'present' },
      ],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ sectionId: secA.id, date: D0, status: 'submitted', firstSubmission: true, changed: 6, notifiedGuardians: 2, counts: { present: 3, absent: 2, late: 1, leave: 0, half_day: 0, total: 6 } });
    expect(new Date(r.body.editableUntil).getTime()).toBeGreaterThan(Date.now() + 20 * 3_600_000);

    const [session] = await s.db.select().from(attendanceSessions).where(and(eq(attendanceSessions.sectionId, secA.id), eq(attendanceSessions.date, D0)));
    expect(session).toMatchObject({ status: 'submitted', periodId: null, takenBy: secA.classTeacherId, takenByUserId: userIdOf['ctA'] });
    const recs = await s.db.select().from(attendanceRecords).where(eq(attendanceRecords.sessionId, session!.id));
    expect(recs).toHaveLength(6);
    // denormalised columns are filled correctly
    expect(recs.every((x) => x.date === D0 && x.sectionId === secA.id)).toBe(true);

    const absentGuardians = [guardianOf(a[0]!.id).userId, guardianOf(a[1]!.id).userId];
    const got = await notifsOf('attendance.absent');
    expect(got.map((n) => n.userId).sort()).toEqual([...absentGuardians].sort());
    expect(got.every((n) => n.title === 'Attendance update' && (n.data as any).route === '/attendance')).toBe(true);
    // the unverified guardian of student 0 hears nothing, nor do the students or anyone else
    expect(got.some((n) => n.userId === userIdOf['unverified'])).toBe(false);
    expect(got.find((n) => n.userId === absentGuardians[0])!.body).toContain(a[0]!.name.split(' ')[0]);
  });

  it('re-submitting the same roll call is idempotent: no duplicate rows, no duplicate notifications', async () => {
    const a = studentsA;
    const body = { date: D0, records: [{ studentId: a[0]!.id, status: 'absent', remarks: 'Fever' }, { studentId: a[1]!.id, status: 'absent' }, { studentId: a[2]!.id, status: 'late', remarks: 'Bus delay' }, { studentId: a[3]!.id, status: 'present' }, { studentId: a[4]!.id, status: 'present', remarks: '=HYPERLINK("http://evil")' }, { studentId: a[5]!.id, status: 'present' }] };
    const r = await submit('ctA', secA.id, body);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ firstSubmission: false, changed: 0, notifiedGuardians: 0 });
    const sessions = await s.db.select().from(attendanceSessions).where(and(eq(attendanceSessions.sectionId, secA.id), eq(attendanceSessions.date, D0)));
    expect(sessions).toHaveLength(1);
    expect(await s.db.select().from(attendanceRecords).where(eq(attendanceRecords.sessionId, sessions[0]!.id))).toHaveLength(6);
    expect(await notifsOf('attendance.absent')).toHaveLength(2);
  });

  it('a changed re-submission updates marks and only notifies students who are newly absent', async () => {
    const a = studentsA;
    const r = await submit('ctA', secA.id, {
      date: D0,
      records: [{ studentId: a[0]!.id, status: 'absent', remarks: 'Fever' }, { studentId: a[1]!.id, status: 'present' }, { studentId: a[2]!.id, status: 'late', remarks: 'Bus delay' }, { studentId: a[3]!.id, status: 'absent' }, { studentId: a[4]!.id, status: 'present', remarks: '=HYPERLINK("http://evil")' }, { studentId: a[5]!.id, status: 'present' }],
    });
    expect(r.body).toMatchObject({ changed: 2, notifiedGuardians: 1, counts: { present: 3, absent: 2, late: 1 } });
    const absent = await notifsOf('attendance.absent');
    expect(absent).toHaveLength(3);
    expect(absent.filter((n) => n.userId === guardianOf(a[3]!.id).userId)).toHaveLength(1);
    expect(absent.filter((n) => n.userId === guardianOf(a[0]!.id).userId)).toHaveLength(1);
  });

  it('writes audit rows with before/after', async () => {
    const first = await auditOf('attendance.submit');
    expect(first.length).toBeGreaterThanOrEqual(1);
    expect(first[0]).toMatchObject({ entity: 'attendance_session', actorUserId: userIdOf['ctA'] });
    expect((first[0]!.after as any).counts).toMatchObject({ present: 3, absent: 2, late: 1, total: 6 });
    const re = await auditOf('attendance.resubmit');
    expect(re).toHaveLength(2);
    expect((re[1]!.before as any).counts).toMatchObject({ absent: 2 });
    expect((re[1]!.after as any)).toMatchObject({ changedCount: 2 });
    expect((re[1]!.after as any).changed).toEqual(expect.arrayContaining([expect.objectContaining({ from: 'absent', to: 'present' }), expect.objectContaining({ from: 'present', to: 'absent' })]));
  });

  it('shows the saved marks with record ids and edit-window info on the roster', async () => {
    const r = await roster('ctA', secA.id, `?date=${D0}`);
    expect(r.body.session).toMatchObject({ status: 'submitted' });
    expect(r.body.session.editableUntil).toBeTruthy();
    expect(r.body.counts).toMatchObject({ present: 3, absent: 2, late: 1, unmarked: 0 });
    expect(r.body.students.every((x: any) => x.recordId && x.source === 'marked')).toBe(true);
    expect(r.body.students[0]).toMatchObject({ status: 'absent', remarks: 'Fever' });
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
describe('roll call: validation and date rules', () => {
  const a = () => studentsA;
  const full = (date: string, status = 'present') => ({ date, records: a().map((x) => ({ studentId: x.id, status })) });

  it('refuses future dates, non-working days, dates outside the academic year and holidays', async () => {
    expect(await submit('ctA', secA.id, full(addDaysIso(today, 1))).then((r) => [r.status, r.body.code])).toEqual([422, 'FUTURE_DATE']);
    expect(await submit('ctA', secA.id, full(lastSunday())).then((r) => [r.status, r.body.code])).toEqual([422, 'NOT_A_WORKING_DAY']);
    const sun = await roster('ctA', secA.id, `?date=${lastSunday()}`);
    expect(sun.body).toMatchObject({ isWorkingDay: false, canSubmit: false, blockedReason: 'NOT_A_WORKING_DAY' });
    expect(sun.body.warnings).toContain('NOT_A_WORKING_DAY');
    expect(await submit('office', secA.id, full('2019-03-04')).then((r) => [r.status, r.body.code])).toEqual([422, 'OUTSIDE_ACADEMIC_YEAR']);

    const [ev] = await s.db.insert(events).values({ title: 'Founders Day', kind: 'holiday', startDate: D2, endDate: D2, status: 'published' }).returning({ id: events.id });
    expect(await submit('office', secA.id, full(D2)).then((r) => [r.status, r.body.code])).toEqual([422, 'HOLIDAY']);
    const hol = await roster('ctA', secA.id, `?date=${D2}`);
    expect(hol.body).toMatchObject({ holiday: 'Founders Day', canSubmit: false, blockedReason: 'HOLIDAY' });
    await s.db.delete(events).where(eq(events.id, ev!.id));
  });

  it('validates the roll call body', async () => {
    const x = a();
    const missing = await submit('ctA', secA.id, { date: D0, records: [{ studentId: x[0]!.id, status: 'present' }] });
    expect([missing.status, missing.body.code]).toEqual([422, 'INCOMPLETE_ROLL_CALL']);
    expect(missing.body.missing).toHaveLength(5);
    const foreign = await submit('ctA', secA.id, { date: D0, defaultStatus: 'present', records: [{ studentId: studentsB[0]!.id, status: 'absent' }] });
    expect([foreign.status, foreign.body.code]).toEqual([422, 'STUDENT_NOT_IN_SECTION']);
    const dup = await submit('ctA', secA.id, { date: D0, defaultStatus: 'present', records: [{ studentId: x[0]!.id, status: 'absent' }, { studentId: x[0]!.id, status: 'late' }] });
    expect([dup.status, dup.body.code]).toEqual([422, 'DUPLICATE_STUDENT']);
    expect((await submit('ctA', secA.id, { date: D0, defaultStatus: 'present', periodId: secA.id, records: [] })).body.code).toBe('PERIOD_NOT_ALLOWED');
    expect((await submit('ctA', secA.id, { date: D0, records: [{ studentId: x[0]!.id, status: 'sleeping' }] })).status).toBe(422);
    expect((await submit('ctA', secA.id, { date: 'yesterday', records: [] })).status).toBe(422);
    expect((await submit('ctA', secA.id, { date: D0 })).status).toBe(422);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
describe('edit window and corrections', () => {
  let recA0: string;
  let recA3: string;
  let recA5: string;

  it('re-submission after the edit window is refused; the roster says to request a correction', async () => {
    await s.db.update(attendanceSessions).set({ submittedAt: new Date(Date.now() - 25 * 3_600_000) }).where(and(eq(attendanceSessions.sectionId, secA.id), eq(attendanceSessions.date, D0)));
    const body = { date: D0, defaultStatus: 'present', records: [{ studentId: studentsA[0]!.id, status: 'present' }] };
    const r = await submit('ctA', secA.id, body);
    expect([r.status, r.body.code]).toEqual([403, 'EDIT_WINDOW_CLOSED']);
    expect(r.body.editableUntil).toBeTruthy();
    const ro = await roster('ctA', secA.id, `?date=${D0}`);
    expect(ro.body).toMatchObject({ canSubmit: false, blockedReason: 'EDIT_WINDOW_CLOSED', canRequestCorrection: true });
    [recA0, , , recA3, , recA5] = ro.body.students.map((x: any) => x.recordId);
    // nothing changed
    expect((await s.db.select().from(attendanceRecords).where(eq(attendanceRecords.id, recA0!)))[0]!.status).toBe('absent');
  });

  it('a missed roll call can be taken until the end of that date + the window; older dates need the office', async () => {
    const body = { defaultStatus: 'present', records: [] };
    const old = await submit('ctA', secA.id, { ...body, date: D2 });
    expect([old.status, old.body.code]).toEqual([403, 'EDIT_WINDOW_CLOSED']);
    const override = await submit('office', secA.id, { ...body, date: D2 });
    expect(override.status, JSON.stringify(override.body)).toBe(200);
    expect(override.body.firstSubmission).toBe(true);
    const [row] = await s.db.select().from(auditLogs).where(and(eq(auditLogs.action, 'attendance.submit'), eq(auditLogs.actorUserId, userIdOf['office']!)));
    expect(row).toBeTruthy();
  });

  it('the office (attendance:edit at school scope) can override inside the closed window, audited; a longer window re-opens it for teachers', async () => {
    const x = studentsA;
    const rec = { date: D0, records: [{ studentId: x[0]!.id, status: 'absent', remarks: 'Fever' }, { studentId: x[1]!.id, status: 'present' }, { studentId: x[2]!.id, status: 'present' }, { studentId: x[3]!.id, status: 'absent' }, { studentId: x[4]!.id, status: 'present', remarks: '=HYPERLINK("http://evil")' }, { studentId: x[5]!.id, status: 'present' }] };
    const o = await submit('office', secA.id, rec);
    expect(o.status, JSON.stringify(o.body)).toBe(200);
    expect(o.body).toMatchObject({ firstSubmission: false, changed: 1 }); // a2 late → present
    const log = (await auditOf('attendance.resubmit')).pop()!;
    expect(log.actorUserId).toBe(userIdOf['office']);

    await putSetting(s.db, 'attendance', { editWindowHours: 72 });
    expect((await submit('ctA', secA.id, rec)).status).toBe(200);
    await putSetting(s.db, 'attendance', { editWindowHours: 24 });
    expect((await submit('ctA', secA.id, rec)).body.code).toBe('EDIT_WINDOW_CLOSED');
  });

  it('who may request a correction', async () => {
    const body = { toStatus: 'present', reason: 'Was present' };
    expect((await s.req('POST', `/attendance/records/${recA0}/corrections`, T('sub'), body)).body.code).toBe('NOT_CLASS_TEACHER');
    expect((await s.req('POST', `/attendance/records/${recA0}/corrections`, T('none'), body)).status).toBe(404);
    expect((await s.req('POST', `/attendance/records/${recA0}/corrections`, T('ctB'), body)).status).toBe(404);
    expect((await s.req('POST', `/attendance/records/${recA0}/corrections`, T('principal'), body)).status).toBe(403);
    expect((await s.req('POST', `/attendance/records/${recA0}/corrections`, T('parent'), body)).status).toBe(403);
    expect((await s.req('POST', `/attendance/records/${recA0}/corrections`, T('student'), body)).status).toBe(403);
    expect((await s.req('POST', `/attendance/records/${secA.id}/corrections`, T('ctA'), body)).status).toBe(404);
    expect((await s.req('POST', `/attendance/records/${recA0}/corrections`, T('ctA'), { toStatus: 'present', reason: 'x' })).status).toBe(422);
  });

  it('the class teacher requests a correction (one pending per record, no-op refused)', async () => {
    const r = await s.req('POST', `/attendance/records/${recA0}/corrections`, T('ctA'), { toStatus: 'present', reason: 'Parent confirmed the child was present' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ status: 'pending', fromStatus: 'absent', toStatus: 'present', date: D0, recordId: recA0, studentId: studentsA[0]!.id, canDecide: false });
    expect((await s.req('POST', `/attendance/records/${recA0}/corrections`, T('ctA'), { toStatus: 'late', reason: 'again' })).body.code).toBe('CORRECTION_PENDING');
    expect((await s.req('POST', `/attendance/records/${recA5}/corrections`, T('ctA'), { toStatus: 'present', reason: 'same status' })).body.code).toBe('NO_CHANGE');
    // the class teacher asked, so school-level approvers (principal) are told; the class teacher themself is not
    const told = await notifsOf('attendance.correction');
    expect(told.some((n) => n.userId === userIdOf['principal'])).toBe(true);
    expect(told.some((n) => n.userId === userIdOf['ctA'])).toBe(false);
    expect(told.every((n) => n.title === 'Attendance correction requested')).toBe(true);
    expect((await auditOf('attendance.correction.request')).length).toBe(1);
  });

  it('listing: approvers see what they can decide, teachers only their own, parents/students nothing', async () => {
    const p = await s.req('GET', '/attendance/corrections', T('principal'));
    expect(p.body.meta.total).toBe(1);
    expect(p.body.data[0]).toMatchObject({ canDecide: true, studentName: studentsA[0]!.name, requestedByName: expect.any(String) });
    const ct = await s.req('GET', '/attendance/corrections', T('ctA'));
    expect(ct.body.meta.total).toBe(1);
    expect(ct.body.data[0].canDecide).toBe(false); // their own request
    expect((await s.req('GET', '/attendance/corrections', T('ctB'))).body.meta.total).toBe(0);
    expect((await s.req('GET', '/attendance/corrections', T('sub'))).body.meta.total).toBe(0);
    expect((await s.req('GET', '/attendance/corrections?status=approved', T('principal'))).body.meta.total).toBe(0);
    expect((await s.req('GET', '/attendance/corrections', T('student'))).status).toBe(403);
  });

  it('decision rules: no self-approval, only the section’s class teacher or school scope', async () => {
    const id = (await s.req('GET', '/attendance/corrections', T('principal'))).body.data[0].id;
    expect((await s.req('POST', `/attendance/corrections/${id}/approve`, T('ctA'), {})).body.code).toBe('SELF_APPROVAL');
    expect((await s.req('POST', `/attendance/corrections/${id}/approve`, T('ctB'), {})).status).toBe(404);
    expect((await s.req('POST', `/attendance/corrections/${id}/approve`, T('sub'), {})).status).toBe(403);
    expect((await s.req('POST', `/attendance/corrections/${id}/reject`, T('principal'), {})).body.code).toBe('NOTE_REQUIRED');
  });

  it('approval applies the change, audits before/after and notifies student + verified guardians + the requester', async () => {
    const id = (await s.req('GET', '/attendance/corrections', T('principal'))).body.data[0].id;
    const r = await s.req('POST', `/attendance/corrections/${id}/approve`, T('principal'), { note: 'Confirmed with parent' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ status: 'approved', decidedBy: userIdOf['principal'], decisionNote: 'Confirmed with parent' });
    expect((await s.db.select().from(attendanceRecords).where(eq(attendanceRecords.id, recA0)))[0]!.status).toBe('present');
    const log = (await auditOf('attendance.correction.approve'))[0]!;
    expect(log).toMatchObject({ entity: 'attendance_correction', entityId: id, actorUserId: userIdOf['principal'] });
    expect(log.before).toMatchObject({ status: 'pending', recordStatus: 'absent' });
    expect(log.after).toMatchObject({ status: 'approved', recordStatus: 'present', studentId: studentsA[0]!.id, date: D0 });

    const corrected = await notifsOf('attendance.corrected');
    const expected = [studentsA[0]!.userId, guardianOf(studentsA[0]!.id).userId].sort();
    expect(corrected.map((n) => n.userId).sort()).toEqual(expected);
    expect(corrected.some((n) => n.userId === userIdOf['unverified'])).toBe(false);
    expect(corrected.every((n) => n.title === 'Attendance update')).toBe(true);
    const decided = (await notifsOf('attendance.correction')).filter((n) => n.userId === userIdOf['ctA']);
    expect(decided).toHaveLength(1);
    expect(decided[0]!.title).toBe('Attendance correction approved');
    // deciding twice
    expect((await s.req('POST', `/attendance/corrections/${id}/approve`, T('principal'), {})).body.code).toBe('ALREADY_DECIDED');
  });

  it('rejection needs a note, leaves the record alone and only tells the requester', async () => {
    const req = await s.req('POST', `/attendance/records/${recA3}/corrections`, T('ctA'), { toStatus: 'present', reason: 'He was there' });
    expect(req.status).toBe(201);
    const before = (await notifsOf('attendance.corrected')).length;
    const r = await s.req('POST', `/attendance/corrections/${req.body.id}/reject`, T('principal'), { note: 'Register shows absent' });
    expect(r.body).toMatchObject({ status: 'rejected', decisionNote: 'Register shows absent' });
    expect((await s.db.select().from(attendanceRecords).where(eq(attendanceRecords.id, recA3)))[0]!.status).toBe('absent');
    expect((await notifsOf('attendance.corrected')).length).toBe(before);
    expect((await auditOf('attendance.correction.reject')).length).toBe(1);
    // a new request is allowed once the previous one is decided; leave it pending for the later tests
    expect((await s.req('POST', `/attendance/records/${recA3}/corrections`, T('ctA'), { toStatus: 'late', reason: 'Actually arrived late' })).status).toBe(201);
  });

  it('the class teacher can approve a request raised by another teacher of the section', async () => {
    const [c] = await s.db
      .insert(attendanceCorrections)
      .values({ recordId: recA5, studentId: studentsA[5]!.id, sectionId: secA.id, date: D0, fromStatus: 'present', toStatus: 'absent', reason: 'Left at recess, no return', requestedBy: userIdOf['sub']! })
      .returning({ id: attendanceCorrections.id });
    const r = await s.req('POST', `/attendance/corrections/${c!.id}/approve`, T('ctA'), {});
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await s.db.select().from(attendanceRecords).where(eq(attendanceRecords.id, recA5)))[0]!.status).toBe('absent');
    // the requesting teacher can follow it
    const mine = await s.req('GET', '/attendance/corrections?status=approved&mine=true', T('sub'));
    expect(mine.body.meta.total).toBe(1);
  });

  it('flags records with a pending correction in the student’s history', async () => {
    const r = await s.req('GET', `/attendance/students/${studentsA[3]!.id}/records`, T('ctA'));
    expect(r.body.data[0]).toMatchObject({ id: recA3, status: 'absent', correctionPending: true });
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
describe('section B: scope isolation and leave pre-marking', () => {
  it('teachers cannot see or mark another teacher’s section', async () => {
    expect((await roster('ctA', secB.id, `?date=${D0}`)).status).toBe(404);
    expect((await roster('ctB', secA.id, `?date=${D0}`)).status).toBe(404);
    expect((await submit('ctA', secB.id, { date: D0, defaultStatus: 'present', records: [] })).status).toBe(404);
    expect((await submit('ctB', secA.id, { date: D0, defaultStatus: 'present', records: [] })).status).toBe(404);
    expect((await submit('sub', secB.id, { date: D0, defaultStatus: 'present', records: [] })).body.code).toBe('NOT_CLASS_TEACHER');
    expect((await s.req('GET', `/attendance/sections/${secB.id}/summary`, T('ctA'))).status).toBe(404);
    expect((await s.req('GET', `/attendance/students/${studentsB[0]!.id}/records`, T('ctA'))).status).toBe(404);
    expect((await s.req('GET', `/attendance/students/${studentsA[0]!.id}/summary`, T('ctB'))).status).toBe(404);
  });

  it('students on approved leave are pre-marked `leave` and stay `leave` when the teacher defaults the rest', async () => {
    const b = studentsB;
    await s.db.insert(leaveRequests).values({ studentId: b[5]!.id, sectionId: secB.id, requestedBy: guardianOf(b[5]!.id).userId, leaveType: 'sick', fromDate: D0, toDate: D0, reason: 'Fever', status: 'approved', decidedBy: userIdOf['ctB']!, decidedAt: new Date() });
    const ro = await roster('ctB', secB.id, `?date=${D0}`);
    expect(ro.body.students[5]).toMatchObject({ status: 'leave', source: 'leave', onApprovedLeave: true, recordId: null });
    expect(ro.body.students.slice(0, 5).every((x: any) => x.status === null)).toBe(true);
    expect(ro.body.warnings).toContain('PRE_MARKED_FROM_LEAVE');
    expect(ro.body.counts).toMatchObject({ leave: 1, unmarked: 5 });

    const r = await submit('ctB', secB.id, { date: D0, defaultStatus: 'present', records: [{ studentId: b[0]!.id, status: 'absent', remarks: 'No intimation' }] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.counts).toMatchObject({ present: 4, absent: 1, leave: 1, total: 6 });
    const [rec] = await s.db.select().from(attendanceRecords).where(and(eq(attendanceRecords.studentId, b[5]!.id), eq(attendanceRecords.date, D0)));
    expect(rec!.status).toBe('leave');
    // only b[0]'s guardian hears about it
    const got = (await notifsOf('attendance.absent')).filter((n) => (n.data as any).studentId === b[0]!.id);
    expect(got.map((n) => n.userId)).toEqual([guardianOf(b[0]!.id).userId]);
  });

  it('turning off notifyParentsOnAbsent sends nothing', async () => {
    await putSetting(s.db, 'attendance', { notifyParentsOnAbsent: false });
    const before = (await notifsOf('attendance.absent')).length;
    const b = studentsB;
    const r = await submit('ctB', secB.id, { date: D0, defaultStatus: 'present', records: [{ studentId: b[0]!.id, status: 'absent' }, { studentId: b[1]!.id, status: 'absent' }] });
    expect(r.body).toMatchObject({ changed: 1, notifiedGuardians: 0 });
    expect((await notifsOf('attendance.absent')).length).toBe(before);
    await putSetting(s.db, 'attendance', { notifyParentsOnAbsent: true });
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
describe('period mode', () => {
  let p1: string;
  let p2: string;
  let brk: string;
  let slotId: string;

  it('requires a period, validates it and honours the slot teacher and substitutions', async () => {
    await putSetting(s.db, 'attendance', { mode: 'period' });
    try {
      const ps = await s.db.select().from(periods).orderBy(asc(periods.ordinal));
      p1 = ps.find((p) => !p.isBreak && p.ordinal === 1)!.id;
      p2 = ps.filter((p) => !p.isBreak)[1]!.id;
      brk = ps.find((p) => p.isBreak)!.id;
      const sub = s.ctx.teachers.find((t) => t.username === s.ctx.teachers.find((x) => userIdOf['sub'] === x.userId)!.username)!;
      const sub2 = s.ctx.teachers.find((t) => t.userId === userIdOf['sub2'])!;
      const [slot] = await s.db.insert(timetableSlots).values({ sectionId: secA.id, dayOfWeek: isoWeekday(D0), periodId: p1, subjectId: s.ctx.subjects[0]!.id, staffId: sub.id }).returning({ id: timetableSlots.id });
      slotId = slot!.id;

      // GET without a period: students, but nothing to submit yet
      const noPeriod = await roster('ctA', secA.id, `?date=${D0}`);
      expect(noPeriod.body).toMatchObject({ mode: 'period', canSubmit: false, blockedReason: 'PERIOD_REQUIRED', periodId: null });
      expect((await submit('ctA', secA.id, { date: D0, defaultStatus: 'present', records: [] })).body.code).toBe('PERIOD_REQUIRED');
      expect((await submit('ctA', secA.id, { date: D0, periodId: brk, defaultStatus: 'present', records: [] })).body.code).toBe('PERIOD_IS_BREAK');
      expect((await submit('ctA', secA.id, { date: D0, periodId: secA.id, defaultStatus: 'present', records: [] })).body.code).toBe('PERIOD_NOT_FOUND');

      // the slot's teacher may take the period; another assigned teacher may not
      const ro = await roster('sub', secA.id, `?date=${D0}&periodId=${p1}`);
      expect(ro.body).toMatchObject({ canSubmit: true, periodId: p1, subjectId: s.ctx.subjects[0]!.id, subjectName: s.ctx.subjects[0]!.name });
      expect(await roster('sub2', secA.id, `?date=${D0}&periodId=${p1}`).then((r) => [r.body.canSubmit, r.body.blockedReason])).toEqual([false, 'NOT_YOUR_PERIOD']);
      const ok = await submit('sub', secA.id, { date: D0, periodId: p1, defaultStatus: 'present', records: [{ studentId: studentsA[2]!.id, status: 'absent' }] });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(ok.body).toMatchObject({ periodId: p1, counts: { present: 5, absent: 1 }, notifiedGuardians: 1 });
      expect((await submit('sub2', secA.id, { date: D0, periodId: p1, defaultStatus: 'present', records: [] })).body.code).toBe('NOT_YOUR_PERIOD');
      // the class teacher may take any period of their section; a second session exists next to the first
      expect((await submit('ctA', secA.id, { date: D0, periodId: p2, defaultStatus: 'present', records: [] })).status).toBe(200);
      const sessions = await s.db.select().from(attendanceSessions).where(and(eq(attendanceSessions.sectionId, secA.id), eq(attendanceSessions.date, D0)));
      expect(sessions.filter((x) => x.periodId !== null)).toHaveLength(2);
      expect(sessions.find((x) => x.periodId === p1)!.subjectId).toBe(s.ctx.subjects[0]!.id);
      // the body of the notification names the period
      expect((await notifsOf('attendance.absent')).some((n) => /Period 1/.test(n.body ?? ''))).toBe(true);

      // dashboards: the slot appears in the slot teacher's list, marked
      const today1 = await s.req('GET', '/attendance/today', T('sub'));
      if (D0 === today) expect(today1.body.items.find((i: any) => i.periodId === p1)).toMatchObject({ marked: true, sectionId: secA.id, counts: { absent: 1 } });
      else expect(today1.body.items).toEqual([]);

      // a substitution moves the right to the substitute
      await s.db.insert(timetableSubstitutions).values({ slotId, date: D0, substituteStaffId: sub2.id });
      expect(await roster('sub', secA.id, `?date=${D0}&periodId=${p1}`).then((r) => r.body.canSubmit)).toBe(false);
      expect(await roster('sub2', secA.id, `?date=${D0}&periodId=${p1}`).then((r) => r.body.canSubmit)).toBe(true);
      expect((await submit('sub2', secA.id, { date: D0, periodId: p1, defaultStatus: 'present', records: [{ studentId: studentsA[2]!.id, status: 'absent' }] })).status).toBe(200);
      if (D0 === today) {
        expect((await s.req('GET', '/attendance/today', T('sub2'))).body.items.map((i: any) => i.periodId)).toContain(p1);
        expect((await s.req('GET', '/attendance/today', T('sub'))).body.items.map((i: any) => i.periodId)).not.toContain(p1);
      }
    } finally {
      await putSetting(s.db, 'attendance', { mode: 'daily' });
      // keep the later whole-school numbers about the daily roll calls only
      await s.db.delete(attendanceSessions).where(sql`${attendanceSessions.periodId} is not null`);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
describe('views: summaries, history, school-wide, today, export', () => {
  const hist: { date: string; status: 'present' | 'absent' | 'late' | 'half_day' | 'leave' }[] = [];
  let stuB: Student;

  beforeAll(async () => {
    stuB = studentsB[1]!;
    tokens.set('parentStuB', await s.login(guardianOf(stuB.id).username));
    const plan = ['present', 'present', 'absent', 'present', 'late', 'absent', 'present', 'half_day', 'present', 'absent', 'present', 'absent', 'leave', 'leave'] as const;
    for (let i = 0; i < plan.length; i++) hist.push({ date: schoolDayBack(3 + i), status: plan[i]! });
    for (const h of hist) {
      const [sess] = await s.db.insert(attendanceSessions).values({ sectionId: secB.id, date: h.date, status: 'submitted', submittedAt: new Date(), takenBy: secB.classTeacherId }).returning({ id: attendanceSessions.id });
      await s.db.insert(attendanceRecords).values({ sessionId: sess!.id, studentId: stuB.id, sectionId: secB.id, date: h.date, status: h.status });
    }
  });

  const expectedTotals = () => {
    // plus the D0 mark from the roll call test: present, but b[1] was set absent by the "notify off" test
    const rows = [...hist.map((h) => h.status), 'absent'] as string[];
    const c = (k: string) => rows.filter((x) => x === k).length;
    return { present: c('present'), absent: c('absent'), late: c('late'), leave: c('leave'), half_day: c('half_day'), total: rows.length, percentage: pct(c('present'), c('absent'), c('late'), c('half_day')) };
  };

  it('a student summary has counts, percentage, months and the shortage flag', async () => {
    const r = await s.req('GET', `/attendance/students/${stuB.id}/summary`, T('parentStuB'));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.totals).toEqual(expectedTotals());
    expect(r.body.shortage).toEqual({ thresholdPercent: 75, isShort: true });
    expect(r.body.studentName).toBe(stuB.name);
    const sum = (k: string) => r.body.months.reduce((a: number, m: any) => a + m[k], 0);
    expect([sum('present'), sum('absent'), sum('late'), sum('leave'), sum('half_day'), sum('total')]).toEqual([r.body.totals.present, r.body.totals.absent, r.body.totals.late, r.body.totals.leave, r.body.totals.half_day, r.body.totals.total]);
    expect(r.body.months.map((m: any) => m.month)).toEqual([...r.body.months.map((m: any) => m.month)].sort());
    // a range with no records yields a null percentage, and a bad range is refused
    const empty = await s.req('GET', `/attendance/students/${stuB.id}/summary?from=2026-04-01&to=2026-04-02`, T('principal'));
    expect(empty.body.totals).toMatchObject({ total: 0, percentage: null });
    expect(empty.body.shortage.isShort).toBe(false);
    expect((await s.req('GET', `/attendance/students/${stuB.id}/summary?from=${today}&to=2026-04-02`, T('principal'))).body.code).toBe('INVALID_RANGE');
    expect((await s.req('GET', `/attendance/students/${stuB.id}/summary?from=2020-01-01&to=${today}`, T('principal'))).body.code).toBe('RANGE_TOO_LARGE');
  });

  it('student/parent/teacher/principal visibility of a student’s attendance', async () => {
    const own = await s.req('GET', `/attendance/students/${stuB.id}/summary`, T('studentB'));
    // student B[0] is a different student than stuB (= studentsB[1]) → 404; the right student sees themself
    expect(own.status).toBe(404);
    const owner = tokens.get('stuB_login') ?? (await s.login(stuB.username));
    tokens.set('stuB_login', owner);
    expect((await s.req('GET', `/attendance/students/${stuB.id}/summary`, owner)).status).toBe(200);
    expect((await s.req('GET', `/attendance/students/${stuB.id}/summary`, T('parent'))).status).toBe(404); // another family
    expect((await s.req('GET', `/attendance/students/${studentsA[1]!.id}/summary`, T('parent'))).status).toBe(200); // own child
    expect((await s.req('GET', `/attendance/students/${studentsA[0]!.id}/summary`, T('student2'))).status).toBe(404); // a classmate
    expect((await s.req('GET', `/attendance/students/${studentsA[0]!.id}/summary`, T('unverified'))).status).toBe(404); // unverified link grants nothing
    expect((await s.req('GET', `/attendance/students/${studentsA[0]!.id}/records`, T('unverified'))).status).toBe(404);
    expect((await s.req('GET', `/attendance/students/${stuB.id}/summary`, T('ctB'))).status).toBe(200);
    expect((await s.req('GET', `/attendance/students/${stuB.id}/summary`, T('principal'))).status).toBe(200);
    expect((await s.req('GET', `/attendance/students/${stuB.id}/summary`, T('hr'))).status).toBe(403);
    expect((await s.req('GET', `/attendance/students/not-a-uuid/summary`, T('principal'))).status).toBe(422);
  });

  it('history is newest first with keyset pagination and filters', async () => {
    const all: any[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page++) {
      const r: any = await s.req('GET', `/attendance/students/${stuB.id}/records?limit=4${cursor ? `&cursor=${cursor}` : ''}`, T('parentStuB'));
      expect(r.status).toBe(200);
      all.push(...r.body.data);
      cursor = r.body.nextCursor;
      if (!cursor) break;
    }
    expect(all).toHaveLength(hist.length + 1);
    expect(new Set(all.map((x) => x.id)).size).toBe(all.length);
    expect(all.map((x) => x.date)).toEqual([...all.map((x) => x.date)].sort().reverse());
    const absent = await s.req('GET', `/attendance/students/${stuB.id}/records?status=absent`, T('parentStuB'));
    expect(absent.body.data.every((x: any) => x.status === 'absent')).toBe(true);
    expect(absent.body.nextCursor).toBeNull();
    const ranged = await s.req('GET', `/attendance/students/${stuB.id}/records?from=${hist[3]!.date}&to=${hist[1]!.date}`, T('parentStuB'));
    expect(ranged.body.data.map((x: any) => x.date)).toEqual([hist[1]!.date, hist[2]!.date, hist[3]!.date]);
    expect((await s.req('GET', `/attendance/students/${stuB.id}/records?cursor=garbage`, T('parentStuB'))).status).toBe(400);
  });

  it('a section summary lists per-day counts and per-student percentages', async () => {
    const r = await s.req('GET', `/attendance/sections/${secB.id}/summary?from=${hist[hist.length - 1]!.date}&to=${D0}`, T('ctB'));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ sectionId: secB.id, strength: 6 });
    expect(r.body.days.length).toBe(hist.length + 1);
    const row = r.body.students.find((x: any) => x.studentId === stuB.id);
    expect(row).toMatchObject({ isShort: true, name: stuB.name });
    expect(r.body.students).toHaveLength(6);
    expect((await s.req('GET', `/attendance/sections/${secB.id}/summary`, T('principal'))).status).toBe(200);
    expect((await s.req('GET', `/attendance/sections/${secB.id}/summary`, T('parentB'))).status).toBe(403);
  });

  it('the school-wide summary matches the stored records', async () => {
    const r = await s.req('GET', `/attendance/summary?date=${D0}&absenteeLimit=50`, T('principal'));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const recs = await s.db.select().from(attendanceRecords).where(and(eq(attendanceRecords.date, D0), inArray(attendanceRecords.sessionId, (await s.db.select({ id: attendanceSessions.id }).from(attendanceSessions).where(and(eq(attendanceSessions.date, D0), sql`${attendanceSessions.periodId} is null`))).map((x) => x.id))));
    const c = (k: string) => recs.filter((x) => x.status === k).length;
    expect(r.body.totals).toMatchObject({ present: c('present'), absent: c('absent'), late: c('late'), leave: c('leave'), half_day: c('half_day'), activeStudents: 12, markedStudents: 12, unmarkedStudents: 0 });
    expect(r.body.totals.percentPresent).toBe(pct(c('present'), c('absent'), c('late'), c('half_day')));
    expect(r.body).toMatchObject({ date: D0, mode: 'daily', sectionsTotal: 2, sectionsMarked: 2, isWorkingDay: true });
    expect(r.body.sections.map((x: any) => [x.sectionId, x.marked, x.strength])).toEqual([[secA.id, true, 6], [secB.id, true, 6]]);
    expect(r.body.sections[0]).toMatchObject({ name: secA.name, gradeName: secA.gradeName, classTeacherName: expect.any(String) });
    expect(r.body.absenteesTotal).toBe(c('absent'));
    expect(r.body.absentees).toHaveLength(c('absent'));
    expect(r.body.absentees.map((x: any) => x.studentId)).toEqual(expect.arrayContaining([studentsA[3]!.id, studentsB[0]!.id]));
    expect(r.body.trend.at(-1)).toMatchObject({ date: D0 });
    // limits: only `absenteeLimit` rows come back but the total stays
    const lim = await s.req('GET', `/attendance/summary?date=${D0}&absenteeLimit=1`, T('office'));
    expect(lim.body.absentees).toHaveLength(1);
    expect(lim.body.absenteesTotal).toBe(c('absent'));
    // a date nobody marked
    const quiet = await s.req('GET', `/attendance/summary?date=${addDaysIso(D0, -60)}`, T('principal'));
    expect(quiet.body).toMatchObject({ sectionsMarked: 0, absenteesTotal: 0 });
    expect(quiet.body.totals).toMatchObject({ markedStudents: 0, unmarkedStudents: 12, percentPresent: null });
    expect((await s.req('GET', `/attendance/summary?date=nope`, T('principal'))).status).toBe(422);
  });

  it('the today helper is shaped per role', async () => {
    const t = await s.req('GET', '/attendance/today', T('ctA'));
    expect(t.status).toBe(200);
    expect(t.body).toMatchObject({ date: today, mode: 'daily', role: 'teacher' });
    if (D0 === today) {
      expect(t.body.items).toHaveLength(1);
      expect(t.body.items[0]).toMatchObject({ sectionId: secA.id, marked: true, sessionStatus: 'submitted', strength: 6 });
      expect(t.body.pendingCount).toBe(0);
      const m = await s.req('GET', '/attendance/today', T('principal'));
      expect(m.body).toMatchObject({ role: 'management', items: [] });
      expect(m.body.school).toMatchObject({ sectionsTotal: 2, sectionsMarked: 2, activeStudents: 12 });
      const stu = await s.req('GET', '/attendance/today', T('student2'));
      expect(stu.body.role).toBe('student');
      expect(stu.body.children).toHaveLength(1);
      expect(stu.body.children[0]).toMatchObject({ studentId: studentsA[1]!.id, status: 'present' });
      const par = await s.req('GET', '/attendance/today', T('parent'));
      expect(par.body.role).toBe('parent');
      expect(par.body.children.map((c: any) => c.studentId)).toEqual([studentsA[1]!.id]);
      // a teacher whose section has not been marked sees it as pending
      await s.db.delete(attendanceRecords).where(and(eq(attendanceRecords.sectionId, secB.id), eq(attendanceRecords.date, D0), sql`${attendanceRecords.studentId} <> ${stuB.id}`));
      await s.db.update(attendanceSessions).set({ status: 'draft' }).where(and(eq(attendanceSessions.sectionId, secB.id), eq(attendanceSessions.date, D0)));
      const b = await s.req('GET', '/attendance/today', T('ctB'));
      expect(b.body.items[0]).toMatchObject({ sectionId: secB.id, marked: false, sessionStatus: 'draft' });
      expect(b.body.pendingCount).toBe(1);
      // put it back
      await s.db.update(attendanceSessions).set({ status: 'submitted' }).where(and(eq(attendanceSessions.sectionId, secB.id), eq(attendanceSessions.date, D0)));
    }
    // nobody sees anything for an unverified link
    const u = await s.req('GET', '/attendance/today', T('unverified'));
    expect(u.body.children).toEqual([]);
  });

  it('exports CSV (guarded against formula injection) within the allowed range only', async () => {
    const r = await s.req('GET', `/attendance/export?from=${D0}&to=${D0}`, T('principal'));
    expect(r.status).toBe(200);
    expect(String(r.headers['content-type'])).toContain('text/csv');
    expect(String(r.headers['content-disposition'])).toContain('attendance-');
    const text = r.body as string;
    expect(text.startsWith('\uFEFFDate,Class,Section,Period,Roll no,Admission no,Student,Status,Remarks\r\n')).toBe(true);
    const lines = text.trim().split('\r\n');
    expect(lines.length).toBeGreaterThanOrEqual(1 + 12 - 5); // header + A's six + (B rows may have been trimmed by the today-test)
    expect(text).toContain(`"'=HYPERLINK(""http://evil"")"`); // quoted and neutralised
    expect(text).toContain(studentsA[0]!.admissionNo);
    expect((await s.req('GET', `/attendance/export?from=${D0}&to=${addDaysIso(D0, -1)}`, T('principal'))).body.code).toBe('INVALID_RANGE');
    expect((await s.req('GET', `/attendance/export?from=${addDaysIso(D0, -200)}&to=${D0}`, T('principal'))).body.code).toBe('RANGE_TOO_LARGE');
    expect((await s.req('GET', `/attendance/export?from=${D0}`, T('principal'))).status).toBe(422);
    const sec = await s.req('GET', `/attendance/export?from=${D0}&to=${D0}&sectionId=${secA.id}`, T('office'));
    expect((sec.body as string).trim().split('\r\n').length).toBe(7);
    // an empty range is just the header
    expect(((await s.req('GET', `/attendance/export?from=2019-01-01&to=2019-01-02`, T('principal'))).body as string).trim().split('\r\n')).toHaveLength(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
describe('shortage alerts', () => {
  it('alerts the verified guardians once per month and is idempotent (route and job)', async () => {
    const stuB = studentsB[1]!;
    const r = await s.req('POST', '/attendance/shortage-scan', T('principal'));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ month: today.slice(0, 7), thresholdPercent: 75, checked: 1, belowThreshold: 1, alertsSent: 1, notifications: 1 });
    const alerts = await notifsOf('attendance.shortage');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ userId: guardianOf(stuB.id).userId, title: 'Attendance alert' });
    expect(alerts[0]!.data).toMatchObject({ studentId: stuB.id, month: today.slice(0, 7), route: '/attendance' });

    expect((await s.req('POST', '/attendance/shortage-scan', T('office'))).body).toMatchObject({ belowThreshold: 1, alertsSent: 0, notifications: 0 });
    expect(await runJobOnce(s.tenant, jobs.find((j) => j.name === 'attendance.shortageScan')!)).toBe(true);
    expect(await notifsOf('attendance.shortage')).toHaveLength(1);
    expect(await s.db.select().from(attendanceAlerts)).toHaveLength(1);

    // a new month is a new alert
    await s.db.update(attendanceAlerts).set({ month: '2000-01' });
    expect((await s.req('POST', '/attendance/shortage-scan', T('principal'))).body.alertsSent).toBe(1);
    expect(await notifsOf('attendance.shortage')).toHaveLength(2);
  });

  it('only counts students with enough marked days', async () => {
    await putSetting(s.db, 'attendance', { shortagePercent: 100 });
    const r = await s.req('POST', '/attendance/shortage-scan', T('principal'));
    expect(r.body.checked).toBe(1); // everybody else has fewer than 10 counted days
    await putSetting(s.db, 'attendance', { shortagePercent: 75 });
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
describe('student leave', () => {
  const parentL = () => guardianOf(studentsA[4]!.id);
  let parentLToken: string;
  let stuL: Student;
  let stuL2: Student;
  let F1: string;
  let F2: string;
  let F3: string;
  let F4: string;
  let F5: string;
  let leaveId: string;

  beforeAll(async () => {
    stuL = studentsA[4]!;
    stuL2 = studentsA[5]!;
    F1 = nextSchoolDay(today);
    F2 = nextSchoolDay(F1);
    F3 = nextSchoolDay(F2);
    F4 = nextSchoolDay(F3);
    F5 = nextSchoolDay(F4);
    parentLToken = await s.login(parentL().username);
    tokens.set('parentL', parentLToken);
    tokens.set('stuL', await s.login(stuL.username));
    tokens.set('stuL2', await s.login(stuL2.username));
  });

  it('a parent applies for a linked child; the class teacher is notified', async () => {
    const r = await s.req('POST', '/leave', T('parentL'), { studentId: stuL.id, leaveType: 'sick', fromDate: D1, toDate: D0, reason: 'Fever and cold' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ status: 'pending', studentId: stuL.id, sectionId: secA.id, leaveType: 'sick', requestedBy: parentL().userId, canCancel: true, canDecide: false, decidedBy: null });
    expect(r.body.days).toBeGreaterThanOrEqual(1);
    leaveId = r.body.id;
    const told = await notifsOf('leave.requested');
    expect(told.map((n) => n.userId)).toEqual([userIdOf['ctA']]);
    expect((told[0]!.data as any).route).toBe(`/leave/${leaveId}`);
    expect((await auditOf('leave.request')).length).toBe(1);
  });

  it('validates the request', async () => {
    const base = { studentId: stuL.id, leaveType: 'casual', reason: 'Family function' };
    const post = (b: object) => s.req('POST', '/leave', T('parentL'), { ...base, ...b });
    expect(await post({ fromDate: D1, toDate: D0 }).then((r) => [r.status, r.body.code])).toEqual([409, 'LEAVE_OVERLAP']);
    expect((await post({ fromDate: F1, toDate: addDaysIso(F1, -1) })).status).toBe(422);
    expect((await post({ fromDate: F1, toDate: addDaysIso(F1, 70) })).body.code).toBe('LEAVE_TOO_LONG');
    expect((await post({ fromDate: addDaysIso(today, -45), toDate: addDaysIso(today, -44) })).body.code).toBe('LEAVE_TOO_OLD');
    const sunday = addDaysIso(lastSunday(), 7);
    expect((await post({ fromDate: sunday, toDate: sunday })).body.code).toBe('NO_WORKING_DAYS');
    expect((await post({ fromDate: F1, toDate: F1, attachmentFileId: secA.id })).body.code).toBe('ATTACHMENT_NOT_FOUND');
    expect((await post({ fromDate: F1, toDate: F1, reason: 'x' })).status).toBe(422);
    expect((await post({ fromDate: F1, toDate: F1, leaveType: 'vacation' })).status).toBe(422);
  });

  it('only the family of a child (or the child) can apply for them', async () => {
    const body = { leaveType: 'sick', fromDate: F1, toDate: F1, reason: 'Fever and cold' };
    expect((await s.req('POST', '/leave', T('parentL'), { ...body, studentId: studentsB[0]!.id })).status).toBe(404); // another family's child
    expect((await s.req('POST', '/leave', T('unverified'), { ...body, studentId: studentsA[0]!.id })).status).toBe(404); // unverified link
    expect((await s.req('POST', '/leave', T('unverified'), body)).status).toBe(404);
    expect((await s.req('POST', '/leave', T('student2'), { ...body, studentId: stuL.id })).status).toBe(404); // a classmate
  });

  it('visibility: own family only', async () => {
    const list = async (who: string) => (await s.req('GET', '/leave', T(who))).body;
    expect((await list('parentL')).meta.total).toBe(1);
    expect((await list('stuL')).meta.total).toBe(1);
    expect((await list('parent')).meta.total).toBe(0);
    expect((await list('parentB')).meta.total).toBe(0);
    expect((await list('student2')).meta.total).toBe(0);
    expect((await list('unverified')).meta.total).toBe(0);
    // section B already has one approved leave (inserted by the pre-marking test): each class teacher sees only their own section's
    expect((await list('ctA')).data.map((x: any) => x.studentId)).toEqual([stuL.id]);
    expect((await list('ctB')).data.map((x: any) => x.studentId)).toEqual([studentsB[5]!.id]);
    expect((await list('principal')).meta.total).toBe(2);
    expect((await list('office')).meta.total).toBe(2);
    expect((await s.req('GET', `/leave/${leaveId}`, T('parentL'))).status).toBe(200);
    expect((await s.req('GET', `/leave/${leaveId}`, T('parent'))).status).toBe(404);
    expect((await s.req('GET', `/leave/${leaveId}`, T('ctB'))).status).toBe(404);
    expect((await s.req('GET', `/leave/${leaveId}`, T('unverified'))).status).toBe(404);
    expect((await s.req('GET', `/leave?status=approved`, T('ctA'))).body.meta.total).toBe(0);
    expect((await s.req('GET', `/leave?studentId=${stuL.id}`, T('principal'))).body.meta.total).toBe(1);
  });

  it('only the section’s class teacher or school scope may decide', async () => {
    expect((await s.req('POST', `/leave/${leaveId}/approve`, T('ctB'), {})).status).toBe(404);
    expect((await s.req('POST', `/leave/${leaveId}/approve`, T('sub'), {})).status).toBe(403);
    expect((await s.req('POST', `/leave/${leaveId}/approve`, T('parentL'), {})).status).toBe(403);
    expect((await s.req('POST', `/leave/${leaveId}/reject`, T('ctA'), {})).body.code).toBe('NOTE_REQUIRED');
    expect((await s.req('GET', `/leave/${leaveId}`, T('ctA'))).body.canDecide).toBe(true);
  });

  it('approval marks attendance `leave` (existing roll call updated, drafts for days without one), audits and notifies', async () => {
    const r = await s.req('POST', `/leave/${leaveId}/approve`, T('ctA'), { note: 'Get well soon' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ status: 'approved', decidedBy: userIdOf['ctA'], decisionNote: 'Get well soon' });
    const rows = await s.db.select().from(attendanceRecords).where(and(eq(attendanceRecords.studentId, stuL.id), inArray(attendanceRecords.date, [D1, D0])));
    expect(rows.map((x) => [x.date, x.status]).sort()).toEqual([[D0, 'leave'], [D1, 'leave']].sort());
    const [d1] = await s.db.select().from(attendanceSessions).where(and(eq(attendanceSessions.sectionId, secA.id), eq(attendanceSessions.date, D1), sql`${attendanceSessions.periodId} is null`));
    expect(d1!.status).toBe('draft'); // D1 had no roll call yet: a draft carries the pre-marked leave
    const log = (await auditOf('leave.approve'))[0]!;
    expect(log.after).toMatchObject({ status: 'approved', studentId: stuL.id, attendance: expect.objectContaining({ updated: expect.any(Number), inserted: expect.any(Number) }) });
    // student + verified guardian (who is also the requester) — one row each, never the unverified guardian
    const dec = (await notifsOf('leave.decided')).filter((n) => (n.data as any).id === leaveId);
    expect(dec.map((n) => n.userId).sort()).toEqual([parentL().userId, stuL.userId!].sort());
    expect(dec.every((n) => n.title === 'Leave request update')).toBe(true);
    expect((await s.req('POST', `/leave/${leaveId}/approve`, T('ctA'), {})).body.code).toBe('ALREADY_DECIDED');
    // a record that already existed can be inspected through the roster (draft day shows the pre-mark)
    const ro = await roster('ctA', secA.id, `?date=${D1}`);
    expect(ro.body.students[4]).toMatchObject({ status: 'leave', onApprovedLeave: true });
  });

  it('a student applies for themself; rejection needs a note and leaves attendance alone', async () => {
    const r = await s.req('POST', '/leave', T('stuL2'), { leaveType: 'casual', fromDate: F1, toDate: F1, reason: 'Dentist appointment' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ studentId: stuL2.id, requestedBy: stuL2.userId });
    const rej = await s.req('POST', `/leave/${r.body.id}/reject`, T('office'), { note: 'Please book appointments after school' });
    expect(rej.body).toMatchObject({ status: 'rejected', decisionNote: 'Please book appointments after school' });
    expect(await s.db.select().from(attendanceSessions).where(and(eq(attendanceSessions.sectionId, secA.id), eq(attendanceSessions.date, F1)))).toHaveLength(0);
    expect((await auditOf('leave.reject')).length).toBe(1);
    // the student hears the decision (they applied)
    expect((await notifsOf('leave.decided', [stuL2.userId!])).length).toBe(1);
  });

  it('cancelling: only the requester, only while pending', async () => {
    const mk = await s.req('POST', '/leave', T('parentL'), { studentId: stuL.id, leaveType: 'family', fromDate: F2, toDate: F2, reason: 'Travel' });
    expect(mk.status).toBe(201);
    expect((await s.req('POST', `/leave/${mk.body.id}/cancel`, T('stuL'), {})).body.code).toBe('NOT_REQUESTER');
    expect((await s.req('POST', `/leave/${mk.body.id}/cancel`, T('parent'), {})).status).toBe(404);
    expect((await s.req('POST', `/leave/${mk.body.id}/cancel`, T('ctA'), {})).status).toBe(403);
    const ok = await s.req('POST', `/leave/${mk.body.id}/cancel`, T('parentL'), {});
    expect(ok.body).toMatchObject({ status: 'cancelled', canCancel: false });
    expect((await s.req('POST', `/leave/${mk.body.id}/cancel`, T('parentL'), {})).body.code).toBe('NOT_PENDING');
    expect((await s.req('POST', `/leave/${mk.body.id}/approve`, T('ctA'), {})).body.code).toBe('ALREADY_DECIDED');
    expect((await s.req('POST', `/leave/${leaveId}/cancel`, T('parentL'), {})).body.code).toBe('NOT_PENDING');
    expect((await auditOf('leave.cancel')).length).toBe(1);
  });

  it('with leaveMarksAttendance off, approval does not touch attendance', async () => {
    await putSetting(s.db, 'attendance', { leaveMarksAttendance: false });
    const mk = await s.req('POST', '/leave', T('parentL'), { studentId: stuL.id, leaveType: 'family', fromDate: F3, toDate: F3, reason: 'Travel' });
    expect((await s.req('POST', `/leave/${mk.body.id}/approve`, T('principal'), {})).status).toBe(200);
    expect(await s.db.select().from(attendanceSessions).where(and(eq(attendanceSessions.sectionId, secA.id), eq(attendanceSessions.date, F3)))).toHaveLength(0);
    // …and the roster does not pre-mark either
    await putSetting(s.db, 'attendance', { leaveMarksAttendance: true });
  });

  it('approval of future leave pre-marks the coming days (draft roll calls), visible on the roster', async () => {
    const mk = await s.req('POST', '/leave', T('parentL'), { studentId: stuL.id, leaveType: 'family', fromDate: F4, toDate: F5, reason: 'Native place trip' });
    expect(mk.status, JSON.stringify(mk.body)).toBe(201);
    const ok = await s.req('POST', `/leave/${mk.body.id}/approve`, T('office'), {});
    expect(ok.status).toBe(200);
    const sess = await s.db.select().from(attendanceSessions).where(and(eq(attendanceSessions.sectionId, secA.id), inArray(attendanceSessions.date, [F4, F5])));
    expect(sess).toHaveLength(2);
    expect(sess.every((x) => x.status === 'draft')).toBe(true);
    const ro = await roster('ctA', secA.id, `?date=${F4}`);
    expect(ro.body).toMatchObject({ isFuture: true, canSubmit: false, blockedReason: 'FUTURE_DATE', session: { status: 'draft', editableUntil: null } });
    expect(ro.body.students[4]).toMatchObject({ status: 'leave' });
    // a draft is not "marked": the school-wide summary ignores it
    const sum = await s.req('GET', `/attendance/summary?date=${F4}`, T('principal'));
    expect(sum.body).toMatchObject({ sectionsMarked: 0 });
    expect(sum.body.totals).toMatchObject({ leave: 0, markedStudents: 0 });
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
describe('staff attendance and leave', () => {
  let staffIds: Record<string, string>;
  const markBody = (date: string) => ({
    date,
    records: [
      { staffId: staffIds['sub']!, status: 'present', checkIn: '08:05', checkOut: '15:30' },
      { staffId: staffIds['sub2']!, status: 'late', checkIn: '08:55', note: 'Traffic' },
      { staffId: staffIds['ctA']!, status: 'absent', note: 'Not informed' },
      { staffId: staffIds['ctB']!, status: 'half_day', checkIn: '08:00', checkOut: '12:15' },
    ],
  });

  beforeAll(async () => {
    const all = await s.db.select({ id: staff.id, userId: staff.userId }).from(staff);
    staffIds = Object.fromEntries(Object.entries(userIdOf).map(([k, uid]) => [k, all.find((x) => x.userId === uid)?.id ?? '']));
    for (const k of ['sub', 'sub2', 'ctA', 'ctB', 'none', 'hr', 'principal']) expect(staffIds[k], k).toBeTruthy();
  });

  it('HR sees the whole register and marks the day in bulk (idempotent upsert, audited)', async () => {
    const ro = await s.req('GET', `/staff-attendance?date=${D0}&pageSize=100`, T('hr'));
    expect(ro.status).toBe(200);
    const total = (await s.db.select({ id: staff.id }).from(staff).where(inArray(staff.status, ['active', 'on_leave']))).length;
    expect(ro.body.meta.total).toBe(total);
    expect(ro.body.counts).toMatchObject({ unmarked: total, present: 0 });
    expect(ro.body.data.every((x: any) => x.status === null && x.onApprovedLeave === false)).toBe(true);

    const r = await s.req('PUT', '/staff-attendance', T('hr'), markBody(D0));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ date: D0, saved: 4, counts: { present: 1, late: 1, absent: 1, half_day: 1, leave: 0 } });
    const again = await s.req('PUT', '/staff-attendance', T('hr'), markBody(D0));
    expect(again.body.saved).toBe(4);
    expect(await s.db.select().from(staffAttendance).where(eq(staffAttendance.date, D0))).toHaveLength(4);

    const after = await s.req('GET', `/staff-attendance?date=${D0}&pageSize=100`, T('hr'));
    expect(after.body.counts).toMatchObject({ present: 1, late: 1, absent: 1, half_day: 1, unmarked: total - 4 });
    const row = after.body.data.find((x: any) => x.staffId === staffIds['sub']);
    expect(row).toMatchObject({ status: 'present', checkIn: '08:05', checkOut: '15:30', recordId: expect.any(String) });
    expect(after.body.data.find((x: any) => x.staffId === staffIds['sub2'])).toMatchObject({ status: 'late', note: 'Traffic' });
    const logs = await auditOf('staff_attendance.mark');
    expect(logs).toHaveLength(2);
    expect((logs[1]!.after as any).counts).toMatchObject({ present: 1, absent: 1 });
    expect(logs[1]!.before).toMatchObject({ records: 4 });
    // search + department filters
    expect((await s.req('GET', `/staff-attendance?date=${D0}&q=EMPX`, T('hr'))).body.meta.total).toBe(1);
  });

  it('validates marking', async () => {
    const ok = { staffId: staffIds['sub']!, status: 'present' };
    const put = (b: object) => s.req('PUT', '/staff-attendance', T('hr'), b);
    expect((await put({ date: addDaysIso(today, 1), records: [ok] })).body.code).toBe('FUTURE_DATE');
    expect((await put({ date: lastSunday(), records: [ok] })).body.code).toBe('NOT_A_WORKING_DAY');
    expect((await put({ date: D0, records: [ok, ok] })).body.code).toBe('DUPLICATE_STAFF');
    expect((await put({ date: D0, records: [{ staffId: secA.id, status: 'present' }] })).body.code).toBe('STAFF_NOT_FOUND');
    expect((await put({ date: D0, records: [{ ...ok, checkIn: '10:00', checkOut: '09:00' }] })).body.code).toBe('INVALID_TIMES');
    expect((await put({ date: D0, records: [] })).status).toBe(422);
    expect((await put({ date: D0, records: [{ ...ok, checkIn: '25:99' }] })).status).toBe(422);
  });

  it('HR can correct one record (audited); teachers cannot', async () => {
    const rec = (await s.db.select().from(staffAttendance).where(and(eq(staffAttendance.staffId, staffIds['ctA']!), eq(staffAttendance.date, D0))))[0]!;
    expect((await s.req('PATCH', `/staff-attendance/${rec.id}`, T('sub'), { status: 'present' })).status).toBe(403);
    expect((await s.req('PATCH', `/staff-attendance/${rec.id}`, T('hr'), {})).status).toBe(422);
    const r = await s.req('PATCH', `/staff-attendance/${rec.id}`, T('hr'), { status: 'present', checkIn: '08:10', note: 'Was on duty' });
    expect(r.body).toMatchObject({ status: 'present', checkIn: '08:10', note: 'Was on duty' });
    const log = (await auditOf('staff_attendance.update'))[0]!;
    expect(log.before).toMatchObject({ status: 'absent' });
    expect(log.after).toMatchObject({ status: 'present', checkIn: '08:10' });
    expect((await s.req('PATCH', `/staff-attendance/${secA.id}`, T('hr'), { status: 'present' })).status).toBe(404);
    expect((await s.req('PATCH', `/staff-attendance/${rec.id}`, T('hr'), { checkIn: '09:00', checkOut: '08:00' })).body.code).toBe('INVALID_TIMES');
  });

  it('staff check in and out themselves once a day', async () => {
    await putSetting(s.db, 'academic', { workingDays: [1, 2, 3, 4, 5, 6, 7] });
    try {
      const a = await s.req('POST', '/staff-attendance/check-in', T('none'), undefined);
      expect(a.status, JSON.stringify(a.body)).toBe(200);
      expect(['present', 'late']).toContain(a.body.status);
      expect(a.body).toMatchObject({ date: today, staffId: staffIds['none'], checkOut: null });
      expect(a.body.checkIn).toMatch(/^\d\d:\d\d$/);
      expect((await s.req('POST', '/staff-attendance/check-in', T('none'))).body.code).toBe('ALREADY_CHECKED_IN');
      const o = await s.req('POST', '/staff-attendance/check-out', T('none'));
      expect(o.status).toBe(200);
      expect(o.body.checkOut).toMatch(/^\d\d:\d\d$/);
      expect((await s.req('POST', '/staff-attendance/check-out', T('none'))).body.code).toBe('ALREADY_CHECKED_OUT');
      // not checked in yet
      expect((await s.req('POST', '/staff-attendance/check-out', T('accounts'))).body.code).toBe('NOT_CHECKED_IN');
      // the office already recorded this person for today → no self check-in
      await s.req('PUT', '/staff-attendance', T('hr'), { date: today, records: [{ staffId: staffIds['sub']!, status: 'present' }] });
      expect((await s.req('POST', '/staff-attendance/check-in', T('sub'))).body.code).toBe('ALREADY_MARKED');
      // /me
      const me = await s.req('GET', '/staff-attendance/me', T('none'));
      expect(me.body.today).toMatchObject({ staffId: staffIds['none'], date: today });
      expect(me.body.totals.total).toBe(1);
      expect(me.body.records).toHaveLength(1);
      expect((await s.req('GET', '/staff-attendance/me', T('student'))).status).toBe(403);
      expect((await auditOf('staff_attendance.check_in')).length).toBe(1);
      expect((await auditOf('staff_attendance.check_out')).length).toBe(1);
      // check-in on a non-working day is refused
      await putSetting(s.db, 'academic', { workingDays: [1, 2, 3, 4, 5, 6, 7].filter((d) => d !== isoWeekday(today)) });
      expect((await s.req('POST', '/staff-attendance/check-in', T('accounts'))).body.code).toBe('NOT_A_WORKING_DAY');
    } finally {
      await putSetting(s.db, 'academic', { workingDays });
    }
  });

  it('own scope sees only their own row; summary and export are for HR', async () => {
    const mine = await s.req('GET', `/staff-attendance?date=${D0}`, T('sub'));
    expect(mine.body.meta.total).toBe(1);
    expect(mine.body.data[0].staffId).toBe(staffIds['sub']);
    const sum = await s.req('GET', `/staff-attendance/summary?from=${D0}&to=${D0}`, T('hr'));
    expect(sum.status, JSON.stringify(sum.body)).toBe(200);
    expect(sum.body.today).toMatchObject({ date: D0 });
    const row = sum.body.staff.find((x: any) => x.staffId === staffIds['sub2']);
    expect(row).toMatchObject({ late: 1, total: 1, percentage: 100 });
    const csv = await s.req('GET', `/staff-attendance/export?from=${D0}&to=${D0}`, T('hr'));
    expect(csv.status).toBe(200);
    expect(String(csv.headers['content-type'])).toContain('text/csv');
    expect((csv.body as string).startsWith('\uFEFFDate,Employee id,Name,Department,Status,Check in,Check out,Note')).toBe(true);
    expect(csv.body).toContain('Traffic');
    expect((await s.req('GET', `/staff-attendance/export?from=${addDaysIso(D0, -200)}&to=${D0}`, T('hr'))).body.code).toBe('RANGE_TOO_LARGE');
  });

  describe('staff leave', () => {
    let F1: string;
    let F2: string;
    let leaveId: string;

    beforeAll(() => {
      F1 = nextSchoolDay(today);
      F2 = nextSchoolDay(F1);
    });

    it('a teacher applies for their own leave; approvers are notified, other teachers see nothing', async () => {
      const r = await s.req('POST', '/staff-leave', T('sub'), { leaveType: 'casual', fromDate: F1, toDate: F2, reason: 'Personal work' });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(r.body).toMatchObject({ staffId: staffIds['sub'], status: 'pending', days: 2, canCancel: true, canDecide: false });
      leaveId = r.body.id;
      const told = (await notifsOf('leave.requested')).filter((n) => (n.data as any).id === leaveId).map((n) => n.userId);
      expect(told).toEqual(expect.arrayContaining([userIdOf['principal']!, userIdOf['hr']!]));
      expect(told).not.toContain(userIdOf['sub']);
      expect(told).not.toContain(userIdOf['sub2']);
      expect((await s.req('POST', '/staff-leave', T('sub'), { leaveType: 'sick', fromDate: F2, toDate: F2, reason: 'Overlap' })).body.code).toBe('LEAVE_OVERLAP');
      expect((await s.req('POST', '/staff-leave', T('sub'), { leaveType: 'sick', fromDate: F2, toDate: F1, reason: 'Backwards' })).status).toBe(422);
      expect((await s.req('POST', '/staff-leave', T('sub'), { leaveType: 'sick', fromDate: addDaysIso(today, -60), toDate: addDaysIso(today, -59), reason: 'Too old' })).body.code).toBe('LEAVE_TOO_OLD');

      expect((await s.req('GET', '/staff-leave', T('sub'))).body.meta.total).toBe(1);
      expect((await s.req('GET', '/staff-leave', T('sub2'))).body.meta.total).toBe(0);
      expect((await s.req('GET', `/staff-leave/${leaveId}`, T('sub2'))).status).toBe(404);
      expect((await s.req('GET', '/staff-leave', T('principal'))).body.meta.total).toBe(1);
      expect((await s.req('GET', `/staff-leave?staffId=${staffIds['sub']}&status=pending`, T('hr'))).body.meta.total).toBe(1);
      expect((await s.req('POST', `/staff-leave/${leaveId}/approve`, T('sub'), {})).status).toBe(403);
      expect((await s.req('POST', `/staff-leave/${leaveId}/approve`, T('office'), {})).status).toBe(403);
      expect((await auditOf('staff_leave.request')).length).toBe(1);
    });

    it('HR/principal decide; nobody decides their own; the applicant is notified', async () => {
      expect((await s.req('POST', `/staff-leave/${leaveId}/reject`, T('hr'), {})).body.code).toBe('NOTE_REQUIRED');
      const ok = await s.req('POST', `/staff-leave/${leaveId}/approve`, T('hr'), { note: 'Approved' });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(ok.body).toMatchObject({ status: 'approved', decidedBy: userIdOf['hr'], canCancel: false });
      expect((await s.req('POST', `/staff-leave/${leaveId}/approve`, T('hr'), {})).body.code).toBe('ALREADY_DECIDED');
      const dec = (await notifsOf('leave.decided')).filter((n) => (n.data as any).id === leaveId);
      expect(dec.map((n) => n.userId)).toEqual([userIdOf['sub']]);
      expect((await auditOf('staff_leave.approve')).length).toBe(1);

      // HR applies for their own leave: they cannot approve it, the principal can
      const own = await s.req('POST', '/staff-leave', T('hr'), { leaveType: 'sick', fromDate: nextSchoolDay(F2), toDate: nextSchoolDay(F2), reason: 'Check-up' });
      expect(own.status, JSON.stringify(own.body)).toBe(201);
      expect(own.body.canDecide).toBe(false);
      expect((await s.req('POST', `/staff-leave/${own.body.id}/approve`, T('hr'), {})).body.code).toBe('SELF_APPROVAL');
      expect((await s.req('POST', `/staff-leave/${own.body.id}/reject`, T('principal'), { note: 'Please reschedule' })).body.status).toBe('rejected');
    });

    it('approving past leave marks the staff register, keeping days already checked in', async () => {
      const past = await s.req('POST', '/staff-leave', T('sub2'), { leaveType: 'sick', fromDate: D1, toDate: D0, reason: 'Fever' });
      expect(past.status, JSON.stringify(past.body)).toBe(201);
      const days = D1 === D0 ? 1 : 2;
      expect(past.body.days).toBe(days);
      expect((await s.req('POST', `/staff-leave/${past.body.id}/approve`, T('principal'), {})).status).toBe(200);
      const rows = await s.db.select().from(staffAttendance).where(and(eq(staffAttendance.staffId, staffIds['sub2']!), inArray(staffAttendance.date, [D1, D0])));
      // sub2 was marked `late` with a check-in time on D0 by HR (no check-in time → overwritten; a real check-in would be kept)
      expect(rows.every((x) => x.status === 'leave' || x.checkIn !== null)).toBe(true);
      expect(rows.find((x) => x.date === D1)?.status ?? 'leave').toBe('leave');
      const roster = await s.req('GET', `/staff-attendance?date=${D1}&pageSize=100`, T('hr'));
      expect(roster.body.data.find((x: any) => x.staffId === staffIds['sub2'])).toMatchObject({ onApprovedLeave: true });
    });

    it('balance counts approved and pending school days per type; others’ balances are not visible', async () => {
      const mine = await s.req('GET', '/staff-leave/balance', T('sub'));
      expect(mine.status, JSON.stringify(mine.body)).toBe(200);
      expect(mine.body).toMatchObject({ staffId: staffIds['sub'], totalApprovedDays: 2, totalPendingDays: 0, byType: [{ leaveType: 'casual', approvedDays: 2, pendingDays: 0 }] });
      expect((await s.req('GET', `/staff-leave/balance?staffId=${staffIds['sub']}`, T('sub2'))).status).toBe(404);
      expect((await s.req('GET', `/staff-leave/balance?staffId=${staffIds['sub']}`, T('hr'))).body.totalApprovedDays).toBe(2);
      expect((await s.req('GET', `/staff-leave/balance?staffId=${secA.id}`, T('hr'))).status).toBe(404);
    });

    it('cancelling: only the applicant, only while pending', async () => {
      const mk = await s.req('POST', '/staff-leave', T('sub'), { leaveType: 'casual', fromDate: nextSchoolDay(addDaysIso(F2, 30)), toDate: nextSchoolDay(addDaysIso(F2, 30)), reason: 'Maybe' });
      const id = mk.body.id;
      expect(mk.status, JSON.stringify(mk.body)).toBe(201);
      expect((await s.req('POST', `/staff-leave/${id}/cancel`, T('hr'), {})).body.code).toBe('NOT_REQUESTER');
      expect((await s.req('POST', `/staff-leave/${id}/cancel`, T('sub2'), {})).status).toBe(404);
      expect((await s.req('POST', `/staff-leave/${id}/cancel`, T('sub'), {})).body.status).toBe('cancelled');
      expect((await s.req('POST', `/staff-leave/${id}/cancel`, T('sub'), {})).body.code).toBe('NOT_PENDING');
      expect((await s.req('POST', `/staff-leave/${leaveId}/cancel`, T('sub'), {})).body.code).toBe('NOT_PENDING');
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
describe('OpenAPI', () => {
  it('documents the attendance and leave routes with schemas', async () => {
    const res = await s.app.inject({ method: 'GET', url: '/api/v1/openapi.json' });
    expect(res.statusCode).toBe(200);
    const doc = res.json();
    const paths = Object.keys(doc.paths);
    for (const p of [
      '/api/v1/attendance/sections/{sectionId}',
      '/api/v1/attendance/records/{id}/corrections',
      '/api/v1/attendance/corrections/{id}/approve',
      '/api/v1/attendance/students/{studentId}/summary',
      '/api/v1/attendance/students/{studentId}/records',
      '/api/v1/attendance/summary',
      '/api/v1/attendance/today',
      '/api/v1/attendance/export',
      '/api/v1/attendance/shortage-scan',
      '/api/v1/leave',
      '/api/v1/leave/{id}/approve',
      '/api/v1/staff-attendance',
      '/api/v1/staff-attendance/check-in',
      '/api/v1/staff-leave',
      '/api/v1/staff-leave/{id}/approve',
    ]) expect(paths, p).toContain(p);
    const put = doc.paths['/api/v1/attendance/sections/{sectionId}'].put;
    expect(put.tags).toContain('Attendance');
    expect(put.requestBody.content['application/json'].schema.properties.records).toBeTruthy();
    expect(doc.paths['/api/v1/attendance/export'].get.responses['200']).toBeTruthy();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
describe('read-only school', () => {
  it('rejects every write with 402 once the subscription has lapsed, while reads keep working', async () => {
    await upsertSubscription({ tenantCode: s.tenant.code, academicYear: '2020-21', startsOn: '2020-04-01', endsOn: '2021-03-31', pricePerStudent: 100, licensedStudents: 12, graceDays: 10 });
    await upsertSubscription({ tenantCode: s.tenant.code, academicYear: s.ctx.yearName, startsOn: '2000-01-01', endsOn: '2001-01-01', pricePerStudent: 100, licensedStudents: 12, graceDays: 10 });
    invalidateLicense(s.tenant.id);
    const writes: [string, 'POST' | 'PUT', string, unknown][] = [
      ['ctA', 'PUT', `/attendance/sections/${secA.id}`, { date: D0, defaultStatus: 'present', records: [] }],
      ['ctA', 'POST', `/attendance/records/${secA.id}/corrections`, { toStatus: 'present', reason: 'because' }],
      ['principal', 'POST', `/attendance/corrections/${secA.id}/approve`, {}],
      ['principal', 'POST', '/attendance/shortage-scan', undefined],
      ['parentL', 'POST', '/leave', { studentId: studentsA[4]!.id, fromDate: D0, toDate: D0, reason: 'Unwell' }],
      ['ctA', 'POST', `/leave/${secA.id}/approve`, {}],
      ['none', 'POST', '/staff-attendance/check-in', undefined],
      ['hr', 'PUT', '/staff-attendance', { records: [{ staffId: secA.id, status: 'present' }] }],
      ['sub', 'POST', '/staff-leave', { fromDate: D0, toDate: D0, reason: 'Unwell' }],
      ['hr', 'POST', `/staff-leave/${secA.id}/approve`, {}],
    ];
    for (const [who, method, path, body] of writes) {
      const r = await s.req(method, path, T(who), body);
      expect([r.status, r.body.code], `${method} ${path}`).toEqual([402, 'SUBSCRIPTION_EXPIRED']);
    }
    expect((await roster('ctA', secA.id, `?date=${D0}`)).status).toBe(200);
    expect((await s.req('GET', '/attendance/summary', T('principal'))).status).toBe(200);
    expect((await s.req('GET', '/leave', T('parentL'))).status).toBe(200);
    expect((await s.req('GET', `/attendance/students/${studentsA[1]!.id}/summary`, T('parent'))).status).toBe(200);
    expect((await s.req('GET', '/staff-attendance/me', T('none'))).status).toBe(200);
  });
});
