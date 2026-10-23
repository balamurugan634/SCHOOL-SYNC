import { desc, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { PERMISSION_CATALOG, SYSTEM_ROLE_KEYS } from '@school-sync/shared';
import { csvCell } from '../src/modules/settings/audit';
import { auditLogs, files, notifications, users } from '../src/db/tenant/schema';
import { createTestSchool, PASSWORD, type TestSchool } from './helpers';

let s: TestSchool;
let admin: string;
let office: string;
let principal: string;
let hr: string;
let accounts: string;
let teacher: string;
let student: string;

const auditRows = (action: string) => s.db.select().from(auditLogs).where(eq(auditLogs.action, action)).orderBy(desc(auditLogs.at));
const roleIdByKey = async (key: string): Promise<string> => (await s.req('GET', '/roles', admin)).body.data.find((r: any) => r.key === key).id;
const userIdByName = async (username: string): Promise<string> => (await s.db.select({ id: users.id }).from(users).where(eq(users.username, username)))[0]!.id;

beforeAll(async () => {
  s = await createTestSchool();
  [admin, office, principal, hr, accounts, teacher, student] = await Promise.all([s.login('admin@test.school'), s.login('office'), s.login('principal'), s.login('hr'), s.login('accounts'), s.login('t001'), s.login(s.ctx.students[0]!.username)]);
});

describe('permission catalog & roles', () => {
  it('serves the catalog to roles:view holders only', async () => {
    const r = await s.req('GET', '/permissions/catalog', admin);
    expect(r.status).toBe(200);
    expect(r.body.scopes).toEqual(['own', 'linked', 'assigned', 'school']);
    expect(r.body.systemRoles.map((x: any) => x.key).sort()).toEqual([...SYSTEM_ROLE_KEYS].sort());
    const allPerms = r.body.modules.flatMap((m: any) => m.resources.flatMap((x: any) => x.actions.map((a: any) => a.permission)));
    expect(allPerms).toHaveLength(Object.values(PERMISSION_CATALOG).reduce((n, d) => n + d.actions.length, 0));
    expect((await s.req('GET', '/permissions/catalog', office)).status).toBe(200); // administrator holds roles:view
    for (const t of [teacher, student, principal, accounts]) expect((await s.req('GET', '/permissions/catalog', t)).status).toBe(403);
    expect((await s.req('GET', '/permissions/catalog')).status).toBe(401);
  });

  it('lists roles with counts and shows one role’s grants as { permission: scope }', async () => {
    const list = await s.req('GET', '/roles', office);
    expect(list.status).toBe(200);
    const teacherRole = list.body.data.find((r: any) => r.key === 'teacher');
    expect(teacherRole).toMatchObject({ isSystem: true, userCount: expect.any(Number) });
    expect(teacherRole.userCount).toBeGreaterThan(0);
    const detail = await s.req('GET', `/roles/${teacherRole.id}`, office);
    expect(detail.body.grants['attendance:create']).toBe('assigned');
    expect((await s.req('GET', `/roles/${teacherRole.id}`, hr)).status).toBe(403);
  });

  it('creates a custom role (validated) — only roles:create holders', async () => {
    const body = { name: 'Lab Assistant', description: 'Science lab', grants: { 'academics:view': 'school', 'students:view': 'assigned' } };
    expect((await s.req('POST', '/roles', office, body)).status).toBe(403); // administrator has roles:view only
    expect((await s.req('POST', '/roles', teacher, body)).status).toBe(403);
    const ok = await s.req('POST', '/roles', admin, body);
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ key: 'lab_assistant', isSystem: false, userCount: 0, grants: { 'academics:view': 'school', 'students:view': 'assigned' } });

    expect((await s.req('POST', '/roles', admin, body)).body.code).toBe('ROLE_KEY_TAKEN');
    expect((await s.req('POST', '/roles', admin, { name: 'Teacher' })).body.code).toBe('ROLE_KEY_RESERVED');
    const unknown = await s.req('POST', '/roles', admin, { name: 'Weird', grants: { 'banana:eat': 'school' } });
    expect(unknown.status).toBe(422);
    expect(unknown.body.code).toBe('UNKNOWN_PERMISSION');
    expect((await s.req('POST', '/roles', admin, { name: 'Weird2', grants: { 'students:view': 'galaxy' } })).status).toBe(422);
    expect((await auditRows('role.create')).length).toBe(1);
  });

  it('edits grants with a partial map, audits before/after, and keeps system roles undeletable', async () => {
    const lab = (await s.req('GET', '/roles', admin)).body.data.find((r: any) => r.key === 'lab_assistant');
    const put = await s.req('PUT', `/roles/${lab.id}/permissions`, admin, { grants: { 'attendance:view': 'assigned', 'students:view': null } });
    expect(put.status).toBe(200);
    expect(put.body.grants).toEqual({ 'academics:view': 'school', 'attendance:view': 'assigned' });
    expect((await s.req('PUT', `/roles/${lab.id}/permissions`, admin, { grants: { nope: 'school' } })).body.code).toBe('UNKNOWN_PERMISSION');
    expect((await s.req('PUT', `/roles/${lab.id}/permissions`, office, { grants: { 'attendance:view': 'school' } })).status).toBe(403);

    const [entry] = await auditRows('role.permissions');
    expect(entry!.entityId).toBe(lab.id);
    expect((entry!.before as any)['students:view']).toBe('assigned');
    expect((entry!.after as any)['attendance:view']).toBe('assigned');
    expect(entry!.actorUserId).toBeTruthy();

    // system roles: grants editable, never deletable; super_admin is locked
    const librarian = await roleIdByKey('librarian');
    expect((await s.req('PUT', `/roles/${librarian}/permissions`, admin, { grants: { 'reports:view': 'school' } })).body.grants['reports:view']).toBe('school');
    const del = await s.req('DELETE', `/roles/${librarian}`, admin);
    expect(del.status).toBe(409);
    expect(del.body.code).toBe('ROLE_SYSTEM');
    const sa = await roleIdByKey('super_admin');
    expect((await s.req('PUT', `/roles/${sa}/permissions`, admin, { grants: { 'users:view': null } })).body.code).toBe('SUPER_ADMIN_LOCKED');
  });

  it('only grants what the editor holds themselves (without super_admin)', async () => {
    const lab = (await s.req('GET', '/roles', admin)).body.data.find((r: any) => r.key === 'lab_assistant');
    // a role-admin who can edit roles but not hand out finance
    const roleAdmin = await s.req('POST', '/roles', admin, { name: 'Role Admin', grants: { 'roles:view': 'school', 'roles:edit': 'school', 'users:view': 'school', 'users:edit': 'school', 'users:create': 'school' } });
    const made = await s.req('POST', '/users', admin, { displayName: 'Role Admin', username: 'roleadmin', roleIds: [roleAdmin.body.id] });
    expect(made.status).toBe(201);
    const tok = await s.login('roleadmin', made.body.temporaryPassword);
    const tooMuch = await s.req('PUT', `/roles/${lab.id}/permissions`, tok, { grants: { 'fees:approve': 'school' } });
    expect(tooMuch.status).toBe(403);
    expect(tooMuch.body.code).toBe('CANNOT_GRANT_BEYOND_OWN_ACCESS');
    const fine = await s.req('PUT', `/roles/${lab.id}/permissions`, tok, { grants: { 'users:view': 'school' } });
    expect(fine.status).toBe(200);
    await s.req('PUT', `/roles/${lab.id}/permissions`, admin, { grants: { 'users:view': null } });
  });
});

describe('role changes take effect for the holders', () => {
  let labTech: { id: string; password: string; token: string };

  it('a grant change makes holders’ tokens stale; a fresh sign-in has the new rights', async () => {
    const lab = (await s.req('GET', '/roles', admin)).body.data.find((r: any) => r.key === 'lab_assistant');
    const made = await s.req('POST', '/users', admin, { displayName: 'Lab Tech', username: 'labtech', roleIds: [lab.id] });
    expect(made.status).toBe(201);
    expect(made.body.mustChangePassword).toBe(true);
    labTech = { id: made.body.id, password: made.body.temporaryPassword, token: await s.login('labtech', made.body.temporaryPassword) };
    expect((await s.req('GET', '/academics/overview', labTech.token)).status).toBe(200);
    const [before] = await s.db.select({ v: users.authVersion }).from(users).where(eq(users.id, labTech.id));

    expect((await s.req('PUT', `/roles/${lab.id}/permissions`, admin, { grants: { 'academics:view': null } })).status).toBe(200);
    const stale = await s.req('GET', '/academics/overview', labTech.token);
    expect(stale.status).toBe(401);
    expect(stale.body.code).toBe('TOKEN_STALE');
    const [after] = await s.db.select({ v: users.authVersion }).from(users).where(eq(users.id, labTech.id));
    expect(after!.v).toBe(before!.v + 1);

    const fresh = await s.login('labtech', labTech.password);
    expect((await s.req('GET', '/academics/overview', fresh)).status).toBe(403);
    expect((await s.req('GET', '/auth/me', fresh)).body.permissions['attendance:view']).toBe('assigned');
  });

  it('assigning / removing roles on a user: needs roles:edit, refreshes access, notifies, audits', async () => {
    const lab = (await s.req('GET', '/roles', admin)).body.data.find((r: any) => r.key === 'lab_assistant');
    const librarian = await roleIdByKey('librarian');
    const before = await s.login('labtech', labTech.password);
    expect((await s.req('GET', '/auth/me', before)).status).toBe(200);

    // administrator has users:edit but not roles:edit
    expect((await s.req('PUT', `/users/${labTech.id}/roles`, office, { roleIds: [lab.id, librarian] })).status).toBe(403);
    const put = await s.req('PUT', `/users/${labTech.id}/roles`, admin, { roleIds: [lab.id, librarian] });
    expect(put.status).toBe(200);
    expect(put.body.changed).toBe(true);
    expect(put.body.roles.map((r: any) => r.key).sort()).toEqual(['lab_assistant', 'librarian']);
    expect((await s.req('GET', '/auth/me', before)).body.code).toBe('TOKEN_STALE');
    const fresh = await s.login('labtech', labTech.password);
    expect((await s.req('GET', '/auth/me', fresh)).body.permissions['library:view']).toBe('school');

    // the same set again changes nothing
    expect((await s.req('PUT', `/users/${labTech.id}/roles`, admin, { roleIds: [lab.id, librarian] })).body.changed).toBe(false);
    const removed = await s.req('DELETE', `/users/${labTech.id}/roles/${librarian}`, admin);
    expect(removed.body.roles.map((r: any) => r.key)).toEqual(['lab_assistant']);
    const added = await s.req('POST', `/users/${labTech.id}/roles`, admin, { roleId: librarian });
    expect(added.body.roles).toHaveLength(2);

    const notes = await s.db.select().from(notifications).where(eq(notifications.userId, labTech.id));
    expect(notes.some((n) => n.type === 'system.access_changed')).toBe(true);
    const rows = await auditRows('user.roles');
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect((rows.at(-1)!.before as any).roles).toEqual(['lab_assistant']);
    // a role in use cannot be deleted
    expect((await s.req('DELETE', `/roles/${lab.id}`, admin)).body.code).toBe('ROLE_IN_USE');
  });

  it('guards: role/user-type fit, own roles, super administrator protection', async () => {
    const teacherRole = await roleIdByKey('teacher');
    const studentUser = await userIdByName(s.ctx.students[0]!.username);
    const bad = await s.req('PUT', `/users/${studentUser}/roles`, admin, { roleIds: [teacherRole] });
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe('ROLE_NOT_ALLOWED_FOR_USER_TYPE');

    const adminId = await userIdByName('admin@test.school');
    const self = await s.req('PUT', `/users/${adminId}/roles`, admin, { roleIds: [] });
    expect(self.status).toBe(403);
    expect(self.body.code).toBe('CANNOT_MODIFY_SELF');
    expect((await s.req('POST', `/users/${adminId}/deactivate`, admin)).body.code).toBe('CANNOT_MODIFY_SELF');

    // the office (users:edit/delete) must not touch a super administrator's account
    expect((await s.req('POST', `/users/${adminId}/reset-password`, office)).body.code).toBe('ONLY_SUPER_ADMIN');
    expect((await s.req('POST', `/users/${adminId}/deactivate`, office)).body.code).toBe('ONLY_SUPER_ADMIN');
    expect((await s.req('POST', `/users/${adminId}/force-logout`, office)).body.code).toBe('ONLY_SUPER_ADMIN');
    expect((await s.req('POST', '/users', office, { displayName: 'Sneaky', roleIds: [await roleIdByKey('super_admin')] })).status).toBe(403);
    // without roles:edit a plain account can still be created
    const hrMade = await s.req('POST', '/users', hr, { displayName: 'Front Desk', email: 'desk@test.school' });
    expect(hrMade.status).toBe(201);
    expect(hrMade.body.username).toMatch(/^emp\d+$/);
    expect(hrMade.body.roles).toEqual([]);
  });
});

describe('user accounts', () => {
  it('lists with search and filters; permission matrix', async () => {
    expect((await s.req('GET', '/users', accounts)).status).toBe(403);
    expect((await s.req('GET', '/users', teacher)).status).toBe(403);
    expect((await s.req('GET', '/users', student)).status).toBe(403);
    const all = await s.req('GET', '/users?userType=student&pageSize=100', hr);
    expect(all.status).toBe(200);
    expect(all.body.meta.total).toBe(s.ctx.students.length);
    expect(all.body.data[0]).toMatchObject({ userType: 'student', roles: [{ key: 'student' }], studentId: expect.any(String) });
    expect(JSON.stringify(all.body)).not.toMatch(/passwordHash|password_hash|argon2/i);

    const byName = await s.req('GET', `/users?q=${s.ctx.students[0]!.username}`, office);
    expect(byName.body.data.map((u: any) => u.username)).toEqual([s.ctx.students[0]!.username]);
    const teachers = await s.req('GET', '/users?roleKey=class_teacher', office);
    expect(teachers.body.meta.total).toBe(s.ctx.sections.length);
    expect((await s.req('GET', '/users?status=deactivated', office)).body.data).toEqual([]);
    const detail = await s.req('GET', `/users/${all.body.data[0].id}`, office);
    expect(detail.body).toMatchObject({ activeSessions: expect.any(Number), failedLoginCount: 0 });
  });

  it('creates a staff login with a one-time temporary password; duplicates are refused', async () => {
    const created = await s.req('POST', '/users', office, { displayName: 'Meera Joshi', username: 'meera.joshi', email: 'meera@test.school' });
    expect(created.status).toBe(201);
    expect(created.body.temporaryPassword).toHaveLength(14);
    expect(created.body).toMatchObject({ userType: 'staff', status: 'active', mustChangePassword: true, staffId: expect.any(String) });
    expect((await s.req('GET', `/users/${created.body.id}`, office)).body.temporaryPassword).toBeUndefined();
    const login = await s.req('POST', '/auth/login', null, { identifier: 'meera.joshi', password: created.body.temporaryPassword });
    expect(login.status).toBe(200);
    expect(login.body.user.mustChangePassword).toBe(true);
    const dupe = await s.req('POST', '/users', office, { displayName: 'Another', username: 'meera.joshi' });
    expect(dupe.status).toBe(409);
    expect(dupe.body.code).toBe('USERNAME_TAKEN');
    expect((await s.req('POST', '/users', teacher, { displayName: 'Nope' })).status).toBe(403);
    expect((await auditRows('user.create')).length).toBeGreaterThanOrEqual(1);
  });

  it('deactivate / reactivate: sessions die, sign-in blocked until reactivated', async () => {
    const id = await userIdByName('t004');
    const tok = await s.login('t004');
    expect((await s.req('GET', '/auth/me', tok)).status).toBe(200);
    expect((await s.req('POST', `/users/${id}/deactivate`, teacher)).status).toBe(403);
    const d = await s.req('POST', `/users/${id}/deactivate`, office);
    expect(d.status).toBe(200);
    expect(d.body.status).toBe('deactivated');
    expect((await s.req('GET', '/auth/me', tok)).status).toBe(401);
    expect((await s.req('POST', '/auth/login', null, { identifier: 't004', password: PASSWORD })).status).toBe(403);
    expect((await s.req('POST', `/users/${id}/reactivate`, office)).body.status).toBe('active');
    expect((await s.req('POST', '/auth/login', null, { identifier: 't004', password: PASSWORD })).status).toBe(200);
    expect((await auditRows('user.deactivate')).length).toBe(1);
    expect((await auditRows('user.reactivate')).length).toBe(1);
  });

  it('admin password reset: shown once, must change, all sessions revoked, hashes never leak', async () => {
    const id = await userIdByName('t003');
    const oldToken = await s.login('t003');
    const r = await s.req('POST', `/users/${id}/reset-password`, office);
    expect(r.status).toBe(200);
    expect(r.body.username).toBe('t003');
    const temp = r.body.temporaryPassword as string;
    expect(temp).toBeTruthy();
    expect((await s.req('GET', '/auth/me', oldToken)).status).toBe(401);
    expect((await s.req('POST', '/auth/login', null, { identifier: 't003', password: PASSWORD })).status).toBe(401);
    const login = await s.req('POST', '/auth/login', null, { identifier: 't003', password: temp });
    expect(login.status).toBe(200);
    expect(login.body.user.mustChangePassword).toBe(true);
    const [row] = await auditRows('user.reset_password');
    expect(JSON.stringify(row)).not.toContain(temp);
    expect((await s.req('POST', `/users/${id}/reset-password`, teacher)).status).toBe(403);
  });

  it('unlocks a locked account, forces logout, lists and revokes individual sessions', async () => {
    const id = await userIdByName('t002');
    for (let i = 0; i < 5; i++) await s.req('POST', '/auth/login', null, { identifier: 't002', password: 'wrong-password' });
    const locked = await s.req('POST', '/auth/login', null, { identifier: 't002', password: PASSWORD });
    expect(locked.status).toBe(423);
    expect((await s.req('GET', `/users/${id}`, office)).body.locked).toBe(true);
    expect((await s.req('POST', `/users/${id}/unlock`, office)).body.locked).toBe(false);
    const a = await s.req('POST', '/auth/login', null, { identifier: 't002', password: PASSWORD });
    const b = await s.req('POST', '/auth/login', null, { identifier: 't002', password: PASSWORD });
    expect(a.status).toBe(200);

    const sessions = await s.req('GET', `/users/${id}/sessions`, office);
    expect(sessions.body.data).toHaveLength(2);
    expect(JSON.stringify(sessions.body)).not.toMatch(/hash/i);
    const one = await s.req('DELETE', `/users/${id}/sessions/${a.body.sessionId}`, office);
    expect(one.status).toBe(200);
    expect((await s.req('GET', '/auth/me', a.body.accessToken)).status).toBe(401);
    expect((await s.req('GET', '/auth/me', b.body.accessToken)).status).toBe(200);
    const out = await s.req('POST', `/users/${id}/force-logout`, office);
    expect(out.body).toMatchObject({ ok: true, revoked: 1 });
    expect((await s.req('GET', '/auth/me', b.body.accessToken)).status).toBe(401);
    expect((await s.req('GET', `/users/${id}/sessions`, office)).body.data).toEqual([]);
    expect((await auditRows('user.unlock')).length).toBe(1);
    expect((await auditRows('user.force_logout')).length).toBe(1);
  });
});

describe('school settings', () => {
  it('reads defaults, validates updates, audits before/after', async () => {
    const g = await s.req('GET', '/settings/attendance', office);
    expect(g.status).toBe(200);
    expect(g.body).toMatchObject({ mode: 'daily', shortagePercent: 75 });
    const all = await s.req('GET', '/settings', office);
    expect(Object.keys(all.body)).toEqual(expect.arrayContaining(['attendance', 'academic', 'school', 'exams', 'fees', 'notifications']));

    const put = await s.req('PUT', '/settings/attendance', office, { shortagePercent: 80 });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ shortagePercent: 80, mode: 'daily' }); // untouched fields are kept
    expect((await s.req('GET', '/settings/attendance', office)).body.shortagePercent).toBe(80);

    const bad = await s.req('PUT', '/settings/attendance', office, { shortagePercent: 150 });
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe('VALIDATION_ERROR');
    expect((await s.req('PUT', '/settings/attendance', office, { nonsense: true })).body.code).toBe('UNKNOWN_SETTING');
    expect((await s.req('GET', '/settings/nope', office)).status).toBe(404);

    const [entry] = await auditRows('settings.update');
    expect(entry).toMatchObject({ entity: 'settings', entityId: 'attendance' });
    expect((entry!.before as any).shortagePercent).toBe(75);
    expect((entry!.after as any).shortagePercent).toBe(80);
  });

  it('permission matrix', async () => {
    for (const t of [teacher, student, principal, accounts]) {
      expect((await s.req('GET', '/settings/attendance', t)).status).toBe(403);
      expect((await s.req('PUT', '/settings/attendance', t, { mode: 'period' })).status).toBe(403);
      expect((await s.req('GET', '/setup/status', t)).status).toBe(403);
    }
    expect((await s.req('GET', '/settings/attendance')).status).toBe(401);
  });

  it('branding updates the control-plane school record, so /site/info reflects it', async () => {
    const [file] = await s.db.insert(files).values({ storageKey: `logo-${Date.now()}`, originalName: 'logo.png', mimeType: 'image/png', sizeBytes: 1234, purpose: 'other' }).returning({ id: files.id });
    const put = await s.req('PUT', '/settings/branding', office, { name: 'Green Valley Public School', shortName: 'GVPS', primaryColor: '#112233', accentColor: '#FFAA00', logoFileId: file!.id });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ name: 'Green Valley Public School', shortName: 'GVPS', primaryColor: '#112233', accentColor: '#ffaa00', logoFileId: file!.id, logoUrl: '/api/v1/site/logo' });
    const info = await s.req('GET', '/site/info');
    expect(info.body).toMatchObject({ name: 'Green Valley Public School', shortName: 'GVPS', primaryColor: '#112233', accentColor: '#ffaa00', logoUrl: '/api/v1/site/logo' });
    expect((await s.req('GET', '/settings/branding', office)).body.logoFileId).toBe(file!.id);

    expect((await s.req('PUT', '/settings/branding', office, { primaryColor: 'blue' })).status).toBe(422);
    expect((await s.req('PUT', '/settings/branding', office, { logoFileId: '00000000-0000-4000-8000-000000000000' })).body.code).toBe('ATTACHMENT_NOT_FOUND');
    expect((await s.req('PUT', '/settings/branding', teacher, { name: 'Hacked School' })).status).toBe(403);

    const removed = await s.req('PUT', '/settings/branding', office, { logoFileId: null });
    expect(removed.body).toMatchObject({ logoFileId: null, logoUrl: null });
    expect((await s.req('GET', '/site/info')).body.logoUrl).toBeNull();
    expect((await auditRows('branding.update')).length).toBe(2);
  });

  it('feature toggles are for super administrators only', async () => {
    expect((await s.req('GET', '/settings/features', office)).body).toMatchObject({ fees: true, studentLogin: true });
    const refused = await s.req('PUT', '/settings/features', office, { studentLogin: false });
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe('ONLY_SUPER_ADMIN');

    const off = await s.req('PUT', '/settings/features', admin, { studentLogin: false, library: false });
    expect(off.status).toBe(200);
    expect(off.body).toMatchObject({ studentLogin: false, library: false, fees: true });
    expect((await s.req('GET', '/site/info')).body.features).toMatchObject({ studentLogin: false, library: false });
    const blocked = await s.req('POST', '/auth/login', null, { identifier: s.ctx.students[1]!.username, password: PASSWORD });
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('STUDENT_LOGIN_DISABLED');

    expect((await s.req('PUT', '/settings/features', admin, { studentLogin: true, library: true })).status).toBe(200);
    expect((await s.req('POST', '/auth/login', null, { identifier: s.ctx.students[1]!.username, password: PASSWORD })).status).toBe(200);
    expect((await auditRows('features.update')).length).toBe(2);
  });
});

describe('audit viewer', () => {
  it('is for audit:view holders; filters by prefix, entity, actor and dates', async () => {
    expect((await s.req('GET', '/audit', office)).status).toBe(403);
    expect((await s.req('GET', '/audit', teacher)).status).toBe(403);
    const all = await s.req('GET', '/audit?limit=100', principal);
    expect(all.status).toBe(200);
    expect(all.body.data.length).toBeGreaterThan(10);
    expect(all.body.data[0]).toMatchObject({ action: expect.any(String), entity: expect.any(String), at: expect.any(String) });
    expect(all.body.data[0].before).toBeUndefined();

    const roles = await s.req('GET', '/audit?action=role.&limit=100', admin);
    expect(roles.body.data.length).toBeGreaterThan(0);
    expect(roles.body.data.every((e: any) => e.action.startsWith('role.'))).toBe(true);
    const ent = await s.req('GET', '/audit?entity=settings&limit=100', admin);
    expect(ent.body.data.every((e: any) => e.entity === 'settings')).toBe(true);
    const adminId = await userIdByName('admin@test.school');
    const byActor = await s.req('GET', `/audit?actorUserId=${adminId}&limit=100`, admin);
    expect(byActor.body.data.length).toBeGreaterThan(0);
    expect(byActor.body.data.every((e: any) => e.actorUserId === adminId)).toBe(true);
    // dates are interpreted in the SCHOOL's timezone, so don't build "today" from UTC (wrong for ~5.5 h a day in India): use a far-future bound
    expect((await s.req('GET', '/audit?from=2000-01-01&to=2999-12-31&limit=5', admin)).body.data.length).toBe(5);
    expect((await s.req('GET', '/audit?from=2000-01-01&to=2000-12-31', admin)).body.data).toEqual([]);
    // injected LIKE wildcards are plain text
    expect((await s.req('GET', '/audit?action=%25', admin)).body.data).toEqual([]);
  });

  it('keyset pagination walks the whole trail without gaps or repeats', async () => {
    const total = (await s.db.select({ id: auditLogs.id }).from(auditLogs)).length;
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 500; guard++) {
      const page: any = await s.req('GET', `/audit?limit=7${cursor ? `&cursor=${cursor}` : ''}`, admin);
      expect(page.status).toBe(200);
      seen.push(...page.body.data.map((e: any) => e.id));
      cursor = page.body.nextCursor;
      if (!cursor) break;
    }
    // new rows may appear while paging (our own reads are not audited, but logins are): never fewer, never duplicates
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBeGreaterThanOrEqual(total);
    expect((await s.req('GET', '/audit?cursor=garbage', admin)).status).toBe(400);
  });

  it('detail includes before/after; secrets are redacted', async () => {
    const [entry] = await auditRows('role.permissions');
    const d = await s.req('GET', `/audit/${entry!.id}`, principal);
    expect(d.status).toBe(200);
    expect(d.body.before).toBeTruthy();
    expect(d.body.after).toBeTruthy();
    const all = JSON.stringify((await s.db.select().from(auditLogs)).map((r) => [r.before, r.after, r.summary]));
    expect(all).not.toMatch(/Demo@12345/);
    expect(all).not.toMatch(/\$argon2/);
  });

  it('exports CSV for audit:export holders, and audits the export', async () => {
    expect((await s.req('GET', '/audit/export', principal)).status).toBe(403); // audit:view only
    expect((await s.req('GET', '/audit/export', office)).status).toBe(403);
    const r = await s.app.inject({ method: 'GET', url: '/api/v1/audit/export?action=role.', headers: { 'x-tenant': s.tenant.code, authorization: `Bearer ${admin}` } });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('text/csv');
    expect(r.headers['content-disposition']).toContain('attachment');
    const lines = r.body.trim().split('\r\n');
    expect(lines[0]).toBe('at,actor_user_id,actor_name,action,entity,entity_id,summary,ip,request_id,before,after');
    expect(lines.length).toBeGreaterThan(2);
    expect((await auditRows('audit.export')).length).toBe(1);
  });

  it('defuses spreadsheet formulas in CSV cells', () => {
    expect(csvCell('=HYPERLINK("http://evil")')).toBe(`"'=HYPERLINK(""http://evil"")"`);
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell(null)).toBe('');
  });
});

describe('setup checklist', () => {
  it('reports each onboarding step with { key, done, count, hint } and the licence', async () => {
    const r = await s.req('GET', '/setup/status', office);
    expect(r.status).toBe(200);
    const by = Object.fromEntries(r.body.steps.map((x: any) => [x.key, x]));
    expect(Object.keys(by)).toEqual(['school_profile', 'academic_year', 'terms', 'grades', 'sections', 'subjects', 'teaching_assignments', 'teachers', 'students', 'parents_linked', 'timetable', 'fee_structure', 'communication']);
    for (const step of r.body.steps) expect(step).toMatchObject({ key: expect.any(String), done: expect.any(Boolean), count: expect.any(Number), hint: expect.any(String) });
    expect(by.school_profile.done).toBe(false);
    expect(by.academic_year).toMatchObject({ done: true, count: 1 });
    expect(by.terms.done).toBe(true);
    expect(by.grades.count).toBe(s.ctx.grades.length);
    expect(by.sections).toMatchObject({ done: true, count: s.ctx.sections.length });
    expect(by.subjects.count).toBe(s.ctx.subjects.length);
    expect(by.teaching_assignments.done).toBe(true);
    expect(by.teachers.count).toBeGreaterThanOrEqual(s.ctx.teachers.length);
    expect(by.students.count).toBe(s.ctx.students.length);
    expect(by.parents_linked.done).toBe(true);
    expect(by.parents_linked.hint).toMatch(/1 link/); // the demo's unverified parent
    expect(by.timetable.done).toBe(false);
    expect(by.fee_structure.done).toBe(false);
    expect(by.communication.done).toBe(false);
    expect(r.body.ready).toBe(false);
    expect(r.body.progress).toMatchObject({ total: 13 });
    expect(r.body.progress.done).toBe(r.body.steps.filter((x: any) => x.done).length);
    expect(r.body.license).toMatchObject({ state: 'unlicensed', readOnly: false, seats: { licensed: null } });
  });

  it('steps flip to done as the school gets set up', async () => {
    await s.req('PUT', '/settings/school', office, { address: '12 Lake Road, Bengaluru', phone: '+91 80 1234 5678' });
    expect((await s.req('GET', '/setup/status', office)).body.steps.find((x: any) => x.key === 'school_profile').done).toBe(true);

    // a section without a class teacher keeps the step open
    const g = s.ctx.sections[0]!.gradeId;
    await s.req('POST', '/academics/sections', office, { gradeId: g, name: 'Z' });
    const after = await s.req('GET', '/setup/status', office);
    const sections = after.body.steps.find((x: any) => x.key === 'sections');
    expect(sections.done).toBe(false);
    expect(sections.hint).toMatch(/class teacher/);

    // fees switched off → nothing to set up there
    await s.req('PUT', '/settings/features', admin, { fees: false });
    expect((await s.req('GET', '/setup/status', office)).body.steps.find((x: any) => x.key === 'fee_structure').done).toBe(true);
    await s.req('PUT', '/settings/features', admin, { fees: true });
  });
});
