import { and, desc, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { upsertSubscription } from '../src/core/billing/invoicing';
import { addDaysIso, todayIn } from '../src/core/http';
import { invalidateLicense } from '../src/core/billing/license';
import { putSetting } from '../src/core/settings';
import { auditLogs, notifications, reportRemarks } from '../src/db/tenant/schema';
import { createTestSchool, type TestSchool } from './helpers';

let s: TestSchool;
const tok: Record<string, string> = {};
/** dates relative to today so the suite never rots */
const D = (n: number) => addDaysIso(todayIn('Asia/Kolkata'), n);

// ── fixtures derived from the deterministic small seed ──────────────────────────────────────
// sections[0] = Grade 6 A (class teacher t001), sections[1] = Grade 7 A (class teacher t002)
// t001 teaches ENG in sec0 and MAT in sec1; t002 teaches MAT in sec0 and SCI in sec1.
const subj = (code: string) => s.ctx.subjects.find((x) => x.code === code)!;
const sec = (i: number) => s.ctx.sections[i]!;
const studentsOf = (i: number) => s.ctx.students.filter((x) => x.sectionId === sec(i).id);
const guardianOf = (studentId: string) => s.ctx.guardians.find((g) => g.studentIds.includes(studentId))!;
const teacherOf = (i: number, code: string) => {
  const a = s.ctx.assignments.find((x) => x.sectionId === sec(i).id && x.subjectId === subj(code).id)!;
  return s.ctx.teachers.find((t) => t.id === a.staffId)!;
};

let examId = '';
const sheetId: Record<string, string> = {}; // `${secIndex}:${code}`

async function sheetsOf(token: string | undefined, q = '') {
  const r = await s.req('GET', `/marks/sheets?examId=${examId}&pageSize=100${q}`, token);
  expect(r.status).toBe(200);
  return r.body.data as any[];
}
/** marks 40..95, deterministic per student; roll 6 fails (marks 20) */
const marksFor = (i: number, seed = 0) => (i === 5 ? 20 : 40 + ((i * 13 + seed) % 56));
async function fill(token: string | undefined, id: string, seed = 0) {
  const d = await s.req('GET', `/marks/sheets/${id}`, token);
  if (d.status !== 200) return d; // cannot even see the sheet
  const entries = d.body.entries.map((e: any, i: number) => (i === 4 ? { studentId: e.studentId, isAbsent: false, marksObtained: marksFor(i, seed), remarks: 'Good effort' } : { studentId: e.studentId, isAbsent: false, marksObtained: marksFor(i, seed) }));
  return s.req('PUT', `/marks/sheets/${id}/entries`, token, { entries });
}

beforeAll(async () => {
  s = await createTestSchool();
  for (const u of ['principal', 'office', 'accounts', 't001', 't002', 't003', 't004']) tok[u] = await s.login(u);
  tok.admin = await s.login('admin@test.school');
  tok.student0 = await s.login(studentsOf(0)[0]!.username);
  tok.student1 = await s.login(studentsOf(1)[0]!.username); // other section
  tok.parent0 = await s.login(guardianOf(studentsOf(0)[0]!.id).username);
  tok.parent1 = await s.login(guardianOf(studentsOf(1)[0]!.id).username);
  tok.unverified = await s.login('9099999999');
}, 120_000);

describe('exam setup & schedule', () => {
  it('lets only exam managers create exams (teachers, students, parents, accountant get 403)', async () => {
    const body = { name: 'Mid-term', examType: 'midterm', startDate: D(5), endDate: D(9), passPercent: 35 };
    for (const who of ['t001', 'student0', 'parent0', 'accounts']) expect((await s.req('POST', '/exams', tok[who], body)).status, who).toBe(403);
    expect((await s.req('POST', '/exams', null, body)).status).toBe(401);
    const bad = await s.req('POST', '/exams', tok.principal, { ...body, name: 'x' });
    expect(bad.status).toBe(422);
    const ok = await s.req('POST', '/exams', tok.principal, body);
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ name: 'Mid-term', status: 'draft', passPercent: 35, paperCount: 0 });
    examId = ok.body.id;
    const audit = await s.db.select().from(auditLogs).where(and(eq(auditLogs.action, 'exam.create'), eq(auditLogs.entityId, examId)));
    expect(audit).toHaveLength(1);
  });

  it('hides a draft exam and its schedule from students, parents and teachers', async () => {
    for (const who of ['student0', 'parent0', 't001']) {
      expect((await s.req('GET', `/exams/${examId}`, tok[who])).status, who).toBe(404);
      expect((await s.req('GET', `/exams/${examId}/papers`, tok[who])).status, who).toBe(404);
      const list = await s.req('GET', '/exams', tok[who]);
      expect(list.body.data.map((e: any) => e.id)).not.toContain(examId);
    }
    expect((await s.req('GET', '/exams', tok.principal)).body.data.map((e: any) => e.id)).toContain(examId);
  });

  it('builds the schedule per grade and rejects clashes for the same grade', async () => {
    const g6 = sec(0).gradeId;
    const g7 = sec(1).gradeId;
    const slot = (gradeId: string, code: string, date: string, start: string, end: string) => ({ gradeId, subjectId: subj(code).id, examDate: date, startTime: start, endTime: end, room: 'Hall', maxMarks: 100, passMarks: 35 });
    const bulk = await s.req('POST', `/exams/${examId}/papers/bulk`, tok.office, {
      papers: ['ENG', 'MAT', 'SCI', 'SST'].flatMap((c, i) => [slot(g6, c, D(5 + i), '09:00', '12:00'), slot(g7, c, D(5 + i), '13:00', '16:00')]),
    });
    expect(bulk.status).toBe(200);
    expect(bulk.body.data).toHaveLength(8);
    // same grade, overlapping slot on the same day -> 409 SCHEDULE_CONFLICT
    const clash = await s.req('PATCH', `/exams/${examId}/papers/${bulk.body.data.find((p: any) => p.subjectCode === 'MAT' && p.gradeId === g6).id}`, tok.office, { examDate: D(5), startTime: '11:00', endTime: '12:30' });
    expect(clash.status).toBe(409);
    expect(clash.body.code).toBe('SCHEDULE_CONFLICT');
    // a different grade in the same slot is fine
    expect((await s.req('PATCH', `/exams/${examId}/papers/${bulk.body.data.find((p: any) => p.subjectCode === 'MAT' && p.gradeId === g7).id}`, tok.office, { examDate: D(5), startTime: '13:30', endTime: '14:30' })).status).toBe(409); // ...but not on top of Grade 7 ENG
    // outside the exam dates
    const outside = await s.req('POST', `/exams/${examId}/papers`, tok.office, slot(g6, 'ENG', D(60), '09:00', '10:00'));
    expect([409, 422]).toContain(outside.status);
    // marks cannot exceed paper maximum rules
    expect((await s.req('POST', `/exams/${examId}/papers`, tok.office, { ...slot(g6, 'ENG', D(6), '14:00', '15:00'), passMarks: 120, maxMarks: 100 })).status).toBe(422);
  });

  it('shows the published schedule only for the viewer’s own grade once scheduled', async () => {
    expect((await s.req('POST', `/exams/${examId}/schedule`, tok.t001)).status).toBe(403);
    const sch = await s.req('POST', `/exams/${examId}/schedule`, tok.office);
    expect(sch.status).toBe(200);
    expect(sch.body.status).toBe('scheduled');
    const stu = await s.req('GET', `/exams/${examId}/papers`, tok.student0);
    expect(stu.status).toBe(200);
    expect(stu.body.data).toHaveLength(4);
    expect(new Set(stu.body.data.map((p: any) => p.gradeId))).toEqual(new Set([sec(0).gradeId]));
    const par = await s.req('GET', `/exams/${examId}/papers`, tok.parent1);
    expect(new Set(par.body.data.map((p: any) => p.gradeId))).toEqual(new Set([sec(1).gradeId]));
    const mgr = await s.req('GET', `/exams/${examId}/papers`, tok.principal);
    expect(mgr.body.data).toHaveLength(8);
    expect((await s.req('GET', '/exams?upcoming=true', tok.student0)).body.data.map((e: any) => e.id)).toContain(examId);
    // students never receive sheet-progress figures
    expect((await s.req('GET', `/exams/${examId}`, tok.student0)).body.sheets).toBeNull();
    // a scheduled exam notifies students and verified guardians (not the unverified link)
    const n = await s.db.select().from(notifications).where(eq(notifications.type, 'marks.scheduled'));
    const users = new Set(n.map((x) => x.userId));
    expect(users.has(studentsOf(0)[0]!.userId)).toBe(true);
    expect(users.has(guardianOf(studentsOf(0)[0]!.id).userId)).toBe(true);
    expect(n.every((x) => x.title === 'Exam schedule published')).toBe(true);
  });
});

describe('mark sheet workflow', () => {
  it('generates one sheet per section and subject from the teaching assignments (idempotent)', async () => {
    expect((await s.req('POST', `/exams/${examId}/sheets/generate`, tok.t001, {})).status).toBe(403);
    const g = await s.req('POST', `/exams/${examId}/sheets/generate`, tok.office, {});
    expect(g.status).toBe(200);
    expect(g.body).toMatchObject({ created: 8, existing: 0, skipped: [] });
    const again = await s.req('POST', `/exams/${examId}/sheets/generate`, tok.office, {});
    expect(again.body).toMatchObject({ created: 0, existing: 8 });
    for (const row of await sheetsOf(tok.principal)) sheetId[`${s.ctx.sections.findIndex((x) => x.id === row.sectionId)}:${row.subjectName === 'English' ? 'ENG' : row.subjectName === 'Mathematics' ? 'MAT' : row.subjectName === 'Science' ? 'SCI' : 'SST'}`] = row.id;
    expect(Object.keys(sheetId)).toHaveLength(8);
  });

  it('keeps marks entry closed until the exam is opened for marks', async () => {
    const r = await fill(tok.t001, sheetId['0:ENG']!);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('MARKS_ENTRY_NOT_OPEN');
    expect((await s.req('POST', `/exams/${examId}/open-marks`, tok.office)).body.status).toBe('marks_entry');
    const teachers = await s.db.select().from(notifications).where(eq(notifications.type, 'marks.entry_open'));
    expect(teachers.length).toBeGreaterThan(0);
  });

  it('scopes sheet lists to what a teacher teaches (+ the class they lead)', async () => {
    // t001: class teacher of sec0 (all 4 subjects) + MAT in sec1
    const mine = await sheetsOf(tok.t001);
    expect(mine).toHaveLength(5);
    expect(mine.filter((x) => x.sectionId === sec(1).id).map((x) => x.subjectName)).toEqual(['Mathematics']);
    expect(await sheetsOf(tok.t001, '&mine=true')).toHaveLength(2);
    expect(await sheetsOf(tok.principal)).toHaveLength(8);
    expect((await s.req('GET', '/marks/sheets', tok.accounts)).status).toBe(403); // accountant has no marks permission
    expect((await s.req('GET', '/marks/sheets', tok.student0)).status).toBe(403);
  });

  it('lets only the subject teacher enter marks', async () => {
    const eng = sheetId['0:ENG']!;
    const mat0 = sheetId['0:MAT']!;
    // t002 teaches nothing in sec0 ENG and does not lead sec0 -> the sheet is invisible (404)
    expect((await fill(tok.t002, eng)).status).toBe(404);
    // t001 leads sec0 but MAT in sec0 belongs to t002 -> can see it, cannot edit it
    const lead = await fill(tok.t001, mat0);
    expect(lead.status).toBe(403);
    expect(lead.body.code).toBe('NOT_SUBJECT_TEACHER');
    expect((await s.req('GET', `/marks/sheets/${mat0}`, tok.t001)).body.canEdit).toBe(false);
    // the accountant and parents cannot enter marks at all
    const dummy = { entries: [{ studentId: studentsOf(0)[0]!.id, marksObtained: 1 }] };
    for (const who of ['accounts', 'parent0', 'student0']) expect((await s.req('PUT', `/marks/sheets/${eng}/entries`, tok[who], dummy)).status, who).toBe(403);
    // the subject teacher can
    const ok = await fill(tok.t001, eng);
    expect(ok.status).toBe(200);
    expect(ok.body.canEdit).toBe(true);
    expect(ok.body.enteredCount).toBe(6);
  });

  it('validates entries: max marks, roster, duplicates, absent flag', async () => {
    const eng = sheetId['0:ENG']!;
    const d = await s.req('GET', `/marks/sheets/${eng}`, tok.t001);
    const first = d.body.entries[0].studentId;
    const over = await s.req('PUT', `/marks/sheets/${eng}/entries`, tok.t001, { entries: [{ studentId: first, marksObtained: 101 }] });
    expect(over.status).toBe(422);
    expect(over.body.code).toBe('MARKS_EXCEED_MAX');
    const outsider = await s.req('PUT', `/marks/sheets/${eng}/entries`, tok.t001, { entries: [{ studentId: studentsOf(1)[0]!.id, marksObtained: 50 }] });
    expect(outsider.status).toBe(422);
    expect(outsider.body.code).toBe('STUDENT_NOT_IN_SECTION');
    expect((await s.req('PUT', `/marks/sheets/${eng}/entries`, tok.t001, { entries: [{ studentId: first, marksObtained: 5 }, { studentId: first, marksObtained: 6 }] })).body.code).toBe('DUPLICATE_ENTRY');
    expect((await s.req('PUT', `/marks/sheets/${eng}/entries`, tok.t001, { entries: [{ studentId: first, marksObtained: 5, isAbsent: true }] })).status).toBe(422);
    expect((await s.req('PUT', `/marks/sheets/${eng}/entries`, tok.t001, { entries: [{ studentId: first, marksObtained: -1 }] })).status).toBe(422);
    // entering marks is audited with before/after
    const rows = await s.db.select().from(auditLogs).where(and(eq(auditLogs.action, 'marks.entry'), eq(auditLogs.entityId, eng)));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]!.after).toBeTruthy();
  });

  it('refuses to submit an incomplete sheet, then submits a complete one', async () => {
    const sci0 = sheetId['0:SCI']!; // taught by t003
    const t = tok[teacherOf(0, 'SCI').username];
    expect(t).toBeDefined();
    const partial = await s.req('GET', `/marks/sheets/${sci0}`, t);
    await s.req('PUT', `/marks/sheets/${sci0}/entries`, t, { entries: [{ studentId: partial.body.entries[0].studentId, marksObtained: 70 }] });
    const incomplete = await s.req('POST', `/marks/sheets/${sci0}/submit`, t, {});
    expect(incomplete.status).toBe(422);
    expect(incomplete.body.code).toBe('INCOMPLETE_SHEET');
    expect((await fill(t, sci0, 3)).status).toBe(200);
    const sub = await s.req('POST', `/marks/sheets/${sci0}/submit`, t, {});
    expect(sub.status).toBe(200);
    expect(sub.body.status).toBe('submitted');
    // locked while under review
    expect((await fill(t, sci0)).body.code).toBe('SHEET_LOCKED');
    // principal is told
    const note = await s.db.select().from(notifications).where(eq(notifications.type, 'marks.submitted'));
    expect(note.length).toBeGreaterThan(0);
  });

  it('only a reviewer can approve or return; a returned sheet comes back to the teacher with a note', async () => {
    const eng = sheetId['0:ENG']!;
    expect((await s.req('POST', `/marks/sheets/${eng}/submit`, tok.t001, {})).status).toBe(200);
    // teachers cannot approve (not even their own sheet); accountant neither
    for (const who of ['t001', 'accounts', 'student0', 'office']) expect((await s.req('POST', `/marks/sheets/${eng}/approve`, tok[who], {})).status, who).toBe(403);
    // return needs a note
    expect((await s.req('POST', `/marks/sheets/${eng}/return`, tok.principal, {})).status).toBe(422);
    const ret = await s.req('POST', `/marks/sheets/${eng}/return`, tok.principal, { note: 'Please recheck question 4 marks' });
    expect(ret.status).toBe(200);
    expect(ret.body.status).toBe('returned');
    expect(ret.body.returnNote).toBe('Please recheck question 4 marks');
    const t001User = s.ctx.teachers.find((t) => t.username === 't001')!.userId;
    const got = await s.db.select().from(notifications).where(and(eq(notifications.userId, t001User), eq(notifications.type, 'marks.returned')));
    expect(got).toHaveLength(1);
    // teacher fixes and resubmits
    expect((await fill(tok.t001, eng, 1)).status).toBe(200);
    expect((await s.req('POST', `/marks/sheets/${eng}/submit`, tok.t001, {})).body.status).toBe('submitted');
    // a published-only action cannot skip approval
    expect((await s.req('POST', `/marks/sheets/${eng}/publish`, tok.principal)).status).toBe(409);
    const ap = await s.req('POST', `/marks/sheets/${eng}/approve`, tok.principal, { note: 'ok' });
    expect(ap.body.status).toBe('approved');
    expect((await s.req('POST', `/marks/sheets/${eng}/approve`, tok.principal, {})).status).toBe(409);
    const trail = await s.db.select({ action: auditLogs.action }).from(auditLogs).where(eq(auditLogs.entityId, eng)).orderBy(desc(auditLogs.at));
    expect(trail.map((t) => t.action)).toEqual(expect.arrayContaining(['marks.entry', 'marks.submit', 'marks.return', 'marks.approve']));
  });
});

describe('publish gate and results', () => {
  it('shows nothing to students/parents before publication (by id, by list, results, report card)', async () => {
    const eng = sheetId['0:ENG']!; // approved, not published
    for (const who of ['student0', 'parent0', 'student1', 'unverified']) {
      expect((await s.req('GET', `/marks/sheets/${eng}`, tok[who])).status, who).toBe(404);
    }
    const stu = studentsOf(0)[0]!;
    const res = await s.req('GET', `/results?studentId=${stu.id}`, tok.student0);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect((await s.req('GET', `/report-cards/${examId}/students/${stu.id}`, tok.parent0)).status).toBe(404);
    expect((await s.req('GET', `/results/progress?studentId=${stu.id}`, tok.student0)).body.subjects).toEqual([]);
  });

  it('publishes an approved sheet (marks:publish only) and notifies students + verified guardians once', async () => {
    const eng = sheetId['0:ENG']!;
    for (const who of ['t001', 'office', 'accounts']) expect((await s.req('POST', `/marks/sheets/${eng}/publish`, tok[who])).status, who).toBe(403);
    const pub = await s.req('POST', `/marks/sheets/${eng}/publish`, tok.principal);
    expect(pub.status).toBe(200);
    expect(pub.body.status).toBe('published');
    expect((await s.req('POST', `/marks/sheets/${eng}/publish`, tok.principal)).body.code).toBe('ALREADY_PUBLISHED');
    const stu = studentsOf(0)[0]!;
    const n = await s.db.select().from(notifications).where(eq(notifications.type, 'marks.published'));
    const recipients = new Set(n.map((x) => x.userId));
    expect(recipients.has(stu.userId)).toBe(true);
    expect(recipients.has(guardianOf(stu.id).userId)).toBe(true);
    expect([...recipients].some((u) => u === studentsOf(1)[0]!.userId)).toBe(false); // other section untouched
    expect(n.every((x) => x.title === 'New results available' && !JSON.stringify(x.data).match(/\d{2}\s*\/\s*100/))).toBe(true);
    // a second published sheet of the same section does not notify again
    const before = n.length;
    const sci0 = sheetId['0:SCI']!;
    await s.req('POST', `/marks/sheets/${sci0}/approve`, tok.principal, {});
    await s.req('POST', `/marks/sheets/${sci0}/publish`, tok.principal);
    expect((await s.db.select().from(notifications).where(eq(notifications.type, 'marks.published'))).length).toBe(before);
  });

  it('now shows ONLY their own published entry to the student and to the linked parent', async () => {
    const eng = sheetId['0:ENG']!;
    const stu = studentsOf(0)[0]!;
    const asStudent = await s.req('GET', `/marks/sheets/${eng}`, tok.student0);
    expect(asStudent.status).toBe(200);
    expect(asStudent.body.entries).toHaveLength(1);
    expect(asStudent.body.entries[0].studentId).toBe(stu.id);
    expect(asStudent.body.canEdit).toBe(false);
    const asParent = await s.req('GET', `/marks/sheets/${eng}`, tok.parent0);
    expect(asParent.body.entries.map((e: any) => e.studentId)).toEqual([stu.id]);
    // other families / sections / the unverified guardian see nothing
    for (const who of ['student1', 'parent1', 'unverified']) expect((await s.req('GET', `/marks/sheets/${eng}`, tok[who])).status, who).toBe(404);
    expect((await s.req('GET', `/results?studentId=${stu.id}`, tok.parent1)).status).toBe(404);
    expect((await s.req('GET', `/results?studentId=${stu.id}`, tok.unverified)).status).toBe(404);
    expect((await s.req('GET', `/results?studentId=${stu.id}`, tok.student1)).status).toBe(404);
    // an unpublished sheet of the same section is still invisible
    expect((await s.req('GET', `/marks/sheets/${sheetId['0:SST']}`, tok.student0)).status).toBe(404);
  });

  it('computes subject grades, totals, pass/fail and class rank from published sheets only', async () => {
    const stu = studentsOf(0)[0]!;
    const r = await s.req('GET', `/results?studentId=${stu.id}&examId=${examId}`, tok.parent0);
    expect(r.status).toBe(200);
    const res = r.body.data[0];
    expect(res.examId).toBe(examId);
    expect(res.subjects.map((x: any) => x.subjectCode).sort()).toEqual(['ENG', 'SCI']);
    expect(res.subjectsPublished).toBe(2);
    expect(res.subjectsExpected).toBe(4);
    expect(res.complete).toBe(false);
    expect(res.maxTotal).toBe(200);
    expect(res.subjects[0].grade).toBeTruthy();
    expect(res.classSize).toBe(6);
    expect(res.rank).toBeGreaterThanOrEqual(1);
    // the student with 20 marks (roll 6) fails
    const failer = studentsOf(0)[5]!;
    const fr = await s.req('GET', `/results?studentId=${failer.id}`, tok.principal);
    expect(fr.body.data[0].result).toBe('fail');
    expect(fr.body.data[0].subjects.some((x: any) => !x.passed)).toBe(true);
    // class list is staff-only
    expect((await s.req('GET', `/results/class?examId=${examId}&sectionId=${sec(0).id}`, tok.student0)).status).toBe(403);
    const cl = await s.req('GET', `/results/class?examId=${examId}&sectionId=${sec(0).id}`, tok.t001);
    expect(cl.status).toBe(200);
    expect(cl.body.data).toHaveLength(6);
    // a teacher who does not lead the section cannot read the class list
    expect((await s.req('GET', `/results/class?examId=${examId}&sectionId=${sec(0).id}`, tok.t004)).status).toBe(404);
  });

  it('bulk-publishes the remaining approved sheets and publishes the exam', async () => {
    // finish every other sheet through the workflow
    for (const key of Object.keys(sheetId)) {
      const [si, code] = key.split(':') as [string, string];
      const id = sheetId[key]!;
      const detail = await s.req('GET', `/marks/sheets/${id}`, tok.principal);
      if (detail.body.status === 'published') continue;
      const teacher = tok[teacherOf(Number(si), code).username] ?? (tok[teacherOf(Number(si), code).username] = await s.login(teacherOf(Number(si), code).username));
      if (detail.body.status === 'draft') {
        expect((await fill(teacher, id, Number(si) * 7)).status).toBe(200);
        expect((await s.req('POST', `/marks/sheets/${id}/submit`, teacher, {})).status).toBe(200);
      }
      if ((await s.req('GET', `/marks/sheets/${id}`, tok.principal)).body.status === 'submitted') expect((await s.req('POST', `/marks/sheets/${id}/approve`, tok.principal, {})).status).toBe(200);
    }
    // one sheet stays pending -> exam publish without force is refused
    const hold = sheetId['1:SST']!;
    await s.req('POST', `/marks/sheets/${hold}/return`, tok.principal, { note: 'Recheck' });
    const refused = await s.req('POST', `/exams/${examId}/publish`, tok.principal, {});
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('SHEETS_PENDING');
    expect((await s.req('POST', `/exams/${examId}/publish`, tok.office, {})).status).toBe(403);
    // sheet bulk publish
    const bulk = await s.req('POST', `/exams/${examId}/sheets/publish`, tok.principal, { sectionId: sec(0).id });
    expect(bulk.status).toBe(200);
    expect(bulk.body.published).toBe(2); // MAT + SST of section 0 (ENG, SCI were already published)
    const forced = await s.req('POST', `/exams/${examId}/publish`, tok.principal, { force: true });
    expect(forced.status).toBe(200);
    expect(forced.body.status).toBe('published');
    // the held-back sheet is still hidden from the family
    expect((await s.req('GET', `/marks/sheets/${hold}`, tok.student1)).status).toBe(404);
    // the exam is now locked
    expect((await s.req('PATCH', `/exams/${examId}`, tok.principal, { name: 'Renamed' })).status).toBe(409);
    const stu = studentsOf(0)[0]!;
    const res = await s.req('GET', `/results?studentId=${stu.id}&examId=${examId}`, tok.student0);
    expect(res.body.data[0]).toMatchObject({ complete: true, subjectsPublished: 4, subjectsExpected: 4, maxTotal: 400 });
    expect(res.body.data[0].rank).toBeGreaterThanOrEqual(1);
    expect(res.body.data[0].percentile).not.toBeNull();
  });
});

describe('post-publication corrections', () => {
  it('requires marks:approve and a reason, audits before/after and re-notifies', async () => {
    const eng = sheetId['0:ENG']!;
    const stu = studentsOf(0)[0]!;
    const before = await s.req('GET', `/marks/sheets/${eng}`, tok.principal);
    const entry = before.body.entries.find((e: any) => e.studentId === stu.id);
    const body = { reason: 'Totalling error found on re-evaluation', entries: [{ studentId: stu.id, marksObtained: entry.marksObtained + 3 }] };
    for (const who of ['t001', 'office', 'accounts', 'student0', 'parent0']) expect((await s.req('POST', `/marks/sheets/${eng}/correct`, tok[who], body)).status, who).toBe(403);
    // a teacher cannot sneak a change in through the normal entry route either
    const sneaky = await s.req('PUT', `/marks/sheets/${eng}/entries`, tok.t001, { entries: [{ studentId: stu.id, marksObtained: 99 }] });
    expect(sneaky.status).toBe(409);
    expect(sneaky.body.code).toBe('SHEET_LOCKED');
    expect((await s.req('POST', `/marks/sheets/${eng}/correct`, tok.principal, { ...body, reason: '' })).status).toBe(422);
    expect((await s.req('POST', `/marks/sheets/${eng}/correct`, tok.principal, { entries: body.entries })).status).toBe(422);
    const notesBefore = (await s.db.select().from(notifications).where(eq(notifications.type, 'marks.corrected'))).length;
    const ok = await s.req('POST', `/marks/sheets/${eng}/correct`, tok.principal, body);
    expect(ok.status).toBe(200);
    expect(ok.body.entries.find((e: any) => e.studentId === stu.id).marksObtained).toBe(entry.marksObtained + 3);
    const [log] = await s.db.select().from(auditLogs).where(and(eq(auditLogs.action, 'marks.correct'), eq(auditLogs.entityId, eng)));
    expect(log).toBeDefined();
    expect((log!.before as any).reason).toBe(body.reason);
    expect((log!.before as any).entries[0].marksObtained).toBe(entry.marksObtained);
    expect((log!.after as any).entries[0].marksObtained).toBe(entry.marksObtained + 3);
    expect(log!.actorUserId).toBeTruthy();
    const notes = await s.db.select().from(notifications).where(eq(notifications.type, 'marks.corrected'));
    expect(notes.length).toBeGreaterThan(notesBefore);
    expect(new Set(notes.map((n) => n.userId)).has(stu.userId)).toBe(true);
    // identical resubmission changes nothing -> 422
    expect((await s.req('POST', `/marks/sheets/${eng}/correct`, tok.principal, { reason: 'same again', entries: [{ studentId: stu.id, marksObtained: entry.marksObtained + 3 }] })).body.code).toBe('NO_CHANGES');
    // the student sees the corrected mark
    const mine = await s.req('GET', `/marks/sheets/${eng}`, tok.student0);
    expect(mine.body.entries[0].marksObtained).toBe(entry.marksObtained + 3);
  });

  it('refuses to correct a sheet that is not published yet', async () => {
    const hold = sheetId['1:SST']!;
    const d = await s.req('GET', `/marks/sheets/${hold}`, tok.principal);
    const r = await s.req('POST', `/marks/sheets/${hold}/correct`, tok.principal, { reason: 'trying to skip the flow', entries: [{ studentId: d.body.entries[0].studentId, marksObtained: 10 }] });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('SHEET_NOT_PUBLISHED');
  });
});

describe('report cards, analytics, export', () => {
  it('assembles the report card with attendance and keeps remarks hidden until published', async () => {
    const stu = studentsOf(0)[0]!;
    // seed a little attendance so the percentage is meaningful
    const { attendanceSessions, attendanceRecords } = await import('../src/db/tenant/schema');
    const [session] = await s.db.insert(attendanceSessions).values({ sectionId: sec(0).id, date: D(-1), status: 'submitted' }).returning();
    const [session2] = await s.db.insert(attendanceSessions).values({ sectionId: sec(0).id, date: D(0), status: 'submitted' }).returning();
    await s.db.insert(attendanceRecords).values([
      { sessionId: session!.id, studentId: stu.id, sectionId: sec(0).id, date: D(-1), status: 'present' },
      { sessionId: session2!.id, studentId: stu.id, sectionId: sec(0).id, date: D(0), status: 'absent' },
    ]);

    const rc = await s.req('GET', `/report-cards/${examId}/students/${stu.id}`, tok.parent0);
    expect(rc.status).toBe(200);
    expect(rc.body.subjects).toHaveLength(4);
    expect(rc.body.attendance).toMatchObject({ totalDays: 2, present: 1, absent: 1, percent: 50 });
    expect(rc.body.remarks).toBeNull();
    expect(rc.body.gradeScale.length).toBeGreaterThan(3);
    expect(rc.body.school.name).toContain('Test School');

    // only the class teacher (or school scope) writes remarks
    const body = { remark: 'A steady, thoughtful learner.', areasToImprove: 'Revise tables daily', conduct: 'Excellent' };
    for (const who of ['t002', 't004', 'student0', 'parent0', 'accounts']) expect((await s.req('PUT', `/report-cards/${examId}/students/${stu.id}/remarks`, tok[who], body)).status, who).toBe(who === 't002' ? 404 : 403); // t002 leads another class
    expect((await s.req('PUT', `/report-cards/${examId}/students/${stu.id}/remarks`, tok.t001, { remark: '', areasToImprove: '', conduct: '' })).status).toBe(422);
    const saved = await s.req('PUT', `/report-cards/${examId}/students/${stu.id}/remarks`, tok.t001, body);
    expect(saved.status).toBe(200);
    expect(saved.body.publishedAt).toBeNull();
    // draft remarks: staff see them, the family does not
    expect((await s.req('GET', `/report-cards/${examId}/students/${stu.id}`, tok.t001)).body.remarks.remark).toBe(body.remark);
    expect((await s.req('GET', `/report-cards/${examId}/students/${stu.id}`, tok.parent0)).body.remarks).toBeNull();
    const list = await s.req('GET', `/report-cards/${examId}/remarks?sectionId=${sec(0).id}`, tok.t001);
    expect(list.body.data).toHaveLength(6);
    expect((await s.req('GET', `/report-cards/${examId}/remarks?sectionId=${sec(0).id}`, tok.t004)).status).toBe(404);

    // publishing needs report_cards:publish
    expect((await s.req('POST', `/report-cards/${examId}/publish`, tok.t001, { sectionId: sec(0).id })).status).toBe(403);
    const pub = await s.req('POST', `/report-cards/${examId}/publish`, tok.principal, { sectionId: sec(0).id });
    expect(pub.body.published).toBe(1);
    expect((await s.req('GET', `/report-cards/${examId}/students/${stu.id}`, tok.parent0)).body.remarks).toMatchObject({ remark: body.remark, conduct: 'Excellent' });
    // editing again takes it back to draft
    await s.req('PUT', `/report-cards/${examId}/students/${stu.id}/remarks`, tok.t001, { remark: 'Updated remark' });
    expect((await s.req('GET', `/report-cards/${examId}/students/${stu.id}`, tok.parent0)).body.remarks).toBeNull();
    const dbRow = await s.db.select().from(reportRemarks).where(eq(reportRemarks.studentId, stu.id));
    expect(dbRow[0]!.publishedAt).toBeNull();
  });

  it('renders the report card as a PDF', async () => {
    const stu = studentsOf(0)[0]!;
    const res = await s.app.inject({ method: 'GET', url: `/api/v1/report-cards/${examId}/students/${stu.id}/pdf`, headers: { 'x-tenant': s.tenant.code, authorization: `Bearer ${tok.student0}` } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect(res.rawPayload.length).toBeGreaterThan(1500);
    // another family cannot download it
    const other = await s.app.inject({ method: 'GET', url: `/api/v1/report-cards/${examId}/students/${stu.id}/pdf`, headers: { 'x-tenant': s.tenant.code, authorization: `Bearer ${tok.parent1}` } });
    expect(other.statusCode).toBe(404);
  });

  it('gives teachers analytics for their own sheets and the principal for all; students get 403', async () => {
    const all = await s.req('GET', `/exams/${examId}/analytics`, tok.principal);
    expect(all.status).toBe(200);
    expect(all.body.rows.length).toBeGreaterThanOrEqual(6);
    expect(all.body.rows[0]).toHaveProperty('averagePercent');
    expect(all.body.topPerformers.length).toBeGreaterThan(0);
    expect(all.body.distribution).toHaveLength(10);
    expect(all.body.distribution.reduce((t: number, b: any) => t + b.count, 0)).toBeGreaterThan(0);
    const mine = await s.req('GET', `/exams/${examId}/analytics`, tok.t004);
    expect(mine.status).toBe(200);
    expect(mine.body.rows.length).toBeLessThan(all.body.rows.length);
    const allowed = new Set(s.ctx.assignments.filter((a) => a.staffId === s.ctx.teachers.find((t) => t.username === 't004')!.id).map((a) => `${a.sectionId}:${a.subjectId}`));
    expect(mine.body.rows).toHaveLength(2);
    for (const r of mine.body.rows) expect(allowed.has(`${r.sectionId}:${r.subjectId}`)).toBe(true);
    for (const who of ['student0', 'parent0', 'accounts']) expect((await s.req('GET', `/exams/${examId}/analytics`, tok[who])).status, who).toBe(403);
  });

  it('exports CSV for marks:export holders only', async () => {
    const res = await s.app.inject({ method: 'GET', url: `/api/v1/marks/export?examId=${examId}`, headers: { 'x-tenant': s.tenant.code, authorization: `Bearer ${tok.principal}` } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    const lines = res.body.replace(/^﻿/, '').trim().split(/\r?\n/);
    expect(lines[0]).toContain('Admission no');
    expect(lines.length).toBeGreaterThan(20);
    for (const who of ['t001', 'office', 'student0', 'accounts']) expect((await s.req('GET', `/marks/export?examId=${examId}`, tok[who])).status, who).toBe(403);
  });

  it('shows a student their progress across exams', async () => {
    const stu = studentsOf(0)[0]!;
    const p = await s.req('GET', `/results/progress`, tok.student0); // defaults to self
    expect(p.status).toBe(200);
    expect(p.body.studentId).toBe(stu.id);
    expect(p.body.exams).toHaveLength(1);
    expect(p.body.subjects.length).toBe(4);
    expect(p.body.subjects[0].points[0].examId).toBe(examId);
    expect((await s.req('GET', `/results/progress?studentId=${stu.id}`, tok.parent1)).status).toBe(404);
  });
});

describe('grade scales, approval setting, read-only school', () => {
  it('manages grade scales (valid bands, one default) and protects the default', async () => {
    const list = await s.req('GET', '/grade-scales', tok.student0);
    expect(list.status).toBe(200);
    expect(list.body.data.find((g: any) => g.isDefault).bands).toHaveLength(7);
    const bands = [
      { label: 'Pass', minPercent: 40, maxPercent: 100, gradePoint: 1, remark: 'Pass' },
      { label: 'Fail', minPercent: 0, maxPercent: 39.99, gradePoint: 0, remark: 'Fail' },
    ];
    expect((await s.req('POST', '/grade-scales', tok.t001, { name: 'Simple', bands })).status).toBe(403);
    expect((await s.req('POST', '/grade-scales', tok.principal, { name: 'Gap', bands: [{ label: 'A', minPercent: 10, maxPercent: 100 }] })).body.code).toBe('INVALID_BANDS');
    expect((await s.req('POST', '/grade-scales', tok.principal, { name: 'Overlap', bands: [{ label: 'A', minPercent: 0, maxPercent: 60 }, { label: 'B', minPercent: 50, maxPercent: 100 }] })).body.code).toBe('INVALID_BANDS');
    const ok = await s.req('POST', '/grade-scales', tok.principal, { name: 'Simple', bands });
    expect(ok.status).toBe(201);
    const def = list.body.data.find((g: any) => g.isDefault);
    expect((await s.req('DELETE', `/grade-scales/${def.id}`, tok.admin)).status).toBe(409);
    const made = await s.req('PATCH', `/grade-scales/${ok.body.id}`, tok.principal, { isDefault: true });
    expect(made.body.isDefault).toBe(true);
    expect((await s.req('GET', '/grade-scales', tok.principal)).body.data.filter((g: any) => g.isDefault)).toHaveLength(1);
    expect((await s.req('DELETE', `/grade-scales/${def.id}`, tok.admin)).status).toBe(200); // no longer default, unused
  });

  it('with exams.requireApproval=false a submit skips review (approved), or publishes directly for a publisher', async () => {
    await putSetting(s.db, 'exams', { requireApproval: false });
    const exam2 = await s.req('POST', '/exams', tok.principal, { name: 'Quick test', examType: 'quiz', startDate: D(12), endDate: D(13) });
    const id2 = exam2.body.id;
    await s.req('POST', `/exams/${id2}/papers/bulk`, tok.principal, {
      papers: [
        { gradeId: sec(0).gradeId, subjectId: subj('ENG').id, examDate: D(12), startTime: '09:00', endTime: '10:00', maxMarks: 20 },
        { gradeId: sec(0).gradeId, subjectId: subj('MAT').id, examDate: D(13), startTime: '09:00', endTime: '10:00', maxMarks: 20 },
      ],
    });
    await s.req('POST', `/exams/${id2}/schedule`, tok.principal);
    await s.req('POST', `/exams/${id2}/open-marks`, tok.principal);
    await s.req('POST', `/exams/${id2}/sheets/generate`, tok.principal, {});
    const sh = await sheetsFor(id2, tok.principal);
    expect(sh).toHaveLength(2);
    const eng = sh.find((x) => x.subjectName === 'English');
    const mat = sh.find((x) => x.subjectName === 'Mathematics');
    // a teacher's submit has no reviewer step: the sheet is ready for a publisher
    const d = await s.req('GET', `/marks/sheets/${eng.id}`, tok.t001);
    expect((await s.req('PUT', `/marks/sheets/${eng.id}/entries`, tok.t001, { entries: d.body.entries.map((e: any) => ({ studentId: e.studentId, marksObtained: 15 })) })).status).toBe(200);
    const sub = await s.req('POST', `/marks/sheets/${eng.id}/submit`, tok.t001, {});
    expect(sub.body.status).toBe('approved');
    expect((await s.req('POST', `/marks/sheets/${eng.id}/publish`, tok.principal)).body.status).toBe('published');
    // a user who may enter marks AND publish (super admin) publishes straight from the submit
    const dm = await s.req('GET', `/marks/sheets/${mat.id}`, tok.admin);
    expect((await s.req('PUT', `/marks/sheets/${mat.id}/entries`, tok.admin, { entries: dm.body.entries.map((e: any) => ({ studentId: e.studentId, marksObtained: 12 })) })).status).toBe(200);
    const direct = await s.req('POST', `/marks/sheets/${mat.id}/submit`, tok.admin, {});
    expect(direct.body.status).toBe('published');
    expect((await s.req('GET', `/marks/sheets/${mat.id}`, tok.student0)).status).toBe(200);
    await putSetting(s.db, 'exams', { requireApproval: true });
  });

  it('reminds each affected grade (students + verified guardians) once about tomorrow’s exam', async () => {
    const { runExamReminders } = await import('../src/modules/exams/jobs');
    const exam = await s.req('POST', '/exams', tok.principal, { name: 'Surprise quiz', examType: 'quiz', startDate: D(1), endDate: D(1) });
    await s.req('POST', `/exams/${exam.body.id}/papers`, tok.principal, { gradeId: sec(1).gradeId, subjectId: subj('SCI').id, examDate: D(1), startTime: '10:00', endTime: '11:00', maxMarks: 25 });
    // still a draft: nothing is announced
    expect(await runExamReminders(s.tenant, s.db)).toEqual({ grades: 0, notified: 0 });
    await s.req('POST', `/exams/${exam.body.id}/schedule`, tok.principal);
    const first = await runExamReminders(s.tenant, s.db);
    expect(first.grades).toBe(1);
    const n = await s.db.select().from(notifications).where(eq(notifications.type, 'marks.exam_tomorrow'));
    const users = new Set(n.map((x) => x.userId));
    expect(users.has(studentsOf(1)[0]!.userId)).toBe(true);
    expect(users.has(guardianOf(studentsOf(1)[0]!.id).userId)).toBe(true);
    expect(users.has(studentsOf(0)[0]!.userId)).toBe(false); // other grade
    expect(n.every((x) => x.title === 'Exam tomorrow')).toBe(true);
    expect(await runExamReminders(s.tenant, s.db)).toEqual({ grades: 0, notified: 0 });
    expect((await s.db.select().from(notifications).where(eq(notifications.type, 'marks.exam_tomorrow'))).length).toBe(n.length);
  });

  it('refuses writes with 402 when the subscription has lapsed, but still serves reads', async () => {
    await upsertSubscription({ tenantCode: s.tenant.code, academicYear: '2020-21', startsOn: '2020-04-01', endsOn: '2021-03-31', pricePerStudent: 100, licensedStudents: 12, graceDays: 10 });
    await upsertSubscription({ tenantCode: s.tenant.code, academicYear: s.ctx.yearName, startsOn: '2000-01-01', endsOn: '2001-01-01', pricePerStudent: 100, licensedStudents: 12, graceDays: 10 });
    invalidateLicense(s.tenant.id);
    const w = await s.req('POST', '/exams', tok.principal, { name: 'Blocked exam', examType: 'quiz' });
    expect(w.status).toBe(402);
    expect(w.body.code).toBe('SUBSCRIPTION_EXPIRED');
    expect((await s.req('POST', `/marks/sheets/${sheetId['1:SST']}/approve`, tok.principal, {})).status).toBe(402);
    expect((await s.req('GET', '/exams', tok.principal)).status).toBe(200);
    expect((await s.req('GET', `/results?studentId=${studentsOf(0)[0]!.id}`, tok.parent0)).status).toBe(200);
  });
});

async function sheetsFor(id: string, token: string | undefined) {
  const r = await s.req('GET', `/marks/sheets?examId=${id}`, token);
  return r.body.data as any[];
}
