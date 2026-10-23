import { and, eq, like } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { upsertSubscription } from '../src/core/billing/invoicing';
import { invalidateLicense } from '../src/core/billing/license';
import { auditLogs, enrollments, sections, students, users } from '../src/db/tenant/schema';
import { createTestSchool, type TestSchool } from './helpers';

let s: TestSchool;
let admin: string;
let office: string;
let principal: string;
let teacher1: string; // t001: class teacher of section 0, teaches in both sections
let student0: string;
let parent0: string;
let librarian: string;

const nextYear = () => {
  const start = Number(s.ctx.yearName.slice(0, 4)) + 1;
  return { name: `${start}-${String(start + 1).slice(2)}`, startDate: `${start}-04-01`, endDate: `${start + 1}-03-31` };
};
const audits = async (action: string) => s.db.select().from(auditLogs).where(eq(auditLogs.action, action));
const me = (t: string) => s.req('GET', '/auth/me', t);

beforeAll(async () => {
  s = await createTestSchool();
  [admin, office, principal, teacher1, student0, parent0, librarian] = await Promise.all([
    s.login('admin@test.school'),
    s.login('office'),
    s.login('principal'),
    s.login('t001'),
    s.login(s.ctx.students[0]!.username),
    s.login(s.ctx.guardians[0]!.username),
    s.login('librarian'),
  ]);
});

describe('permission matrix', () => {
  it('requires authentication', async () => {
    expect((await s.req('GET', '/academics/years')).status).toBe(401);
  });

  it('everyone who works with classes can read the structure; a librarian cannot', async () => {
    for (const [who, token] of [['admin', admin], ['office', office], ['principal', principal], ['teacher', teacher1], ['student', student0], ['parent', parent0]] as const) {
      expect((await s.req('GET', '/academics/years', token)).status, who).toBe(200);
      expect((await s.req('GET', '/academics/overview', token)).status, who).toBe(200);
    }
    expect((await s.req('GET', '/academics/years', librarian)).status).toBe(403);
  });

  it('only academics:create/edit/delete holders change the structure', async () => {
    const body = { name: 'Grade 11', ordinal: 11 };
    for (const [who, token] of [['teacher', teacher1], ['student', student0], ['parent', parent0], ['principal', principal]] as const) {
      expect((await s.req('POST', '/academics/grades', token, body)).status, who).toBe(403);
    }
    const ok = await s.req('POST', '/academics/grades', office, body);
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ name: 'Grade 11', ordinal: 11, isActive: true });
    // delete is a separate permission and the grade is unused
    expect((await s.req('DELETE', `/academics/grades/${ok.body.id}`, teacher1)).status).toBe(403);
    expect((await s.req('DELETE', `/academics/grades/${ok.body.id}`, office)).status).toBe(200);
  });

  it('writes are audited', async () => {
    expect((await audits('grade.create')).length).toBeGreaterThan(0);
    expect((await audits('grade.delete')).length).toBeGreaterThan(0);
  });
});

describe('academic years & terms', () => {
  let nextId: string;
  let currentId: string;

  it('lists years with exactly one current', async () => {
    const r = await s.req('GET', '/academics/years', office);
    expect(r.body.data.filter((y: any) => y.isCurrent)).toHaveLength(1);
    currentId = r.body.data.find((y: any) => y.isCurrent).id;
    expect(r.body.data.find((y: any) => y.isCurrent).name).toBe(s.ctx.yearName);
  });

  it('refuses overlapping dates and bad ranges', async () => {
    const cur = (await s.req('GET', `/academics/years/${currentId}`, office)).body;
    const overlap = await s.req('POST', '/academics/years', office, { name: 'Overlap-1', startDate: cur.startDate, endDate: cur.endDate });
    expect(overlap.status).toBe(409);
    expect(overlap.body.code).toBe('YEAR_OVERLAP');
    const backwards = await s.req('POST', '/academics/years', office, { name: 'Backwards', startDate: '2040-04-01', endDate: '2040-03-01' });
    expect(backwards.status).toBe(422);
    const dupe = await s.req('POST', '/academics/years', office, { ...nextYear(), name: cur.name });
    expect(dupe.status).toBe(409);
  });

  it('creates the next year without switching, then switches current and refreshes teachers’ scopes', async () => {
    const created = await s.req('POST', '/academics/years', office, nextYear());
    expect(created.status).toBe(201);
    expect(created.body.isCurrent).toBe(false);
    nextId = created.body.id;

    const before = await me(teacher1);
    expect(before.body.profile.assignedSectionIds.length).toBeGreaterThan(0);

    const switched = await s.req('POST', `/academics/years/${nextId}/set-current`, office);
    expect(switched.status).toBe(200);
    expect(switched.body.isCurrent).toBe(true);
    // the principal cache was invalidated: no waiting for the 15 s TTL
    expect((await me(teacher1)).body.profile.assignedSectionIds).toEqual([]);
    const years = (await s.req('GET', '/academics/years', office)).body.data;
    expect(years.filter((y: any) => y.isCurrent)).toHaveLength(1);
    expect((await s.req('GET', '/academics/sections?mine=true', teacher1)).body.data).toEqual([]);

    // back again
    expect((await s.req('POST', `/academics/years/${currentId}/set-current`, office)).status).toBe(200);
    expect((await me(teacher1)).body.profile.assignedSectionIds.length).toBeGreaterThan(0);
    expect((await audits('academic_year.set_current')).length).toBe(2);
  });

  it('cannot delete the current year; can delete an unused one', async () => {
    const del = await s.req('DELETE', `/academics/years/${currentId}`, admin);
    expect(del.status).toBe(409);
    expect(del.body.code).toBe('YEAR_IS_CURRENT');
    const tmp = await s.req('POST', '/academics/years', office, { name: 'Temp-year', startDate: '2060-04-01', endDate: '2061-03-31' });
    expect((await s.req('DELETE', `/academics/years/${tmp.body.id}`, admin)).status).toBe(200);
  });

  it('manages terms inside the year', async () => {
    const y = nextYear();
    const t1 = await s.req('POST', `/academics/years/${nextId}/terms`, office, { name: 'Term 1', startDate: y.startDate, endDate: `${y.startDate.slice(0, 4)}-09-30` });
    expect(t1.status).toBe(201);
    expect(t1.body.ordinal).toBe(1);
    const t2 = await s.req('POST', `/academics/years/${nextId}/terms`, office, { name: 'Term 2', startDate: `${y.startDate.slice(0, 4)}-10-01`, endDate: y.endDate });
    expect(t2.status).toBe(201);
    expect(t2.body.ordinal).toBe(2);
    const overlap = await s.req('POST', `/academics/years/${nextId}/terms`, office, { name: 'Clash', ordinal: 3, startDate: `${y.startDate.slice(0, 4)}-09-01`, endDate: `${y.startDate.slice(0, 4)}-09-20` });
    expect(overlap.body.code).toBe('TERM_OVERLAP');
    const outside = await s.req('POST', `/academics/years/${nextId}/terms`, office, { name: 'Outside', ordinal: 4, startDate: '2001-01-01', endDate: '2001-02-01' });
    expect(outside.body.code).toBe('TERM_OUT_OF_RANGE');
    expect((await s.req('GET', `/academics/years/${nextId}/terms`, teacher1)).body.data).toHaveLength(2);
    expect((await s.req('PATCH', `/academics/terms/${t2.body.id}`, office, { name: 'Second term' })).body.name).toBe('Second term');
    expect((await s.req('DELETE', `/academics/terms/${t1.body.id}`, office)).status).toBe(200);
  });
});

describe('grades, subjects, offerings, periods', () => {
  it('rejects duplicate grades and subject codes', async () => {
    const g = s.ctx.grades[0]!;
    expect((await s.req('POST', '/academics/grades', office, { name: g.name, ordinal: 20 })).body.code).toBe('GRADE_EXISTS');
    expect((await s.req('POST', '/academics/grades', office, { name: 'Another', ordinal: g.ordinal })).body.code).toBe('GRADE_ORDINAL_EXISTS');
    const sub = s.ctx.subjects[0]!;
    expect((await s.req('POST', '/academics/subjects', office, { code: sub.code.toLowerCase(), name: 'Dupe' })).body.code).toBe('SUBJECT_CODE_EXISTS');
  });

  it('refuses to delete a grade or subject that is in use', async () => {
    expect((await s.req('DELETE', `/academics/grades/${s.ctx.grades[0]!.id}`, office)).body.code).toBe('GRADE_IN_USE');
    expect((await s.req('DELETE', `/academics/subjects/${s.ctx.subjects[0]!.id}`, office)).body.code).toBe('SUBJECT_IN_USE');
  });

  it('sets the subjects a grade offers with periods per week', async () => {
    const g = s.ctx.grades[0]!;
    const art = await s.req('POST', '/academics/subjects', office, { code: 'MUS', name: 'Music', type: 'co_scholastic' });
    expect(art.status).toBe(201);
    const current = (await s.req('GET', `/academics/grades/${g.id}/subjects`, teacher1)).body.data as { subjectId: string; periodsPerWeek: number }[];
    const put = await s.req('PUT', `/academics/grades/${g.id}/subjects`, office, { subjects: [...current.map((c) => ({ subjectId: c.subjectId, periodsPerWeek: c.periodsPerWeek })), { subjectId: art.body.id, periodsPerWeek: 2 }] });
    expect(put.status).toBe(200);
    expect(put.body.data.find((d: any) => d.subjectCode === 'MUS').periodsPerWeek).toBe(2);
    // removing a subject whose teachers are assigned is refused
    const drop = await s.req('PUT', `/academics/grades/${g.id}/subjects`, office, { subjects: [{ subjectId: art.body.id, periodsPerWeek: 2 }] });
    expect(drop.body.code).toBe('OFFERING_IN_USE');
  });

  it('manages the day structure and refuses overlapping periods', async () => {
    const list = (await s.req('GET', '/academics/periods', student0)).body.data;
    expect(list.length).toBeGreaterThan(5);
    const clash = await s.req('POST', '/academics/periods', office, { name: 'Clash', ordinal: 20, startTime: '08:40', endTime: '09:00' });
    expect(clash.body.code).toBe('PERIOD_OVERLAP');
    const added = await s.req('POST', '/academics/periods', office, { name: 'Period 8', ordinal: 21, startTime: '15:00', endTime: '15:45' });
    expect(added.status).toBe(201);
    expect((await s.req('DELETE', `/academics/periods/${added.body.id}`, office)).status).toBe(200);
  });
});

describe('sections, class teachers and scope', () => {
  const sec0 = () => s.ctx.sections[0]!;
  const sec1 = () => s.ctx.sections[1]!;

  it('lists sections by scope: teacher assigned, student own, parent children’s, management all, unverified parent none', async () => {
    const all = (await s.req('GET', '/academics/sections?mine=true', office)).body.data;
    expect(all).toHaveLength(s.ctx.sections.length);
    expect(all[0]).toMatchObject({ gradeName: expect.any(String), studentCount: expect.any(Number) });

    const own = (await s.req('GET', '/academics/sections?mine=true', student0)).body.data;
    expect(own.map((x: any) => x.id)).toEqual([s.ctx.students[0]!.sectionId]);

    const child = s.ctx.students.find((x) => x.id === s.ctx.guardians[0]!.studentIds[0])!;
    const kids = (await s.req('GET', '/academics/sections?mine=true', parent0)).body.data;
    expect(kids.map((x: any) => x.id)).toContain(child.sectionId);
    expect(kids.length).toBeLessThan(all.length + 1);

    const unverified = await s.login('9099999999');
    expect((await s.req('GET', '/academics/sections?mine=true', unverified)).body.data).toEqual([]);
  });

  it('creates a section; a teacher with no assignment there gets 404 (not 403) and an empty list', async () => {
    const created = await s.req('POST', '/academics/sections', office, { gradeId: sec0().gradeId, name: 'C', room: '6C', capacity: 30 });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: 'C', classTeacherId: null, studentCount: 0 });
    const dupe = await s.req('POST', '/academics/sections', office, { gradeId: sec0().gradeId, name: 'c' });
    expect(dupe.body.code).toBe('SECTION_EXISTS');

    const detail404 = await s.req('GET', `/academics/sections/${created.body.id}`, teacher1);
    expect(detail404.status).toBe(404);
    expect((await s.req('GET', `/academics/sections/${created.body.id}`, student0)).status).toBe(404);
    expect((await s.req('GET', `/academics/sections/${created.body.id}`, office)).status).toBe(200);
    expect((await s.req('GET', '/academics/sections?mine=true', teacher1)).body.data.map((x: any) => x.id)).not.toContain(created.body.id);
  });

  it('assigns and unassigns a class teacher, keeping the class_teacher role and token versions in step', async () => {
    const t4 = s.ctx.teachers[3]!;
    const t2 = s.ctx.teachers[1]!;
    const t4Token = await s.login(t4.username);
    const t2Token = await s.login(t2.username);
    expect((await me(t4Token)).body.permissions['leave:approve']).toBeUndefined();
    expect((await me(t2Token)).body.profile.classTeacherSectionIds).toEqual([sec1().id]);

    const r = await s.req('PUT', `/academics/sections/${sec1().id}/class-teacher`, office, { staffId: t4.id });
    expect(r.status).toBe(200);
    expect(r.body.classTeacherId).toBe(t4.id);

    // old tokens are stale for both (their roles changed) …
    const stale = await s.req('GET', '/auth/me', t4Token);
    expect(stale.status).toBe(401);
    expect(stale.body.code).toBe('TOKEN_STALE');
    expect((await s.req('GET', '/auth/me', t2Token)).body.code).toBe('TOKEN_STALE');
    // … and a fresh sign-in shows the new rights
    const fresh4 = await me(await s.login(t4.username));
    expect(fresh4.body.profile.classTeacherSectionIds).toEqual([sec1().id]);
    expect(fresh4.body.permissions['leave:approve']).toBe('assigned');
    const fresh2 = await me(await s.login(t2.username));
    expect(fresh2.body.profile.classTeacherSectionIds).toEqual([]);
    expect(fresh2.body.roles).not.toContain('class_teacher');

    // unassign
    const none = await s.req('PUT', `/academics/sections/${sec1().id}/class-teacher`, office, { staffId: null });
    expect(none.body.classTeacherId).toBeNull();
    expect((await me(await s.login(t4.username))).body.roles).not.toContain('class_teacher');
    // restore t002 so later tests keep the seeded shape
    await s.req('PUT', `/academics/sections/${sec1().id}/class-teacher`, office, { staffId: t2.id });
    expect((await audits('section.class_teacher')).length).toBeGreaterThanOrEqual(3);
  });

  it('teachers cannot change class teachers or sections', async () => {
    expect((await s.req('PUT', `/academics/sections/${sec0().id}/class-teacher`, teacher1, { staffId: null })).status).toBe(403);
    expect((await s.req('PATCH', `/academics/sections/${sec0().id}`, teacher1, { capacity: 99 })).status).toBe(403);
  });

  it('capacity cannot drop below the enrolled count; sections with students cannot be deleted', async () => {
    const low = await s.req('PATCH', `/academics/sections/${sec0().id}`, office, { capacity: 2 });
    expect(low.status).toBe(422);
    expect(low.body.code).toBe('CAPACITY_BELOW_ENROLMENT');
    const del = await s.req('DELETE', `/academics/sections/${sec0().id}`, office);
    expect(del.body.code).toBe('SECTION_HAS_STUDENTS');
  });
});

describe('teaching assignments', () => {
  it('is unique per section + subject, needs the subject to be offered, and refreshes the teacher’s sections at once', async () => {
    const grade = s.ctx.sections[0]!.gradeId;
    const d = await s.req('POST', '/academics/sections', office, { gradeId: grade, name: 'D' });
    const secD = d.body.id as string;
    const subject = s.ctx.subjects[0]!;
    const t3 = s.ctx.teachers[2]!;
    const t3Token = await s.login(t3.username);
    expect((await me(t3Token)).body.profile.assignedSectionIds).not.toContain(secD);

    const created = await s.req('POST', '/academics/teaching-assignments', office, { sectionId: secD, subjectId: subject.id, staffId: t3.id });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ sectionId: secD, subjectCode: subject.code, staffId: t3.id });
    // same token, no waiting: the cached principal was invalidated
    expect((await me(t3Token)).body.profile.assignedSectionIds).toContain(secD);
    expect((await s.req('GET', `/academics/sections/${secD}`, t3Token)).status).toBe(200);

    const dupe = await s.req('POST', '/academics/teaching-assignments', office, { sectionId: secD, subjectId: subject.id, staffId: s.ctx.teachers[0]!.id });
    expect(dupe.status).toBe(409);
    expect(dupe.body.code).toBe('ASSIGNMENT_EXISTS');

    const music = (await s.req('GET', '/academics/subjects', office)).body.data.find((x: any) => x.code === 'MUS');
    const other = await s.req('POST', '/academics/subjects', office, { code: 'DNC', name: 'Dance' });
    const notOffered = await s.req('POST', '/academics/teaching-assignments', office, { sectionId: secD, subjectId: other.body.id, staffId: t3.id });
    expect(notOffered.status).toBe(422);
    expect(notOffered.body.code).toBe('SUBJECT_NOT_OFFERED');
    expect(music).toBeTruthy();

    // changing the teacher refreshes both
    const t1 = s.ctx.teachers[0]!;
    const t1Token = await s.login(t1.username);
    const changed = await s.req('PATCH', `/academics/teaching-assignments/${created.body.id}`, office, { staffId: t1.id });
    expect(changed.body.staffId).toBe(t1.id);
    expect((await me(t3Token)).body.profile.assignedSectionIds).not.toContain(secD);
    expect((await me(t1Token)).body.profile.assignedSectionIds).toContain(secD);

    // lists respect scope: a teacher sees assignments of their own sections only
    const list = await s.req('GET', `/academics/teaching-assignments?sectionId=${secD}`, t3Token);
    expect(list.status).toBe(200);
    expect(list.body.data).toEqual([]);
    expect((await s.req('GET', `/academics/teaching-assignments?sectionId=${secD}`, office)).body.data).toHaveLength(1);

    expect((await s.req('DELETE', `/academics/teaching-assignments/${created.body.id}`, teacher1)).status).toBe(403);
    expect((await s.req('DELETE', `/academics/teaching-assignments/${created.body.id}`, office)).status).toBe(200);
    expect((await me(t1Token)).body.profile.assignedSectionIds).not.toContain(secD);
    expect((await audits('teaching_assignment.create')).length).toBe(1);
  });

  it('replaces a section’s whole grid in one call', async () => {
    const grade = s.ctx.sections[0]!.gradeId;
    const e = await s.req('POST', '/academics/sections', office, { gradeId: grade, name: 'E' });
    const [a, b] = s.ctx.subjects as [(typeof s.ctx.subjects)[number], (typeof s.ctx.subjects)[number]];
    const put = await s.req('PUT', `/academics/sections/${e.body.id}/teaching-assignments`, office, { assignments: [{ subjectId: a.id, staffId: s.ctx.teachers[0]!.id }, { subjectId: b.id, staffId: s.ctx.teachers[1]!.id }] });
    expect(put.status).toBe(200);
    expect(put.body.data).toHaveLength(2);
    const shrink = await s.req('PUT', `/academics/sections/${e.body.id}/teaching-assignments`, office, { assignments: [{ subjectId: a.id, staffId: s.ctx.teachers[2]!.id }] });
    expect(shrink.body.data).toHaveLength(1);
    expect(shrink.body.data[0].staffId).toBe(s.ctx.teachers[2]!.id);
    const detail = await s.req('GET', `/academics/sections/${e.body.id}`, office);
    expect(detail.body.teachingAssignments).toHaveLength(1);
  });

  it('overview counts match', async () => {
    const o = (await s.req('GET', '/academics/overview', office)).body;
    expect(o.currentYear.name).toBe(s.ctx.yearName);
    expect(o.counts.students).toBe(s.ctx.students.length);
    expect(o.counts.staff).toBeGreaterThan(0);
    // a student only counts what they may see; no staff headcount
    const mine = (await s.req('GET', '/academics/overview', student0)).body;
    expect(mine.counts.students).toBe(1);
    expect(mine.counts.staff).toBeNull();
  });
});

describe('year-end promotion', () => {
  let toYearId: string;
  let toYearName: string;
  const g6 = () => s.ctx.grades.find((g) => g.ordinal === 6)!;
  const g7 = () => s.ctx.grades.find((g) => g.ordinal === 7)!;
  let body: any;
  let retained: string;
  let leaver: string;

  beforeAll(async () => {
    // drop the helper sections created above that have no students, so counts below are about the seeded ones
    const extra = await s.db.select({ id: sections.id }).from(sections);
    const keep = new Set(s.ctx.sections.map((x) => x.id));
    for (const x of extra.filter((e) => !keep.has(e.id))) await s.req('DELETE', `/academics/sections/${x.id}`, admin).catch(() => undefined);

    const y = nextYear();
    const years = (await s.req('GET', '/academics/years', admin)).body.data;
    const existing = years.find((x: any) => x.name === y.name);
    toYearId = existing.id;
    toYearName = y.name;
    const copy = await s.req('POST', `/academics/years/${toYearId}/copy-sections`, office, { fromYearId: s.ctx.yearId, copyClassTeachers: true });
    expect(copy.status).toBe(200);
    expect(copy.body.created).toBe(s.ctx.sections.length);
    // copying again creates nothing
    expect((await s.req('POST', `/academics/years/${toYearId}/copy-sections`, office, { fromYearId: s.ctx.yearId })).body).toMatchObject({ created: 0, skipped: s.ctx.sections.length });

    const grade6Students = s.ctx.students.filter((x) => x.gradeId === g6().id);
    retained = grade6Students[0]!.id;
    leaver = grade6Students[1]!.id;
    body = { fromYearId: s.ctx.yearId, toYearId, decisions: [{ studentId: retained, decision: 'retain' }, { studentId: leaver, decision: 'leave' }] };
  });

  it('previews counts without changing anything', async () => {
    const r = await s.req('POST', '/promotions/preview', office, body);
    expect(r.status).toBe(200);
    const g6Count = s.ctx.students.filter((x) => x.gradeId === g6().id).length;
    const g7Count = s.ctx.students.filter((x) => x.gradeId === g7().id).length;
    expect(r.body.totals).toMatchObject({ eligible: s.ctx.students.length, retain: 1, leave: 1, promote: g6Count - 2, graduate: g7Count, newSeats: g6Count - 1, alreadyEnrolled: 0 });
    expect(r.body.problems).toEqual([]);
    expect(r.body.canApply).toBe(true);
    expect(r.body.byGrade.find((x: any) => x.fromGradeId === g6().id).toGradeId).toBe(g7().id);
    expect(r.body.byGrade.find((x: any) => x.fromGradeId === g7().id).toGradeId).toBeNull();
    const rows = await s.db.select().from(enrollments).where(eq(enrollments.academicYearId, toYearId));
    expect(rows).toHaveLength(0);
  });

  it('permission matrix: the office previews but only the principal (promotions:approve) applies', async () => {
    expect((await s.req('POST', '/promotions/preview', teacher1, body)).status).toBe(403);
    expect((await s.req('POST', '/promotions/preview', student0, body)).status).toBe(403);
    expect((await s.req('POST', '/promotions/apply', office, body)).status).toBe(403);
    expect((await s.req('POST', '/promotions/apply', teacher1, body)).status).toBe(403);
  });

  it('reports a problem when the next grade has no sections in the new year, and refuses to apply', async () => {
    const lonely = await s.req('POST', '/academics/years', office, { name: '2090-91', startDate: '2090-04-01', endDate: '2091-03-31' });
    const r = await s.req('POST', '/promotions/preview', office, { fromYearId: s.ctx.yearId, toYearId: lonely.body.id });
    expect(r.body.canApply).toBe(false);
    expect(r.body.problems.some((p: any) => p.code === 'NO_TARGET_SECTION')).toBe(true);
    const apply = await s.req('POST', '/promotions/apply', principal, { fromYearId: s.ctx.yearId, toYearId: lonely.body.id });
    expect(apply.status).toBe(422);
    expect(apply.body.code).toBe('PROMOTION_HAS_PROBLEMS');
    const backwards = await s.req('POST', '/promotions/preview', office, { fromYearId: toYearId, toYearId: s.ctx.yearId });
    expect(backwards.body.code).toBe('INVALID_YEAR_ORDER');
    await s.req('DELETE', `/academics/years/${lonely.body.id}`, admin);
  });

  it('block policy: the new seats are checked before anything moves (402)', async () => {
    await upsertSubscription({ tenantCode: s.tenant.code, academicYear: toYearName, startsOn: '2000-01-01', endsOn: '2999-12-31', pricePerStudent: 100, licensedStudents: 2, overagePolicy: 'block' });
    invalidateLicense(s.tenant.id);
    const preview = await s.req('POST', '/promotions/preview', office, body);
    expect(preview.body.seat).toMatchObject({ ok: false, code: 'LICENSE_LIMIT_REACHED' });
    expect(preview.body.canApply).toBe(false);
    const blocked = await s.req('POST', '/promotions/apply', principal, body);
    expect(blocked.status).toBe(402);
    expect(blocked.body.code).toBe('LICENSE_LIMIT_REACHED');
    // nothing moved
    expect(await s.db.select().from(enrollments).where(eq(enrollments.academicYearId, toYearId))).toHaveLength(0);
    const [stu] = await s.db.select().from(students).where(eq(students.id, retained));
    expect(stu!.status).toBe('active');
    // enough seats now
    const needed = preview.body.totals.newSeats as number;
    await upsertSubscription({ tenantCode: s.tenant.code, academicYear: toYearName, startsOn: '2000-01-01', endsOn: '2999-12-31', pricePerStudent: 100, licensedStudents: needed, overagePolicy: 'block' });
    invalidateLicense(s.tenant.id);
  });

  it('applies: new enrollments, old ones closed with history, last grade becomes alumni, leavers withdrawn', async () => {
    const g7Student = s.ctx.students.find((x) => x.gradeId === g7().id)!;
    const g7Token = await s.login(g7Student.username);
    const promoted = s.ctx.students.find((x) => x.gradeId === g6().id && x.id !== retained && x.id !== leaver)!;

    const r = await s.req('POST', '/promotions/apply', principal, body);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ enrolled: r.body.totals.newSeats, alumni: r.body.totals.graduate, withdrawn: 1 });

    // history preserved: old enrollment row stays with its final status, new row added
    const all = await s.db.select().from(enrollments).where(eq(enrollments.studentId, promoted.id));
    expect(all).toHaveLength(2);
    expect(all.find((e) => e.academicYearId === s.ctx.yearId)!.status).toBe('promoted');
    const next = all.find((e) => e.academicYearId === toYearId)!;
    expect(next).toMatchObject({ status: 'enrolled', gradeId: g7().id });

    const [p] = await s.db.select().from(students).where(eq(students.id, promoted.id));
    expect(p).toMatchObject({ currentGradeId: g7().id, currentSectionId: next.sectionId, status: 'active' });

    const [kept] = await s.db.select().from(enrollments).where(and(eq(enrollments.studentId, retained), eq(enrollments.academicYearId, toYearId)));
    expect(kept!.gradeId).toBe(g6().id);
    expect((await s.db.select().from(enrollments).where(and(eq(enrollments.studentId, retained), eq(enrollments.academicYearId, s.ctx.yearId))))[0]!.status).toBe('retained');

    const [gone] = await s.db.select().from(students).where(eq(students.id, leaver));
    expect(gone!.status).toBe('withdrawn');
    expect(gone!.archivedAt).not.toBeNull();
    expect(await s.db.select().from(enrollments).where(and(eq(enrollments.studentId, leaver), eq(enrollments.academicYearId, toYearId)))).toHaveLength(0);

    const [alum] = await s.db.select().from(students).where(eq(students.id, g7Student.id));
    expect(alum).toMatchObject({ status: 'alumni', currentSectionId: null });
    // the graduate's login is off and the old session no longer works
    const [alumUser] = await s.db.select().from(users).where(eq(users.id, g7Student.userId));
    expect(alumUser!.status).toBe('deactivated');
    expect((await s.req('GET', '/auth/me', g7Token)).status).toBe(401);
    expect((await s.req('POST', '/auth/login', null, { identifier: g7Student.username, password: 'Demo@12345' })).status).toBe(403);

    expect((await audits('promotion.apply')).length).toBe(1);
  });

  it('is idempotent: applying again finds nothing left to move', async () => {
    const again = await s.req('POST', '/promotions/apply', principal, body);
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('NOTHING_TO_PROMOTE');
    const preview = await s.req('POST', '/promotions/preview', office, body);
    expect(preview.body.totals.eligible).toBe(0);
    expect(preview.body.canApply).toBe(false);
  });

  it('parents of graduated students lose them from their linked children', async () => {
    const g7Student = s.ctx.students.find((x) => x.gradeId === g7().id)!;
    const guardian = s.ctx.guardians.find((g) => g.id === g7Student.guardianId)!;
    const token = await s.login(guardian.username);
    const kids = (await me(token)).body.profile.children.map((c: any) => c.studentId);
    expect(kids).not.toContain(g7Student.id);
    expect((await s.db.select().from(auditLogs).where(like(auditLogs.action, 'promotion.%'))).length).toBe(1);
  });
});
