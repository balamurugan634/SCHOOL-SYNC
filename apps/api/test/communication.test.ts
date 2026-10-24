import { and, eq, inArray, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { announcements, auditLogs, devices, eventRegistrations, events, examPapers, exams, homework, meetings, notificationPreferences, notifications, users } from '../src/db/tenant/schema';
import { upsertSubscription } from '../src/core/billing/invoicing';
import { invalidateLicense } from '../src/core/billing/license';
import { runJobOnce } from '../src/core/jobs';
import { dispatchPush, notify } from '../src/core/notify';
import { setPushProvider, type PushMessage, type PushProvider } from '../src/core/notify/push';
import { flushPushQueue } from '../src/core/notify/queue';
import { invalidatePrincipal } from '../src/core/rbac/principal';
import { putSetting } from '../src/core/settings';
import { jobs } from '../src/modules/communication/jobs';
import { createTestSchool, type TestSchool } from './helpers';
import { PDF, guardianOf, parentOnlyIn, parentWithout, sectionWithout, sectionsOfTeacher, studentsIn, teacherWithout, upload } from './upload-helpers';

// the email channel is exercised with a fake mailer
const mails: { to: string; subject: string; text: string }[] = [];
vi.mock('../src/core/email', () => ({
  enqueueMails: async (_tenant: unknown, list: { to: string; subject: string; text: string }[]) => {
    mails.push(...list);
    return list.map(() => ({ id: 'mock' }));
  },
  enqueueMail: async (_tenant: unknown, m: { to: string; subject: string; text: string }) => {
    mails.push(m);
    return { id: 'mock' };
  },
  kickFlush: () => undefined,
  flushSchool: async () => ({ sent: 0, failed: 0, retrying: 0, busy: false }),
  EmailInputError: class EmailInputError extends Error {},
}));

let s: TestSchool;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const DAY = 86_400_000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
const ymd = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);

let clsTeacher: { id: string; userId: string; username: string }; // class teacher of secA
let plainTeacher: { id: string; userId: string; username: string }; // a teacher without the class_teacher role
let outsider: { id: string; userId: string; username: string }; // teaches nothing in secA
let secA: string;
let secB: string;
let gradeA: string;
let studA: ReturnType<typeof studentsIn>[number];
let studB: ReturnType<typeof studentsIn>[number];
let parentA: { username: string; userId: string; studentIds: string[] };
let parentB: { username: string; userId: string; studentIds: string[] };
let tokens: Record<string, string> = {};

const tok = async (u: string) => (tokens[u] ??= await s.login(u));
const userIdOf = async (username: string) => (await s.db.select({ id: users.id }).from(users).where(eq(users.username, username)))[0]!.id;
const req = async (who: string | null, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown) => s.req(method, path, who ? await tok(who) : null, body);
const notifsOf = (type: string, userIds?: string[]) => s.db.select().from(notifications).where(userIds ? and(eq(notifications.type, type), inArray(notifications.userId, userIds)) : eq(notifications.type, type));

beforeAll(async () => {
  s = await createTestSchool({ size: 'full' });
  const c = s.ctx;
  const t0 = c.teachers[0]!;
  clsTeacher = { ...t0, userId: await userIdOf(t0.username) };
  plainTeacher = { ...c.teachers[14]!, userId: await userIdOf(c.teachers[14]!.username) };
  secA = c.sections[0]!.id;
  gradeA = c.sections[0]!.gradeId;
  secB = sectionWithout(c, plainTeacher.id).id === secA ? c.sections[1]!.id : sectionWithout(c, plainTeacher.id).id;
  studA = studentsIn(c, secA)[0]!;
  studB = studentsIn(c, secB)[0]!;
  const pa = parentOnlyIn(c, secA).guardian;
  parentA = { username: pa.username, userId: pa.userId, studentIds: pa.studentIds };
  const pb = parentWithout(c, secA);
  parentB = { username: pb.username, userId: pb.userId, studentIds: pb.studentIds };
  const o = teacherWithout(c, secA);
  outsider = { ...o, userId: await userIdOf(o.username) };
});

afterAll(() => setPushProvider(undefined));

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('announcements: permissions and audience rules', () => {
  const body = (audience: unknown[], extra: Record<string, unknown> = {}) => ({ title: 'Test circular', body: 'Please read.', audience, ...extra });

  it('permission matrix for creating and listing', async () => {
    const section = [{ type: 'section', id: secA }];
    expect((await req(studA.username, 'POST', '/announcements', body(section))).status).toBe(403);
    expect((await req(parentA.username, 'POST', '/announcements', body(section))).status).toBe(403);
    expect((await req('accounts', 'POST', '/announcements', body(section))).status).toBe(403);
    expect((await req('librarian', 'POST', '/announcements', body(section))).status).toBe(403);
    expect((await req(null, 'POST', '/announcements', body(section))).status).toBe(401);
    expect((await req(clsTeacher.username, 'POST', '/announcements', body(section))).status).toBe(201);
    expect((await req('principal', 'POST', '/announcements', body([{ type: 'all' }]))).status).toBe(201);
    for (const u of [studA.username, parentA.username, clsTeacher.username, 'principal', 'accounts', 'librarian']) expect((await req(u, 'GET', '/announcements')).status, u).toBe(200);
    // management listing needs create/edit
    expect((await req(studA.username, 'GET', '/announcements/manage')).status).toBe(403);
    expect((await req(parentA.username, 'GET', '/announcements/manage')).status).toBe(403);
    expect((await req(clsTeacher.username, 'GET', '/announcements/manage')).status).toBe(200);
  });

  it('teachers may only address their own sections; school scope may address anyone; targets are validated', async () => {
    const t = plainTeacher.username;
    const mine = [...sectionsOfTeacher(s.ctx, plainTeacher.id)][0]!;
    const notMine = sectionWithout(s.ctx, plainTeacher.id).id;
    for (const audience of [[{ type: 'all' }], [{ type: 'user_type', id: 'parent' }], [{ type: 'role', id: 'teacher' }], [{ type: 'grade', id: gradeA }], [{ type: 'section', id: notMine }], [{ type: 'section', id: mine }, { type: 'section', id: notMine }]]) {
      const r = await req(t, 'POST', '/announcements', body(audience));
      expect(r.status, JSON.stringify(audience)).toBe(403);
      expect(r.body.code).toBe('AUDIENCE_NOT_ALLOWED');
    }
    expect((await req(t, 'POST', '/announcements', body([{ type: 'section', id: mine }]))).status).toBe(201);
    // publishing/editing a draft cannot widen the audience either
    const d = await req(t, 'POST', '/announcements', body([{ type: 'section', id: mine }]));
    expect((await req(t, 'PATCH', `/announcements/${d.body.id}`, { audience: [{ type: 'all' }] })).status).toBe(403);
    // principal: any audience, but it must exist
    expect((await req('principal', 'POST', '/announcements', body([{ type: 'grade', id: gradeA }, { type: 'role', id: 'teacher' }, { type: 'user_type', id: 'staff' }]))).status).toBe(201);
    for (const audience of [[{ type: 'section', id: '0192e0f0-0000-7000-8000-000000000000' }], [{ type: 'role', id: 'wizard' }], [{ type: 'user_type', id: 'alien' }], [{ type: 'grade' }], [{ type: 'grade', id: 'not-a-uuid' }]]) {
      const r = await req('principal', 'POST', '/announcements', body(audience));
      expect(r.status, JSON.stringify(audience)).toBe(422);
    }
    expect((await req('principal', 'POST', '/announcements', body([]))).status).toBe(422);
    expect((await req('principal', 'POST', '/announcements', { title: '', body: 'x', audience: [{ type: 'all' }] })).status).toBe(422);
  });
});

describe('announcements: lifecycle, visibility and delivery', () => {
  let annId: string;
  const section = () => [{ type: 'section', id: secA }];

  it('a draft is invisible to its audience (even by id); publishing makes it visible and notifies exactly the audience', async () => {
    const create = await req(clsTeacher.username, 'POST', '/announcements', { title: 'Class trip fees', body: 'Details inside', audience: section(), requiresAck: true, priority: 'important' });
    expect(create.status).toBe(201);
    annId = create.body.id;
    expect(create.body).toMatchObject({ state: 'draft', status: 'draft', canManage: true, requiresAck: true, priority: 'important' });
    expect(create.body.audience).toEqual([expect.objectContaining({ type: 'section', id: secA, label: expect.stringContaining(s.ctx.sections[0]!.gradeName) })]);
    expect((await req(studA.username, 'GET', `/announcements/${annId}`)).status).toBe(404);
    expect((await req(studA.username, 'POST', `/announcements/${annId}/read`)).status).toBe(404);
    expect((await req(studA.username, 'GET', '/announcements')).body.data.map((a: any) => a.id)).not.toContain(annId);
    expect((await req(outsider.username, 'GET', `/announcements/${annId}`)).status).toBe(404); // another teacher's draft
    expect((await req('principal', 'GET', `/announcements/${annId}`)).status).toBe(200); // school-scope editor

    const edit = await req(clsTeacher.username, 'PATCH', `/announcements/${annId}`, { title: 'Class trip: fees due' });
    expect(edit.status).toBe(200);
    expect(edit.body.title).toBe('Class trip: fees due');
    expect((await req(outsider.username, 'PATCH', `/announcements/${annId}`, { title: 'hijack' })).status).toBe(404);

    const pub = await req(clsTeacher.username, 'POST', `/announcements/${annId}/publish`);
    expect(pub.status).toBe(200);
    expect(pub.body.state).toBe('published');
    expect((await req(clsTeacher.username, 'POST', `/announcements/${annId}/publish`)).status).toBe(409); // not a draft any more
    expect((await req(clsTeacher.username, 'PATCH', `/announcements/${annId}`, { title: 'late edit' })).status).toBe(409);

    // recipients: students of secA + their verified guardians. nobody else, not the author
    const inA = studentsIn(s.ctx, secA);
    const expectedUsers = new Set<string>();
    for (const st of inA) {
      expectedUsers.add(st.userId);
      expectedUsers.add(guardianOf(s.ctx, st).userId);
    }
    const got = await s.db.select().from(notifications).where(and(eq(notifications.type, 'announcement.new'), eq(notifications.title, 'Class trip: fees due')));
    expect(new Set(got.map((n) => n.userId))).toEqual(expectedUsers);
    expect(got.some((n) => n.userId === clsTeacher.userId)).toBe(false);
    expect(got[0]!.data).toMatchObject({ route: `/announcements/${annId}`, announcementId: annId });
    // the unverified guardian (linked to studentA but not approved) gets nothing, and sees nothing
    const unverified = await userIdOf('9099999999');
    expect(got.some((n) => n.userId === unverified)).toBe(false);
    expect((await req('9099999999', 'GET', '/announcements')).body.data).toHaveLength(0);

    for (const u of [studA.username, parentA.username]) {
      const feed = await req(u, 'GET', '/announcements');
      expect(feed.body.data.map((a: any) => a.id), u).toContain(annId);
      expect(feed.body.data.find((a: any) => a.id === annId)).toMatchObject({ read: false, acknowledged: false, requiresAck: true, audience: [], canManage: false });
      expect((await req(u, 'GET', `/announcements/${annId}`)).status).toBe(200);
    }
    for (const u of [studB.username, parentB.username, outsider.username, 'accounts']) {
      expect((await req(u, 'GET', '/announcements')).body.data.map((a: any) => a.id), u).not.toContain(annId);
      expect((await req(u, 'GET', `/announcements/${annId}`)).status, u).toBe(404);
    }
    const audit = await s.db.select().from(auditLogs).where(and(eq(auditLogs.entityId, annId), like(auditLogs.action, 'announcement.%')));
    expect(audit.map((a) => a.action).sort()).toEqual(['announcement.create', 'announcement.publish', 'announcement.update']);
  });

  it('read / acknowledge receipts, unread counts and delivery statistics', async () => {
    const before = await req(studA.username, 'GET', '/announcements/unread-count');
    expect(before.body.unread).toBeGreaterThanOrEqual(1);
    expect(before.body.pendingAck).toBeGreaterThanOrEqual(1);
    const read = await req(studA.username, 'POST', `/announcements/${annId}/read`);
    expect(read.status).toBe(200);
    expect(read.body.ackedAt).toBeNull();
    const again = await req(studA.username, 'POST', `/announcements/${annId}/read`);
    expect(again.body.readAt).toBe(read.body.readAt); // idempotent
    expect((await req(studA.username, 'GET', '/announcements/unread-count')).body.unread).toBe(before.body.unread - 1);
    expect((await req(studA.username, 'GET', '/announcements?unread=true')).body.data.map((a: any) => a.id)).not.toContain(annId);
    // opening it also clears the matching inbox notification
    const inbox = await notifsOf('announcement.new', [studA.userId]);
    expect(inbox.find((n) => (n.data as any).announcementId === annId)?.readAt).not.toBeNull();

    const ack = await req(parentA.username, 'POST', `/announcements/${annId}/ack`);
    expect(ack.status).toBe(200);
    expect(ack.body.ackedAt).toBeTruthy();
    expect((await req(parentA.username, 'POST', `/announcements/${annId}/ack`)).body.ackedAt).toBe(ack.body.ackedAt);
    expect((await req(studB.username, 'POST', `/announcements/${annId}/ack`)).status).toBe(404); // not in the audience
    const noAck = await req('principal', 'POST', '/announcements', { title: 'FYI', body: 'x', audience: [{ type: 'all' }] });
    await req('principal', 'POST', `/announcements/${noAck.body.id}/publish`);
    const refused = await req(studA.username, 'POST', `/announcements/${noAck.body.id}/ack`);
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('ACK_NOT_REQUIRED');

    const stats = await req(clsTeacher.username, 'GET', `/announcements/${annId}/stats`);
    expect(stats.status).toBe(200);
    const inA = studentsIn(s.ctx, secA);
    const families = new Set(inA.map((st) => guardianOf(s.ctx, st).userId));
    expect(stats.body).toMatchObject({ audienceSize: inA.length + families.size, readCount: 2, ackCount: 1, unreadCount: inA.length + families.size - 2, pendingAckCount: inA.length + families.size - 1 }); // a student read it; a parent acknowledged (which also reads)
    expect(stats.body.byUserType).toEqual(expect.arrayContaining([expect.objectContaining({ userType: 'student', audience: inA.length, read: 1, acked: 0 }), expect.objectContaining({ userType: 'parent', audience: families.size, read: 1, acked: 1 })]));
    expect(stats.body.bySection).toEqual([expect.objectContaining({ sectionId: secA })]);
    expect((await req('principal', 'GET', `/announcements/${annId}/stats`)).status).toBe(200); // school scope sees everything
    expect((await req(outsider.username, 'GET', `/announcements/${annId}/stats`)).status).toBe(404); // not theirs
    expect((await req(studA.username, 'GET', `/announcements/${annId}/stats`)).status).toBe(403);
    const todo = await req(clsTeacher.username, 'GET', `/announcements/${annId}/recipients?status=unacknowledged&pageSize=100`);
    expect(todo.body.meta.total).toBe(inA.length + families.size - 1);
    expect(todo.body.data.map((r: any) => r.userId)).not.toContain(parentA.userId);
    const mine = await req(clsTeacher.username, 'GET', '/announcements/manage');
    const row = mine.body.data.find((a: any) => a.id === annId);
    expect(row).toMatchObject({ readCount: 2, ackCount: 1 }); // studA read + parentA's ack implies read
  });

  it('feed visibility matches who gets notified, for every audience kind', async () => {
    const author = 'principal';
    const targets: Record<string, unknown[]> = {
      all: [{ type: 'all' }],
      students: [{ type: 'user_type', id: 'student' }],
      parents: [{ type: 'user_type', id: 'parent' }],
      staff: [{ type: 'user_type', id: 'staff' }],
      teacherRole: [{ type: 'role', id: 'teacher' }],
      parentRole: [{ type: 'role', id: 'parent' }],
      gradeA: [{ type: 'grade', id: gradeA }],
      secB: [{ type: 'section', id: secB }],
    };
    const samples = [studA.username, studB.username, parentA.username, parentB.username, '9099999999', clsTeacher.username, plainTeacher.username, 'accounts', 'librarian', 'office'];
    for (const [name, audience] of Object.entries(targets)) {
      const created = await req(author, 'POST', '/announcements', { title: `Audience ${name}`, body: 'b', audience });
      const id = created.body.id as string;
      await req(author, 'POST', `/announcements/${id}/publish`);
      const notified = new Set((await s.db.select({ u: notifications.userId }).from(notifications).where(and(eq(notifications.type, 'announcement.new'), eq(notifications.title, `Audience ${name}`)))).map((r) => r.u));
      const stats = await req(author, 'GET', `/announcements/${id}/stats`);
      const authorId = await userIdOf(author);
      expect(notified.size, name).toBe(stats.body.audienceSize - (name === 'all' || name === 'staff' ? 1 : 0)); // the author is in the audience but is not notified
      for (const u of samples) {
        const feed = (await req(u, 'GET', '/announcements?pageSize=100')).body.data.map((a: any) => a.id);
        const uid = await userIdOf(u);
        expect(feed.includes(id), `${name} → ${u}`).toBe(notified.has(uid));
        expect(uid).not.toBe(authorId);
      }
    }
  });

  it('scheduling: future time, automatic publication by the job (once), expiry and archiving', async () => {
    const past = await req('principal', 'POST', '/announcements', { title: 'Late', body: 'x', audience: [{ type: 'all' }], publishAt: iso(-60_000) });
    expect(past.status).toBe(422);
    expect(past.body.code).toBe('PUBLISH_AT_IN_PAST');
    const created = await req('principal', 'POST', '/announcements', { title: 'Scheduled notice', body: 'x', audience: [{ type: 'user_type', id: 'student' }], publishAt: iso(2 * 3600_000), expiresAt: iso(5 * 3600_000) });
    expect(created.status).toBe(201);
    expect(created.body.state).toBe('scheduled');
    const id = created.body.id as string;
    expect((await req(studA.username, 'GET', `/announcements/${id}`)).status).toBe(404);
    expect((await req('principal', 'POST', `/announcements/${id}/unschedule`)).body.state).toBe('draft');
    const sched = await req('principal', 'POST', `/announcements/${id}/schedule`, { publishAt: iso(3600_000) });
    expect(sched.body.state).toBe('scheduled');
    expect((await req('principal', 'POST', `/announcements/${id}/schedule`, { publishAt: iso(-1000) })).status).toBe(422);

    const job = jobs.find((j) => j.name === 'communication.publish-scheduled')!;
    expect(job.everyMinutes).toBe(1);
    await runJobOnce(s.tenant, job); // not due yet
    expect((await s.db.select().from(announcements).where(eq(announcements.id, id)))[0]!.status).toBe('draft');

    await s.db.update(announcements).set({ publishAt: new Date(Date.now() - 1000) }).where(eq(announcements.id, id)); // time passes
    await runJobOnce(s.tenant, job);
    const row = (await s.db.select().from(announcements).where(eq(announcements.id, id)))[0]!;
    expect(row.status).toBe('published');
    const first = await s.db.select().from(notifications).where(and(eq(notifications.type, 'announcement.new'), eq(notifications.title, 'Scheduled notice')));
    expect(first.length).toBe(s.ctx.students.length); // every student, once
    expect((await req(studA.username, 'GET', `/announcements/${id}`)).status).toBe(200);
    expect((await req(parentA.username, 'GET', `/announcements/${id}`)).status).toBe(404); // students only
    await runJobOnce(s.tenant, job); // idempotent
    await runJobOnce(s.tenant, job);
    expect((await s.db.select().from(notifications).where(and(eq(notifications.type, 'announcement.new'), eq(notifications.title, 'Scheduled notice')))).length).toBe(first.length);
    expect((await s.db.select().from(auditLogs).where(and(eq(auditLogs.entityId, id), eq(auditLogs.action, 'announcement.publish')))).length).toBe(1);

    await s.db.update(announcements).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(announcements.id, id)); // expiry passes
    expect((await req(studA.username, 'GET', `/announcements/${id}`)).status).toBe(404); // gone from the feed immediately
    expect((await req('principal', 'GET', `/announcements/${id}`)).body.state).toBe('expired');
    await runJobOnce(s.tenant, job);
    expect((await req('principal', 'GET', `/announcements/${id}`)).body.state).toBe('archived');
  });

  it('expire / archive / delete rules and attachments', async () => {
    const t = await tok(clsTeacher.username);
    const up = await upload(s, t, { purpose: 'announcement', filename: 'menu.pdf', data: PDF });
    const fileId = up.body.id as string;
    const mk = (extra = {}) => req(clsTeacher.username, 'POST', '/announcements', { title: 'With file', body: 'see attached', audience: section(), ...extra });
    const withFile = await mk({ attachmentFileIds: [fileId] });
    expect(withFile.status).toBe(201);
    expect(withFile.body.attachments).toEqual([{ fileId, name: 'menu.pdf', mimeType: 'application/pdf', sizeBytes: PDF.length, url: `/api/v1/files/${fileId}` }]);
    const foreign = (await upload(s, await tok(outsider.username), { purpose: 'announcement', filename: 'x.pdf', data: PDF })).body.id;
    const bad = await mk({ attachmentFileIds: [foreign] }); // someone else's upload
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe('ATTACHMENT_NOT_FOUND');

    await req(clsTeacher.username, 'POST', `/announcements/${withFile.body.id}/publish`);
    const { download } = await import('./upload-helpers');
    expect((await download(s, await tok(studA.username), fileId)).status).toBe(200); // recipients can open the attachment
    expect((await download(s, await tok(studB.username), fileId)).status).toBe(404);

    // expire: gone from feeds at once
    const exp = await req(clsTeacher.username, 'POST', `/announcements/${withFile.body.id}/expire`);
    expect(exp.body.state).toBe('expired');
    expect((await req(studA.username, 'GET', `/announcements/${withFile.body.id}`)).status).toBe(404);
    expect((await req(clsTeacher.username, 'POST', `/announcements/${withFile.body.id}/archive`)).body.state).toBe('archived');
    expect((await req(clsTeacher.username, 'POST', `/announcements/${withFile.body.id}/archive`)).status).toBe(409);

    // delete: author removes a draft; only announcements:delete (office) removes a published one (archive)
    const draft = await mk();
    expect((await req(outsider.username, 'DELETE', `/announcements/${draft.body.id}`)).status).toBe(404);
    expect((await req(clsTeacher.username, 'DELETE', `/announcements/${draft.body.id}`)).status).toBe(200);
    expect((await req(clsTeacher.username, 'GET', `/announcements/${draft.body.id}`)).status).toBe(404);
    const live = await mk();
    await req(clsTeacher.username, 'POST', `/announcements/${live.body.id}/publish`);
    expect((await req(clsTeacher.username, 'DELETE', `/announcements/${live.body.id}`)).status).toBe(404);
    expect((await req('office', 'DELETE', `/announcements/${live.body.id}`)).status).toBe(200);
    expect((await s.db.select().from(announcements).where(eq(announcements.id, live.body.id)))[0]!.status).toBe('archived');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('events: permissions, visibility, registration and consent', () => {
  const mkEvent = (who: string, extra: Record<string, unknown> = {}) =>
    req(who, 'POST', '/events', { title: 'Sports day', kind: 'sports', startDate: ymd(10), audience: [{ type: 'section', id: secA }], ...extra });

  it('permission matrix', async () => {
    expect((await mkEvent(studA.username)).status).toBe(403);
    expect((await mkEvent(parentA.username)).status).toBe(403);
    expect((await mkEvent(plainTeacher.username)).status).toBe(403); // plain subject teacher: no events:create
    expect((await mkEvent('accounts')).status).toBe(403);
    expect((await mkEvent(clsTeacher.username)).status).toBe(201);
    expect((await mkEvent('principal', { audience: [{ type: 'all' }] })).status).toBe(201);
    // class teachers (assigned scope) address only their own sections
    const r = await mkEvent(clsTeacher.username, { audience: [{ type: 'all' }] });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('AUDIENCE_NOT_ALLOWED');
    expect((await mkEvent(clsTeacher.username, { audience: [{ type: 'section', id: sectionWithout(s.ctx, clsTeacher.id).id }] })).status).toBe(403);
    for (const u of [studA.username, parentA.username, plainTeacher.username, 'accounts']) expect((await req(u, 'GET', '/events')).status, u).toBe(200);
    // publishing needs events:publish (class teachers have it for their own events)
    expect((await mkEvent(clsTeacher.username, { publish: true })).body.status).toBe('published');
    // invalid shapes
    expect((await mkEvent('principal', { endDate: ymd(5) })).status).toBe(422);
    expect((await mkEvent('principal', { consentRequired: true })).body.code).toBe('CONSENT_TEXT_REQUIRED');
    expect((await mkEvent('principal', { capacity: 5 })).body.code).toBe('RESPONSE_SETTINGS_WITHOUT_REGISTRATION');
    expect((await mkEvent('principal', { allDay: false })).body.code).toBe('EVENT_TIME_REQUIRED');
  });

  it('drafts stay private; publishing notifies the audience; edits and cancellation notify too', async () => {
    const created = await mkEvent(clsTeacher.username, { title: 'Science fair', kind: 'event' });
    const id = created.body.id as string;
    expect(created.body.status).toBe('draft');
    for (const u of [studA.username, parentA.username, outsider.username, 'principal']) {
      // the principal has school-scope events:edit, so sees drafts; learners and other teachers do not
      expect((await req(u, 'GET', `/events/${id}`)).status, u).toBe(u === 'principal' ? 200 : 404);
    }
    expect((await req(clsTeacher.username, 'GET', `/events/${id}`)).status).toBe(200); // the creator
    const pub = await req(clsTeacher.username, 'POST', `/events/${id}/publish`);
    expect(pub.status).toBe(200);
    expect((await req(clsTeacher.username, 'POST', `/events/${id}/publish`)).status).toBe(409);
    const recipients = new Set((await notifsOf('event.new')).filter((n) => (n.data as any).eventId === id).map((n) => n.userId));
    const expected = new Set<string>();
    for (const st of studentsIn(s.ctx, secA)) {
      expected.add(st.userId);
      expected.add(guardianOf(s.ctx, st).userId);
    }
    expect(recipients).toEqual(expected);
    expect((await req(studA.username, 'GET', `/events/${id}`)).status).toBe(200);
    expect((await req(studB.username, 'GET', `/events/${id}`)).status).toBe(404);
    expect((await req(parentB.username, 'GET', `/events/${id}`)).status).toBe(404);
    expect((await req(outsider.username, 'GET', `/events/${id}`)).status).toBe(404);
    // a teacher who leads/teaches the section sees it too (calendar of their classes)
    expect((await req(clsTeacher.username, 'GET', `/events/${id}`)).body.canManage).toBe(true);
    const other = [...sectionsOfTeacher(s.ctx, s.ctx.teachers[3]!.id)].includes(secA) ? s.ctx.teachers[3]! : s.ctx.assignments.filter((a) => a.sectionId === secA).map((a) => s.ctx.teachers.find((t) => t.id === a.staffId)!).find((t) => t.id !== clsTeacher.id)!;
    expect((await req(other.username, 'GET', `/events/${id}`)).status).toBe(200);
    expect((await req(other.username, 'PATCH', `/events/${id}`, { title: 'not mine' })).status).toBe(404);

    const edit = await req(clsTeacher.username, 'PATCH', `/events/${id}`, { location: 'Main hall' });
    expect(edit.body.location).toBe('Main hall');
    expect((await notifsOf('event.updated')).filter((n) => (n.data as any).eventId === id).length).toBe(expected.size);
    const cancel = await req(clsTeacher.username, 'POST', `/events/${id}/cancel`);
    expect(cancel.body.status).toBe('cancelled');
    expect((await req(studA.username, 'GET', `/events/${id}`)).body.status).toBe('cancelled'); // still on the calendar, marked cancelled
    expect((await notifsOf('event.cancelled')).filter((n) => (n.data as any).eventId === id).length).toBe(expected.size);
    expect((await req(clsTeacher.username, 'PATCH', `/events/${id}`, { title: 'x' })).status).toBe(409);
    const audit = await s.db.select().from(auditLogs).where(and(eq(auditLogs.entityId, id), like(auditLogs.action, 'event.%')));
    expect(audit.map((a) => a.action).sort()).toEqual(['event.cancel', 'event.create', 'event.publish', 'event.update']);
  });

  it('registration: per-child answers, capacity, deadline and audience rules', async () => {
    const kids = studentsIn(s.ctx, secA).slice(0, 4);
    const created = await mkEvent('principal', { title: 'PTM day', kind: 'ptm', audience: [{ type: 'section', id: secA }], registrationRequired: true, capacity: 2, registrationDeadline: iso(3 * DAY), publish: true });
    expect(created.status).toBe(201);
    const id = created.body.id as string;
    const go = (who: string, studentId: string, response = 'going') => req(who, 'POST', `/events/${id}/respond`, { studentId, response });

    // a learner sees which children must answer
    const view = await req(parentA.username, 'GET', `/events/${id}`);
    expect(view.body.responseOpen).toBe(true);
    expect(view.body.children).toEqual(parentA.studentIds.map((sid) => expect.objectContaining({ studentId: sid, response: null })));
    expect(view.body.counts).toBeNull(); // counts are for organisers only

    expect((await go(kids[0]!.username, kids[0]!.id)).status).toBe(200); // a student answers for themselves
    expect((await go(kids[0]!.username, kids[1]!.id)).status).toBe(404); // ...but not for a classmate
    const fam1 = guardianOf(s.ctx, kids[1]!);
    expect((await go(fam1.username, kids[1]!.id)).status).toBe(200); // a parent answers for their child
    const full = await go(guardianOf(s.ctx, kids[2]!).username, kids[2]!.id);
    expect(full.status).toBe(409);
    expect(full.body.code).toBe('EVENT_FULL');
    expect((await go(fam1.username, kids[1]!.id, 'not_going')).status).toBe(200); // changing the answer frees the seat
    expect((await go(guardianOf(s.ctx, kids[2]!).username, kids[2]!.id)).status).toBe(200);
    expect((await go(fam1.username, kids[1]!.id)).status).toBe(409); // seat taken again
    expect((await go(kids[0]!.username, kids[0]!.id)).status).toBe(200); // re-answering with the same answer keeps the seat

    const wrong = await go(guardianOf(s.ctx, kids[3]!).username, kids[3]!.id, 'consent_given');
    expect(wrong.status).toBe(422);
    expect(wrong.body.code).toBe('RESPONSE_NOT_ALLOWED');
    // outside the audience / not linked
    expect((await go(studB.username, studB.id)).status).toBe(404);
    expect((await go(guardianOf(s.ctx, studB).username, studB.id)).status).toBe(404);
    expect((await go(parentB.username, kids[3]!.id)).status).toBe(404);
    expect((await go('9099999999', studA.id)).status).toBe(404);
    expect((await go(clsTeacher.username, kids[3]!.id)).status).toBe(403); // staff have no event_responses:create
    // an event that asks for nothing
    const plain = await mkEvent('principal', { title: 'Assembly', audience: [{ type: 'all' }], publish: true });
    const none = await req(kids[0]!.username, 'POST', `/events/${plain.body.id}/respond`, { studentId: kids[0]!.id, response: 'going' });
    expect(none.status).toBe(422);
    expect(none.body.code).toBe('NO_RESPONSE_REQUIRED');

    // organisers see counts and who answered / who is still pending
    const counts = (await req('principal', 'GET', `/events/${id}`)).body.counts;
    expect(counts).toMatchObject({ eligible: studentsIn(s.ctx, secA).length, going: 2, notGoing: 1, capacity: 2, seatsLeft: 0 });
    expect(counts.pending).toBe(studentsIn(s.ctx, secA).length - 3);
    const pending = await req('principal', 'GET', `/events/${id}/responses?response=pending&pageSize=100`);
    expect(pending.body.meta.total).toBe(counts.pending);
    const going = await req(clsTeacher.username, 'GET', `/events/${id}/responses?response=going`);
    expect(going.body.data.map((r: any) => r.studentId).sort()).toEqual([kids[0]!.id, kids[2]!.id].sort());
    expect((await req(plainTeacher.username, 'GET', `/events/${id}/responses`)).status).toBe(403); // no events:edit/create
    expect((await req(outsider.username, 'GET', `/events/${id}/responses`)).status).toBe(404); // leads another class, not part of this event
    expect((await req(studA.username, 'GET', `/events/${id}/responses`)).status).toBe(403);
    // lowering capacity below the seats taken is refused
    const lower = await req('principal', 'PATCH', `/events/${id}`, { capacity: 1 });
    expect(lower.status).toBe(409);
    expect(lower.body.code).toBe('CAPACITY_BELOW_REGISTRATIONS');

    // the deadline closes answers; the event ending does too
    await s.db.update(events).set({ registrationDeadline: new Date(Date.now() - 1000) }).where(eq(events.id, id));
    const closed = await go(guardianOf(s.ctx, kids[3]!).username, kids[3]!.id);
    expect(closed.status).toBe(409);
    expect(closed.body.code).toBe('REGISTRATION_CLOSED');
    expect((await req(parentA.username, 'GET', `/events/${id}`)).body.responseOpen).toBe(false);
  });

  it('consent: only parents consent; the parent must be linked to the child', async () => {
    const created = await mkEvent('principal', { title: 'Museum trip', kind: 'event', audience: [{ type: 'grade', id: gradeA }], consentRequired: true, consentText: 'I allow my child to travel by school bus.', registrationDeadline: iso(2 * DAY), publish: true });
    const id = created.body.id as string;
    const kid = studA;
    const fam = guardianOf(s.ctx, kid);
    const consent = (who: string, studentId: string, response = 'consent_given') => req(who, 'POST', `/events/${id}/respond`, { studentId, response });
    const byStudent = await consent(kid.username, kid.id);
    expect(byStudent.status).toBe(403);
    expect(byStudent.body.code).toBe('CONSENT_REQUIRES_GUARDIAN');
    expect((await consent(kid.username, kid.id, 'going')).status).toBe(422); // wrong answer type for a consent form
    expect((await consent(parentB.username, kid.id)).status).toBe(404);
    expect((await consent('9099999999', kid.id)).status).toBe(404); // unverified link
    const ok = await consent(fam.username, kid.id);
    expect(ok.status).toBe(200);
    expect(ok.body.response).toBe('consent_given');
    expect((await consent(fam.username, kid.id, 'consent_denied')).body.response).toBe('consent_denied'); // can change their mind before the deadline
    const detail = await req(fam.username, 'GET', `/events/${id}`);
    expect(detail.body.consentText).toContain('school bus');
    expect(detail.body.children.find((c: any) => c.studentId === kid.id)).toMatchObject({ response: 'consent_denied' });
    const counts = (await req('principal', 'GET', `/events/${id}`)).body.counts;
    expect(counts).toMatchObject({ consentDenied: 1, consentGiven: 0 });
    // students of other grades cannot be consented for
    const otherGradeStudent = s.ctx.students.find((x) => x.gradeId !== gradeA)!;
    expect((await consent(guardianOf(s.ctx, otherGradeStudent).username, otherGradeStudent.id)).status).toBe(404);
    expect(await s.db.select().from(eventRegistrations).where(eq(eventRegistrations.eventId, id))).toHaveLength(1);
  });

  it('a holiday is on the calendar for everyone and never pushed; deleting is limited to drafts', async () => {
    const hol = await mkEvent('office', { title: 'Founders day', kind: 'holiday', audience: [{ type: 'all' }], publish: true });
    expect(hol.status).toBe(201);
    expect((await notifsOf('event.new')).filter((n) => (n.data as any).eventId === hol.body.id)).toHaveLength(0);
    for (const u of [studA.username, parentB.username, 'accounts', plainTeacher.username]) expect((await req(u, 'GET', `/events/${hol.body.id}`)).status, u).toBe(200);
    expect((await req('9099999999', 'GET', `/events/${hol.body.id}`)).status).toBe(404); // unverified guardian belongs to no audience
    const draft = await mkEvent(clsTeacher.username);
    expect((await req(clsTeacher.username, 'DELETE', `/events/${draft.body.id}`)).status).toBe(200);
    const registered = await mkEvent('principal', { registrationRequired: true, publish: true });
    await req(studA.username, 'POST', `/events/${registered.body.id}/respond`, { studentId: studA.id, response: 'going' });
    const del = await req('office', 'DELETE', `/events/${registered.body.id}`);
    expect(del.status).toBe(409);
    expect(del.body.code).toBe('EVENT_HAS_RESPONSES');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('calendar feed', () => {
  it('merges events, exam papers and homework due dates per role, without leaking other classes', async () => {
    const subjectId = s.ctx.subjects[0]!.id;
    const from = ymd(-1);
    const to = ymd(30);
    const mkExam = async (name: string, status: 'draft' | 'scheduled' | 'published', gradeId: string, offset: number) => {
      const [e] = await s.db.insert(exams).values({ name, academicYearId: s.ctx.yearId, status, startDate: ymd(offset), endDate: ymd(offset) }).returning();
      await s.db.insert(examPapers).values({ examId: e!.id, gradeId, subjectId, examDate: ymd(offset), startTime: '09:00', endTime: '11:00', room: 'Hall 1' });
      return e!;
    };
    const examA = await mkExam('Mid-term', 'scheduled', gradeA, 12);
    await mkExam('Secret draft exam', 'draft', gradeA, 13);
    const otherGrade = s.ctx.grades.find((g) => g.id !== gradeA)!;
    await mkExam('Other grade exam', 'published', otherGrade.id, 14);
    const [hwA] = await s.db.insert(homework).values({ sectionId: secA, subjectId, title: 'Algebra worksheet', dueAt: new Date(Date.now() + 5 * DAY), status: 'published' }).returning();
    await s.db.insert(homework).values({ sectionId: secA, subjectId, title: 'Draft homework', dueAt: new Date(Date.now() + 6 * DAY), status: 'draft' });
    await s.db.insert(homework).values({ sectionId: secB, subjectId, title: 'Other section homework', dueAt: new Date(Date.now() + 5 * DAY), status: 'published' });
    const hol = await req('principal', 'POST', '/events', { title: 'Calendar holiday', kind: 'holiday', startDate: ymd(7), audience: [{ type: 'all' }], publish: true });
    const hidden = await req('principal', 'POST', '/events', { title: 'Section B only', kind: 'event', startDate: ymd(8), audience: [{ type: 'section', id: secB }], publish: true });

    const titles = (body: any) => body.data.map((i: any) => i.title);
    const stud = await req(studA.username, 'GET', `/calendar?from=${from}&to=${to}`);
    expect(stud.status).toBe(200);
    expect(titles(stud.body)).toEqual(expect.arrayContaining(['Calendar holiday', 'Algebra worksheet'.replace(/^/, 'Due: '), `${s.ctx.subjects[0]!.name} exam`]));
    expect(titles(stud.body)).not.toContain('Due: Draft homework');
    expect(titles(stud.body)).not.toContain('Due: Other section homework');
    expect(titles(stud.body)).not.toContain('Section B only');
    expect(stud.body.data.filter((i: any) => i.kind === 'exam_paper')).toHaveLength(1); // draft exam and other grade excluded
    const kinds = new Set(stud.body.data.map((i: any) => i.kind));
    for (const k of ['holiday', 'exam_paper', 'homework_due']) expect(kinds.has(k as never), k).toBe(true);
    const paper = stud.body.data.find((i: any) => i.kind === 'exam_paper');
    expect(paper).toMatchObject({ date: ymd(12), startTime: '09:00', endTime: '11:00', location: 'Hall 1', route: `/results/${examA.id}`, studentId: studA.id });
    expect(stud.body.data).toEqual([...stud.body.data].sort((a: any, b: any) => a.date.localeCompare(b.date)));

    // parents: their children only; studentId narrows; another family's child → 404
    const par = await req(parentA.username, 'GET', `/calendar?from=${from}&to=${to}&studentId=${parentA.studentIds[0]}`);
    expect(par.status).toBe(200);
    expect(titles(par.body)).toContain('Due: Algebra worksheet');
    expect(titles(par.body)).not.toContain('Due: Other section homework');
    expect((await req(parentA.username, 'GET', `/calendar?from=${from}&to=${to}&studentId=${studB.id}`)).status).toBe(404);
    expect(titles((await req(parentB.username, 'GET', `/calendar?from=${from}&to=${to}`)).body)).not.toContain('Due: Algebra worksheet');
    expect((await req('9099999999', 'GET', `/calendar?from=${from}&to=${to}`)).body.data.map((i: any) => i.kind)).not.toContain('homework_due');

    // staff: events of their audience + exams/homework of their classes
    const teacher = await req(clsTeacher.username, 'GET', `/calendar?from=${from}&to=${to}`);
    expect(titles(teacher.body)).toContain('Due: Algebra worksheet');
    expect(titles(teacher.body)).not.toContain('Section B only');
    const principal = await req('principal', 'GET', `/calendar?from=${from}&to=${to}`);
    expect(titles(principal.body)).toEqual(expect.arrayContaining(['Section B only', 'Calendar holiday', 'Due: Other section homework']));
    expect(titles(principal.body)).not.toContain('Secret draft exam'); // drafts never reach the calendar
    expect(hol.status).toBe(201);
    expect(hidden.status).toBe(201);
    expect(hwA!.id).toBeTruthy();

    // bounds
    expect((await req(studA.username, 'GET', `/calendar?from=${from}&to=${ymd(400)}`)).body.code).toBe('RANGE_TOO_LARGE');
    expect((await req(studA.username, 'GET', `/calendar?from=${to}&to=${from}`)).status).toBe(422);
    expect((await req(studA.username, 'GET', '/calendar')).status).toBe(422);
    expect((await req(null, 'GET', `/calendar?from=${from}&to=${to}`)).status).toBe(401);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('parent–teacher meetings', () => {
  let meetingId: string;
  const teacherOfA = () => s.ctx.assignments.filter((a) => a.sectionId === secA).map((a) => s.ctx.teachers.find((t) => t.id === a.staffId)!).find((t) => t.id !== clsTeacher.id)!;
  const child = () => parentA.studentIds[0]!;

  it('a parent requests a meeting only with a teacher of their child, once, and the teacher is notified', async () => {
    const tchr = clsTeacher;
    const opts = await req(parentA.username, 'GET', `/meetings/teachers?studentId=${child()}`);
    expect(opts.status).toBe(200);
    expect(opts.body.data[0]).toMatchObject({ staffId: tchr.id, isClassTeacher: true });
    expect(opts.body.data.map((o: any) => o.staffId)).not.toContain(outsider.id);
    expect((await req(parentA.username, 'GET', `/meetings/teachers?studentId=${studB.id}`)).status).toBe(404);

    const reqBody = { studentId: child(), staffId: tchr.id, topic: 'How is my child settling in?', proposedAt: iso(3 * DAY) };
    expect((await req(studA.username, 'POST', '/meetings', reqBody)).status).toBe(403); // students cannot request
    expect((await req(parentB.username, 'POST', '/meetings', reqBody)).status).toBe(404); // not their child
    expect((await req('9099999999', 'POST', '/meetings', reqBody)).status).toBe(404); // unverified link
    expect((await req(clsTeacher.username, 'POST', '/meetings', reqBody)).status).toBe(403);
    const wrongTeacher = await req(parentA.username, 'POST', '/meetings', { ...reqBody, staffId: outsider.id });
    expect(wrongTeacher.status).toBe(422);
    expect(wrongTeacher.body.code).toBe('TEACHER_NOT_ASSIGNED');
    expect((await req(parentA.username, 'POST', '/meetings', { ...reqBody, proposedAt: iso(-DAY) })).status).toBe(422);

    const ok = await req(parentA.username, 'POST', '/meetings', reqBody);
    expect(ok.status).toBe(201);
    meetingId = ok.body.id;
    expect(ok.body).toMatchObject({ status: 'requested', topic: reqBody.topic, availableActions: ['cancel'] });
    expect(ok.body.teacher.staffId).toBe(tchr.id);
    const dup = await req(parentA.username, 'POST', '/meetings', reqBody);
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('MEETING_ALREADY_REQUESTED');
    // only the addressed teacher is told
    const told = await notifsOf('meeting.requested');
    expect(told.map((n) => n.userId)).toEqual([clsTeacher.userId]);
    expect(told[0]!.data).toMatchObject({ route: `/meetings/${meetingId}` });
  });

  it('visibility by role', async () => {
    const ids = async (u: string) => (await req(u, 'GET', '/meetings')).body.data.map((m: any) => m.id);
    expect(await ids(parentA.username)).toContain(meetingId);
    expect(await ids(clsTeacher.username)).toContain(meetingId);
    expect(await ids('principal')).toContain(meetingId);
    expect(await ids(parentB.username)).not.toContain(meetingId);
    expect(await ids(outsider.username)).not.toContain(meetingId);
    expect(await ids(studA.username)).toEqual([]); // a child never sees the meetings their parents request about them
    expect((await req(studA.username, 'GET', `/meetings/${meetingId}`)).status).toBe(404);
    expect((await req(parentB.username, 'GET', `/meetings/${meetingId}`)).status).toBe(404);
    expect((await req(outsider.username, 'GET', `/meetings/${meetingId}`)).status).toBe(404);
    expect((await req('accounts', 'GET', `/meetings/${meetingId}`)).status).toBe(403);
    expect((await req(clsTeacher.username, 'GET', `/meetings/${meetingId}`)).body.availableActions).toEqual(['confirm', 'decline', 'cancel']);
    expect((await req('principal', 'GET', `/meetings/${meetingId}`)).body.availableActions).toEqual(['confirm', 'decline', 'cancel']);
    const upcoming = await req(parentA.username, 'GET', '/meetings/upcoming');
    expect(upcoming.body.data.map((m: any) => m.id)).toContain(meetingId);
  });

  it('state machine: confirm → reschedule → complete; declined / cancelled are terminal; slots cannot overlap', async () => {
    const slot = iso(4 * DAY);
    const notParent = await req(parentA.username, 'POST', `/meetings/${meetingId}/confirm`, { scheduledAt: slot });
    expect(notParent.status).toBe(403);
    expect((await req(outsider.username, 'POST', `/meetings/${meetingId}/confirm`, { scheduledAt: slot })).status).toBe(404);
    expect((await req(clsTeacher.username, 'POST', `/meetings/${meetingId}/confirm`, { scheduledAt: iso(-DAY) })).status).toBe(422);
    const online = await req(clsTeacher.username, 'POST', `/meetings/${meetingId}/confirm`, { scheduledAt: slot, mode: 'online' });
    expect(online.status).toBe(422);
    expect(online.body.code).toBe('MEETING_LINK_REQUIRED');
    expect((await req(clsTeacher.username, 'POST', `/meetings/${meetingId}/complete`, { outcomeNotes: 'too early' })).status).toBe(409); // not confirmed yet

    const confirm = await req(clsTeacher.username, 'POST', `/meetings/${meetingId}/confirm`, { scheduledAt: slot, durationMin: 20, mode: 'in_person', locationOrLink: 'Room 6A' });
    expect(confirm.status).toBe(200);
    expect(confirm.body).toMatchObject({ status: 'confirmed', durationMin: 20, mode: 'in_person', locationOrLink: 'Room 6A', availableActions: ['reschedule', 'complete', 'cancel'] });
    expect(new Date(confirm.body.scheduledAt).getTime()).toBe(new Date(slot).getTime());
    expect((await notifsOf('meeting.confirmed')).map((n) => n.userId)).toEqual([parentA.userId]);
    expect((await req(clsTeacher.username, 'POST', `/meetings/${meetingId}/confirm`, { scheduledAt: slot })).status).toBe(409);
    expect((await req(clsTeacher.username, 'POST', `/meetings/${meetingId}/decline`, { reason: 'busy' })).status).toBe(409);

    // a second request for the same teacher cannot take an overlapping slot (but a free one is fine)
    const sibling = parentA.studentIds[1] ?? null;
    const other = parentOnlyIn(s.ctx, secA).guardian.id === parentA.username ? null : null;
    void sibling;
    void other;
    const second = studentsIn(s.ctx, secA).find((st) => guardianOf(s.ctx, st).userId !== parentA.userId && guardianOf(s.ctx, st).studentIds.every((i) => s.ctx.students.find((x) => x.id === i)!.sectionId === secA))!;
    const g2 = guardianOf(s.ctx, second);
    const r2 = await req(g2.username, 'POST', '/meetings', { studentId: second.id, staffId: clsTeacher.id, topic: 'Maths progress' });
    expect(r2.status).toBe(201);
    const clash = await req(clsTeacher.username, 'POST', `/meetings/${r2.body.id}/confirm`, { scheduledAt: new Date(new Date(slot).getTime() + 10 * 60_000).toISOString(), durationMin: 15 });
    expect(clash.status).toBe(409);
    expect(clash.body.code).toBe('MEETING_SLOT_TAKEN');
    const free = await req(clsTeacher.username, 'POST', `/meetings/${r2.body.id}/confirm`, { scheduledAt: new Date(new Date(slot).getTime() + 30 * 60_000).toISOString(), durationMin: 15 });
    expect(free.status).toBe(200);
    // rescheduling onto the other meeting is also refused
    const bump = await req(clsTeacher.username, 'POST', `/meetings/${meetingId}/reschedule`, { scheduledAt: new Date(new Date(slot).getTime() + 35 * 60_000).toISOString() });
    expect(bump.body.code).toBe('MEETING_SLOT_TAKEN');
    const moved = await req(clsTeacher.username, 'POST', `/meetings/${meetingId}/reschedule`, { scheduledAt: iso(5 * DAY), mode: 'online', locationOrLink: 'https://meet.example/abc' });
    expect(moved.body).toMatchObject({ status: 'confirmed', mode: 'online', locationOrLink: 'https://meet.example/abc' });
    expect((await notifsOf('meeting.rescheduled')).map((n) => n.userId)).toEqual([parentA.userId]);

    const done = await req(clsTeacher.username, 'POST', `/meetings/${meetingId}/complete`, { outcomeNotes: 'Agreed a reading plan.' });
    expect(done.body).toMatchObject({ status: 'completed', outcomeNotes: 'Agreed a reading plan.', availableActions: [] });
    for (const action of ['confirm', 'reschedule', 'complete']) expect((await req(clsTeacher.username, 'POST', `/meetings/${meetingId}/${action}`, { scheduledAt: slot, outcomeNotes: 'x' })).status, action).toBe(409);
    expect((await req(clsTeacher.username, 'POST', `/meetings/${meetingId}/cancel`, {})).status).toBe(409);
    expect((await req(parentA.username, 'GET', `/meetings/${meetingId}`)).body.outcomeNotes).toBe('Agreed a reading plan.');

    // decline and cancel paths
    const dec = await req(g2.username, 'POST', '/meetings', { studentId: second.id, staffId: teacherOfA().id, topic: 'Homework load' });
    expect(dec.status).toBe(201);
    const t2 = teacherOfA().username;
    expect((await req(t2, 'POST', `/meetings/${dec.body.id}/decline`, {})).status).toBe(422); // reason required
    const declined = await req(t2, 'POST', `/meetings/${dec.body.id}/decline`, { reason: 'Please see the class teacher first.' });
    expect(declined.body).toMatchObject({ status: 'declined', outcomeNotes: 'Please see the class teacher first.' });
    expect((await notifsOf('meeting.declined')).map((n) => n.userId)).toEqual([g2.userId]);
    expect((await req(g2.username, 'POST', `/meetings/${dec.body.id}/cancel`, {})).status).toBe(409);

    const c3 = await req(g2.username, 'POST', '/meetings', { studentId: second.id, staffId: teacherOfA().id, topic: 'Second try' });
    const cancelled = await req(g2.username, 'POST', `/meetings/${c3.body.id}/cancel`, { reason: 'Resolved' });
    expect(cancelled.body.status).toBe('cancelled');
    expect((await notifsOf('meeting.cancelled')).map((n) => n.userId)).toContain(teacherOfA().userId ?? (await userIdOf(t2)));
    expect((await req(parentA.username, 'POST', `/meetings/${c3.body.id}/cancel`, {})).status).toBe(404); // another family's meeting

    const audit = await s.db.select().from(auditLogs).where(and(eq(auditLogs.entityId, meetingId), like(auditLogs.action, 'meeting.%')));
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['meeting.request', 'meeting.confirm', 'meeting.reschedule', 'meeting.complete']));
    expect((await s.db.select().from(meetings).where(eq(meetings.id, meetingId)))[0]!.status).toBe('completed');
  });

  it('the class teacher and the office can act on a request addressed to another teacher', async () => {
    const t = s.ctx.assignments.filter((a) => a.sectionId === secA).map((a) => s.ctx.teachers.find((x) => x.id === a.staffId)!).find((x) => x.id !== clsTeacher.id)!;
    const stu = studentsIn(s.ctx, secA)[3]!;
    const g = guardianOf(s.ctx, stu);
    const m = await req(g.username, 'POST', '/meetings', { studentId: stu.id, staffId: t.id, topic: 'Attendance concern' });
    expect(m.status).toBe(201);
    const byClass = await req(clsTeacher.username, 'POST', `/meetings/${m.body.id}/confirm`, { scheduledAt: iso(6 * DAY) });
    expect(byClass.body.status).toBe('confirmed');
    expect((await req('office', 'POST', `/meetings/${m.body.id}/reschedule`, { scheduledAt: iso(7 * DAY) })).body.status).toBe('confirmed');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('notification inbox', () => {
  it('keyset pagination is stable (even with identical timestamps), filterable, and strictly per user', async () => {
    const uid = studA.userId;
    const base = await s.db.select({ n: notifications.id }).from(notifications).where(eq(notifications.userId, uid));
    const types = ['homework.assigned', 'marks.published', 'fees.due', 'attendance.absent', 'system.notice'];
    // 25 rows written in ONE statement: they share one created_at, so the cursor must disambiguate by id
    await s.db.insert(notifications).values(Array.from({ length: 25 }, (_, i) => ({ userId: uid, type: types[i % 5]!, title: `n${i}`, readAt: i % 4 === 0 ? new Date() : null })));
    const total = base.length + 25;
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 20; page++) {
      const r: any = await req(studA.username, 'GET', `/notifications?limit=10${cursor ? `&cursor=${cursor}` : ''}`);
      expect(r.status).toBe(200);
      expect(r.body.data.length).toBeLessThanOrEqual(10);
      seen.push(...r.body.data.map((n: any) => n.id));
      cursor = r.body.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toHaveLength(total);
    expect(new Set(seen).size).toBe(total); // no duplicates, nothing skipped
    const unread = await req(studA.username, 'GET', '/notifications?limit=100&unread=true');
    expect(unread.body.data.every((n: any) => !n.read)).toBe(true);
    expect((await req(studA.username, 'GET', '/notifications/unread-count')).body.unread).toBe(unread.body.data.length);
    const cat = await req(studA.username, 'GET', '/notifications?limit=100&category=homework');
    expect(cat.body.data.length).toBeGreaterThan(0);
    expect(cat.body.data.every((n: any) => n.category === 'homework' && n.type.startsWith('homework.'))).toBe(true);
    expect((await req(studA.username, 'GET', '/notifications?cursor=garbage')).status).toBe(400);
    expect((await req(studA.username, 'GET', '/notifications?limit=500')).status).toBe(422);

    // another user can neither see nor touch them
    const sample = seen[0]!;
    expect((await req(parentB.username, 'POST', `/notifications/${sample}/read`)).status).toBe(404);
    expect((await req(parentB.username, 'DELETE', `/notifications/${sample}`)).status).toBe(404);
    expect((await req(parentB.username, 'GET', '/notifications?limit=100')).body.data.map((n: any) => n.id)).not.toContain(sample);

    // mark one / delete one / mark all (optionally per category)
    const one = unread.body.data[0];
    expect((await req(studA.username, 'POST', `/notifications/${one.id}/read`)).body).toMatchObject({ id: one.id, read: true });
    expect((await req(studA.username, 'GET', '/notifications/unread-count')).body.unread).toBe(unread.body.data.length - 1);
    expect((await req(studA.username, 'DELETE', `/notifications/${one.id}`)).status).toBe(200);
    expect((await req(studA.username, 'DELETE', `/notifications/${one.id}`)).status).toBe(404);
    const homeworkUnread = (await req(studA.username, 'GET', '/notifications?limit=100&unread=true&category=homework')).body.data.length;
    const part = await req(studA.username, 'POST', '/notifications/read-all', { category: 'homework' });
    expect(part.body.updated).toBe(homeworkUnread);
    const all = await req(studA.username, 'POST', '/notifications/read-all');
    expect(all.status).toBe(200);
    expect((await req(studA.username, 'GET', '/notifications/unread-count')).body.unread).toBe(0);
    expect((await req(null, 'GET', '/notifications')).status).toBe(401);
  });

  it('preferences: defaults, partial updates, validation', async () => {
    const t = clsTeacher.username;
    const def = await req(t, 'GET', '/notifications/preferences');
    expect(def.status).toBe(200);
    expect(def.body.categories.map((c: any) => c.category)).toEqual(['attendance', 'homework', 'marks', 'fees', 'announcement', 'event', 'meeting', 'leave', 'tasks', 'system']);
    expect(def.body.categories.every((c: any) => c.push === true && c.email === false && c.quietFrom === null)).toBe(true);
    expect(def.body.schoolDefaults).toEqual({ quietFrom: '21:00', quietTo: '07:00' });
    const upd = await req(t, 'PUT', '/notifications/preferences', { preferences: [{ category: 'homework', push: false }, { category: 'event', email: true, quietFrom: '22:00', quietTo: '06:30' }] });
    expect(upd.status).toBe(200);
    expect(upd.body.categories.find((c: any) => c.category === 'homework')).toMatchObject({ push: false, email: false });
    expect(upd.body.categories.find((c: any) => c.category === 'event')).toMatchObject({ push: true, email: true, quietFrom: '22:00', quietTo: '06:30' });
    // untouched fields survive a later partial update
    const upd2 = await req(t, 'PUT', '/notifications/preferences', { preferences: [{ category: 'event', push: false }] });
    expect(upd2.body.categories.find((c: any) => c.category === 'event')).toMatchObject({ push: false, email: true, quietFrom: '22:00' });
    expect((await req(t, 'PUT', '/notifications/preferences', { preferences: [{ category: 'event', quietFrom: null, quietTo: null }] })).body.categories.find((c: any) => c.category === 'event').quietFrom).toBeNull();
    for (const bad of [[{ category: 'event', quietFrom: '22:00' }], [{ category: 'event', quietFrom: '22:00', quietTo: null }], [{ category: 'event', quietFrom: '25:00', quietTo: '06:00' }], [{ category: 'nonsense', push: true }], [], [{ category: 'event' }, { category: 'event' }]]) {
      expect((await req(t, 'PUT', '/notifications/preferences', { preferences: bad })).status, JSON.stringify(bad)).toBe(422);
    }
    expect((await s.db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, clsTeacher.userId))).length).toBe(2);
    expect((await req(studA.username, 'GET', '/notifications/preferences')).body.categories.find((c: any) => c.category === 'homework').push).toBe(true); // per user
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('push dispatcher honours preferences (fake PushProvider)', () => {
  const sent: PushMessage[] = [];
  const fake: PushProvider = {
    name: 'fake',
    async send(messages) {
      sent.push(...messages);
      return messages.map(() => ({ ok: true as const }));
    },
  };
  let uid: string;
  let token: string;
  let n = 0;

  beforeAll(async () => {
    await flushPushQueue();
    setPushProvider(fake);
    // The school default quiet window (21:00–07:00) would make these tests pass or fail depending on the time of day they
    // run. Switch it off here; the quiet-hours tests below set explicit per-user windows.
    await putSetting(s.db, 'notifications', { quietFrom: '00:00', quietTo: '00:00' });
    uid = parentB.userId;
    token = `fake-fcm-token-${Date.now()}-${'x'.repeat(30)}`;
    const r = await req(parentB.username, 'POST', '/devices', { platform: 'android', pushToken: token });
    expect(r.status).toBe(200);
  });
  afterAll(async () => {
    await putSetting(s.db, 'notifications', { quietFrom: '21:00', quietTo: '07:00' });
  });
  const mine = () => sent.filter((m) => m.token === token);
  const setPref = (category: string, fields: Record<string, unknown>) => req(parentB.username, 'PUT', '/notifications/preferences', { preferences: [{ category, ...fields }] });
  /** local HH:MM of the school, shifted by `min` minutes */
  const localHm = (min = 0) => {
    const d = new Date(Date.now() + min * 60_000);
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: s.tenant.timezone, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
    return `${parts.find((p) => p.type === 'hour')!.value.replace('24', '00')}:${parts.find((p) => p.type === 'minute')!.value}`;
  };
  const send = async (type: string, extra: { priority?: 'normal' | 'high'; title?: string } = {}) => {
    const ids = await notify(s.db, s.tenant, { userIds: [uid], type, title: extra.title ?? `T${n++}`, body: 'details', priority: extra.priority, data: { route: '/x' } }, { noQueue: true });
    const r = await dispatchPush(s.db, s.tenant, ids);
    const row = (await s.db.select().from(notifications).where(eq(notifications.id, ids[0]!)))[0]!;
    return { r, row, id: ids[0]! };
  };

  it('delivers by default; an off switch for the category suppresses push but keeps the inbox row', async () => {
    const a = await send('homework.assigned', { title: 'hw-1' });
    expect(a.r.sent).toBe(1);
    expect(a.row.pushStatus).toBe('sent');
    expect(mine().map((m) => m.title)).toEqual(['hw-1']);
    expect(mine()[0]).toMatchObject({ body: 'details', data: expect.objectContaining({ route: '/x', type: 'homework.assigned' }) });
    await setPref('homework', { push: false });
    const b = await send('homework.assigned', { title: 'hw-2' });
    expect(b.r.skipped).toBe(1);
    expect(b.row.pushStatus).toBe('skipped');
    expect(mine()).toHaveLength(1); // nothing new reached the device
    expect((await req(parentB.username, 'GET', '/notifications?limit=50')).body.data.map((x: any) => x.title)).toContain('hw-2'); // still in the inbox
    const c = await send('homework.assigned', { title: 'hw-3', priority: 'high' });
    expect(c.row.pushStatus).toBe('skipped'); // even urgent respects an explicit opt-out
    await setPref('homework', { push: true });
    expect((await send('marks.published', { title: 'private' })).r.sent).toBe(1);
    expect(mine().at(-1)).toMatchObject({ title: s.tenant.name, body: 'You have a new update. Open the app to view.' }); // private category: generic lock-screen text
    const noDevice = await notify(s.db, s.tenant, { userIds: [studA.userId], type: 'homework.assigned', title: 'nobody home' }, { noQueue: true });
    expect((await dispatchPush(s.db, s.tenant, noDevice)).skipped).toBe(1);
  });

  it('quiet hours hold the push back until the window ends; urgent notifications go through', async () => {
    await setPref('event', { quietFrom: localHm(-60), quietTo: localHm(60) }); // we are inside the window
    const before = mine().length;
    const held = await send('event.new', { title: 'held-1' });
    expect(held.r.held).toBe(1);
    expect(held.row.pushStatus).toBe('held');
    expect(held.row.deliverAfter!.getTime()).toBeGreaterThan(Date.now() + 50 * 60_000);
    expect(held.row.deliverAfter!.getTime()).toBeLessThan(Date.now() + 70 * 60_000);
    expect(mine()).toHaveLength(before);
    // the sweeper ignores it while the window is open...
    expect((await dispatchPush(s.db, s.tenant)).sent).toBe(0);
    expect((await s.db.select().from(notifications).where(eq(notifications.id, held.id)))[0]!.pushStatus).toBe('held');
    // ...and delivers it once the window has closed
    await s.db.update(notifications).set({ deliverAfter: new Date(Date.now() - 1000) }).where(eq(notifications.id, held.id));
    await setPref('event', { quietFrom: '00:00', quietTo: '00:00' }); // quiet hours switched off
    const released = await dispatchPush(s.db, s.tenant);
    expect(released.sent).toBe(1);
    expect(mine().at(-1)!.title).toBe('held-1');
    expect((await s.db.select().from(notifications).where(eq(notifications.id, held.id)))[0]!.pushStatus).toBe('sent');
    // urgent ignores quiet hours
    await setPref('event', { quietFrom: localHm(-60), quietTo: localHm(60) });
    expect((await send('event.new', { title: 'urgent', priority: 'high' })).row.pushStatus).toBe('sent');
    // a window that does not contain now does not hold
    await setPref('event', { quietFrom: localHm(120), quietTo: localHm(180) });
    expect((await send('event.new', { title: 'daytime' })).row.pushStatus).toBe('sent');
  });

  it('email goes out only for categories the user switched email on for (generic text for private ones)', async () => {
    await setPref('announcement', { email: true });
    mails.length = 0;
    const [parentRow] = await s.db.select({ email: users.email }).from(users).where(eq(users.id, uid));
    await send('announcement.new', { title: 'Mail me' });
    await send('event.new', { title: 'no mail for this' });
    expect(mails.map((m) => [m.to, m.subject])).toEqual([[parentRow!.email, 'Mail me']]);
    await setPref('fees', { email: true });
    await send('fees.due', { title: 'Invoice 42 is overdue by ₹5000' });
    const fee = mails.at(-1)!;
    expect(fee.subject).toContain(s.tenant.name);
    expect(fee.subject + fee.text).not.toContain('5000'); // private category: no details by email either
    await setPref('announcement', { email: false });
  });

  it('announcing to many recipients writes every inbox row and dispatches all of them', async () => {
    const many = s.ctx.students.map((x) => x.userId);
    const ids = await notify(s.db, s.tenant, { userIds: many, type: 'announcement.new', title: 'bulk' }, { noQueue: true });
    expect(ids).toHaveLength(many.length);
    const out = await dispatchPush(s.db, s.tenant, ids);
    expect(out.sent + out.skipped + out.held).toBe(many.length);
  });

  it('POST /notifications/test pushes to my devices through the real pipeline and is rate limited', async () => {
    mails.length = 0;
    await setPref('system', { push: true, quietFrom: null, quietTo: null });
    const before = mine().length;
    const r = await req(parentB.username, 'POST', '/notifications/test');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'sent', devices: 1 });
    expect(mine()).toHaveLength(before + 1);
    expect(mine().at(-1)!.title).toBe('Test notification');
    await setPref('system', { push: false });
    expect((await req(parentB.username, 'POST', '/notifications/test')).body.status).toBe('skipped'); // explains why nothing arrived
    await setPref('system', { push: true });
    // no device → skipped
    expect((await req(studA.username, 'POST', '/notifications/test')).body).toMatchObject({ status: 'skipped', devices: 0 });
    let last = 0;
    for (let i = 0; i < 6; i++) last = (await req(parentB.username, 'POST', '/notifications/test')).status;
    expect(last).toBe(429);
    await s.db.update(devices).set({ enabled: false }).where(eq(devices.pushToken, token));
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('read-only school', () => {
  it('refuses communication writes with 402 but still serves reads', async () => {
    await upsertSubscription({ tenantCode: s.tenant.code, academicYear: '2020-21', startsOn: '2020-04-01', endsOn: '2021-03-31', pricePerStudent: 100, licensedStudents: 400, graceDays: 10 });
    await upsertSubscription({ tenantCode: s.tenant.code, academicYear: s.ctx.yearName, startsOn: '2000-01-01', endsOn: '2001-01-01', pricePerStudent: 100, licensedStudents: 400, graceDays: 10 });
    invalidateLicense(s.tenant.id);
    invalidatePrincipal(s.tenant.id);
    const create = await req('principal', 'POST', '/announcements', { title: 'x', body: 'y', audience: [{ type: 'all' }] });
    expect(create.status).toBe(402);
    expect(create.body.code).toBe('SUBSCRIPTION_EXPIRED');
    expect((await req(parentA.username, 'POST', '/meetings', { studentId: parentA.studentIds[0], staffId: clsTeacher.id, topic: 'read only?' })).status).toBe(402);
    expect((await req(studA.username, 'POST', '/notifications/read-all')).status).toBe(402);
    expect((await req('principal', 'POST', '/events', { title: 'x', startDate: ymd(3), audience: [{ type: 'all' }] })).status).toBe(402);
    expect((await req(studA.username, 'GET', '/announcements')).status).toBe(200);
    expect((await req(studA.username, 'GET', '/notifications')).status).toBe(200);
  });
});
