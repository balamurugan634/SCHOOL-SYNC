import { and, eq, inArray, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { seed as learningSeed } from '../src/cli/seed/learning';
import { upsertSubscription } from '../src/core/billing/invoicing';
import { invalidateLicense } from '../src/core/billing/license';
import { invalidatePrincipal } from '../src/core/rbac/principal';
import { addDaysIso, isoWeekday, todayIn } from '../src/core/http';
import { runJobOnce } from '../src/core/jobs';
import { auditLogs, homework, homeworkSubmissions, materials, notifications, periods, staff, studentGuardians, students, studentTasks, subjects, syllabusTopics, teachingAssignments, timetableSlots, topicProgress, userRoles, users, guardians } from '../src/db/tenant/schema';
import { zonedDayStart } from '../src/modules/learning/common';
import { jobs, sendDueTomorrowReminders, sendTaskReminders } from '../src/modules/learning/jobs';
import { createTestSchool, type TestSchool } from './helpers';

let s: TestSchool;
const tokens = new Map<string, string>();
const T = (user: string): string => {
  const t = tokens.get(user);
  if (!t) throw new Error(`no token for ${user}`);
  return t;
};
let secA: TestSchool['ctx']['sections'][number];
let secB: TestSchool['ctx']['sections'][number];
let stuA: TestSchool['ctx']['students'][number];
let stuA2: TestSchool['ctx']['students'][number];
let stuB: TestSchool['ctx']['students'][number];
let parentA: TestSchool['ctx']['guardians'][number];
let parentB: TestSchool['ctx']['guardians'][number];
let classTeacherA: string; // username
let subj0: string; // subject taught in sectionA by its class teacher
let today: string;

const teacherUsername = (staffId: string) => s.ctx.teachers.find((t) => t.id === staffId)!.username;
const futureAt = (days: number, hour = 17) => new Date(zonedDayStart(addDaysIso(today, days), s.tenant.timezone).getTime() + hour * 3_600_000).toISOString();
const nextDateWithWeekday = (dow: number) => {
  for (let k = 1; k <= 7; k++) {
    const d = addDaysIso(today, k);
    if (isoWeekday(d) === dow) return d;
  }
  throw new Error('unreachable');
};

async function notificationsFor(type: string, key: string, value: string) {
  return s.db.select().from(notifications).where(and(eq(notifications.type, type), sql`${notifications.data}->>${key} = ${value}`));
}

async function addTeacher(username: string) {
  const [u] = await s.db.insert(users).values({ userType: 'staff', username, displayName: `Extra ${username}`, passwordHash: s.ctx.passwordHash, passwordChangedAt: new Date() }).returning({ id: users.id });
  const [st] = await s.db.insert(staff).values({ userId: u!.id, employeeId: `EMPX-${username}`, firstName: 'Extra', lastName: username }).returning({ id: staff.id });
  await s.db.insert(userRoles).values({ userId: u!.id, roleId: s.ctx.roleIds['teacher']! });
  return st!.id;
}

async function newHomework(token: string, over: Record<string, unknown> = {}) {
  const r = await s.req('POST', '/homework', token, { sectionId: secA.id, subjectId: subj0, title: 'Test homework', dueAt: futureAt(3), publish: true, maxMarks: 10, ...over });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body as { id: string; status: string };
}

beforeAll(async () => {
  s = await createTestSchool();
  await learningSeed(s.ctx);
  today = todayIn(s.tenant.timezone);
  [secA, secB] = [s.ctx.sections[0]!, s.ctx.sections[1]!];
  stuA = s.ctx.students.find((x) => x.sectionId === secA.id)!;
  stuA2 = s.ctx.students.filter((x) => x.sectionId === secA.id)[1]!;
  stuB = s.ctx.students.find((x) => x.sectionId === secB.id)!;
  // pick parents whose every child is in a single section so the child selector is unambiguous
  parentA = s.ctx.guardians.find((g) => g.studentIds.length === 1 && g.studentIds[0] === stuA.id)!;
  parentB = s.ctx.guardians.find((g) => g.studentIds.length === 1 && g.studentIds[0] === stuB.id)!;
  classTeacherA = teacherUsername(secA.classTeacherId);
  subj0 = s.ctx.assignments.find((a) => a.sectionId === secA.id && a.staffId === secA.classTeacherId)!.subjectId;
  await addTeacher('t_none');
  for (const u of ['t_none', classTeacherA, teacherUsername(secB.classTeacherId), 'principal', 'office', 'hr', stuA.username, stuA2.username, stuB.username, parentA.username, parentB.username, '9099999999']) tokens.set(u, await s.login(u));
});

describe('learning seed', () => {
  it('builds a clash-free timetable for every section', async () => {
    for (const sec of s.ctx.sections) {
      const [r] = await s.db.select({ n: sql<number>`count(*)::int` }).from(timetableSlots).where(eq(timetableSlots.sectionId, sec.id));
      expect(r!.n).toBeGreaterThan(10);
    }
    const dup = await s.db.execute(sql`select staff_id, day_of_week, period_id, count(*) from timetable_slots where staff_id is not null group by 1,2,3 having count(*) > 1`);
    expect(dup.rows).toHaveLength(0);
  });

  it('creates homework with submissions in varied states, materials, syllabus and tasks', async () => {
    const hw = await s.db.select().from(homework);
    expect(hw.length).toBeGreaterThanOrEqual(s.ctx.sections.length * 8);
    expect(new Set(hw.map((h) => h.status))).toContain('closed');
    const subs = await s.db.select({ status: homeworkSubmissions.status }).from(homeworkSubmissions);
    const kinds = new Set(subs.map((x) => x.status));
    for (const k of ['submitted', 'late', 'reviewed']) expect(kinds.has(k as 'late'), k).toBe(true);
    expect((await s.db.select().from(materials)).length).toBeGreaterThan(0);
    expect((await s.db.select().from(syllabusTopics)).length).toBeGreaterThan(0);
    expect((await s.db.select().from(topicProgress)).length).toBeGreaterThan(0);
    expect((await s.db.select().from(studentTasks)).length).toBeGreaterThan(0);
  });
});

describe('permission matrix', () => {
  const cases: [string, 'GET' | 'POST' | 'PUT', string, number][] = [
    // student
    ['student', 'GET', '/homework', 200],
    ['student', 'GET', '/timetable/me', 200],
    ['student', 'GET', '/materials', 200],
    ['student', 'GET', '/syllabus/topics', 200],
    ['student', 'GET', '/tasks', 200],
    ['student', 'GET', '/tasks/feed', 200],
    ['student', 'POST', '/homework', 403],
    ['student', 'PUT', '/timetable/slots', 403],
    ['student', 'POST', '/materials', 403],
    ['student', 'POST', '/syllabus/topics', 403],
    // parent
    ['parent', 'GET', '/homework', 200],
    ['parent', 'GET', '/timetable/me', 200],
    ['parent', 'GET', '/tasks', 403],
    ['parent', 'GET', '/tasks/feed', 403],
    ['parent', 'POST', '/homework', 403],
    // teacher
    ['teacher', 'GET', '/homework', 200],
    ['teacher', 'GET', '/submissions', 200],
    ['teacher', 'GET', '/timetable/me', 200],
    ['teacher', 'PUT', '/timetable/slots', 403],
    ['teacher', 'POST', '/timetable/substitutions', 403],
    // management
    ['principal', 'GET', '/homework', 200],
    ['principal', 'GET', '/syllabus/coverage', 200],
    ['principal', 'POST', '/homework', 403],
    ['principal', 'PUT', '/timetable/slots', 403],
    ['office', 'GET', '/timetable/substitutions', 200],
    ['office', 'GET', '/submissions', 403],
    ['hr', 'GET', '/homework', 403],
    ['hr', 'GET', '/timetable/me', 403],
  ];
  const ZERO = '0194c0de-0000-7000-8000-000000000000';
  const bodyFor = (path: string): unknown => {
    if (path === '/homework') return { sectionId: secA.id, subjectId: subj0, title: 'x', dueAt: futureAt(2) };
    if (path === '/timetable/slots') return { sectionId: secA.id, dayOfWeek: 1, periodId: ZERO, subjectId: subj0 };
    if (path === '/materials') return { title: 'x', subjectId: subj0, sectionId: secA.id, url: 'https://example.com/x' };
    if (path === '/syllabus/topics') return { gradeId: secA.gradeId, subjectId: subj0, title: 'x' };
    if (path === '/timetable/substitutions') return { slotId: ZERO, date: addDaysIso(today, 2), substituteStaffId: ZERO };
    return {};
  };
  it.each(cases)('%s %s %s -> %i', async (who, method, path, expected) => {
    const token = who === 'student' ? T(stuA.username) : who === 'parent' ? T(parentA.username) : who === 'teacher' ? T(classTeacherA) : T(who);
    const r = await s.req(method, path, token, method === 'GET' ? undefined : bodyFor(path));
    expect(r.status, JSON.stringify(r.body)).toBe(expected);
  });
  it('requires authentication', async () => {
    expect((await s.req('GET', '/homework', null)).status).toBe(401);
    expect((await s.req('GET', '/tasks/feed', null)).status).toBe(401);
  });
});

describe('timetable', () => {
  it('shows a section grid to its students and hides other sections', async () => {
    const mine = await s.req('GET', `/timetable/sections/${secA.id}`, T(stuA.username));
    expect(mine.status).toBe(200);
    expect(mine.body.slots.length).toBeGreaterThan(10);
    expect(mine.body.periods.length).toBeGreaterThan(5);
    expect(mine.body.section.id).toBe(secA.id);
    expect((await s.req('GET', `/timetable/sections/${secB.id}`, T(stuA.username))).status).toBe(404);
    expect((await s.req('GET', `/timetable/sections/${secA.id}`, T(parentB.username))).status).toBe(404);
    expect((await s.req('GET', `/timetable/sections/${secA.id}`, T('9099999999'))).status).toBe(404);
    expect((await s.req('GET', `/timetable/sections/${secA.id}`, T('principal'))).status).toBe(200);
  });

  it('reports a clash (409 TEACHER_CLASH) when a teacher is booked in two sections in the same period', async () => {
    const slotsA = await s.db.select().from(timetableSlots).where(eq(timetableSlots.sectionId, secA.id));
    // a teacher who also has a subject in section B
    const pick = slotsA.find((sl) => sl.staffId && s.ctx.assignments.some((a) => a.sectionId === secB.id && a.staffId === sl.staffId))!;
    const subjectInB = s.ctx.assignments.find((a) => a.sectionId === secB.id && a.staffId === pick.staffId)!.subjectId;
    // free B's cell first so only the teacher clash can fail
    const [inB] = await s.db.select().from(timetableSlots).where(and(eq(timetableSlots.sectionId, secB.id), eq(timetableSlots.dayOfWeek, pick.dayOfWeek), eq(timetableSlots.periodId, pick.periodId)));
    if (inB) expect((await s.req('DELETE', `/timetable/slots/${inB.id}`, T('office'))).status).toBe(200);
    const clash = await s.req('PUT', '/timetable/slots', T('office'), { sectionId: secB.id, dayOfWeek: pick.dayOfWeek, periodId: pick.periodId, subjectId: subjectInB });
    expect(clash.status).toBe(409);
    expect(clash.body.code).toBe('TEACHER_CLASH');
    expect(clash.body.sectionId).toBe(secA.id);
    // the same teacher in a period where they are free is fine
    const busy = new Set((await s.db.select().from(timetableSlots).where(eq(timetableSlots.staffId, pick.staffId!))).map((x) => `${x.dayOfWeek}|${x.periodId}`));
    const free = await s.db.select().from(periods).where(eq(periods.isBreak, false));
    const bTaken = new Set((await s.db.select().from(timetableSlots).where(eq(timetableSlots.sectionId, secB.id))).map((x) => `${x.dayOfWeek}|${x.periodId}`));
    const cell = free.flatMap((p) => [1, 2, 3, 4, 5, 6].map((d) => ({ d, p: p.id }))).find((c) => !busy.has(`${c.d}|${c.p}`) && !bTaken.has(`${c.d}|${c.p}`))!;
    const ok = await s.req('PUT', '/timetable/slots', T('office'), { sectionId: secB.id, dayOfWeek: cell.d, periodId: cell.p, subjectId: subjectInB });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.staffId).toBe(pick.staffId);
    expect(ok.body.teacherName).toBeTruthy();
  });

  it('validates breaks, subjects and teacher assignments', async () => {
    const [brk] = await s.db.select().from(periods).where(eq(periods.isBreak, true));
    const body = { sectionId: secA.id, dayOfWeek: 1, periodId: brk!.id, subjectId: subj0 };
    const r1 = await s.req('PUT', '/timetable/slots', T('office'), body);
    expect([r1.status, r1.body.code]).toEqual([422, 'PERIOD_IS_BREAK']);

    const [extra] = await s.db.insert(subjects).values({ code: 'XTR', name: 'Extra subject' }).returning();
    const [lesson] = await s.db.select().from(periods).where(eq(periods.isBreak, false));
    const r2 = await s.req('PUT', '/timetable/slots', T('office'), { ...body, periodId: lesson!.id, subjectId: extra!.id });
    expect([r2.status, r2.body.code]).toEqual([422, 'SUBJECT_NOT_OFFERED']);

    // a different teacher for an existing assignment: rejected, or saved with a warning when explicitly allowed
    const assignee = s.ctx.assignments.find((a) => a.sectionId === secA.id && a.subjectId === subj0)!.staffId;
    const slotsA = await s.db.select().from(timetableSlots).where(eq(timetableSlots.sectionId, secA.id));
    const takenA = new Set(slotsA.map((x) => `${x.dayOfWeek}|${x.periodId}`));
    const lessonPeriods = await s.db.select().from(periods).where(eq(periods.isBreak, false));
    const emptyCell = lessonPeriods.flatMap((p) => [1, 2, 3, 4, 5, 6].map((d) => ({ d, p: p.id }))).find((c) => !takenA.has(`${c.d}|${c.p}`))!;
    const other = s.ctx.teachers.find((t) => t.id !== assignee && !slotsA.some((x) => x.staffId === t.id && x.dayOfWeek === emptyCell.d && x.periodId === emptyCell.p))!;
    const mismatch = { sectionId: secA.id, dayOfWeek: emptyCell.d, periodId: emptyCell.p, subjectId: subj0, staffId: other.id };
    const [clashCheck] = await s.db.select().from(timetableSlots).where(and(eq(timetableSlots.staffId, other.id), eq(timetableSlots.dayOfWeek, emptyCell.d), eq(timetableSlots.periodId, emptyCell.p)));
    const r3 = await s.req('PUT', '/timetable/slots', T('office'), mismatch);
    expect([r3.status, r3.body.code]).toEqual([422, 'TEACHER_NOT_ASSIGNED']);
    if (!clashCheck) {
      const r4 = await s.req('PUT', '/timetable/slots', T('office'), { ...mismatch, allowUnassigned: true });
      expect(r4.status, JSON.stringify(r4.body)).toBe(200);
      expect(r4.body.warnings).toContain('TEACHER_NOT_ASSIGNED');
      expect((await s.req('DELETE', `/timetable/slots/${r4.body.id}`, T('office'))).status).toBe(200);
    }
    expect((await s.req('PUT', '/timetable/slots', T('office'), { ...body, dayOfWeek: 9 })).status).toBe(422);
  });

  it('replaces a section grid atomically and audits it', async () => {
    const grid = await s.req('GET', `/timetable/sections/${secA.id}`, T('office'));
    const input = grid.body.slots.map((x: any) => ({ dayOfWeek: x.dayOfWeek, periodId: x.periodId, subjectId: x.subjectId, staffId: x.staffId, room: x.room }));
    const fewer = await s.req('PUT', `/timetable/sections/${secA.id}`, T('office'), { slots: input.slice(1) });
    expect(fewer.status, JSON.stringify(fewer.body)).toBe(200);
    expect(fewer.body.data).toHaveLength(input.length - 1);
    const full = await s.req('PUT', `/timetable/sections/${secA.id}`, T('office'), { slots: input });
    expect(full.body.data).toHaveLength(input.length);
    const dup = await s.req('PUT', `/timetable/sections/${secA.id}`, T('office'), { slots: [input[0], input[0]] });
    expect([dup.status, dup.body.code]).toEqual([422, 'DUPLICATE_SLOT']);
    const logs = await s.db.select().from(auditLogs).where(eq(auditLogs.action, 'timetable.replace'));
    expect(logs.length).toBeGreaterThanOrEqual(2);
    expect(logs[0]!.before).toBeTruthy();
  });

  it('arranges substitutions, notifies the substitute and shows covers in day views', async () => {
    const slots = await s.db.select().from(timetableSlots).where(eq(timetableSlots.sectionId, secA.id));
    const slot = slots.find((x) => x.staffId)!;
    const date = nextDateWithWeekday(slot.dayOfWeek);
    const allSlots = await s.db.select().from(timetableSlots);
    const freeTeacher = s.ctx.teachers.find((t) => t.id !== slot.staffId && !allSlots.some((x) => x.staffId === t.id && x.dayOfWeek === slot.dayOfWeek && x.periodId === slot.periodId))!;
    const busyTeacher = s.ctx.teachers.find((t) => t.id !== slot.staffId && allSlots.some((x) => x.staffId === t.id && x.dayOfWeek === slot.dayOfWeek && x.periodId === slot.periodId));

    expect((await s.req('POST', '/timetable/substitutions', T('principal'), { slotId: slot.id, date, substituteStaffId: freeTeacher.id })).status).toBe(403);
    if (busyTeacher) {
      const clash = await s.req('POST', '/timetable/substitutions', T('office'), { slotId: slot.id, date, substituteStaffId: busyTeacher.id });
      expect([clash.status, clash.body.code]).toEqual([409, 'TEACHER_CLASH']);
    }
    const past = await s.req('POST', '/timetable/substitutions', T('office'), { slotId: slot.id, date: addDaysIso(today, -7), substituteStaffId: freeTeacher.id });
    expect([past.status, past.body.code]).toEqual([422, 'DATE_IN_PAST']);
    const wrongDay = await s.req('POST', '/timetable/substitutions', T('office'), { slotId: slot.id, date: addDaysIso(date, 1), substituteStaffId: freeTeacher.id });
    expect([wrongDay.status, wrongDay.body.code]).toEqual([422, 'DATE_WEEKDAY_MISMATCH']);

    const created = await s.req('POST', '/timetable/substitutions', T('office'), { slotId: slot.id, date, substituteStaffId: freeTeacher.id, reason: 'Training' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.substituteTeacherName).toBeTruthy();
    const again = await s.req('POST', '/timetable/substitutions', T('office'), { slotId: slot.id, date, substituteStaffId: freeTeacher.id });
    expect([again.status, again.body.code]).toEqual([409, 'SUBSTITUTION_EXISTS']);

    // notifications: substitute + the covered teacher, nobody else
    const notes = await notificationsFor('timetable.substitution', 'substitutionId', created.body.id);
    const recipients = notes.map((n) => n.userId).sort();
    expect(recipients).toEqual([s.ctx.teachers.find((t) => t.id === freeTeacher.id)!.userId, s.ctx.teachers.find((t) => t.id === slot.staffId)!.userId].sort());

    // day views
    const subToken = await s.login(teacherUsername(freeTeacher.id));
    const sub = await s.req('GET', `/timetable/me?date=${date}`, subToken);
    expect(sub.body.entries.find((e: any) => e.slotId === slot.id)).toMatchObject({ relation: 'covering', substituted: true });
    const orig = await s.req('GET', `/timetable/me?date=${date}`, await s.login(teacherUsername(slot.staffId!)));
    expect(orig.body.entries.find((e: any) => e.slotId === slot.id)).toMatchObject({ relation: 'covered', substituted: true });
    const student = await s.req('GET', `/timetable/me?date=${date}`, T(stuA.username));
    const entry = student.body.entries.find((e: any) => e.slotId === slot.id);
    expect(entry.substituted).toBe(true);
    expect(entry.substitution.substituteStaffId).toBe(freeTeacher.id);
    // a parent selects the child
    expect((await s.req('GET', `/timetable/me?date=${date}&studentId=${stuA.id}`, T(parentA.username))).body.sectionId).toBe(secA.id);
    expect((await s.req('GET', `/timetable/me?date=${date}&studentId=${stuB.id}`, T(parentA.username))).status).toBe(404);

    const list = await s.req('GET', `/timetable/substitutions?from=${date}&to=${date}`, T('office'));
    expect(list.body.data.map((x: any) => x.id)).toContain(created.body.id);
    expect((await s.req('GET', `/timetable/substitutions?from=${date}&to=${date}`, T(stuB.username))).body.data).toHaveLength(0); // other section's cover is invisible

    expect((await s.req('DELETE', `/timetable/substitutions/${created.body.id}`, T('office'))).status).toBe(200);
    expect((await s.req('GET', `/timetable/me?date=${date}`, subToken)).body.entries.find((e: any) => e.slotId === slot.id)).toBeUndefined();
  });

  it('shapes /timetable/today for dashboards', async () => {
    const r = await s.req('GET', '/timetable/today', T(stuA.username));
    expect(r.status).toBe(200);
    expect(r.body.date).toBe(today);
    expect(r.body.sectionId).toBe(secA.id);
    if (r.body.isWorkingDay) {
      expect(r.body.entries.length).toBeGreaterThan(5);
      expect(r.body.entries.every((e: any) => ['past', 'current', 'upcoming'].includes(e.state))).toBe(true);
      expect(r.body.now).toMatch(/^\d\d:\d\d$/);
    } else expect(r.body.entries).toHaveLength(0);
    const t = await s.req('GET', '/timetable/today', T(classTeacherA));
    expect(t.status).toBe(200);
    expect(t.body.sectionId).toBeNull();
    expect(t.body.entries.every((e: any) => e.relation !== null)).toBe(true);
  });
});

describe('homework', () => {
  it('drafts are invisible to learners; publishing notifies students and verified guardians only', async () => {
    const draft = await newHomework(T(classTeacherA), { publish: false, title: 'Draft homework' });
    expect(draft.status).toBe('draft');
    expect((await s.req('GET', `/homework/${draft.id}`, T(stuA.username))).status).toBe(404);
    expect((await s.req('GET', `/homework/${draft.id}`, T(parentA.username))).status).toBe(404);
    expect((await s.req('GET', `/homework?q=Draft+homework`, T(stuA.username))).body.data).toHaveLength(0);
    expect((await s.req('GET', `/homework/${draft.id}`, T(classTeacherA))).status).toBe(200);
    expect(await notificationsFor('homework.assigned', 'homeworkId', draft.id)).toHaveLength(0);

    const pub = await s.req('POST', `/homework/${draft.id}/publish`, T(classTeacherA));
    expect(pub.status, JSON.stringify(pub.body)).toBe(200);
    expect(pub.body.status).toBe('published');

    const roster = await s.db.select({ id: students.id, userId: students.userId }).from(students).where(eq(students.currentSectionId, secA.id));
    const links = await s.db
      .select({ userId: guardians.userId, verifiedAt: studentGuardians.verifiedAt })
      .from(studentGuardians)
      .innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId))
      .where(inArray(studentGuardians.studentId, roster.map((r) => r.id)));
    const expected = [...roster.map((r) => r.userId!), ...links.filter((l) => l.verifiedAt).map((l) => l.userId!)].sort();
    const sent = (await notificationsFor('homework.assigned', 'homeworkId', draft.id)).map((n) => n.userId).sort();
    expect(sent).toEqual(expected);
    const pendingGuardian = (await s.db.select({ userId: guardians.userId }).from(guardians).where(eq(guardians.phone, '9099999999')))[0]!.userId!;
    expect(sent).not.toContain(pendingGuardian);
    expect(sent).not.toContain(s.ctx.students.find((x) => x.sectionId === secB.id)!.userId); // other section untouched

    const again = await s.req('POST', `/homework/${draft.id}/publish`, T(classTeacherA));
    expect([again.status, again.body.code]).toEqual([409, 'INVALID_STATE']);
  });

  it('enforces subject-level rights and section scope for teachers', async () => {
    const notMine = s.ctx.assignments.find((a) => a.sectionId === secA.id && a.staffId !== secA.classTeacherId)!;
    const outsider = teacherUsername(notMine.staffId); // teaches one subject in A, does not lead it
    const otherSubject = s.ctx.assignments.find((a) => a.sectionId === secA.id && a.staffId !== notMine.staffId && a.staffId !== secA.classTeacherId) ?? s.ctx.assignments.find((a) => a.sectionId === secA.id && a.staffId === secA.classTeacherId)!;
    const t = await s.login(outsider);
    const wrongSubject = await s.req('POST', '/homework', t, { sectionId: secA.id, subjectId: otherSubject.subjectId, title: 'x', dueAt: futureAt(2), publish: true });
    expect([wrongSubject.status, wrongSubject.body.code]).toEqual([403, 'NOT_TEACHING_SUBJECT']);
    const own = await s.req('POST', '/homework', t, { sectionId: secA.id, subjectId: notMine.subjectId, title: 'Mine', dueAt: futureAt(2) });
    expect(own.status).toBe(201);
    expect(own.body.status).toBe('draft');

    // a teacher with no classes sees nothing and cannot touch section A
    const none = T('t_none');
    expect((await s.req('GET', '/homework', none)).body.data).toHaveLength(0);
    expect((await s.req('POST', '/homework', none, { sectionId: secA.id, subjectId: subj0, title: 'x', dueAt: futureAt(2) })).status).toBe(404);
    expect((await s.req('GET', `/homework/${own.body.id}`, none)).status).toBe(404);
    expect((await s.req('GET', `/homework/${own.body.id}/roster`, none)).status).toBe(404);
    expect((await s.req('PATCH', `/homework/${own.body.id}`, none, { title: 'hijack' })).status).toBe(404);
    expect((await s.req('GET', `/timetable/sections/${secA.id}`, none)).status).toBe(404);
    expect((await s.req('GET', '/materials', none)).body.data).toHaveLength(0);
    // …but the class teacher of A can see the homework a colleague authored for their class
    expect((await s.req('GET', `/homework/${own.body.id}`, T(classTeacherA))).status).toBe(200);
  });

  it('validates input and due dates', async () => {
    const t = T(classTeacherA);
    expect((await s.req('POST', '/homework', t, { sectionId: secA.id, subjectId: subj0, dueAt: futureAt(2) })).status).toBe(422); // no title
    expect((await s.req('POST', '/homework', t, { sectionId: secA.id, subjectId: subj0, title: 'x', dueAt: futureAt(2), maxMarks: 0 })).status).toBe(422);
    const past = await s.req('POST', '/homework', t, { sectionId: secA.id, subjectId: subj0, title: 'x', dueAt: futureAt(-2), publish: true });
    expect([past.status, past.body.code]).toEqual([422, 'DUE_DATE_PAST']);
    const bogusFile = await s.req('POST', '/homework', t, { sectionId: secA.id, subjectId: subj0, title: 'x', dueAt: futureAt(2), attachments: [{ fileId: '0194c0de-0000-7000-8000-000000000000', name: 'a.pdf' }] });
    expect([bogusFile.status, bogusFile.body.code]).toEqual([422, 'ATTACHMENT_NOT_FOUND']);
  });

  it('gives students and parents per-item status and filters, and teachers a roster', async () => {
    const hw = await newHomework(T(classTeacherA), { title: 'Status check' });
    const list = await s.req('GET', `/homework?pageSize=100`, T(stuA.username));
    expect(list.status).toBe(200);
    expect(list.body.data.every((h: any) => h.sectionId === secA.id)).toBe(true);
    expect(list.body.data.every((h: any) => h.status !== 'draft')).toBe(true);
    expect(list.body.data.find((h: any) => h.id === hw.id).learner).toMatchObject({ studentId: stuA.id, status: 'pending', submission: null });
    const overdue = await s.req('GET', `/homework?learnerStatus=overdue&pageSize=100`, T(stuA.username));
    expect(overdue.body.data.every((h: any) => h.learner.status === 'overdue')).toBe(true);
    const pending = await s.req('GET', `/homework?learnerStatus=pending&pageSize=100`, T(stuA.username));
    expect(pending.body.data.some((h: any) => h.id === hw.id)).toBe(true);
    // parent sees the child's view; naming someone else's child is a 404
    const asParent = await s.req('GET', `/homework?studentId=${stuA.id}`, T(parentA.username));
    expect(asParent.status).toBe(200);
    expect(asParent.body.data[0].learner.studentId).toBe(stuA.id);
    expect((await s.req('GET', `/homework?studentId=${stuB.id}`, T(parentA.username))).status).toBe(404);
    expect((await s.req('GET', `/homework?studentId=${stuA.id}`, T(stuB.username))).status).toBe(404);
    // the unverified guardian sees nothing
    expect((await s.req('GET', '/homework', T('9099999999'))).body.data).toHaveLength(0);
    expect((await s.req('GET', `/homework/${hw.id}`, T('9099999999'))).status).toBe(404);
    expect((await s.req('GET', `/homework/${hw.id}?studentId=${stuA.id}`, T('9099999999'))).status).toBe(404);
    // other section's student cannot open it
    expect((await s.req('GET', `/homework/${hw.id}`, T(stuB.username))).status).toBe(404);

    const roster = await s.req('GET', `/homework/${hw.id}/roster`, T(classTeacherA));
    expect(roster.status).toBe(200);
    expect(roster.body.data).toHaveLength(s.ctx.students.filter((x) => x.sectionId === secA.id).length);
    expect(roster.body.data.every((r: any) => r.status === 'missing')).toBe(true);
    expect(roster.body.homework.stats.missing).toBe(roster.body.data.length);
    // learners have no roster
    expect((await s.req('GET', `/homework/${hw.id}/roster`, T(stuA.username))).status).toBe(403);
    // teacher list carries submission counts
    const tl = await s.req('GET', `/homework?sectionId=${secA.id}&mine=true`, T(classTeacherA));
    expect(tl.body.data.find((h: any) => h.id === hw.id).stats.totalStudents).toBe(roster.body.data.length);
  });

  it('edits, closes and deletes with the right state rules and audit', async () => {
    const t = T(classTeacherA);
    const hw = await newHomework(t, { title: 'Lifecycle' });
    const patched = await s.req('PATCH', `/homework/${hw.id}`, t, { title: 'Lifecycle v2', maxMarks: 20 });
    expect(patched.body).toMatchObject({ title: 'Lifecycle v2', maxMarks: 20 });
    expect((await s.req('PATCH', `/homework/${hw.id}`, T(stuA.username), { title: 'hack' })).status).toBe(403);
    const closed = await s.req('POST', `/homework/${hw.id}/close`, t);
    expect(closed.body.status).toBe('closed');
    expect((await s.req('POST', `/homework/${hw.id}/close`, t)).body.code).toBe('INVALID_STATE');
    expect((await s.req('PATCH', `/homework/${hw.id}`, t, { title: 'again' })).body.code).toBe('HOMEWORK_CLOSED');
    const submit = await s.req('POST', `/homework/${hw.id}/submit`, T(stuA.username), { text: 'late to the party' });
    expect([submit.status, submit.body.code]).toEqual([409, 'HOMEWORK_CLOSED']);
    // students still see closed homework
    expect((await s.req('GET', `/homework/${hw.id}`, T(stuA.username))).body.status).toBe('closed');

    const gone = await newHomework(t, { title: 'Delete me' });
    expect((await s.req('DELETE', `/homework/${gone.id}`, t)).status).toBe(200);
    expect((await s.req('GET', `/homework/${gone.id}`, t)).status).toBe(404);
    const keep = await newHomework(t, { title: 'Has submission' });
    expect((await s.req('POST', `/homework/${keep.id}/submit`, T(stuA.username), { text: 'done' })).status).toBe(200);
    expect((await s.req('DELETE', `/homework/${keep.id}`, t)).body.code).toBe('HOMEWORK_HAS_SUBMISSIONS');

    const actions = (await s.db.select({ action: auditLogs.action }).from(auditLogs).where(and(eq(auditLogs.entity, 'homework'), eq(auditLogs.entityId, hw.id)))).map((x) => x.action);
    expect(actions).toEqual(expect.arrayContaining(['homework.create', 'homework.publish', 'homework.update', 'homework.close']));
    const [upd] = await s.db.select().from(auditLogs).where(and(eq(auditLogs.action, 'homework.update'), eq(auditLogs.entityId, hw.id)));
    expect((upd!.before as any).title).toBe('Lifecycle');
    expect((upd!.after as any).title).toBe('Lifecycle v2');
    expect(await s.db.select().from(auditLogs).where(and(eq(auditLogs.action, 'homework.delete'), eq(auditLogs.entityId, gone.id)))).toHaveLength(1);
  });

  it('sends "due tomorrow" reminders once, skipping students who already submitted', async () => {
    const t = T(classTeacherA);
    const hw = await newHomework(t, { title: 'Due tomorrow job', dueAt: futureAt(1, 12) });
    expect((await s.req('POST', `/homework/${hw.id}/submit`, T(stuA2.username), { text: 'already done' })).status).toBe(200);

    expect(await sendDueTomorrowReminders(s.tenant, s.db, { now: new Date(zonedDayStart(today, s.tenant.timezone).getTime() + 8 * 3_600_000) })).toBe(0); // before 15:00 school time: nothing yet
    const sent = await sendDueTomorrowReminders(s.tenant, s.db, { ignoreHour: true });
    expect(sent).toBeGreaterThan(0);
    const rows = await notificationsFor('homework.reminder', 'homeworkId', hw.id);
    const userIds = rows.map((n) => n.userId);
    const a2 = s.ctx.students.find((x) => x.id === stuA2.id)!;
    expect(userIds).toContain(s.ctx.students.find((x) => x.id === stuA.id)!.userId);
    expect(userIds).not.toContain(a2.userId); // submitted
    expect(userIds).toContain(parentA.userId);
    expect(rows.every((n) => n.title === 'Homework due tomorrow')).toBe(true);
    // idempotent: a second run (and the registered job) sends nothing for it
    expect(await sendDueTomorrowReminders(s.tenant, s.db, { ignoreHour: true })).toBe(0);
    const job = jobs.find((j) => j.name === 'homework.dueTomorrow')!;
    expect(await runJobOnce(s.tenant, job)).toBe(true);
    expect(await notificationsFor('homework.reminder', 'homeworkId', hw.id)).toHaveLength(rows.length);
    // moving the deadline re-arms the reminder
    await s.req('PATCH', `/homework/${hw.id}`, t, { dueAt: futureAt(1, 14) });
    expect(await sendDueTomorrowReminders(s.tenant, s.db, { ignoreHour: true })).toBeGreaterThan(0);
  });
});

describe('submissions', () => {
  it('walks the submit -> review -> locked -> return -> resubmit state machine', async () => {
    const t = T(classTeacherA);
    const hw = await newHomework(t, { title: 'State machine', maxMarks: 10 });
    const st = T(stuA.username);

    expect((await s.req('POST', `/homework/${hw.id}/submit`, st, {})).body.code).toBe('EMPTY_SUBMISSION');
    const first = await s.req('POST', `/homework/${hw.id}/submit`, st, { text: 'first try' });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body).toMatchObject({ status: 'submitted', isLate: false, studentId: stuA.id, text: 'first try' });
    const second = await s.req('POST', `/homework/${hw.id}/submit`, st, { text: 'second try' });
    expect(second.body).toMatchObject({ id: first.body.id, text: 'second try', status: 'submitted' });

    // who may submit
    expect((await s.req('POST', `/homework/${hw.id}/submit`, T(parentA.username), { text: 'x' })).status).toBe(403);
    expect((await s.req('POST', `/homework/${hw.id}/submit`, t, { text: 'x' })).status).toBe(403);
    expect((await s.req('POST', `/homework/${hw.id}/submit`, T(stuB.username), { text: 'x' })).status).toBe(404); // other section

    // review rules
    const subId = first.body.id as string;
    expect((await s.req('POST', `/submissions/${subId}/review`, st, { marks: 10 })).status).toBe(403); // students hold submissions:edit at own scope only
    expect((await s.req('POST', `/submissions/${subId}/review`, t, {})).body.code).toBe('EMPTY_REVIEW');
    expect((await s.req('POST', `/submissions/${subId}/review`, t, { marks: 11 })).body.code).toBe('MARKS_EXCEED_MAX');
    expect((await s.req('POST', `/submissions/${subId}/review`, T('t_none'), { marks: 5 })).status).toBe(404); // no classes at all
    const otherSubjectTeacher = s.ctx.assignments.find((a) => a.sectionId === secA.id && a.staffId !== secA.classTeacherId)!.staffId;
    expect((await s.req('POST', `/submissions/${subId}/review`, await s.login(teacherUsername(otherSubjectTeacher)), { marks: 5 })).status).toBe(404); // teaches another subject in A
    const reviewed = await s.req('POST', `/submissions/${subId}/review`, t, { marks: 8.5, feedback: 'Good work' });
    expect(reviewed.status, JSON.stringify(reviewed.body)).toBe(200);
    expect(reviewed.body).toMatchObject({ status: 'reviewed', marks: 8.5, feedback: 'Good work' });
    const note = await notificationsFor('homework.reviewed', 'homeworkId', hw.id);
    expect(note.map((n) => n.userId)).toEqual([s.ctx.students.find((x) => x.id === stuA.id)!.userId]);

    // locked after review
    const locked = await s.req('POST', `/homework/${hw.id}/submit`, st, { text: 'too late to edit' });
    expect([locked.status, locked.body.code]).toEqual([409, 'SUBMISSION_LOCKED']);

    // parent: read-only view of the child's status and feedback; another family sees nothing
    const parentView = await s.req('GET', `/homework/${hw.id}/submission?studentId=${stuA.id}`, T(parentA.username));
    expect(parentView.body).toMatchObject({ status: 'reviewed', marks: 8.5, feedback: 'Good work' });
    expect((await s.req('GET', `/homework/${hw.id}/submission?studentId=${stuA.id}`, T(parentB.username))).status).toBe(404);
    expect((await s.req('GET', `/submissions/${subId}`, T(parentB.username))).status).toBe(404);
    expect((await s.req('GET', `/submissions/${subId}`, T(stuA2.username))).status).toBe(404);
    expect((await s.req('GET', `/submissions/${subId}`, T('9099999999'))).status).toBe(404);
    expect((await s.req('GET', `/submissions/${subId}`, T(parentA.username))).status).toBe(200);
    expect((await s.req('GET', `/homework/${hw.id}/submission`, T(stuA2.username))).body.code).toBe('NOT_SUBMITTED');
    const mine = await s.req('GET', `/submissions?homeworkId=${hw.id}`, st);
    expect(mine.body.data).toHaveLength(1);
    expect((await s.req('GET', `/submissions?homeworkId=${hw.id}`, T(stuA2.username))).body.data).toHaveLength(0);

    // return for rework -> student resubmits
    expect((await s.req('POST', `/submissions/${subId}/return`, t, {})).status).toBe(422); // feedback required
    const returned = await s.req('POST', `/submissions/${subId}/return`, t, { feedback: 'Please add the diagram' });
    expect(returned.body).toMatchObject({ status: 'returned', marks: null, feedback: 'Please add the diagram' });
    expect((await s.req('POST', `/submissions/${subId}/return`, t, { feedback: 'again' })).body.code).toBe('INVALID_STATE');
    expect((await s.req('POST', `/submissions/${subId}/review`, t, { marks: 5 })).body.code).toBe('INVALID_STATE'); // waiting for the student
    const feed = await s.req('GET', '/tasks/feed', st);
    expect(feed.body.data.find((x: any) => x.id === hw.id)).toMatchObject({ kind: 'homework', status: 'returned' });
    const redo = await s.req('POST', `/homework/${hw.id}/submit`, st, { text: 'with diagram' });
    expect(redo.body).toMatchObject({ id: subId, status: 'submitted', marks: null, reviewedAt: null });

    const roster = await s.req('GET', `/homework/${hw.id}/roster`, t);
    expect(roster.body.data.find((r: any) => r.studentId === stuA.id).status).toBe('submitted');
    expect(roster.body.homework.stats).toMatchObject({ submitted: 1, missing: roster.body.data.length - 1 });

    // audit trail
    const logs = await s.db.select().from(auditLogs).where(and(eq(auditLogs.entity, 'homework_submission'), eq(auditLogs.entityId, subId)));
    expect(logs.map((l) => l.action).sort()).toEqual(['submission.return', 'submission.review']);
    const rev = logs.find((l) => l.action === 'submission.review')!;
    expect((rev.before as any).status).toBe('submitted');
    expect((rev.after as any)).toMatchObject({ status: 'reviewed', marks: 8.5 });
    expect(await notificationsFor('homework.reviewed', 'homeworkId', hw.id)).toHaveLength(2); // reviewed + returned
  });

  it('marks work submitted after the due time as late', async () => {
    const [row] = await s.db
      .insert(homework)
      .values({ sectionId: secA.id, subjectId: subj0, staffId: secA.classTeacherId, title: 'Overdue one', dueAt: new Date(Date.now() - 3_600_000), status: 'published', allowSubmission: true })
      .returning({ id: homework.id });
    const r = await s.req('POST', `/homework/${row!.id}/submit`, T(stuA.username), { text: 'sorry, late' });
    expect(r.body).toMatchObject({ status: 'late', isLate: true });
    const h = await s.req('GET', `/homework/${row!.id}`, T(stuA.username));
    expect(h.body.learner.status).toBe('late');
    const roster = await s.req('GET', `/homework/${row!.id}/roster`, T(classTeacherA));
    expect(roster.body.data.find((x: any) => x.studentId === stuA.id).status).toBe('late');
    const other = await s.req('GET', `/homework/${row!.id}`, T(stuA2.username));
    expect(other.body.learner.status).toBe('overdue');
  });
});

describe('materials', () => {
  it('publishes link materials per section / grade and hides them from other sections', async () => {
    const t = T(classTeacherA);
    const sectionMat = await s.req('POST', '/materials', t, { title: 'Section only notes', subjectId: subj0, sectionId: secA.id, url: 'https://example.com/notes' });
    expect(sectionMat.status, JSON.stringify(sectionMat.body)).toBe(201);
    expect(sectionMat.body).toMatchObject({ sectionId: secA.id, gradeId: secA.gradeId, createdByName: expect.any(String) });
    const gradeMat = await s.req('POST', '/materials', t, { title: 'Grade wide notes', subjectId: subj0, gradeId: secA.gradeId, url: 'https://example.com/grade' });
    expect(gradeMat.status, JSON.stringify(gradeMat.body)).toBe(201);
    expect(gradeMat.body.sectionId).toBeNull();

    const titlesFor = async (token: string, qs = '') => (await s.req('GET', `/materials?pageSize=100${qs}`, token)).body.data.map((m: any) => m.title);
    expect(await titlesFor(T(stuA.username))).toEqual(expect.arrayContaining(['Section only notes', 'Grade wide notes']));
    expect(await titlesFor(T(stuB.username))).not.toContain('Section only notes'); // other grade & section
    expect(await titlesFor(T(stuB.username))).not.toContain('Grade wide notes');
    expect(await titlesFor(T(parentA.username))).toContain('Section only notes');
    expect(await titlesFor(T(parentB.username))).not.toContain('Section only notes');
    expect(await titlesFor(T('9099999999'))).toHaveLength(0);
    expect((await s.req('GET', `/materials/${sectionMat.body.id}`, T(stuB.username))).status).toBe(404);
    expect((await s.req('GET', `/materials/${sectionMat.body.id}`, T(stuA.username))).status).toBe(200);

    // rules
    const notTeaching = s.ctx.assignments.find((a) => a.sectionId === secA.id && a.staffId !== secA.classTeacherId)!;
    const outsider = await s.login(teacherUsername(notTeaching.staffId));
    const wrongSubject = await s.req('POST', '/materials', outsider, { title: 'x', subjectId: subj0, sectionId: secA.id, url: 'https://example.com/x' });
    expect([wrongSubject.status, wrongSubject.body.code]).toEqual([403, 'NOT_TEACHING_SUBJECT']);
    expect((await s.req('POST', '/materials', T(stuA.username), { title: 'x', subjectId: subj0, sectionId: secA.id, url: 'https://example.com/x' })).status).toBe(403);
    expect((await s.req('POST', '/materials', t, { title: 'x', subjectId: subj0, sectionId: secA.id })).status).toBe(422); // neither file nor link
    expect((await s.req('POST', '/materials', t, { title: 'x', subjectId: subj0, url: 'https://example.com/x' })).status).toBe(422); // no target
    expect((await s.req('POST', '/materials', t, { title: 'x', subjectId: subj0, sectionId: secA.id, url: 'not a url' })).status).toBe(422);
    const noFile = await s.req('POST', '/materials', t, { title: 'x', subjectId: subj0, sectionId: secA.id, fileId: '0194c0de-0000-7000-8000-000000000000' });
    expect([noFile.status, noFile.body.code]).toEqual([422, 'ATTACHMENT_NOT_FOUND']);
    expect((await s.req('PATCH', `/materials/${sectionMat.body.id}`, outsider, { title: 'hijack' })).status).toBe(404);

    // archive hides it from learners, keeps it for staff
    expect((await s.req('PATCH', `/materials/${sectionMat.body.id}`, t, { title: 'Section notes v2' })).body.title).toBe('Section notes v2');
    expect((await s.req('DELETE', `/materials/${sectionMat.body.id}`, t)).status).toBe(200);
    expect(await titlesFor(T(stuA.username))).not.toContain('Section notes v2');
    expect((await s.req('GET', `/materials/${sectionMat.body.id}`, T(stuA.username))).status).toBe(404);
    expect(await titlesFor(t, '&archived=true')).toContain('Section notes v2');
    expect(await titlesFor(t)).not.toContain('Section notes v2');
    const logs = (await s.db.select({ action: auditLogs.action }).from(auditLogs).where(eq(auditLogs.entityId, sectionMat.body.id))).map((x) => x.action);
    expect(logs).toEqual(expect.arrayContaining(['material.create', 'material.update', 'material.archive']));
  });
});

describe('syllabus', () => {
  it('lets management and the subject teacher author topics and track progress per section', async () => {
    const created = await s.req('POST', '/syllabus/topics', T('office'), { gradeId: secA.gradeId, subjectId: subj0, title: 'Brand new topic' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.ordinal).toBeGreaterThan(0);
    const t = T(classTeacherA);
    const byTeacher = await s.req('POST', '/syllabus/topics', t, { gradeId: secA.gradeId, subjectId: subj0, title: 'Teacher topic', plannedHours: 4 });
    expect(byTeacher.status).toBe(201);
    // a teacher with no classes cannot author topics at all
    const none = await s.req('POST', '/syllabus/topics', T('t_none'), { gradeId: secA.gradeId, subjectId: subj0, title: 'Not mine' });
    expect([none.status, none.body.code]).toEqual([403, 'NOT_TEACHING_SUBJECT']);
    expect((await s.req('POST', '/syllabus/topics', T(stuA.username), { gradeId: secA.gradeId, subjectId: subj0, title: 'x' })).status).toBe(403);
    expect((await s.req('POST', '/syllabus/topics', T('office'), { gradeId: secA.gradeId, subjectId: (await s.db.insert(subjects).values({ code: 'ZZZ', name: 'Zed' }).returning())[0]!.id, title: 'x' })).body.code).toBe('SUBJECT_NOT_OFFERED');

    const topicId = created.body.id as string;
    const set = await s.req('PUT', `/syllabus/topics/${topicId}/progress`, t, { sectionId: secA.id, status: 'completed' });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    expect(set.body.data[0]).toMatchObject({ topicId, sectionId: secA.id, status: 'completed' });
    expect(set.body.data[0].completedAt).toBeTruthy();
    // wrong section grade -> 422; student cannot write; a teacher of another subject cannot mark this one
    expect((await s.req('PUT', `/syllabus/topics/${topicId}/progress`, t, { sectionId: secB.id, status: 'completed' })).body.code).toBe('TOPIC_NOT_FOR_SECTION');
    expect((await s.req('PUT', `/syllabus/topics/${topicId}/progress`, T(stuA.username), { sectionId: secA.id, status: 'completed' })).status).toBe(403);
    const otherTeacherId = s.ctx.assignments.find((a) => a.sectionId === secA.id && a.staffId !== secA.classTeacherId)!.staffId;
    const other = await s.req('PUT', `/syllabus/topics/${topicId}/progress`, await s.login(teacherUsername(otherTeacherId)), { sectionId: secA.id, status: 'in_progress' });
    expect([other.status, other.body.code]).toEqual([403, 'NOT_TEACHING_SUBJECT']);
    const bulk = await s.req('PUT', '/syllabus/progress', t, { sectionId: secA.id, items: [{ topicId, status: 'in_progress' }, { topicId: byTeacher.body.id, status: 'completed' }] });
    expect(bulk.body.data).toHaveLength(2);

    // learners read topics with their section's progress; coverage % is computed in SQL
    const topics = await s.req('GET', `/syllabus/topics?subjectId=${subj0}`, T(stuA.username));
    expect(topics.body.data.every((x: any) => x.gradeId === secA.gradeId && x.progress?.sectionId === secA.id)).toBe(true);
    expect(topics.body.data.find((x: any) => x.id === topicId).progress.status).toBe('in_progress');
    expect((await s.req('GET', `/syllabus/topics?sectionId=${secB.id}`, T(stuA.username))).body.data.every((x: any) => x.gradeId === secA.gradeId)).toBe(true); // learner can't peek at B
    expect((await s.req('GET', '/syllabus/topics', T('9099999999'))).body.data).toHaveLength(0);

    const cov = await s.req('GET', `/syllabus/coverage?sectionId=${secA.id}&subjectId=${subj0}`, T('principal'));
    expect(cov.body.data).toHaveLength(1);
    const c = cov.body.data[0];
    expect(c.totalTopics).toBeGreaterThan(8);
    expect(c.completed + c.inProgress + c.notStarted).toBe(c.totalTopics);
    expect(c.percent).toBeCloseTo(Math.round((c.completed / c.totalTopics) * 1000) / 10, 1);
    const asStudent = await s.req('GET', '/syllabus/coverage', T(stuA.username));
    expect(new Set(asStudent.body.data.map((x: any) => x.sectionId))).toEqual(new Set([secA.id]));
    expect((await s.req('GET', `/syllabus/coverage?sectionId=${secB.id}`, T(stuA.username))).body.data.every((x: any) => x.sectionId === secA.id)).toBe(true);
    expect((await s.req('GET', '/syllabus/coverage', T('9099999999'))).body.data).toHaveLength(0);
    const school = await s.req('GET', '/syllabus/coverage', T('principal'));
    expect(new Set(school.body.data.map((x: any) => x.sectionId)).size).toBe(s.ctx.sections.length);

    const logs = (await s.db.select({ action: auditLogs.action }).from(auditLogs).where(sql`${auditLogs.action} like 'syllabus.%'`)).map((x) => x.action);
    expect(logs).toEqual(expect.arrayContaining(['syllabus.topic.create', 'syllabus.progress']));
    expect((await s.req('DELETE', `/syllabus/topics/${byTeacher.body.id}`, t)).status).toBe(200);
  });
});

describe('student tasks', () => {
  it('is strictly personal: CRUD, validation, feed and cross-student isolation', async () => {
    const st = T(stuA.username);
    const created = await s.req('POST', '/tasks', st, { title: 'Pack the bag', priority: 'high', dueAt: futureAt(1, 9), remindAt: futureAt(1, 7) });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body).toMatchObject({ title: 'Pack the bag', priority: 'high', status: 'todo' });
    const undated = await s.req('POST', '/tasks', st, { title: 'Someday' });
    expect(undated.body.dueAt).toBeNull();
    expect((await s.req('POST', '/tasks', st, { title: '' })).status).toBe(422);
    expect((await s.req('POST', '/tasks', st, { title: 'x', priority: 'urgent' })).status).toBe(422);
    expect((await s.req('POST', '/tasks', st, { title: 'x', remindAt: futureAt(-2) })).body.code).toBe('REMIND_IN_PAST');

    // others cannot see or touch it
    const id = created.body.id as string;
    for (const other of [T(stuA2.username), T(parentA.username)]) {
      expect([200, 403]).toContain((await s.req('GET', '/tasks', other)).status);
      expect((await s.req('GET', `/tasks/${id}`, other)).status).toBe(other === T(parentA.username) ? 403 : 404);
      expect((await s.req('PATCH', `/tasks/${id}`, other, { status: 'done' })).status).toBe(other === T(parentA.username) ? 403 : 404);
      expect((await s.req('DELETE', `/tasks/${id}`, other)).status).toBe(other === T(parentA.username) ? 403 : 404);
    }
    expect((await s.req('GET', '/tasks', T(stuA2.username))).body.data.map((x: any) => x.id)).not.toContain(id);
    // staff accounts have no task list
    const teacher = await s.req('POST', '/tasks', T(classTeacherA), { title: 'nope' });
    expect(teacher.status).toBe(403); // staff hold no tasks:* permission, so the route guard refuses (the service also enforces students-only)
    expect((await s.req('GET', '/tasks', T(classTeacherA))).status).toBe(403);
    expect((await s.req('GET', '/tasks/feed', T(classTeacherA))).status).toBe(403);

    // edit + status
    const done = await s.req('PATCH', `/tasks/${id}`, st, { status: 'done' });
    expect(done.body.status).toBe('done');
    expect(done.body.completedAt).toBeTruthy();
    const reopened = await s.req('PATCH', `/tasks/${id}`, st, { status: 'doing' });
    expect(reopened.body).toMatchObject({ status: 'doing', completedAt: null });
    expect((await s.req('GET', `/tasks?status=doing`, st)).body.data.map((x: any) => x.id)).toContain(id);

    // feed: personal tasks + pending/overdue homework, one list sorted by due date, undated last
    const hw = await newHomework(T(classTeacherA), { title: 'Feed homework', dueAt: futureAt(2, 10) });
    const feed = await s.req('GET', '/tasks/feed?limit=100', st);
    expect(feed.status).toBe(200);
    const kinds = new Set(feed.body.data.map((x: any) => x.kind));
    expect(kinds).toEqual(new Set(['task', 'homework']));
    const fh = feed.body.data.find((x: any) => x.id === hw.id);
    expect(fh).toMatchObject({ kind: 'homework', status: 'pending', overdue: false, route: `/homework/${hw.id}`, subtitle: expect.any(String) });
    const dated = feed.body.data.filter((x: any) => x.dueAt);
    expect(dated.map((x: any) => x.dueAt)).toEqual([...dated.map((x: any) => x.dueAt)].sort());
    const firstUndated = feed.body.data.findIndex((x: any) => !x.dueAt);
    if (firstUndated >= 0) expect(feed.body.data.slice(firstUndated).every((x: any) => !x.dueAt)).toBe(true);
    expect(feed.body.data.some((x: any) => x.kind === 'task' && x.status === 'done')).toBe(false);
    // submitting removes the homework from the feed
    await s.req('POST', `/homework/${hw.id}/submit`, st, { text: 'done' });
    expect((await s.req('GET', '/tasks/feed?limit=100', st)).body.data.some((x: any) => x.id === hw.id)).toBe(false);
    // overdue homework shows with the overdue flag
    const overdueItem = (await s.req('GET', '/tasks/feed?limit=100', T(stuA2.username))).body.data.find((x: any) => x.kind === 'homework' && x.overdue);
    if (overdueItem) expect(overdueItem.status).toBe('overdue');
    // other student's feed has no foreign homework
    const bFeed = await s.req('GET', '/tasks/feed?limit=100', T(stuB.username));
    expect(bFeed.body.data.some((x: any) => x.id === hw.id)).toBe(false);

    expect((await s.req('DELETE', `/tasks/${undated.body.id}`, st)).status).toBe(200);
    expect((await s.req('GET', `/tasks/${undated.body.id}`, st)).status).toBe(404);
  });

  it('sends each reminder once and re-arms it when remindAt changes', async () => {
    const st = T(stuA.username);
    const t = await s.req('POST', '/tasks', st, { title: 'Reminder target', remindAt: futureAt(1, 7), dueAt: futureAt(1, 9) });
    const id = t.body.id as string;
    await sendTaskReminders(s.tenant, s.db);
    expect(await notificationsFor('tasks.reminder', 'taskId', id)).toHaveLength(0); // not due yet
    await s.db.update(studentTasks).set({ remindAt: new Date(Date.now() - 60_000) }).where(eq(studentTasks.id, id));
    const n = await sendTaskReminders(s.tenant, s.db);
    expect(n).toBeGreaterThanOrEqual(1);
    const rows = await notificationsFor('tasks.reminder', 'taskId', id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe(s.ctx.students.find((x) => x.id === stuA.id)!.userId);
    expect(await sendTaskReminders(s.tenant, s.db)).toBe(0);
    const job = jobs.find((j) => j.name === 'tasks.reminders')!;
    expect(await runJobOnce(s.tenant, job)).toBe(true);
    expect(await notificationsFor('tasks.reminder', 'taskId', id)).toHaveLength(1);
    // done tasks are not reminded; a new remindAt re-arms it
    await s.req('PATCH', `/tasks/${id}`, st, { remindAt: futureAt(2, 7) });
    await s.db.update(studentTasks).set({ remindAt: new Date(Date.now() - 1000) }).where(eq(studentTasks.id, id));
    await s.req('PATCH', `/tasks/${id}`, st, { status: 'done' });
    await sendTaskReminders(s.tenant, s.db);
    expect(await notificationsFor('tasks.reminder', 'taskId', id)).toHaveLength(1);
  });
});

describe('parents with several children', () => {
  it('asks which child, then serves the chosen child only', async () => {
    // link family B's guardian to student A as well (verified) -> one parent, two children in two sections
    const [g] = await s.db.select().from(guardians).where(eq(guardians.id, parentB.id));
    await s.db.insert(studentGuardians).values({ studentId: stuA.id, guardianId: g!.id, relationship: 'guardian', verifiedAt: new Date() });
    invalidatePrincipal(s.tenant.id);
    const pt = T(parentB.username);
    const ambiguous = await s.req('GET', '/homework', pt);
    expect([ambiguous.status, ambiguous.body.code]).toEqual([422, 'STUDENT_REQUIRED']);
    const forA = await s.req('GET', `/homework?studentId=${stuA.id}`, pt);
    expect(forA.status).toBe(200);
    expect(forA.body.data.every((h: any) => h.sectionId === secA.id && h.learner.studentId === stuA.id)).toBe(true);
    const forB = await s.req('GET', `/homework?studentId=${stuB.id}`, pt);
    expect(forB.body.data.every((h: any) => h.sectionId === secB.id)).toBe(true);
    // a deep link without ?studentId= resolves to the child who sits in that homework's section
    const hwA = forA.body.data[0].id as string;
    const deep = await s.req('GET', `/homework/${hwA}`, pt);
    expect(deep.status).toBe(200);
    expect(deep.body.learner.studentId).toBe(stuA.id);
    expect((await s.req('GET', `/timetable/me?studentId=${stuA.id}`, pt)).body.sectionId).toBe(secA.id);
    expect((await s.req('GET', `/timetable/me`, pt)).status).toBe(422);
  });
});

describe('OpenAPI', () => {
  it('documents the learning routes with schemas', async () => {
    const res = await s.app.inject({ method: 'GET', url: '/api/v1/openapi.json' });
    expect(res.statusCode).toBe(200);
    const doc = res.json();
    const paths = Object.keys(doc.paths);
    for (const p of ['/api/v1/timetable/sections/{id}', '/api/v1/timetable/me', '/api/v1/timetable/today', '/api/v1/homework', '/api/v1/homework/{id}/submit', '/api/v1/submissions/{id}/review', '/api/v1/materials', '/api/v1/syllabus/coverage', '/api/v1/tasks/feed']) expect(paths, p).toContain(p);
    const op = doc.paths['/api/v1/homework'].get;
    expect(op.tags).toContain('Homework');
    expect(op.responses['200']).toBeTruthy();
    expect(doc.paths['/api/v1/tasks/feed'].get.responses['200'].content['application/json'].schema.properties.data).toBeTruthy();
  });
});

describe('read-only school', () => {
  it('rejects every write with 402 once the subscription has lapsed, while reads keep working', async () => {
    await upsertSubscription({ tenantCode: s.tenant.code, academicYear: '2020-21', startsOn: '2020-04-01', endsOn: '2021-03-31', pricePerStudent: 100, licensedStudents: 12, graceDays: 10 });
    await upsertSubscription({ tenantCode: s.tenant.code, academicYear: s.ctx.yearName, startsOn: '2000-01-01', endsOn: '2001-01-01', pricePerStudent: 100, licensedStudents: 12, graceDays: 10 });
    invalidateLicense(s.tenant.id);
    const writes: [string, 'POST' | 'PUT', string, unknown][] = [
      ['t', 'POST', '/homework', { sectionId: secA.id, subjectId: subj0, title: 'x', dueAt: futureAt(2) }],
      ['s', 'POST', '/tasks', { title: 'x' }],
      ['s', 'POST', `/homework/${(await s.db.select({ id: homework.id }).from(homework).limit(1))[0]!.id}/submit`, { text: 'x' }],
      ['o', 'PUT', '/timetable/slots', {}],
      ['t', 'POST', '/materials', { title: 'x', subjectId: subj0, sectionId: secA.id, url: 'https://example.com' }],
    ];
    for (const [who, method, path, body] of writes) {
      const token = who === 't' ? T(classTeacherA) : who === 's' ? T(stuA.username) : T('office');
      const r = await s.req(method, path, token, body);
      expect([r.status, r.body.code], `${method} ${path}`).toEqual([402, 'SUBSCRIPTION_EXPIRED']);
    }
    expect((await s.req('GET', '/homework', T(stuA.username))).status).toBe(200);
    expect((await s.req('GET', '/timetable/me', T(stuA.username))).status).toBe(200);
    expect((await s.req('GET', '/tasks/feed', T(stuA.username))).status).toBe(200);
  });
});
