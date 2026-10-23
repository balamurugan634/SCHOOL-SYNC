import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { upsertSubscription } from '../src/core/billing/invoicing';
import { invalidateLicense } from '../src/core/billing/license';
import { seed as seedPeople } from '../src/cli/seed/people';
import { admissions, auditLogs, enrollments, files, guardians, notifications, staff, studentDocuments, studentGuardians, students, teachingAssignments, users } from '../src/db/tenant/schema';
import { parseCsv } from '../src/modules/people/import';
import { createTestSchool, PASSWORD, type TestSchool } from './helpers';

let s: TestSchool;
let admin: string;
let office: string;
let principal: string;
let hr: string;
let accounts: string;
let teacher: string; // t001: class teacher of section 0, teaches both seeded sections
let student0: string;
let parent0: string;
let unverified: string; // 9099999999

const child0 = () => s.ctx.students[0]!;
const guardian0 = () => s.ctx.guardians[0]!;
let secA: string; // seeded Grade 6 A (6 students)
let secB: string; // new Grade 6 B, capacity 3, no teacher assigned
let secBig: string; // new Grade 6 "Big", capacity 500 (imports, seat tests)
let secBulk: string; // new Grade 6 "Bulk", capacity 500 (the 500-row import)
let gradeId6: string;

const audits = (action: string) => s.db.select().from(auditLogs).where(eq(auditLogs.action, action));
const me = (t: string) => s.req('GET', '/auth/me', t);
const mkFile = async () => (await s.db.insert(files).values({ storageKey: `f-${Math.random().toString(36).slice(2)}`, originalName: 'doc.pdf', mimeType: 'application/pdf', sizeBytes: 10, purpose: 'document' }).returning({ id: files.id }))[0]!.id;
const newStudent = (extra: Record<string, unknown> = {}) => ({ firstName: 'Kabir', lastName: 'Menon', dob: '2015-03-04', gender: 'male', sectionId: secB, createLogin: false, ...extra });
const phoneSeq = (() => {
  let n = 9810000000;
  return () => String(n++);
})();

beforeAll(async () => {
  s = await createTestSchool();
  [admin, office, principal, hr, accounts, teacher, student0, parent0, unverified] = await Promise.all([
    s.login('admin@test.school'),
    s.login('office'),
    s.login('principal'),
    s.login('hr'),
    s.login('accounts'),
    s.login('t001'),
    s.login(child0().username),
    s.login(guardian0().username),
    s.login('9099999999'),
  ]);
  secA = s.ctx.sections[0]!.id;
  gradeId6 = s.ctx.sections[0]!.gradeId;
  secB = (await s.req('POST', '/academics/sections', office, { gradeId: gradeId6, name: 'B', capacity: 3 })).body.id;
  secBig = (await s.req('POST', '/academics/sections', office, { gradeId: gradeId6, name: 'Big', capacity: 500 })).body.id;
  secBulk = (await s.req('POST', '/academics/sections', office, { gradeId: gradeId6, name: 'Bulk', capacity: 500 })).body.id;
  expect([secB, secBig, secBulk].every(Boolean)).toBe(true);
});

// ───────────────────────────────────────────────────────────────────────────────────────────────
describe('students: list, search and scope isolation', () => {
  it('management lists everyone, with search, filters and paging', async () => {
    const all = await s.req('GET', '/students?pageSize=100', office);
    expect(all.status).toBe(200);
    expect(all.body.meta.total).toBe(s.ctx.students.length);
    expect(all.body.data[0]).toMatchObject({ admissionNo: expect.any(String), name: expect.any(String), gradeName: expect.any(String), sectionName: expect.any(String), status: 'active' });
    const first = s.ctx.students[3]!;
    const byNo = await s.req('GET', `/students?q=${first.admissionNo}`, office);
    expect(byNo.body.data.map((x: any) => x.id)).toEqual([first.id]);
    const byName = await s.req('GET', `/students?q=${encodeURIComponent(first.name)}`, office);
    expect(byName.body.data.map((x: any) => x.id)).toContain(first.id);
    const bySection = await s.req('GET', `/students?sectionId=${first.sectionId}&pageSize=100`, office);
    expect(bySection.body.data.length).toBe(s.ctx.students.filter((x) => x.sectionId === first.sectionId).length);
    expect((await s.req('GET', '/students?pageSize=5&page=2', office)).body.data).toHaveLength(5);
    expect((await s.req('GET', '/students?pageSize=1000', office)).status).toBe(422);
    expect((await s.req('GET', '/students?q=%25', office)).body.data).toEqual([]); // LIKE wildcards are literal
  });

  it('a student sees only themselves; a parent only their verified children; the unverified parent nothing', async () => {
    expect((await s.req('GET', '/students', student0)).body.data.map((x: any) => x.id)).toEqual([child0().id]);
    expect((await s.req('GET', '/students', parent0)).body.data.map((x: any) => x.id).sort()).toEqual([...guardian0().studentIds].sort());
    expect((await s.req('GET', '/students', unverified)).body.data).toEqual([]);
    const other = s.ctx.students[7]!;
    for (const t of [student0, parent0, unverified]) expect((await s.req('GET', `/students/${other.id}`, t)).status).toBe(404);
    // the unverified guardian is linked to child0 but must not see them
    expect((await s.req('GET', `/students/${child0().id}`, unverified)).status).toBe(404);
  });

  it('a teacher sees assigned sections only: a student in an unassigned section is invisible (404, not 403)', async () => {
    const made = await s.req('POST', '/students', office, newStudent({ firstName: 'Hidden' }));
    expect(made.status).toBe(201);
    const id = made.body.id as string;
    expect((await s.req('GET', `/students/${id}`, teacher)).status).toBe(404);
    expect((await s.req('GET', '/students?pageSize=100', teacher)).body.data.map((x: any) => x.id)).not.toContain(id);
    expect((await s.req('GET', `/students/${id}`, office)).status).toBe(200);
    expect((await s.req('GET', `/students/${id}`, principal)).status).toBe(200);
    // write attempts on invisible records are 403 for lack of permission, never leaking existence
    expect((await s.req('PATCH', `/students/${id}`, teacher, { firstName: 'X' })).status).toBe(403);
    // clean up: remove from the capacity budget of B for the capacity test later
    await s.req('POST', `/students/${id}/status`, office, { status: 'withdrawn', reason: 'test cleanup' });
  });

  it('permission matrix for listing', async () => {
    expect((await s.req('GET', '/students', principal)).status).toBe(200);
    expect((await s.req('GET', '/students', accounts)).status).toBe(200);
    expect((await s.req('GET', '/students', hr)).status).toBe(403); // HR has no student-record permissions
    expect((await s.req('GET', '/students')).status).toBe(401);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────
describe('students: sensitive fields', () => {
  it('medical notes, documents, contacts and login are returned only to those permitted', async () => {
    expect((await s.req('PATCH', `/students/${child0().id}`, office, { medicalNotes: 'Asthma: inhaler in the school bag' })).status).toBe(200);
    const fileId = await mkFile();
    const doc = await s.req('POST', `/students/${child0().id}/documents`, office, { kind: 'birth_certificate', title: 'Birth certificate', fileId });
    expect(doc.status).toBe(201);

    const forOffice = (await s.req('GET', `/students/${child0().id}`, office)).body;
    expect(forOffice.medicalNotes).toContain('Asthma');
    expect(forOffice.documents).toHaveLength(1);
    expect(forOffice.username).toBe(child0().username);
    expect(forOffice.guardians.length).toBeGreaterThanOrEqual(2); // verified parent + the unverified demo link
    expect(forOffice.enrollments).toHaveLength(1);

    const forPrincipal = (await s.req('GET', `/students/${child0().id}`, principal)).body;
    expect(forPrincipal.medicalNotes).toBeNull();
    expect(forPrincipal.documents).toBeNull();
    expect(forPrincipal.username).toBeNull();
    expect(forPrincipal.guardians.every((g: any) => g.verified)).toBe(true); // unverified links are for the school's eyes only

    const forTeacher = (await s.req('GET', `/students/${child0().id}`, teacher)).body;
    expect(forTeacher.medicalNotes).toBeNull();
    expect(forTeacher.documents).toBeNull();
    expect(forTeacher.guardians[0].phone).toBeTruthy(); // teachers hold guardians:view for their own sections

    const forStudent = (await s.req('GET', `/students/${child0().id}`, student0)).body;
    expect(forStudent.medicalNotes).toBeNull();
    expect(forStudent.documents).toBeNull();
    expect(forStudent.guardians.every((g: any) => g.phone === null && g.email === null)).toBe(true);

    const forParent = (await s.req('GET', `/students/${child0().id}`, parent0)).body;
    expect(forParent.medicalNotes).toContain('Asthma');
    expect(forParent.documents).toBeNull();
    expect(forParent.guardians).toHaveLength(1);
    expect(forParent.guardians[0]).toMatchObject({ guardianId: guardian0().id, verified: true, phone: expect.any(String) });
    expect(JSON.stringify(forParent)).not.toContain('9099999999');
  });

  it('documents: only student_documents holders; verify and delete are audited', async () => {
    const id = child0().id;
    for (const t of [teacher, principal, accounts, student0, parent0]) expect((await s.req('GET', `/students/${id}/documents`, t)).status).toBe(403);
    const list = await s.req('GET', `/students/${id}/documents`, office);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ kind: 'birth_certificate', verified: false, fileUrl: expect.stringContaining('/files/') });
    const docId = list.body.data[0].id;
    expect((await s.req('POST', `/students/${id}/documents/${docId}/verify`, teacher)).status).toBe(403);
    const v = await s.req('POST', `/students/${id}/documents/${docId}/verify`, office);
    expect(v.body.verified).toBe(true);
    const bad = await s.req('POST', `/students/${id}/documents`, office, { kind: 'id_proof', fileId: '00000000-0000-4000-8000-000000000000' });
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe('ATTACHMENT_NOT_FOUND');
    expect((await s.req('POST', `/students/${id}/documents`, office, { kind: 'passport', fileId: await mkFile() })).status).toBe(422);
    expect((await s.req('DELETE', `/students/${id}/documents/${docId}`, office)).status).toBe(200);
    expect(await audits('student.document_add')).toHaveLength(1);
    expect(await audits('student.document_verify')).toHaveLength(1);
    expect(await audits('student.document_delete')).toHaveLength(1);
    expect(await s.db.select().from(studentDocuments).where(eq(studentDocuments.studentId, id))).toHaveLength(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────
describe('students: create', () => {
  const created: { id: string; admissionNo: string; creds: any }[] = [];

  it('only students:create holders (teacher, principal, accounts, parent, student are refused)', async () => {
    for (const t of [teacher, principal, accounts, parent0, student0, hr]) expect((await s.req('POST', '/students', t, newStudent())).status).toBe(403);
  });

  it('creates a student: admission number, current-year enrollment, login with one-time password, guardian (unverified link)', async () => {
    const phone = phoneSeq();
    const r = await s.req('POST', '/students', office, newStudent({ firstName: 'Aditi', lastName: 'Rao', createLogin: true, guardians: [{ firstName: 'Sunil', lastName: 'Rao', phone, email: 'sunil.rao@mail.test', relationship: 'father', createLogin: true }] }));
    expect(r.status).toBe(201);
    expect(r.body.admissionNo).toMatch(/^[A-Z]{2,3}\d{4}\d{4}$/);
    expect(r.body.sectionId).toBe(secB);
    expect(r.body.enrollments).toHaveLength(1);
    expect(r.body.enrollments[0]).toMatchObject({ sectionId: secB, status: 'enrolled', rollNo: expect.any(Number) });
    expect(r.body.credentials.student).toMatchObject({ username: r.body.admissionNo.toLowerCase() });
    expect(r.body.credentials.student.temporaryPassword).toHaveLength(14);
    expect(r.body.credentials.guardians).toHaveLength(1);
    expect(r.body.credentials.guardians[0].username).toBe(phone);
    expect(r.body.guardians[0]).toMatchObject({ verified: false, relationship: 'father' });
    created.push({ id: r.body.id, admissionNo: r.body.admissionNo, creds: r.body.credentials });

    // the password is shown once: reading the student back never returns it
    expect(JSON.stringify((await s.req('GET', `/students/${r.body.id}`, office)).body)).not.toContain(r.body.credentials.student.temporaryPassword);
    const login = await s.req('POST', '/auth/login', null, { identifier: r.body.credentials.student.username, password: r.body.credentials.student.temporaryPassword });
    expect(login.status).toBe(200);
    expect(login.body.user).toMatchObject({ mustChangePassword: true, experience: 'student' });
    expect(login.body.user.profile.studentId).toBe(r.body.id);
    expect((await audits('student.create')).some((a) => a.entityId === r.body.id)).toBe(true);
  });

  it('numbers continue without gaps, rolls continue, the section capacity is enforced', async () => {
    for (const name of ['Bhavna', 'Chetan']) {
      const r = await s.req('POST', '/students', office, newStudent({ firstName: name }));
      expect(r.status).toBe(201);
      created.push({ id: r.body.id, admissionNo: r.body.admissionNo, creds: r.body.credentials });
    }
    const nums = created.map((c) => Number(c.admissionNo.slice(-4)));
    expect(nums[1]).toBe(nums[0]! + 1);
    expect(nums[2]).toBe(nums[1]! + 1);
    expect(new Set(created.map((c) => c.admissionNo)).size).toBe(3);
    // B has capacity 3 and now 3 enrolled (the earlier "Hidden" student was withdrawn)
    const full = await s.req('POST', '/students', office, newStudent({ firstName: 'Overflow' }));
    expect(full.status).toBe(409);
    expect(full.body.code).toBe('SECTION_FULL');
    // no student without a login → no user row for them
    expect(created[1]!.creds.student).toBeNull();
  });

  it('validates input and refuses duplicate parent phone numbers', async () => {
    expect((await s.req('POST', '/students', office, { sectionId: secA })).status).toBe(422); // no first name
    expect((await s.req('POST', '/students', office, newStudent({ dob: '15-03-2015' }))).status).toBe(422);
    expect((await s.req('POST', '/students', office, newStudent({ sectionId: '00000000-0000-4000-8000-000000000000' }))).body.code).toBe('SECTION_NOT_FOUND');
    expect((await s.req('POST', '/students', office, newStudent({ emergencyContacts: [{ name: 'X', phone: 'abc' }] }))).status).toBe(422);
    const dup = await s.req('POST', '/students', office, newStudent({ sectionId: secA, guardians: [{ firstName: 'Dup', phone: guardian0().username }] }));
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('GUARDIAN_EXISTS');
    expect(dup.body.guardianId).toBe(guardian0().id);
    // nothing half-created
    expect((await s.db.select().from(students).where(eq(students.firstName, 'Overflow'))).length).toBe(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────
describe('guardians & verification gating', () => {
  let x1: { id: string; admissionNo: string };
  let parentX1: { guardianId: string; username: string; temporaryPassword: string };

  beforeAll(async () => {
    const r = await s.req('POST', '/students', office, newStudent({ sectionId: secA, firstName: 'Diya', lastName: 'Kulkarni', createLogin: true, guardians: [{ firstName: 'Mohan', lastName: 'Kulkarni', phone: phoneSeq(), createLogin: true }] }));
    expect(r.status).toBe(201);
    x1 = r.body;
    parentX1 = r.body.credentials.guardians[0];
  });

  it('an unverified link grants nothing; verifying gives access at once (no re-login), unverifying takes it away', async () => {
    const tok = await s.login(parentX1.username, parentX1.temporaryPassword);
    expect((await me(tok)).body.profile.children).toEqual([]);
    expect((await s.req('GET', '/students', tok)).body.data).toEqual([]);
    expect((await s.req('GET', `/students/${x1.id}`, tok)).status).toBe(404);

    // permission matrix for verification
    for (const t of [teacher, principal, accounts, parent0, student0, tok]) expect((await s.req('POST', `/students/${x1.id}/guardians/${parentX1.guardianId}/verify`, t)).status).toBe(403);
    const v = await s.req('POST', `/students/${x1.id}/guardians/${parentX1.guardianId}/verify`, office);
    expect(v.status).toBe(200);
    expect(v.body).toMatchObject({ guardianId: parentX1.guardianId, verified: true });

    // the SAME token now sees the child
    const kids = (await me(tok)).body.profile.children;
    expect(kids.map((c: any) => c.studentId)).toEqual([x1.id]);
    expect((await s.req('GET', `/students/${x1.id}`, tok)).status).toBe(200);
    // verifying twice is harmless
    expect((await s.req('POST', `/students/${x1.id}/guardians/${parentX1.guardianId}/verify`, office)).status).toBe(200);
    expect((await audits('student.guardian_verify')).filter((a) => a.entityId === x1.id)).toHaveLength(1);
    const [note] = await s.db.select().from(notifications).where(and(eq(notifications.type, 'system.child_linked')));
    expect(note).toBeTruthy();

    const un = await s.req('POST', `/students/${x1.id}/guardians/${parentX1.guardianId}/unverify`, office);
    expect(un.body.verified).toBe(false);
    expect((await me(tok)).body.profile.children).toEqual([]);
    expect((await s.req('GET', `/students/${x1.id}`, tok)).status).toBe(404);
    expect(await audits('student.guardian_unverify')).toHaveLength(1);
  });

  it('the demo’s unverified parent is promoted by verification and demoted again', async () => {
    const [g] = await s.db.select({ id: guardians.id }).from(guardians).where(eq(guardians.phone, '9099999999'));
    expect((await me(unverified)).body.profile.children).toEqual([]);
    expect((await s.req('POST', `/students/${child0().id}/guardians/${g!.id}/verify`, office)).status).toBe(200);
    expect((await me(unverified)).body.profile.children.map((c: any) => c.studentId)).toEqual([child0().id]);
    expect((await s.req('GET', `/students/${child0().id}`, unverified)).status).toBe(200);
    expect((await s.req('DELETE', `/students/${child0().id}/guardians/${g!.id}`, office)).status).toBe(200);
    expect((await me(unverified)).body.profile.children).toEqual([]);
    expect(await audits('student.guardian_unlink')).toHaveLength(1);
    // link again unverified (as the demo has it) and with verified=true in one step for a different case
    const again = await s.req('POST', `/students/${child0().id}/guardians`, office, { guardianId: g!.id, relationship: 'guardian' });
    expect(again.status).toBe(201);
    expect(again.body.verified).toBe(false);
    expect((await s.req('POST', `/students/${child0().id}/guardians`, office, { guardianId: g!.id })).body.code).toBe('LINK_EXISTS');
  });

  it('many children per parent, many guardians per child', async () => {
    // guardian0 gets a second child; x1 gets a second guardian
    const link = await s.req('POST', `/students/${x1.id}/guardians`, office, { guardianId: guardian0().id, relationship: 'mother', verified: true });
    expect(link.status).toBe(201);
    const kids = (await me(parent0)).body.profile.children.map((c: any) => c.studentId).sort();
    expect(kids).toEqual([...guardian0().studentIds, x1.id].sort());
    const detail = (await s.req('GET', `/students/${x1.id}`, office)).body;
    expect(detail.guardians.length).toBeGreaterThanOrEqual(2);
    // another family's parent still cannot see x1
    const otherParent = await s.login(s.ctx.guardians[5]!.username);
    expect((await s.req('GET', `/students/${x1.id}`, otherParent)).status).toBe(404);
    // primary flag moves
    const pri = await s.req('PATCH', `/students/${x1.id}/guardians/${guardian0().id}`, office, { isPrimary: true });
    expect(pri.body.isPrimary).toBe(true);
    const after = (await s.req('GET', `/students/${x1.id}`, office)).body.guardians;
    expect(after.filter((g: any) => g.isPrimary)).toHaveLength(1);
  });

  it('guardian CRUD: scope for teachers, parents locked out, logins, duplicates, deletion rules', async () => {
    expect((await s.req('GET', '/guardians', parent0)).status).toBe(403);
    expect((await s.req('GET', '/guardians', student0)).status).toBe(403);
    expect((await s.req('POST', '/guardians', teacher, { firstName: 'Nope' })).status).toBe(403);

    const phone = phoneSeq();
    const made = await s.req('POST', '/guardians', office, { firstName: 'Lata', lastName: 'Shah', phone, email: 'lata@mail.test', createLogin: true });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ hasLogin: true, children: [], credentials: { username: phone } });
    const gid = made.body.id as string;
    expect((await s.req('POST', '/guardians', office, { firstName: 'Lata2', phone })).body.code).toBe('GUARDIAN_EXISTS');
    expect((await s.req('POST', '/guardians', office, { firstName: 'NoContact', createLogin: true })).status).toBe(422);

    // a teacher only sees parents of children in their assigned sections
    const mine = await s.req('GET', '/guardians?pageSize=100', teacher);
    expect(mine.status).toBe(200);
    expect(mine.body.data.map((g: any) => g.id)).not.toContain(gid);
    expect((await s.req('GET', `/guardians/${gid}`, teacher)).status).toBe(404);
    expect((await s.req('GET', `/guardians/${guardian0().id}`, teacher)).status).toBe(200);
    expect((await s.req('GET', `/guardians/${gid}`, office)).status).toBe(200);

    const patched = await s.req('PATCH', `/guardians/${gid}`, office, { occupation: 'Architect', email: 'lata.shah@mail.test' });
    expect(patched.body).toMatchObject({ occupation: 'Architect', email: 'lata.shah@mail.test' });
    const [u] = await s.db.select().from(users).where(eq(users.username, phone));
    expect(u!.email).toBe('lata.shah@mail.test'); // the login follows

    // link → cannot delete; unlink → can delete
    expect((await s.req('POST', `/students/${s.ctx.students[2]!.id}/guardians`, office, { guardianId: gid, verified: true })).status).toBe(201);
    expect((await s.req('DELETE', `/guardians/${gid}`, office)).body.code).toBe('GUARDIAN_HAS_LINKS');
    await s.req('DELETE', `/students/${s.ctx.students[2]!.id}/guardians/${gid}`, office);
    expect((await s.req('DELETE', `/guardians/${gid}`, office)).status).toBe(200);
    expect((await s.req('GET', `/guardians/${gid}`, office)).status).toBe(404);
    const [gone] = await s.db.select().from(users).where(eq(users.username, phone));
    expect(gone!.status).toBe('deactivated');

    // a parent record without login can get one later
    const noLogin = await s.req('POST', '/guardians', office, { firstName: 'Ravi', phone: phoneSeq() });
    expect(noLogin.body.hasLogin).toBe(false);
    const lg = await s.req('POST', `/guardians/${noLogin.body.id}/login`, office);
    expect(lg.status).toBe(200);
    expect(lg.body.temporaryPassword).toHaveLength(14);
    expect((await s.req('POST', `/guardians/${noLogin.body.id}/login`, office)).body.code).toBe('GUARDIAN_HAS_LOGIN');
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────
describe('students: edit, status, move', () => {
  let st: any;

  beforeAll(async () => {
    const r = await s.req('POST', '/students', office, newStudent({ sectionId: s.ctx.sections[1]!.id, firstName: 'Esha', lastName: 'Iyer', createLogin: true, guardians: [{ firstName: 'Vijay', lastName: 'Iyer', phone: phoneSeq(), createLogin: true, verified: true }] }));
    expect(r.status).toBe(201);
    st = r.body;
  });

  it('edits with validation, photo file check and an audit diff (medical notes are not echoed)', async () => {
    expect((await s.req('PATCH', `/students/${st.id}`, teacher, { firstName: 'X' })).status).toBe(403);
    expect((await s.req('PATCH', `/students/${st.id}`, parent0, { firstName: 'X' })).status).toBe(403);
    expect((await s.req('PATCH', `/students/${st.id}`, principal, { firstName: 'X' })).status).toBe(403);
    const r = await s.req('PATCH', `/students/${st.id}`, office, { bloodGroup: 'O+', medicalNotes: 'Peanut allergy', emergencyContacts: [{ name: 'Vijay Iyer', relationship: 'father', phone: '+91 98450 11122' }], authorizedPickups: [{ name: 'Uncle Raj', phone: '9845011199', idProof: 'Aadhaar ending 1234' }] });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ bloodGroup: 'O+', emergencyContacts: [{ name: 'Vijay Iyer' }], authorizedPickups: [{ name: 'Uncle Raj' }] });
    const entry = (await audits('student.update')).find((a) => a.entityId === st.id && (a.after as any).bloodGroup === 'O+')!;
    expect(JSON.stringify(entry)).not.toContain('Peanut');
    expect((entry.after as any).medicalNotes).toBe('[changed]');

    expect((await s.req('PATCH', `/students/${st.id}`, office, { emergencyContacts: Array.from({ length: 11 }, () => ({ name: 'a', phone: '9845011122' })) })).status).toBe(422);
    expect((await s.req('PATCH', `/students/${st.id}`, office, { gender: 'robot' })).status).toBe(422);
    expect((await s.req('PATCH', `/students/${st.id}`, office, { photoFileId: '00000000-0000-4000-8000-000000000000' })).body.code).toBe('ATTACHMENT_NOT_FOUND');
    const fileId = await mkFile();
    const photo = await s.req('PATCH', `/students/${st.id}`, office, { photoFileId: fileId });
    expect(photo.body.photoUrl).toBe(`/api/v1/files/${fileId}`);
    // renaming keeps the login's display name in step
    await s.req('PATCH', `/students/${st.id}`, office, { firstName: 'Eesha' });
    const [u] = await s.db.select().from(users).where(eq(users.username, st.admissionNo.toLowerCase()));
    expect(u!.displayName).toBe('Eesha Iyer');
  });

  it('suspend → login blocked and sessions revoked; reinstate → works again', async () => {
    const tok = await s.login(st.credentials.student.username, st.credentials.student.temporaryPassword);
    expect((await s.req('GET', '/auth/me', tok)).status).toBe(200);
    for (const t of [teacher, principal, parent0]) expect((await s.req('POST', `/students/${st.id}/status`, t, { status: 'suspended' })).status).toBe(403);
    const r = await s.req('POST', `/students/${st.id}/status`, office, { status: 'suspended', reason: 'Disciplinary' });
    expect(r.body.status).toBe('suspended');
    expect((await s.req('GET', '/auth/me', tok)).status).toBe(401);
    expect((await s.req('POST', '/auth/login', null, { identifier: st.credentials.student.username, password: st.credentials.student.temporaryPassword })).status).toBe(403);
    expect((await s.req('POST', `/students/${st.id}/status`, office, { status: 'active' })).body.status).toBe('active');
    expect((await s.req('POST', '/auth/login', null, { identifier: st.credentials.student.username, password: st.credentials.student.temporaryPassword })).status).toBe(200);
    expect((await audits('student.status')).filter((a) => a.entityId === st.id)).toHaveLength(2);
  });

  it('withdraw archives (never deletes): hidden from the default list, parents lose access, history and login state kept, reinstatement reopens the place', async () => {
    const parentCred = st.credentials.guardians[0];
    const ptok = await s.login(parentCred.username, parentCred.temporaryPassword);
    expect((await me(ptok)).body.profile.children).toHaveLength(1);

    const w = await s.req('POST', `/students/${st.id}/status`, office, { status: 'withdrawn', reason: 'Moved city' });
    expect(w.body).toMatchObject({ status: 'withdrawn', sectionId: null });
    const [row] = await s.db.select().from(students).where(eq(students.id, st.id));
    expect(row!.archivedAt).not.toBeNull();
    expect((await s.db.select().from(enrollments).where(eq(enrollments.studentId, st.id)))[0]!.status).toBe('left');
    expect((await s.req('GET', '/students?pageSize=100', office)).body.data.map((x: any) => x.id)).not.toContain(st.id);
    expect((await s.req('GET', '/students?status=withdrawn', office)).body.data.map((x: any) => x.id)).toContain(st.id);
    expect((await me(ptok)).body.profile.children).toEqual([]);
    expect((await s.req('GET', `/students/${st.id}`, office)).status).toBe(200); // still in the records
    expect((await s.req('POST', '/auth/login', null, { identifier: st.credentials.student.username, password: st.credentials.student.temporaryPassword })).status).toBe(403);

    const back = await s.req('POST', `/students/${st.id}/status`, office, { status: 'active' });
    expect(back.body).toMatchObject({ status: 'active', sectionId: s.ctx.sections[1]!.id });
    expect((await s.db.select().from(enrollments).where(eq(enrollments.studentId, st.id)))[0]!.status).toBe('enrolled');
    expect((await me(ptok)).body.profile.children).toHaveLength(1);
  });

  it('alumni: archived with a completed enrollment; cannot simply be reinstated or re-archived', async () => {
    const made = await s.req('POST', '/students', office, newStudent({ sectionId: s.ctx.sections[1]!.id, firstName: 'Alum', createLogin: true }));
    const id = made.body.id as string;
    const r = await s.req('POST', `/students/${id}/status`, office, { status: 'alumni', reason: 'Graduated' });
    expect(r.body).toMatchObject({ status: 'alumni', sectionId: null });
    expect((await s.db.select().from(enrollments).where(eq(enrollments.studentId, id)))[0]!.status).toBe('promoted');
    expect((await s.req('POST', `/students/${id}/status`, office, { status: 'withdrawn' })).body.code).toBe('INVALID_TRANSITION');
    expect((await s.req('POST', `/students/${id}/status`, office, { status: 'active' })).body.code).toBe('CANNOT_REINSTATE');
    expect((await s.req('POST', '/auth/login', null, { identifier: made.body.credentials.student.username, password: made.body.credentials.student.temporaryPassword })).status).toBe(403);
  });

  it('move section: updates enrollment + denormalised columns, respects capacity, refreshes scopes', async () => {
    const id = st.id;
    const [g7] = [s.ctx.sections[1]!.id];
    const before = await s.req('GET', `/students/${id}`, teacher);
    expect(before.status).toBe(200); // g7 section is assigned to t001
    const moved = await s.req('POST', `/students/${id}/move-section`, office, { sectionId: secB });
    expect(moved.status).toBe(409); // B is full (3/3)
    expect(moved.body.code).toBe('SECTION_FULL');
    const forced = await s.req('POST', `/students/${id}/move-section`, office, { sectionId: secB, force: true });
    expect(forced.status).toBe(200);
    expect(forced.body).toMatchObject({ sectionId: secB });
    const [enr] = await s.db.select().from(enrollments).where(eq(enrollments.studentId, id));
    expect(enr).toMatchObject({ sectionId: secB, status: 'enrolled' });
    const [stu] = await s.db.select().from(students).where(eq(students.id, id));
    expect(stu).toMatchObject({ currentSectionId: secB, currentGradeId: gradeId6 });
    // teacher no longer has the child (B is unassigned)
    expect((await s.req('GET', `/students/${id}`, teacher)).status).toBe(404);
    expect((await s.req('POST', `/students/${id}/move-section`, office, { sectionId: secB })).body.code).toBe('SAME_SECTION');
    // back to an assigned section with room
    expect((await s.req('POST', `/students/${id}/move-section`, office, { sectionId: g7 })).status).toBe(200);
    expect((await s.req('GET', `/students/${id}`, teacher)).status).toBe(200);
    expect((await s.req('POST', `/students/${id}/move-section`, teacher, { sectionId: g7 })).status).toBe(403);
    expect((await audits('student.move_section')).filter((a) => a.entityId === id)).toHaveLength(2);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────
describe('staff', () => {
  let newTeacher: any;

  it('permission matrix: HR creates; teachers see only themselves; accountants and students are out', async () => {
    expect((await s.req('GET', '/staff', accounts)).status).toBe(403);
    expect((await s.req('GET', '/staff', student0)).status).toBe(403);
    expect((await s.req('GET', '/staff', parent0)).status).toBe(403);
    const all = await s.req('GET', '/staff?pageSize=100', hr);
    expect(all.status).toBe(200);
    expect(all.body.meta.total).toBeGreaterThanOrEqual(s.ctx.teachers.length + 6);
    expect((await s.req('GET', '/staff', office)).status).toBe(200);
    expect((await s.req('GET', '/staff', principal)).status).toBe(200);
    const own = await s.req('GET', '/staff', teacher);
    expect(own.body.data).toHaveLength(1);
    const [t1row] = await s.db.select().from(staff).where(eq(staff.id, s.ctx.teachers[0]!.id));
    expect(own.body.data[0].employeeId).toBe(t1row!.employeeId);
    const other = s.ctx.teachers[1]!;
    expect((await s.req('GET', `/staff/${other.id}`, teacher)).status).toBe(404);
    expect((await s.req('GET', `/staff/${s.ctx.teachers[0]!.id}`, teacher)).status).toBe(200);
    for (const t of [teacher, office, principal, accounts]) expect((await s.req('POST', '/staff', t, { firstName: 'Nope' })).status).toBe(403);
  });

  it('creates a teacher: employee id, teacher role automatically, login with one-time password', async () => {
    const r = await s.req('POST', '/staff', hr, { firstName: 'Priya', lastName: 'Nambiar', designation: 'Maths Teacher', department: 'Maths', phone: '+91 98450 22211', email: 'priya.n@school.test', staffType: 'teaching' });
    expect(r.status).toBe(201);
    newTeacher = r.body;
    expect(r.body.employeeId).toMatch(/^EMP\d+$/);
    expect(r.body.roles).toEqual(['teacher']);
    expect(r.body.credentials.username).toBe(r.body.employeeId.toLowerCase());
    expect(r.body.credentials.temporaryPassword).toHaveLength(14);
    expect(r.body).toMatchObject({ hasLogin: true, status: 'active', userStatus: 'active', phone: '+919845022211' });
    const login = await s.req('POST', '/auth/login', null, { identifier: r.body.credentials.username, password: r.body.credentials.temporaryPassword });
    expect(login.status).toBe(200);
    expect(login.body.user).toMatchObject({ experience: 'teacher', mustChangePassword: true });
    // employee ids are sequential
    const r2 = await s.req('POST', '/staff', hr, { firstName: 'Sunil', staffType: 'non_teaching', designation: 'Clerk', createLogin: false });
    expect(Number(r2.body.employeeId.slice(3))).toBe(Number(r.body.employeeId.slice(3)) + 1);
    expect(r2.body).toMatchObject({ hasLogin: false, roles: [], credentials: null });
    expect((await audits('staff.create')).length).toBe(2);
  });

  it('other roles need roles:edit; a super administrator account needs a super administrator', async () => {
    const refused = await s.req('POST', '/staff', hr, { firstName: 'Anil', staffType: 'non_teaching', roleKeys: ['accountant'] });
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe('ROLES_EDIT_REQUIRED');
    const ok = await s.req('POST', '/staff', admin, { firstName: 'Anil', lastName: 'Kapoor', staffType: 'non_teaching', roleKeys: ['accountant'] });
    expect(ok.status).toBe(201);
    expect(ok.body.roles).toEqual(['accountant']);
    // a student-only role can never go to staff
    expect((await s.req('POST', '/staff', admin, { firstName: 'Bad', roleKeys: ['student'] })).body.code).toBe('ROLE_NOT_ALLOWED_FOR_USER_TYPE');
  });

  it('edit follows the login; duplicates refused; teachers cannot edit', async () => {
    expect((await s.req('PATCH', `/staff/${newTeacher.id}`, teacher, { designation: 'Boss' })).status).toBe(403);
    const r = await s.req('PATCH', `/staff/${newTeacher.id}`, hr, { designation: 'Senior Maths Teacher', email: 'priya.nambiar@school.test' });
    expect(r.body).toMatchObject({ designation: 'Senior Maths Teacher', email: 'priya.nambiar@school.test' });
    const [u] = await s.db.select().from(users).where(eq(users.id, newTeacher.userId));
    expect(u!.email).toBe('priya.nambiar@school.test');
    const clash = await s.req('PATCH', `/staff/${newTeacher.id}`, hr, { email: 'admin@test.school' });
    expect(clash.status).toBe(409);
  });

  it('workload is computed from the teaching assignments; teachers see only their own', async () => {
    const t1 = s.ctx.teachers[0]!;
    const mine = await s.req('GET', `/staff/${t1.id}/workload`, teacher);
    expect(mine.status).toBe(200);
    const expectedAssignments = s.ctx.assignments.filter((a) => a.staffId === t1.id).length;
    expect(mine.body.assignments).toHaveLength(expectedAssignments);
    expect(mine.body.sectionsLed.map((x: any) => x.sectionId)).toEqual([s.ctx.sections[0]!.id]);
    expect(mine.body.totals).toMatchObject({ subjects: expect.any(Number), periodsPerWeek: expectedAssignments * 5 });
    expect((await s.req('GET', `/staff/${t1.id}/workload`, hr)).body.totals).toEqual(mine.body.totals);
    expect((await s.req('GET', `/staff/${s.ctx.teachers[1]!.id}/workload`, teacher)).status).toBe(404);
    expect((await s.req('GET', `/staff/${newTeacher.id}/workload`, hr)).body.totals).toMatchObject({ sections: 0, subjects: 0 });
  });

  it('role assignment on a staff login needs roles:edit and refreshes the person’s token', async () => {
    const tok = await s.login(newTeacher.credentials.username, newTeacher.credentials.temporaryPassword);
    const roles = (await s.req('GET', '/roles', admin)).body.data;
    const hrRole = roles.find((r: any) => r.key === 'hr').id;
    const teacherRole = roles.find((r: any) => r.key === 'teacher').id;
    expect((await s.req('PUT', `/staff/${newTeacher.id}/roles`, hr, { roleIds: [teacherRole, hrRole] })).status).toBe(403);
    const r = await s.req('PUT', `/staff/${newTeacher.id}/roles`, admin, { roleIds: [teacherRole, hrRole] });
    expect(r.status).toBe(200);
    expect(r.body.roles.map((x: any) => x.key).sort()).toEqual(['hr', 'teacher']);
    expect((await s.req('GET', '/auth/me', tok)).body.code).toBe('TOKEN_STALE');
    await s.req('PUT', `/staff/${newTeacher.id}/roles`, admin, { roleIds: [teacherRole] });
  });

  it('deactivation: refused while they hold assignments; with release everything is cleared and the login dies', async () => {
    // simple case first: no assignments
    const tok = await s.login(newTeacher.credentials.username, newTeacher.credentials.temporaryPassword);
    expect((await s.req('POST', `/staff/${newTeacher.id}/deactivate`, teacher, {})).status).toBe(403);
    const ok = await s.req('POST', `/staff/${newTeacher.id}/deactivate`, hr, { status: 'resigned', reason: 'Relocated' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ status: 'resigned', userStatus: 'deactivated' });
    expect((await s.req('GET', '/auth/me', tok)).status).toBe(401);
    expect((await s.req('POST', `/staff/${newTeacher.id}/deactivate`, hr, {})).body.code).toBe('ALREADY_DEACTIVATED');
    expect((await s.req('POST', `/staff/${newTeacher.id}/reactivate`, hr)).body).toMatchObject({ status: 'active', userStatus: 'active' });

    // a teacher with sections and subjects
    const t4 = s.ctx.teachers[3]!;
    const refused = await s.req('POST', `/staff/${t4.id}/deactivate`, hr, {});
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('STAFF_HAS_ASSIGNMENTS');
    expect(refused.body.teachingAssignments).toBeGreaterThan(0);
    const rel = await s.req('POST', `/staff/${t4.id}/deactivate`, hr, { releaseAssignments: true, status: 'terminated' });
    expect(rel.status).toBe(200);
    expect(await s.db.select().from(teachingAssignments).where(eq(teachingAssignments.staffId, t4.id))).toHaveLength(0);
    expect((await audits('staff.deactivate')).length).toBe(2);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────
describe('admissions workflow', () => {
  const app = (extra: Record<string, unknown> = {}) => ({ firstName: 'Zoya', lastName: 'Khan', dob: '2016-05-06', gender: 'female', gradeAppliedId: gradeId6, guardianName: 'Imran Khan', guardianRelationship: 'father', guardianPhone: phoneSeq(), guardianEmail: 'imran.khan@mail.test', previousSchool: 'Sunrise School', ...extra });
  let a1: any;

  it('permission matrix', async () => {
    for (const t of [teacher, accounts, student0, parent0, hr]) expect((await s.req('GET', '/admissions', t)).status).toBe(403);
    for (const t of [teacher, principal, accounts, parent0]) expect((await s.req('POST', '/admissions', t, app())).status).toBe(403);
    expect((await s.req('GET', '/admissions', principal)).status).toBe(200);
    expect((await s.req('GET', '/admissions', office)).status).toBe(200);
  });

  it('staff enters an application; numbers are sequential; validation', async () => {
    const r = await s.req('POST', '/admissions', office, app({ documents: [await mkFile()] }));
    expect(r.status).toBe(201);
    a1 = r.body;
    expect(a1).toMatchObject({ status: 'submitted', gradeAppliedName: expect.any(String), academicYearName: s.ctx.yearName, studentId: null });
    expect(a1.applicationNo).toMatch(new RegExp(`^APP-${s.ctx.yearName.slice(0, 4)}-0001$`));
    const r2 = await s.req('POST', '/admissions', office, app({ firstName: 'Yash' }));
    expect(r2.body.applicationNo).toMatch(/-0002$/);
    expect((await s.req('POST', '/admissions', office, app({ guardianPhone: 'abc' }))).status).toBe(422);
    expect((await s.req('POST', '/admissions', office, app({ gradeAppliedId: '00000000-0000-4000-8000-000000000000' }))).body.code).toBe('GRADE_NOT_FOUND');
    expect((await s.req('POST', '/admissions', office, app({ documents: ['00000000-0000-4000-8000-000000000000'] }))).body.code).toBe('ATTACHMENT_NOT_FOUND');
    const list = await s.req('GET', '/admissions?status=submitted', principal);
    expect(list.body.meta.total).toBe(2);
    expect((await s.req('GET', `/admissions?q=${a1.applicationNo}`, office)).body.data).toHaveLength(1);
    const edit = await s.req('PATCH', `/admissions/${a1.id}`, office, { previousSchool: 'Delhi Public School' });
    expect(edit.body.previousSchool).toBe('Delhi Public School');
    expect((await s.req('PATCH', `/admissions/${a1.id}`, principal, { notes: 'x' })).status).toBe(403);
  });

  it('state machine: submitted → under_review → accepted | waitlisted | rejected; invalid jumps and permissions', async () => {
    const skip = await s.req('POST', `/admissions/${a1.id}/status`, office, { status: 'accepted' });
    expect(skip.status).toBe(409);
    expect(skip.body.code).toBe('INVALID_TRANSITION');
    expect((await s.req('POST', `/admissions/${a1.id}/status`, teacher, { status: 'under_review' })).status).toBe(403);
    expect((await s.req('POST', `/admissions/${a1.id}/status`, principal, { status: 'under_review' })).status).toBe(403); // review is clerical (admissions:edit)
    expect((await s.req('POST', `/admissions/${a1.id}/status`, office, { status: 'under_review' })).body.status).toBe('under_review');
    const noReason = await s.req('POST', `/admissions/${a1.id}/status`, principal, { status: 'rejected' });
    expect(noReason.status).toBe(422);
    const w = await s.req('POST', `/admissions/${a1.id}/status`, principal, { status: 'waitlisted', note: 'Sections full' });
    expect(w.body).toMatchObject({ status: 'waitlisted', decisionNote: 'Sections full', decidedAt: expect.any(String) });
    expect((await s.req('POST', `/admissions/${a1.id}/enroll`, office, { sectionId: secA })).body.code).toBe('ADMISSION_NOT_ACCEPTED');
    expect((await s.req('POST', `/admissions/${a1.id}/status`, principal, { status: 'accepted' })).body.status).toBe('accepted');
    expect((await s.req('POST', `/admissions/${a1.id}/status`, office, { status: 'under_review' })).body.code).toBe('INVALID_TRANSITION'); // an accepted offer cannot go back to review
    expect((await audits('admission.accepted')).length).toBe(1);
    expect((await audits('admission.waitlisted')).length).toBe(1);
  });

  it('enrolling creates student + parent + verified link + enrollment in one transaction', async () => {
    // wrong grade
    const wrong = await s.req('POST', `/admissions/${a1.id}/enroll`, office, { sectionId: s.ctx.sections[1]!.id });
    expect(wrong.status).toBe(422);
    expect(wrong.body.code).toBe('GRADE_MISMATCH');
    for (const t of [teacher, principal, accounts, parent0]) expect((await s.req('POST', `/admissions/${a1.id}/enroll`, t, { sectionId: secA })).status).toBe(403);
    expect((await s.db.select().from(students).where(eq(students.firstName, 'Zoya'))).length).toBe(0);

    const r = await s.req('POST', `/admissions/${a1.id}/enroll`, office, { sectionId: secA });
    expect(r.status).toBe(200);
    expect(r.body.admission).toMatchObject({ status: 'enrolled', studentId: r.body.studentId });
    expect(r.body.guardianLinkVerified).toBe(true);
    expect(r.body.credentials.student.username).toBe(r.body.admissionNo.toLowerCase());
    expect(r.body.credentials.guardian.username).toBe(a1.guardianPhone.replace(/\s/g, ''));

    const student = (await s.req('GET', `/students/${r.body.studentId}`, office)).body;
    expect(student).toMatchObject({ firstName: 'Zoya', gender: 'female', sectionId: secA, status: 'active' });
    expect(student.enrollments).toHaveLength(1);
    expect(student.guardians[0]).toMatchObject({ verified: true, name: 'Imran Khan', relationship: 'father' });
    expect((await s.req('GET', `/students/${r.body.studentId}/documents`, office)).body.data).toHaveLength(1); // admission documents carried over

    // the parent signs in and sees the child immediately
    const ptok = await s.login(r.body.credentials.guardian.username, r.body.credentials.guardian.temporaryPassword);
    expect((await me(ptok)).body.profile.children.map((c: any) => c.studentId)).toEqual([r.body.studentId]);

    expect((await s.req('POST', `/admissions/${a1.id}/enroll`, office, { sectionId: secA })).body.code).toBe('ALREADY_ENROLLED');
    expect((await s.req('PATCH', `/admissions/${a1.id}`, office, { notes: 'late' })).body.code).toBe('INVALID_STATE');
    expect((await audits('admission.enroll')).length).toBe(1);
  });

  it('a sibling reuses the registered parent: the link waits for verification unless the school confirms', async () => {
    const phone = a1.guardianPhone;
    const sib = async (verify: boolean, name: string) => {
      const created = await s.req('POST', '/admissions', office, app({ firstName: name, guardianPhone: phone }));
      await s.req('POST', `/admissions/${created.body.id}/status`, office, { status: 'under_review' });
      await s.req('POST', `/admissions/${created.body.id}/status`, principal, { status: 'accepted' });
      return s.req('POST', `/admissions/${created.body.id}/enroll`, office, { sectionId: secA, verifyExistingGuardian: verify });
    };
    const first = await sib(false, 'Sibling One');
    expect(first.status).toBe(200);
    expect(first.body.guardianLinkVerified).toBe(false);
    expect(first.body.credentials.guardian).toBeNull();
    expect(await s.db.select().from(guardians).where(eq(guardians.phone, phone.replace(/\s/g, '')))).toHaveLength(1);
    const second = await sib(true, 'Sibling Two');
    expect(second.body.guardianLinkVerified).toBe(true);
    const gid = first.body.guardianId;
    expect(second.body.guardianId).toBe(gid);
    const [g] = await s.db.select().from(guardians).where(eq(guardians.id, gid));
    const ptok = await s.login(phone.replace(/\s/g, ''), (await s.req('POST', `/users/${g!.userId}/reset-password`, admin)).body.temporaryPassword);
    expect((await me(ptok)).body.profile.children).toHaveLength(2); // original child + the verified sibling; the unverified one stays hidden
  });

  it('rejection and reopening', async () => {
    const r = await s.req('POST', '/admissions', office, app({ firstName: 'Rejected' }));
    await s.req('POST', `/admissions/${r.body.id}/status`, office, { status: 'under_review' });
    const rej = await s.req('POST', `/admissions/${r.body.id}/status`, principal, { status: 'rejected', note: 'No seat in this grade' });
    expect(rej.body).toMatchObject({ status: 'rejected', decisionNote: 'No seat in this grade' });
    expect((await s.req('POST', `/admissions/${r.body.id}/enroll`, office, { sectionId: secA })).body.code).toBe('ADMISSION_NOT_ACCEPTED');
    expect((await s.req('POST', `/admissions/${r.body.id}/status`, principal, { status: 'under_review' })).body.status).toBe('under_review');
    expect((await audits('admission.rejected')).length).toBe(1);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────
describe('bulk import', () => {
  const header = 'First Name,Last Name,DOB,Gender,Grade,Section,Guardian Name,Guardian Phone,Guardian Email';
  const countStudents = async () => (await s.db.select({ id: students.id }).from(students)).length;

  it('parses CSV (quotes, commas, BOM, CRLF)', () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n\r\n1,2')).toEqual([['a', 'b'], ['x, y', 'say "hi"'], ['1', '2']]);
  });

  it('permission matrix and input shape', async () => {
    for (const t of [teacher, principal, parent0, student0, hr]) expect((await s.req('POST', '/students/import', t, { csv: `${header}\nA,B,,,Grade 6,Big,,,` }))?.status).toBe(403);
    expect((await s.req('POST', '/students/import', office, {})).status).toBe(422);
    expect((await s.req('POST', '/students/import', office, { csv: 'x', rows: [] })).status).toBe(422);
    expect((await s.req('POST', '/students/import', office, { rows: Array.from({ length: 501 }, () => ({ firstName: 'a' })) })).status).toBe(422);
    expect((await s.req('POST', '/students/import', office, { csv: 'Foo,Bar\n1,2' })).body.code).toBe('MISSING_COLUMNS');
  });

  it('dry run reports every row’s problems and creates nothing', async () => {
    const before = await countStudents();
    const csv = [
      header,
      `Asha,Verma,2015-04-02,F,Grade 6,Big,Rohit Verma,${phoneSeq()},rohit@mail.test`,
      `Bad,Date,31/02/2015,M,Grade 6,Big,,,`,
      `Nosection,Kid,2015-01-01,M,Grade 6,Q,,,`,
      `,NoFirst,2015-01-01,M,Grade 6,Big,,,`,
      `Oddgender,Kid,2015-01-01,robot,Grade 6,Big,,,`,
      `Badphone,Kid,2015-01-01,M,Grade 6,Big,Parent,12,`,
      `Ravi,Menon,02/03/2015,M,Grade 6,Big,"Menon, Suresh",${phoneSeq()},`,
    ].join('\n');
    const r = await s.req('POST', '/students/import', office, { csv });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ dryRun: true, total: 7, valid: 2, invalid: 5, created: 0, seats: { ok: true, adding: 2 } });
    expect(r.body.rows[0]).toMatchObject({ row: 2, ok: true, errors: [] });
    expect(r.body.rows[1].errors[0]).toMatch(/Date of birth/);
    expect(r.body.rows[2].errors[0]).toMatch(/no section/i);
    expect(r.body.rows[3].errors[0]).toMatch(/First name/);
    expect(r.body.rows[4].errors[0]).toMatch(/Gender/);
    expect(r.body.rows[5].errors.join(' ')).toMatch(/phone/i);
    expect(r.body.rows[6]).toMatchObject({ ok: true, name: 'Ravi Menon' });
    expect(r.body.credentials).toEqual([]);
    expect(await countStudents()).toBe(before);
  });

  it('a real run with bad rows is rejected whole (422 + report) unless skipInvalid; valid rows get logins and verified new parents', async () => {
    const before = await countStudents();
    const p1 = phoneSeq();
    const csv = [header, `Ira,Bose,2015-04-02,F,Grade 6,Big,Anup Bose,${p1},`, `Tara,Bose,2016-04-02,F,Grade 6,Big,Anup Bose,${p1},`, `Broken,Row,not-a-date,M,Grade 6,Big,,,`].join('\n');
    const strict = await s.req('POST', '/students/import', office, { csv, dryRun: false });
    expect(strict.status).toBe(422);
    expect(strict.body.code).toBe('IMPORT_HAS_ERRORS');
    expect(strict.body.report.invalid).toBe(1);
    expect(await countStudents()).toBe(before);

    const r = await s.req('POST', '/students/import', office, { csv, dryRun: false, skipInvalid: true });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ dryRun: false, created: 2, valid: 2, invalid: 1 });
    expect(r.body.rows.filter((x: any) => x.studentId)).toHaveLength(2);
    expect(await countStudents()).toBe(before + 2);
    // siblings (same phone) share one parent; the parent's login is reported once
    expect(r.body.credentials).toHaveLength(2);
    expect(r.body.credentials.filter((c: any) => c.guardian)).toHaveLength(1);
    expect(r.body.credentials[0].student.temporaryPassword).toHaveLength(14);
    expect(await s.db.select().from(guardians).where(eq(guardians.phone, p1))).toHaveLength(1);
    const links = await s.db.select().from(studentGuardians).innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId)).where(eq(guardians.phone, p1));
    expect(links).toHaveLength(2);
    expect(links.every((l) => l.student_guardians.verifiedAt)).toBe(true);
    // the parent can sign in and sees both children
    const cred = r.body.credentials.find((c: any) => c.guardian).guardian;
    const ptok = await s.login(cred.username, cred.temporaryPassword);
    expect((await me(ptok)).body.profile.children).toHaveLength(2);
    // students sign in too, and are enrolled in the chosen section for the current year
    const stu = r.body.credentials[0];
    expect((await s.req('POST', '/auth/login', null, { identifier: stu.student.username, password: stu.student.temporaryPassword })).status).toBe(200);
    const [enr] = await s.db.select().from(enrollments).where(eq(enrollments.studentId, r.body.rows.find((x: any) => x.studentId).studentId));
    expect(enr).toMatchObject({ sectionId: secBig, academicYearId: s.ctx.yearId, status: 'enrolled' });
    expect((await audits('student.import')).length).toBe(1);

    // a phone that belongs to a registered parent: linked but NOT verified, with a warning
    const again = await s.req('POST', '/students/import', office, { rows: [{ firstName: 'Third', lastName: 'Bose', grade: 'Grade 6', section: 'Big', guardianName: 'Anup Bose', guardianPhone: p1 }], dryRun: false, createLogins: false });
    expect(again.status).toBe(200);
    expect(again.body.rows[0].warnings[0]).toMatch(/already belongs to a registered parent/);
    const unv = await s.db.select().from(studentGuardians).where(eq(studentGuardians.studentId, again.body.rows[0].studentId));
    expect(unv[0]!.verifiedAt).toBeNull();
    // an already-used admission number or email is a row error
    const dup = await s.req('POST', '/students/import', office, { rows: [{ firstName: 'Dup', grade: 'Grade 6', section: 'Big', admissionNo: stu.admissionNo }] });
    expect(dup.body.rows[0].errors[0]).toMatch(/already in use/);
  });

  it('imports 500 rows in chunks without logins', async () => {
    const before = await countStudents();
    const rows = Array.from({ length: 500 }, (_, i) => ({ firstName: `Bulk${i}`, lastName: 'Kid', dob: '2015-06-01', gender: 'male', grade: 'Grade 6', section: 'Bulk', guardianName: `Parent ${i}`, guardianPhone: `97${String(10000000 + i)}` }));
    const t0 = Date.now();
    const r = await s.req('POST', '/students/import', office, { rows, dryRun: false, createLogins: false });
    expect(r.status).toBe(200);
    expect(r.body.created).toBe(500);
    expect(await countStudents()).toBe(before + 500);
    expect(Date.now() - t0).toBeLessThan(30_000);
    const nos = r.body.rows.map((x: any) => x.admissionNo);
    expect(new Set(nos).size).toBe(500);
    // the section is now exactly full (500/500): the capacity is enforced across the batch
    const over = await s.req('POST', '/students/import', office, { rows: Array.from({ length: 5 }, (_, i) => ({ firstName: `Over${i}`, grade: 'Grade 6', section: 'Bulk' })) });
    expect(over.body.invalid).toBe(5);
    expect(over.body.rows.find((x: any) => !x.ok).errors[0]).toMatch(/full/);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────
describe('seat limits (per student per academic year)', () => {
  const usage = async () => (await s.req('GET', '/license', admin)).body.seats.used as number;
  const setLimit = async (licensed: number, policy: 'block' | 'allow_and_bill') => {
    await upsertSubscription({ tenantCode: s.tenant.code, academicYear: s.ctx.yearName, startsOn: '2000-01-01', endsOn: '2999-12-31', pricePerStudent: 100, licensedStudents: licensed, overagePolicy: policy });
    invalidateLicense(s.tenant.id);
  };

  it('block policy: every way of adding an enrollment answers 402 once the committed seats are used', async () => {
    await setLimit(100000, 'block');
    const used = await usage();
    await setLimit(used, 'block');
    const before = (await s.db.select({ id: students.id }).from(students)).length;

    const manual = await s.req('POST', '/students', office, newStudent({ sectionId: secBig }));
    expect(manual.status).toBe(402);
    expect(manual.body.code).toBe('LICENSE_LIMIT_REACHED');

    const dry = await s.req('POST', '/students/import', office, { rows: [{ firstName: 'Seat', grade: 'Grade 6', section: 'Big' }, { firstName: 'Seat2', grade: 'Grade 6', section: 'Big' }] });
    expect(dry.status).toBe(200);
    expect(dry.body.seats).toMatchObject({ ok: false, code: 'LICENSE_LIMIT_REACHED', adding: 2 });
    const real = await s.req('POST', '/students/import', office, { rows: [{ firstName: 'Seat', grade: 'Grade 6', section: 'Big' }], dryRun: false, createLogins: false });
    expect(real.status).toBe(402);

    const adm = await s.req('POST', '/admissions', office, { firstName: 'Seatless', gradeAppliedId: gradeId6, guardianName: 'P', guardianPhone: phoneSeq() });
    await s.req('POST', `/admissions/${adm.body.id}/status`, office, { status: 'under_review' });
    await s.req('POST', `/admissions/${adm.body.id}/status`, principal, { status: 'accepted' });
    const enrol = await s.req('POST', `/admissions/${adm.body.id}/enroll`, office, { sectionId: secBig });
    expect(enrol.status).toBe(402);
    // nothing was created, the admission is still accepted
    expect((await s.db.select({ id: students.id }).from(students)).length).toBe(before);
    expect((await s.db.select().from(admissions).where(eq(admissions.id, adm.body.id)))[0]!.status).toBe('accepted');

    // moving between sections and editing never need a seat
    expect((await s.req('PATCH', `/students/${child0().id}`, office, { bloodGroup: 'A+' })).status).toBe(200);

    // room for exactly one more: a batch of two is refused as a whole, one fits
    await setLimit(used + 1, 'block');
    const two = await s.req('POST', '/students/import', office, { rows: [{ firstName: 'Seat', grade: 'Grade 6', section: 'Big' }, { firstName: 'Seat2', grade: 'Grade 6', section: 'Big' }], dryRun: false, createLogins: false });
    expect(two.status).toBe(402);
    expect(await usage()).toBe(used);
    expect((await s.req('POST', `/admissions/${adm.body.id}/enroll`, office, { sectionId: secBig, createStudentLogin: false, createParentLogin: false })).status).toBe(200);
    expect(await usage()).toBe(used + 1);
  });

  it('allow_and_bill never blocks; the school is read-only once the subscription is expired', async () => {
    const used = await usage();
    await setLimit(used, 'allow_and_bill');
    expect((await s.req('POST', '/students', office, newStudent({ sectionId: secBig }))).status).toBe(201);
    expect((await s.req('GET', '/license', admin)).body.seats.overBy).toBe(1);
    await upsertSubscription({ tenantCode: s.tenant.code, academicYear: s.ctx.yearName, startsOn: '2000-01-01', endsOn: '2001-01-01', pricePerStudent: 100, licensedStudents: 10, graceDays: 1 });
    invalidateLicense(s.tenant.id);
    const ro = await s.req('POST', '/students', office, newStudent({ sectionId: secBig }));
    expect(ro.status).toBe(402);
    expect(ro.body.code).toBe('SUBSCRIPTION_EXPIRED');
    expect((await s.req('GET', '/students', office)).status).toBe(200); // reads keep working
    await setLimit(100000, 'allow_and_bill');
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────
describe('self-service profile', () => {
  it('shows each person their own details; a parent only their verified children’s emergency contacts', async () => {
    const st = (await s.req('GET', '/me/profile', student0)).body;
    expect(st).toMatchObject({ userType: 'student', username: child0().username });
    expect(st.emergencyContacts).toHaveLength(1);
    expect(st.emergencyContacts[0].studentId).toBe(child0().id);
    const pa = (await s.req('GET', '/me/profile', parent0)).body;
    expect(pa.userType).toBe('parent');
    expect(pa.emergencyContacts.map((c: any) => c.studentId).sort()).toEqual((await me(parent0)).body.profile.children.map((c: any) => c.studentId).sort());
    expect((await s.req('GET', '/me/profile', unverified)).body.emergencyContacts).toEqual([]);
    const te = (await s.req('GET', '/me/profile', teacher)).body;
    expect(te).toMatchObject({ userType: 'staff', staff: { employeeId: expect.any(String) } });
    expect((await s.req('GET', '/me/profile')).status).toBe(401);
  });

  it('students and parents change only their permitted fields', async () => {
    const r = await s.req('PATCH', '/me/profile', student0, { phone: '98450 55501', address: { line1: '5 Park Street', city: 'Chennai' }, emergencyContacts: [{ name: 'Granny', relationship: 'grandparent', phone: '9845055502' }], firstName: 'Hacked', admissionNo: 'X' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ phone: '9845055501', address: { city: 'Chennai' } });
    expect(r.body.emergencyContacts[0].contacts[0].name).toBe('Granny');
    // official fields are untouched (unknown keys are ignored)
    const [row] = await s.db.select().from(students).where(eq(students.id, child0().id));
    expect(row!.firstName).not.toBe('Hacked');
    expect(row!.admissionNo).toBe(child0().admissionNo);
    expect((await audits('profile.update')).length).toBeGreaterThanOrEqual(1);

    // parent: phone / address, emergency contacts of a LINKED child only
    const kids = (await me(parent0)).body.profile.children.map((c: any) => c.studentId) as string[];
    expect(kids.length).toBeGreaterThanOrEqual(2); // many children per parent (set up above)
    const noChild = await s.req('PATCH', '/me/profile', parent0, { emergencyContacts: [{ name: 'Uncle', phone: '9845055503' }] });
    expect(noChild.status).toBe(422);
    expect(noChild.body.code).toBe('STUDENT_REQUIRED');
    const ok = await s.req('PATCH', '/me/profile', parent0, { studentId: kids[0], emergencyContacts: [{ name: 'Uncle', phone: '9845055503' }], address: { city: 'Pune' } });
    expect(ok.status).toBe(200);
    expect(ok.body.address).toMatchObject({ city: 'Pune' });
    const otherFamily = s.ctx.students[8]!;
    expect((await s.req('PATCH', '/me/profile', parent0, { studentId: otherFamily.id, emergencyContacts: [{ name: 'Evil', phone: '9845055504' }] })).status).toBe(404);
    const [unchanged] = await s.db.select().from(students).where(eq(students.id, otherFamily.id));
    expect(unchanged!.emergencyContacts.some((c) => c.name === 'Evil')).toBe(false);
    // a child whose link is unverified is not reachable either
    const [g] = await s.db.select({ id: guardians.id }).from(guardians).where(eq(guardians.phone, '9099999999'));
    expect(g).toBeTruthy();
    expect((await s.req('PATCH', '/me/profile', unverified, { studentId: child0().id, emergencyContacts: [{ name: 'Evil', phone: '9845055505' }] })).status).toBe(404);
  });

  it('changing the email needs the current password; phone/email must be unique', async () => {
    expect((await s.req('PATCH', '/me/profile', student0, { email: 'new.student@mail.test' })).body.code).toBe('PASSWORD_REQUIRED');
    expect((await s.req('PATCH', '/me/profile', student0, { email: 'new.student@mail.test', currentPassword: 'wrong' })).status).toBe(401);
    const ok = await s.req('PATCH', '/me/profile', student0, { email: 'New.Student@mail.test', currentPassword: PASSWORD });
    expect(ok.body.email).toBe('new.student@mail.test');
    expect((await me(student0)).body.email).toBe('new.student@mail.test');
    const clash = await s.req('PATCH', '/me/profile', parent0, { phone: '9845055501' });
    expect(clash.status).toBe(409);
    expect(clash.body.code).toBe('PHONE_TAKEN');
    expect((await s.req('PATCH', '/me/profile', student0, { phone: 'abc' })).status).toBe(422);
  });

  it('staff update their own contact details only', async () => {
    const r = await s.req('PATCH', '/me/profile', teacher, { phone: '9845066601', address: { city: 'Mysuru' }, emergencyContact: { name: 'Spouse', phone: '9845066602' } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ phone: '9845066601', address: { city: 'Mysuru' }, staff: { emergencyContact: { name: 'Spouse' } } });
    const [st] = await s.db.select().from(staff).where(eq(staff.id, s.ctx.teachers[0]!.id));
    expect(st!.phone).toBe('9845066601');
    expect(st!.designation).not.toBe('Boss');
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────
describe('record-correction requests', () => {
  let reqId: string;
  const target = () => s.ctx.students[1]!; // another family from child0
  let tokenOfTarget: string;
  let parentOfTarget: string;

  beforeAll(async () => {
    const g = s.ctx.guardians.find((x) => x.studentIds.includes(target().id))!;
    parentOfTarget = await s.login(g.username);
    tokenOfTarget = await s.login(target().username);
  });

  it('only a verified-linked parent or the student themselves can ask; everyone else gets 404', async () => {
    const body = { changes: { dob: '2014-12-12' }, reason: 'Birth certificate says 12 December' };
    for (const t of [parent0, unverified, teacher, principal, student0]) expect((await s.req('POST', `/students/${target().id}/correction-requests`, t, body)).status, 'other').toBe(404);
    const r = await s.req('POST', `/students/${target().id}/correction-requests`, parentOfTarget, body);
    expect(r.status).toBe(201);
    reqId = r.body.id;
    expect(r.body).toMatchObject({ status: 'pending', requesterRole: 'parent', studentId: target().id, changes: { dob: '2014-12-12' } });
    expect(r.body.original).toHaveProperty('dob');
    // nothing changed yet
    const [row] = await s.db.select().from(students).where(eq(students.id, target().id));
    expect(row!.dob).not.toBe('2014-12-12');
    expect((await audits('student.correction_request')).length).toBe(1);
    // reviewers were told
    const reviewerNotes = await s.db.select().from(notifications).where(eq(notifications.type, 'system.correction_requested'));
    expect(reviewerNotes.length).toBeGreaterThan(0);
    const reviewerIds = reviewerNotes.map((n) => n.userId);
    expect(reviewerIds).toContain((await s.db.select({ id: users.id }).from(users).where(eq(users.username, 'office')))[0]!.id);
    expect(reviewerIds).not.toContain(s.ctx.guardians[0]!.userId);
  });

  it('validates what can be corrected', async () => {
    const t = target().id;
    expect((await s.req('POST', `/students/${t}/correction-requests`, parentOfTarget, { changes: { admissionNo: 'X1' }, reason: 'because' })).status).toBe(422); // not a whitelisted field
    expect((await s.req('POST', `/students/${t}/correction-requests`, parentOfTarget, { changes: {}, reason: 'because' })).status).toBe(422);
    expect((await s.req('POST', `/students/${t}/correction-requests`, parentOfTarget, { changes: { dob: 'tomorrow' }, reason: 'because' })).status).toBe(422);
    expect((await s.req('POST', `/students/${t}/correction-requests`, parentOfTarget, { changes: { bloodGroup: 'O+' } })).status).toBe(422); // a reason is required
    const [cur] = await s.db.select().from(students).where(eq(students.id, t));
    expect((await s.req('POST', `/students/${t}/correction-requests`, parentOfTarget, { changes: { gender: cur!.gender }, reason: 'same value' })).body.code).toBe('NO_CHANGE');
  });

  it('visibility: reviewers see all, requesters only their own, strangers nothing', async () => {
    const mine = await s.req('GET', '/correction-requests', parentOfTarget);
    expect(mine.body.data.map((x: any) => x.id)).toEqual([reqId]);
    expect((await s.req('GET', '/correction-requests', parent0)).body.data).toEqual([]);
    expect((await s.req('GET', `/correction-requests/${reqId}`, parent0)).status).toBe(404);
    expect((await s.req('GET', `/correction-requests/${reqId}`, teacher)).status).toBe(404);
    expect((await s.req('GET', '/correction-requests?status=pending', office)).body.data.map((x: any) => x.id)).toContain(reqId);
    expect((await s.req('GET', `/correction-requests/${reqId}`, office)).body).toMatchObject({ studentName: expect.any(String), requestedByName: expect.any(String) });
  });

  it('only students:edit holders decide; approval applies the change atomically with audit and notifies the requester', async () => {
    for (const t of [teacher, principal, parentOfTarget, accounts]) expect((await s.req('POST', `/correction-requests/${reqId}/approve`, t, {})).status).toBe(403);
    const r = await s.req('POST', `/correction-requests/${reqId}/approve`, office, { note: 'Verified against the certificate' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'approved', decisionNote: 'Verified against the certificate', decidedBy: expect.any(String) });
    const [row] = await s.db.select().from(students).where(eq(students.id, target().id));
    expect(row!.dob).toBe('2014-12-12');
    const upd = (await audits('student.update')).find((a) => a.entityId === target().id && (a.after as any).dob === '2014-12-12');
    expect(upd).toBeTruthy();
    expect((upd!.before as any).dob).not.toBe('2014-12-12');
    expect((await audits('student.correction_approve')).length).toBe(1);
    const notes = await s.db.select().from(notifications).where(and(eq(notifications.type, 'system.correction_decided')));
    expect(notes.some((n) => n.title.includes('approved'))).toBe(true);
    expect((await s.req('POST', `/correction-requests/${reqId}/approve`, office, {})).body.code).toBe('NOT_PENDING');
    expect((await s.req('POST', `/correction-requests/${reqId}/reject`, office, { note: 'too late' })).body.code).toBe('NOT_PENDING');
  });

  it('rejection needs a reason and changes nothing; the student can file too; requesters can withdraw', async () => {
    const t = target().id;
    const fromStudent = await s.req('POST', `/students/${t}/correction-requests`, tokenOfTarget, { changes: { address: { line1: '9 New Road', city: 'Zzyzx' } }, reason: 'We moved' });
    expect(fromStudent.status).toBe(201);
    expect(fromStudent.body.requesterRole).toBe('student');
    const id = fromStudent.body.id as string;
    expect((await s.req('POST', `/correction-requests/${id}/reject`, office, {})).status).toBe(422);
    const rej = await s.req('POST', `/correction-requests/${id}/reject`, office, { note: 'Please bring the proof of address' });
    expect(rej.body.status).toBe('rejected');
    const [row] = await s.db.select().from(students).where(eq(students.id, t));
    expect(JSON.stringify(row!.address)).not.toContain('Zzyzx');

    const another = await s.req('POST', `/students/${t}/correction-requests`, parentOfTarget, { changes: { religion: 'Hindu' }, reason: 'Missing' });
    expect((await s.req('POST', `/correction-requests/${another.body.id}/cancel`, parent0)).status).toBe(404);
    expect((await s.req('POST', `/correction-requests/${another.body.id}/cancel`, parentOfTarget)).body.status).toBe('cancelled');
    expect((await s.req('POST', `/correction-requests/${another.body.id}/cancel`, parentOfTarget)).body.code).toBe('NOT_PENDING');
  });

  it('caps how many pending requests one person can pile up', async () => {
    const t = target().id;
    let last = 0;
    for (let i = 0; i < 6; i++) last = (await s.req('POST', `/students/${t}/correction-requests`, parentOfTarget, { changes: { nationality: `Nation${i}` }, reason: 'testing the cap' })).status;
    expect(last).toBe(429);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────
describe('demo seed', () => {
  it('produces admissions in every state and correction requests, and application numbers continue afterwards', async () => {
    const t = await createTestSchool();
    await seedPeople(t.ctx);
    const adm = await t.db.select().from(admissions);
    expect(new Set(adm.map((a) => a.status))).toEqual(new Set(['submitted', 'under_review', 'waitlisted', 'accepted', 'rejected', 'enrolled']));
    expect(adm.filter((a) => a.status === 'enrolled').every((a) => a.studentId)).toBe(true);
    const tok = await t.login('office');
    const list = await t.req('GET', '/admissions?pageSize=100', tok);
    expect(list.body.meta.total).toBe(adm.length);
    const pending = await t.req('GET', '/correction-requests?status=pending', tok);
    expect(pending.body.data.length).toBeGreaterThanOrEqual(3);
    expect((await t.req('GET', '/correction-requests?status=approved', tok)).body.data).toHaveLength(1);
    expect((await t.req('GET', '/correction-requests?status=rejected', tok)).body.data).toHaveLength(1);
    // a requester sees only their own seeded request
    const g0 = await t.login(t.ctx.guardians[0]!.username);
    expect((await t.req('GET', '/correction-requests', g0)).body.data).toHaveLength(1);
    // numbering carries on after the seeded applications
    const next = await t.req('POST', '/admissions', tok, { firstName: 'After', gradeAppliedId: t.ctx.grades[0]!.id, guardianName: 'P', guardianPhone: '9812345678' });
    expect(next.status).toBe(201);
    expect(next.body.applicationNo).toBe(`APP-${t.ctx.yearName.slice(0, 4)}-${String(adm.length + 1).padStart(4, '0')}`);
  });
});
