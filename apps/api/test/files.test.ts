import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { announcements, audienceTargets, auditLogs, files, homework, homeworkSubmissions, materials, studentDocuments, users } from '../src/db/tenant/schema';
import { runJobOnce } from '../src/core/jobs';
import { storage } from '../src/core/storage';
import { purgeDeletedFiles } from '../src/modules/files/service';
import { upsertSubscription } from '../src/core/billing/invoicing';
import { invalidateLicense } from '../src/core/billing/license';
import { jobs as fileJobs } from '../src/modules/files/jobs';
import { createTestSchool, type TestSchool } from './helpers';
import { DOCX, ELF, GIF, HTML, JPEG, PDF, PE, PLAIN_ZIP, PNG, SHELL, SVG, TEXT, download, parentOnlyIn, parentWithout, sectionsOfTeacher, studentsIn, teacherWithout, upload } from './upload-helpers';

let s: TestSchool;
let secA: string; // a section t001 leads
let secB: string; // a section t001 has nothing to do with
let teacherA: string; // username of a teacher of secA
let teacherAStaff: string;
let outsiderTeacher: string; // neither leads nor teaches secA
let studentA: { username: string; id: string };
let studentB: { username: string; id: string };
let parentA: string;
let parentB: string;

beforeAll(async () => {
  s = await createTestSchool({ size: 'full' });
  const t1 = s.ctx.teachers[0]!;
  secA = [...sectionsOfTeacher(s.ctx, t1.id)][0]!;
  secB = s.ctx.sections.find((x) => !sectionsOfTeacher(s.ctx, t1.id).has(x.id))!.id;
  teacherA = t1.username;
  teacherAStaff = t1.id;
  outsiderTeacher = teacherWithout(s.ctx, secA).username;
  const sa = studentsIn(s.ctx, secA)[0]!;
  const sb = studentsIn(s.ctx, secB)[0]!;
  studentA = { username: sa.username, id: sa.id };
  studentB = { username: sb.username, id: sb.id };
  parentA = parentOnlyIn(s.ctx, secA).guardian.username;
  parentB = parentWithout(s.ctx, secA).username;
});

const subjectId = () => s.ctx.subjects[0]!.id;

describe('upload: type, size and name rules', () => {
  it('stores a file, decides the type from the bytes, and sanitises the name', async () => {
    const t = await s.login(teacherA);
    const r = await upload(s, t, { purpose: 'homework', filename: '../../etc/evil name?.png', data: PNG, claimed: 'text/html' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.mimeType).toBe('image/png'); // not what the client claimed
    expect(r.body.name).toBe('evil name.png');
    expect(r.body.sizeBytes).toBe(PNG.length);
    expect(r.body.sha256).toBe(createHash('sha256').update(PNG).digest('hex'));
    expect(r.body.url).toBe(`/api/v1/files/${r.body.id}`);
    expect(r.body.attachment).toEqual({ fileId: r.body.id, name: 'evil name.png', mimeType: 'image/png', sizeBytes: PNG.length });
    const [row] = await s.db.select().from(files).where(eq(files.id, r.body.id));
    expect(row!.storageKey).toMatch(new RegExp(`^${s.tenant.code}/\\d{4}/\\d{2}/${r.body.id}$`));
    expect(await storage().exists(row!.storageKey)).toBe(true);
  });

  it('accepts purpose as a field before the file or as a query parameter, and rejects it after / missing / unknown', async () => {
    const t = await s.login(teacherA);
    expect((await upload(s, t, { purpose: 'material', via: 'field', filename: 'a.pdf', data: PDF })).status).toBe(201);
    expect((await upload(s, t, { purpose: 'material', via: 'query', filename: 'b.pdf', data: PDF })).status).toBe(201);
    const after = await upload(s, t, { purpose: 'material', via: 'after', filename: 'c.pdf', data: PDF });
    expect(after.status).toBe(422);
    expect(after.body.code).toBe('PURPOSE_REQUIRED');
    expect((await upload(s, t, { via: 'none', filename: 'd.pdf', data: PDF })).body.code).toBe('PURPOSE_REQUIRED');
    expect((await upload(s, t, { purpose: 'nonsense', filename: 'e.pdf', data: PDF })).status).toBe(422);
    expect((await upload(s, t, { purpose: 'material', fieldName: 'upload', filename: 'f.pdf', data: PDF })).body.code).toBe('FILE_REQUIRED');
    const json = await s.req('POST', '/files', t, { purpose: 'material' });
    expect(json.status).toBe(422); // a JSON body is not an upload
  });

  it('rejects disguised executables, scripts and markup whatever the name or declared type says', async () => {
    const t = await s.login(teacherA);
    const cases: [string, string, Buffer, string][] = [
      ['ELF binary named like a photo', 'holiday.png', ELF, 'FILE_TYPE_NOT_ALLOWED'],
      ['Windows PE named like a PDF', 'invoice.pdf', PE, 'FILE_TYPE_NOT_ALLOWED'],
      ['shell script named like notes', 'notes.txt', SHELL, 'FILE_TYPE_NOT_ALLOWED'],
      ['HTML named like a PDF', 'worksheet.pdf', HTML, 'FILE_TYPE_NOT_ALLOWED'],
      ['SVG with a script', 'logo.svg', SVG, 'FILE_TYPE_NOT_ALLOWED'],
      ['SVG renamed to png', 'logo.png', SVG, 'FILE_TYPE_NOT_ALLOWED'],
      ['a real PNG with an .exe name', 'setup.exe', PNG, 'FILE_TYPE_NOT_ALLOWED'],
      ['a real PNG with an .html name', 'page.html', PNG, 'FILE_TYPE_NOT_ALLOWED'],
      ['a real PNG named .pdf', 'scan.pdf', PNG, 'FILE_EXTENSION_MISMATCH'],
      ['a zip with a payload named .docx', 'essay.docx', PLAIN_ZIP, 'FILE_TYPE_NOT_ALLOWED'],
      ['a plain zip', 'bundle.zip', PLAIN_ZIP, 'FILE_TYPE_NOT_ALLOWED'],
      ['random binary', 'blob.bin', Buffer.from([0, 1, 2, 3, 0, 5, 6, 7]), 'FILE_TYPE_NOT_ALLOWED'],
    ];
    for (const [label, filename, data, code] of cases) {
      const r = await upload(s, t, { purpose: 'homework', filename, data, claimed: filename.endsWith('.pdf') ? 'application/pdf' : 'image/png' });
      expect(r.status, label).toBe(422);
      expect(r.body.code, label).toBe(code);
    }
    expect(await s.db.select().from(files).where(eq(files.originalName, 'invoice.pdf'))).toHaveLength(0);
    // and genuine documents of the allowed kinds go through
    for (const [filename, data, mime] of [['notes.txt', TEXT, 'text/plain'], ['essay.docx', DOCX, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'], ['pic.jpg', JPEG, 'image/jpeg'], ['anim.gif', GIF, 'image/gif']] as const) {
      const r = await upload(s, t, { purpose: 'homework', filename, data });
      expect(r.status, filename).toBe(201);
      expect(r.body.mimeType).toBe(mime);
    }
  });

  it('enforces the avatar image allow-list and the 5 MB cap, and leaves nothing behind on failure', async () => {
    const t = await s.login(studentA.username);
    expect((await upload(s, t, { purpose: 'avatar', filename: 'me.gif', data: GIF })).status).toBe(422); // gif is not an avatar type
    expect((await upload(s, t, { purpose: 'avatar', filename: 'me.pdf', data: PDF })).status).toBe(422);
    const before = (await s.db.select().from(files)).length;
    // stream just over 5 MB (PNG header, then filler) without holding it in memory
    const B = '----ss-test-boundary';
    const fileHead = Buffer.from(`--${B}\r\nContent-Disposition: form-data; name="purpose"\r\n\r\navatar\r\n--${B}\r\nContent-Disposition: form-data; name="file"; filename="big.png"\r\nContent-Type: image/png\r\n\r\n`);
    const total = 5 * 1024 * 1024 + 4096;
    const body = Readable.from(
      (async function* () {
        yield fileHead;
        yield PNG;
        for (let sent = PNG.length; sent < total; sent += 65536) yield Buffer.alloc(65536, 0x41);
        yield Buffer.from(`\r\n--${B}--\r\n`);
      })(),
    );
    const res = await s.app.inject({ method: 'POST', url: '/api/v1/files', headers: { 'x-tenant': s.tenant.code, authorization: `Bearer ${t}`, 'content-type': `multipart/form-data; boundary=${B}` }, payload: body });
    expect(res.statusCode).toBe(413);
    expect(JSON.parse(res.body).code).toBe('PAYLOAD_TOO_LARGE');
    expect((await s.db.select().from(files)).length).toBe(before);
  });

  it('enforces who may upload which purpose', async () => {
    const stu = await s.login(studentA.username);
    const par = await s.login(parentA);
    const tea = await s.login(teacherA);
    expect((await upload(s, stu, { purpose: 'homework', filename: 'a.pdf', data: PDF })).status).toBe(403);
    expect((await upload(s, stu, { purpose: 'material', filename: 'a.pdf', data: PDF })).status).toBe(403);
    expect((await upload(s, par, { purpose: 'announcement', filename: 'a.pdf', data: PDF })).status).toBe(403);
    expect((await upload(s, stu, { purpose: 'submission', filename: 'a.pdf', data: PDF })).status).toBe(201);
    expect((await upload(s, par, { purpose: 'document', filename: 'cert.pdf', data: PDF })).status).toBe(201); // leave:create → medical certificate
    expect((await upload(s, par, { purpose: 'other', filename: 'a.pdf', data: PDF })).status).toBe(201);
    expect((await upload(s, tea, { purpose: 'receipt', filename: 'a.pdf', data: PDF })).status).toBe(403);
    expect((await upload(s, null, { purpose: 'other', filename: 'a.pdf', data: PDF })).status).toBe(401);
  });
});

describe('download & per-file authorisation', () => {
  it('streams with the right headers, ETag and byte ranges', async () => {
    const t = await s.login(teacherA);
    const up = await upload(s, t, { purpose: 'homework', filename: 'sheet.pdf', data: PDF });
    const id = up.body.id as string;
    const r = await download(s, t, id);
    expect(r.status).toBe(200);
    expect(r.raw.equals(PDF)).toBe(true);
    expect(r.headers['content-type']).toBe('application/pdf');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['cache-control']).toMatch(/^private/);
    expect(String(r.headers['content-disposition'])).toMatch(/^inline; filename="sheet.pdf"/);
    expect(r.headers['accept-ranges']).toBe('bytes');
    const etag = r.headers.etag as string;
    expect((await download(s, t, id, { 'if-none-match': etag })).status).toBe(304);
    const part = await download(s, t, id, { range: 'bytes=0-4' });
    expect(part.status).toBe(206);
    expect(part.raw.toString()).toBe('%PDF-');
    expect(part.headers['content-range']).toBe(`bytes 0-4/${PDF.length}`);
    expect((await download(s, t, id, { range: 'bytes=-5' })).raw.equals(PDF.subarray(PDF.length - 5))).toBe(true);
    expect((await download(s, t, id, { range: `bytes=${PDF.length + 10}-` })).status).toBe(416);
    expect(String((await download(s, t, id, {}, '?download=1')).headers['content-disposition'])).toMatch(/^attachment/);
    // documents that browsers would not render safely are always downloads; plain text is not compressed on the way out
    const txt = await upload(s, t, { purpose: 'homework', filename: 'n.txt', data: TEXT });
    const tr = await download(s, t, txt.body.id, { 'accept-encoding': 'gzip' });
    expect(String(tr.headers['content-disposition'])).toMatch(/^attachment/);
    expect(tr.headers['content-encoding']).toBeUndefined();
    expect(tr.raw.equals(TEXT)).toBe(true);
  });

  it('only the uploader (and nobody unrelated) can read an unreferenced file; unknown ids and anonymous callers are refused', async () => {
    const up = await upload(s, await s.login(teacherA), { purpose: 'other', filename: 'private.pdf', data: PDF });
    const id = up.body.id as string;
    expect((await download(s, await s.login(teacherA), id)).status).toBe(200);
    for (const who of [studentA.username, parentA, outsiderTeacher, 'librarian']) expect((await download(s, await s.login(who), id)).status, who).toBe(404);
    expect((await download(s, await s.login('office'), id)).status).toBe(404); // administrators need a reason too: purpose "other" has no domain
    expect((await download(s, null, id)).status).toBe(401);
    expect((await download(s, await s.login(teacherA), '0192e0f0-0000-7000-8000-000000000000')).status).toBe(404);
  });

  it('homework attachments follow homework visibility (published, own section / linked child / assigned teacher)', async () => {
    const t = await s.login(teacherA);
    const up = await upload(s, t, { purpose: 'homework', filename: 'hw.pdf', data: PDF });
    const fileId = up.body.id as string;
    const [hw] = await s.db
      .insert(homework)
      .values({ sectionId: secA, subjectId: subjectId(), staffId: teacherAStaff, title: 'Fractions', dueAt: new Date(Date.now() + 86_400_000), attachments: [{ fileId, name: 'hw.pdf' }], status: 'draft' })
      .returning();
    const ok = async (who: string) => (await download(s, await s.login(who), fileId)).status;
    // draft: the author's section teachers only; learners and parents see nothing
    expect(await ok(teacherA)).toBe(200);
    expect(await ok(studentA.username)).toBe(404);
    expect(await ok(parentA)).toBe(404);
    expect(await ok('principal')).toBe(200); // school-scope homework:view
    await s.db.update(homework).set({ status: 'published' }).where(eq(homework.id, hw!.id));
    expect(await ok(studentA.username)).toBe(200);
    expect(await ok(parentA)).toBe(200);
    expect(await ok(studentB.username)).toBe(404); // other section
    expect(await ok(parentB)).toBe(404);
    expect(await ok(outsiderTeacher)).toBe(404);
    expect(await ok('9099999999')).toBe(404); // unverified guardian
    expect(await ok('accounts')).toBe(404);
  });

  it('submission attachments: the student, their parent and the section’s teachers — not classmates or other sections', async () => {
    const stu = await s.login(studentA.username);
    const up = await upload(s, stu, { purpose: 'submission', filename: 'answer.pdf', data: PDF });
    const fileId = up.body.id as string;
    const [hw] = await s.db.insert(homework).values({ sectionId: secA, subjectId: subjectId(), staffId: teacherAStaff, title: 'Essay', dueAt: new Date(Date.now() + 86_400_000), status: 'published' }).returning();
    await s.db.insert(homeworkSubmissions).values({ homeworkId: hw!.id, studentId: studentA.id, attachments: [{ fileId, name: 'answer.pdf' }] });
    const ok = async (who: string) => (await download(s, await s.login(who), fileId)).status;
    expect(await ok(studentA.username)).toBe(200); // uploader
    const classmate = studentsIn(s.ctx, secA).find((x) => x.id !== studentA.id)!;
    expect(await ok(classmate.username)).toBe(404);
    expect(await ok(parentA)).toBe(200); // linked parent of studentA
    expect(await ok(teacherA)).toBe(200);
    expect(await ok(outsiderTeacher)).toBe(404);
    expect(await ok(studentB.username)).toBe(404);
    expect(await ok(parentB)).toBe(404);
  });

  it('study materials follow their section / grade / school-wide audience', async () => {
    const t = await s.login(teacherA);
    const up = await upload(s, t, { purpose: 'material', filename: 'notes.pdf', data: PDF });
    const fileId = up.body.id as string;
    const [m] = await s.db.insert(materials).values({ title: 'Chapter notes', subjectId: subjectId(), sectionId: secA, fileId, createdBy: (await s.db.select().from(users).where(eq(users.username, teacherA)))[0]!.id }).returning();
    const ok = async (who: string) => (await download(s, await s.login(who), fileId)).status;
    expect(await ok(studentA.username)).toBe(200);
    expect(await ok(parentA)).toBe(200);
    expect(await ok(studentB.username)).toBe(404);
    expect(await ok(outsiderTeacher)).toBe(404);
    await s.db.update(materials).set({ archivedAt: new Date() }).where(eq(materials.id, m!.id));
    expect(await ok(studentA.username)).toBe(404); // archived → gone for learners
    expect(await ok(teacherA)).toBe(200); // uploader
  });

  it('announcement attachments reach recipients of a live announcement, not other audiences', async () => {
    const office = await s.login('office');
    const up = await upload(s, office, { purpose: 'announcement', filename: 'circular.pdf', data: PDF });
    const fileId = up.body.id as string;
    const officeUser = (await s.db.select().from(users).where(eq(users.username, 'office')))[0]!;
    const [a] = await s.db.insert(announcements).values({ title: 'Circular', body: 'Read the attachment', status: 'published', publishAt: new Date(Date.now() - 60_000), createdBy: officeUser.id, attachments: [{ fileId, name: 'circular.pdf' }] }).returning();
    await s.db.insert(audienceTargets).values({ ownerType: 'announcement', ownerId: a!.id, targetType: 'section', targetId: secA });
    const ok = async (who: string) => (await download(s, await s.login(who), fileId)).status;
    expect(await ok(studentA.username)).toBe(200);
    expect(await ok(parentA)).toBe(200);
    expect(await ok(studentB.username)).toBe(404);
    expect(await ok(parentB)).toBe(404);
    expect(await ok('9099999999')).toBe(404);
    expect(await ok('principal')).toBe(200); // school-scope editor
    await s.db.update(announcements).set({ status: 'draft' }).where(eq(announcements.id, a!.id));
    expect(await ok(studentA.username)).toBe(404); // not published → invisible even by id
  });

  it('student documents are sensitive: only student_documents:view holders', async () => {
    const office = await s.login('office');
    const up = await upload(s, office, { purpose: 'document', filename: 'birth.pdf', data: PDF });
    const fileId = up.body.id as string;
    await s.db.insert(studentDocuments).values({ studentId: studentA.id, kind: 'birth_certificate', fileId });
    const ok = async (who: string) => (await download(s, await s.login(who), fileId)).status;
    expect(await ok('office')).toBe(200);
    for (const who of [studentA.username, parentA, teacherA, 'principal', 'accounts', 'librarian']) expect(await ok(who), who).toBe(404);
    expect((await download(s, await s.login('admin@test.school'), fileId)).status).toBe(200);
  });

  it('avatars are visible to every signed-in member of the school', async () => {
    const stu = await s.login(studentA.username);
    const up = await upload(s, stu, { path: '/me/avatar', method: 'PUT', filename: 'me.png', data: PNG });
    expect(up.status).toBe(200);
    const fileId = up.body.file.id as string;
    expect(up.body.avatarUrl).toBe(`/api/v1/files/${fileId}`);
    for (const who of [studentB.username, parentB, outsiderTeacher, 'librarian']) expect((await download(s, await s.login(who), fileId)).status, who).toBe(200);
    expect((await download(s, null, fileId)).status).toBe(401);
    const me = await s.req('GET', '/auth/me', stu);
    expect(me.body.avatarUrl).toBe(`/api/v1/files/${fileId}`);
    // replacing retires the old file; removing clears the pointer
    const second = await upload(s, stu, { path: '/me/avatar', method: 'PUT', filename: 'me2.jpg', data: JPEG });
    expect(second.status).toBe(200);
    expect((await download(s, stu, fileId)).status).toBe(404);
    const del = await s.req('DELETE', '/me/avatar', stu);
    expect(del.status).toBe(200);
    expect((await s.req('GET', '/auth/me', stu)).body.avatarUrl).toBeNull();
    expect((await upload(s, stu, { path: '/me/avatar', method: 'PUT', filename: 'doc.pdf', data: PDF })).status).toBe(422);
  });
});

describe('public school logo', () => {
  it('serves only the branded image to anyone, with public caching; never an arbitrary file', async () => {
    const logo = async (headers: Record<string, string> = {}) => s.app.inject({ method: 'GET', url: '/api/v1/site/logo', headers: { 'x-tenant': s.tenant.code, ...headers } });
    expect((await logo()).statusCode).toBe(404); // no logo configured yet
    const office = await s.login('office');
    const png = await upload(s, office, { purpose: 'other', filename: 'logo.png', data: PNG });
    const pdf = await upload(s, office, { purpose: 'other', filename: 'doc.pdf', data: PDF });
    const { controlDb } = await import('../src/core/tenancy/control-db');
    const { tenants } = await import('../src/db/control/schema');
    const { invalidateTenant } = await import('../src/core/tenancy/registry');
    const setLogo = async (logoFileId: string | null) => {
      await controlDb().update(tenants).set({ branding: { logoFileId } }).where(eq(tenants.id, s.tenant.id));
      invalidateTenant(s.tenant.code);
    };
    await setLogo(png.body.id);
    const ok = await logo(); // no Authorization header
    expect(ok.statusCode).toBe(200);
    expect(ok.rawPayload.equals(PNG)).toBe(true);
    expect(ok.headers['content-type']).toBe('image/png');
    expect(ok.headers['cache-control']).toBe('public, max-age=300');
    expect(ok.headers['x-content-type-options']).toBe('nosniff');
    expect((await logo({ 'if-none-match': ok.headers.etag as string })).statusCode).toBe(304);
    await setLogo(pdf.body.id); // not an image → never served
    expect((await logo()).statusCode).toBe(404);
    await setLogo(null);
    expect((await logo()).statusCode).toBe(404);
    // the private file route stays private
    expect((await s.app.inject({ method: 'GET', url: `/api/v1/files/${png.body.id}`, headers: { 'x-tenant': s.tenant.code } })).statusCode).toBe(401);
    expect((await s.app.inject({ method: 'GET', url: '/api/v1/site/logo' })).statusCode).toBe(404); // no school resolved
  });
});

describe('OpenAPI contract', () => {
  it('documents the multipart upload and the binary download', async () => {
    const res = await s.app.inject({ method: 'GET', url: '/api/v1/openapi.json' });
    const doc = JSON.parse(res.body);
    const post = doc.paths['/api/v1/files'].post;
    const form = post.requestBody.content['multipart/form-data'].schema;
    expect(form.properties.file).toMatchObject({ type: 'string', format: 'binary' });
    expect(form.properties.purpose.enum).toContain('homework');
    expect(post.responses['201']).toBeTruthy();
    const get = doc.paths['/api/v1/files/{id}'].get;
    expect(get.responses['200']).toBeTruthy();
    expect(doc.paths['/api/v1/me/avatar'].put.requestBody.content['multipart/form-data']).toBeTruthy();
  });

  it('every route of files / communication / operations is tagged, summarised and has a success response', async () => {
    const doc = JSON.parse((await s.app.inject({ method: 'GET', url: '/api/v1/openapi.json' })).body);
    const mine = /^\/api\/v1\/(files|me\/avatar|site\/logo|announcements|events|calendar|meetings|notifications|transport|library)/;
    const seen = new Set<string>();
    for (const [path, ops] of Object.entries<any>(doc.paths)) {
      if (!mine.test(path)) continue;
      for (const [method, op] of Object.entries<any>(ops)) {
        const label = `${method.toUpperCase()} ${path}`;
        seen.add(path.split('/')[3]!);
        expect(op.tags?.length, label).toBeGreaterThan(0);
        expect(op.summary, label).toBeTruthy();
        expect(Object.keys(op.responses ?? {}).some((c) => /^2\d\d$/.test(c)), label).toBe(true);
      }
    }
    expect([...seen].sort()).toEqual(['announcements', 'calendar', 'events', 'files', 'library', 'me', 'meetings', 'notifications', 'site', 'transport']);
  });
});

describe('delete & housekeeping', () => {
  it('uploader or admin may delete; a referenced file is protected from its uploader; deletes are audited', async () => {
    const t = await s.login(teacherA);
    const other = await s.login(outsiderTeacher);
    const admin = await s.login('admin@test.school');
    const free = (await upload(s, t, { purpose: 'other', filename: 'tmp.pdf', data: PDF })).body.id as string;
    expect((await s.req('DELETE', `/files/${free}`, other)).status).toBe(404); // cannot even see it
    expect((await s.req('DELETE', `/files/${free}`, t)).status).toBe(200);
    expect((await download(s, t, free)).status).toBe(404);
    expect((await s.req('DELETE', `/files/${free}`, t)).status).toBe(404);

    const used = (await upload(s, t, { purpose: 'homework', filename: 'used.pdf', data: PDF })).body.id as string;
    await s.db.insert(homework).values({ sectionId: secA, subjectId: subjectId(), title: 'Ref', dueAt: new Date(Date.now() + 86_400_000), status: 'published', attachments: [{ fileId: used, name: 'used.pdf' }] });
    const blocked = await s.req('DELETE', `/files/${used}`, t);
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('FILE_IN_USE');
    expect((await s.req('DELETE', `/files/${used}`, admin)).status).toBe(200);
    const audits = await s.db.select().from(auditLogs).where(eq(auditLogs.action, 'file.delete'));
    expect(audits.map((a) => a.entityId)).toEqual(expect.arrayContaining([free, used]));
    // a reader who can see the file but did not upload it gets 403 (not 404)
    const shared = (await upload(s, t, { purpose: 'avatar', filename: 'a.png', data: PNG })).body.id as string;
    expect((await s.req('DELETE', `/files/${shared}`, other)).status).toBe(403);
  });

  it('the purge job removes the bytes of long-deleted files and is idempotent', async () => {
    const t = await s.login(teacherA);
    const up = await upload(s, t, { purpose: 'other', filename: 'old.pdf', data: PDF });
    const id = up.body.id as string;
    const [row] = await s.db.select().from(files).where(eq(files.id, id));
    await s.db.update(files).set({ deletedAt: new Date(Date.now() - 40 * 86_400_000) }).where(eq(files.id, id));
    expect(await storage().exists(row!.storageKey)).toBe(true);
    const job = fileJobs.find((j) => j.name === 'files.purge-deleted')!;
    expect(await runJobOnce(s.tenant, job)).toBe(true);
    expect(await storage().exists(row!.storageKey)).toBe(false);
    expect(await purgeDeletedFiles(s.db, 30)).toBe(0); // second run: nothing left to do
    const recent = (await upload(s, t, { purpose: 'other', filename: 'new.pdf', data: PDF })).body.id as string;
    await s.req('DELETE', `/files/${recent}`, t);
    expect(await purgeDeletedFiles(s.db, 30)).toBe(0); // deleted just now: kept for 30 days
  });
});

describe('read-only school', () => {
  it('refuses uploads with 402 but still serves downloads', async () => {
    const t = await s.login(teacherA);
    const id = (await upload(s, t, { purpose: 'other', filename: 'ro.pdf', data: PDF })).body.id as string;
    await upsertSubscription({ tenantCode: s.tenant.code, academicYear: '2020-21', startsOn: '2020-04-01', endsOn: '2021-03-31', pricePerStudent: 100, licensedStudents: 400, graceDays: 10 });
    await upsertSubscription({ tenantCode: s.tenant.code, academicYear: s.ctx.yearName, startsOn: '2000-01-01', endsOn: '2001-01-01', pricePerStudent: 100, licensedStudents: 400, graceDays: 10 });
    invalidateLicense(s.tenant.id);
    const r = await upload(s, t, { purpose: 'other', filename: 'ro2.pdf', data: PDF });
    expect(r.status).toBe(402);
    expect(r.body.code).toBe('SUBSCRIPTION_EXPIRED');
    expect((await download(s, t, id)).status).toBe(200);
    expect((await s.req('DELETE', `/files/${id}`, t)).status).toBe(402);
  });
});
