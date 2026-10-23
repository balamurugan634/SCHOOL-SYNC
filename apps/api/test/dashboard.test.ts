import { beforeAll, describe, expect, it } from 'vitest';
import { createTestSchool, type TestSchool } from './helpers';

let s: TestSchool;
beforeAll(async () => {
  s = await createTestSchool({ modules: true });
});

describe('role dashboards', () => {
  it('student: own day only, never another role’s home', async () => {
    const t = await s.login(s.ctx.students[0]!.username);
    const r = await s.req('GET', '/dashboard/student', t);
    expect(r.status).toBe(200);
    expect(r.body.student.id).toBe(s.ctx.students[0]!.id);
    expect(r.body.homework.pendingCount).toBeGreaterThanOrEqual(0);
    expect(r.body.announcements.latest.length).toBeLessThanOrEqual(3);
    for (const other of ['parent', 'teacher', 'management']) expect((await s.req('GET', `/dashboard/${other}`, t)).status, other).toBe(403);
  });

  it('parent: lists only verified children; selected child must be linked', async () => {
    const g = s.ctx.guardians[0]!;
    const t = await s.login(g.username);
    const r = await s.req('GET', '/dashboard/parent', t);
    expect(r.status).toBe(200);
    expect(r.body.children.map((c: any) => c.student.id).sort()).toEqual([...g.studentIds].sort());
    expect(g.studentIds).toContain(r.body.selectedStudentId);
    // asking for somebody else's child silently falls back to a linked child — never leaks
    const other = s.ctx.students.find((x) => !g.studentIds.includes(x.id))!;
    const r2 = await s.req('GET', `/dashboard/parent?studentId=${other.id}`, t);
    expect(r2.status).toBe(200);
    expect(r2.body.children.map((c: any) => c.student.id)).not.toContain(other.id);
    expect(g.studentIds).toContain(r2.body.selectedStudentId);
  });

  it('parent with an unverified link sees an empty home', async () => {
    const t = await s.login('9099999999');
    const r = await s.req('GET', '/dashboard/parent', t);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ children: [], selectedStudentId: null, child: null, fees: null });
    expect(r.body.announcements.latest).toHaveLength(0);
  });

  it('teacher: own classes and queues', async () => {
    const t = await s.login('t001');
    const r = await s.req('GET', '/dashboard/teacher', t);
    expect(r.status).toBe(200);
    expect(r.body.staff.id).toBe(s.ctx.teachers[0]!.id);
    expect(r.body.attendance.role).toBe('teacher');
    expect(r.body.marks.pendingCount).toBeGreaterThanOrEqual(r.body.marks.returnedCount);
  });

  it('management: every block is permission-gated, not just hidden', async () => {
    const principal = (await s.req('GET', '/dashboard/management', await s.login('principal'))).body;
    expect(principal.attendance).not.toBeNull();
    expect(principal.kpis.students).toBe(s.ctx.students.length);
    expect(principal.approvals.concessions).toBeNull(); // principal can't approve fee concessions

    const accounts = (await s.req('GET', '/dashboard/management', await s.login('accounts'))).body;
    expect(accounts.attendance).toBeNull();
    expect(accounts.finance).not.toBeNull();
    expect(accounts.approvals.studentLeave).toBeNull();
    expect(accounts.approvals.refunds).not.toBeNull();

    const librarian = (await s.req('GET', '/dashboard/management', await s.login('librarian'))).body;
    expect(librarian.attendance).toBeNull();
    expect(librarian.finance).toBeNull();
    expect(librarian.license).toBeNull();
  });

  it('requires authentication', async () => {
    expect((await s.req('GET', '/dashboard/student')).status).toBe(401);
  });
});
