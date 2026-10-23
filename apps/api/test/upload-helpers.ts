import type { SeedContext, SeedGuardian, SeedStudent } from '../src/cli/seed/context';
import type { TestSchool } from './helpers';

// ── multipart uploads through app.inject ─────────────────────────────────────────────────────────

export interface Part {
  name: string;
  value?: string;
  filename?: string;
  contentType?: string;
  data?: Buffer;
}

export function multipartBody(parts: Part[], boundary = '----ss-test-boundary'): { body: Buffer; contentType: string } {
  const chunks: Buffer[] = [];
  for (const p of parts) {
    let head = `--${boundary}\r\nContent-Disposition: form-data; name="${p.name}"${p.filename !== undefined ? `; filename="${p.filename}"` : ''}\r\n`;
    if (p.filename !== undefined) head += `Content-Type: ${p.contentType ?? 'application/octet-stream'}\r\n`;
    chunks.push(Buffer.from(`${head}\r\n`), p.data ?? Buffer.from(p.value ?? ''), Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

export interface UploadOpts {
  filename: string;
  data: Buffer;
  /** how `purpose` is sent: before the file as a form field (default), as ?purpose=, after the file (invalid), or not at all */
  purpose?: string;
  via?: 'field' | 'query' | 'after' | 'none';
  /** the (untrusted) content type the client claims */
  claimed?: string;
  path?: string;
  method?: 'POST' | 'PUT';
  fieldName?: string;
}

export async function upload(s: TestSchool, token: string | null, o: UploadOpts) {
  const via = o.via ?? 'field';
  const file: Part = { name: o.fieldName ?? 'file', filename: o.filename, contentType: o.claimed ?? 'application/octet-stream', data: o.data };
  const purpose: Part[] = o.purpose && via !== 'query' && via !== 'none' ? [{ name: 'purpose', value: o.purpose }] : [];
  const parts = via === 'after' ? [file, ...purpose] : [...purpose, file];
  const { body, contentType } = multipartBody(parts);
  const path = `/api/v1${o.path ?? '/files'}${via === 'query' && o.purpose ? `?purpose=${o.purpose}` : ''}`;
  const res = await s.app.inject({ method: o.method ?? 'POST', url: path, headers: { 'x-tenant': s.tenant.code, 'content-type': contentType, ...(token ? { authorization: `Bearer ${token}` } : {}) }, payload: body });
  let parsed: any = null;
  try {
    parsed = res.body ? JSON.parse(res.body) : null;
  } catch {
    /* binary */
  }
  return { status: res.statusCode, body: parsed, headers: res.headers, raw: res.rawPayload };
}

/** GET returning raw bytes + headers (s.req only handles JSON). */
export async function download(s: TestSchool, token: string | null, id: string, headers: Record<string, string> = {}, query = '') {
  const res = await s.app.inject({ method: 'GET', url: `/api/v1/files/${id}${query}`, headers: { 'x-tenant': s.tenant.code, ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers } });
  return { status: res.statusCode, headers: res.headers, raw: res.rawPayload, text: res.body };
}

// ── magic-byte fixtures (tiny, deliberately not full files) ──────────────────────────────────────

const pad = (head: number[] | Buffer, total = 256) => Buffer.concat([Buffer.from(head), Buffer.alloc(Math.max(0, total - head.length), 0x41)]);
export const PNG = pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export const JPEG = pad([0xff, 0xd8, 0xff, 0xe0]);
export const GIF = pad(Buffer.from('GIF89a'));
export const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
export const ELF = pad([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01]);
export const PE = pad(Buffer.from('MZ\x90\x00'));
export const SHELL = Buffer.from('#!/bin/sh\nrm -rf /\n');
export const HTML = Buffer.from('<!doctype html><html><script>alert(1)</script></html>');
export const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
export const TEXT = Buffer.from('hello world\nplain notes\n');
/** a ZIP whose first entry is `name` (just the local file header — enough for sniffing) */
export function zipWithEntry(name: string): Buffer {
  const h = Buffer.alloc(30);
  h.write('PK\x03\x04', 0, 'latin1');
  h.writeUInt16LE(name.length, 26);
  return Buffer.concat([h, Buffer.from(name), Buffer.alloc(64)]);
}
export const DOCX = zipWithEntry('[Content_Types].xml');
export const PLAIN_ZIP = zipWithEntry('payload.exe');

// ── picking people from the seeded structure ─────────────────────────────────────────────────────

export const studentsIn = (ctx: SeedContext, sectionId: string): SeedStudent[] => ctx.students.filter((s) => s.sectionId === sectionId);
export const guardianOf = (ctx: SeedContext, st: SeedStudent): SeedGuardian => ctx.guardians.find((g) => g.id === st.guardianId)!;

/** sections a teacher leads or teaches */
export function sectionsOfTeacher(ctx: SeedContext, staffId: string): Set<string> {
  const out = new Set(ctx.sections.filter((s) => s.classTeacherId === staffId).map((s) => s.id));
  for (const a of ctx.assignments) if (a.staffId === staffId) out.add(a.sectionId);
  return out;
}

/** a teacher (username) that neither leads nor teaches `sectionId` */
export function teacherWithout(ctx: SeedContext, sectionId: string) {
  const t = ctx.teachers.find((x) => !sectionsOfTeacher(ctx, x.id).has(sectionId));
  if (!t) throw new Error('every teacher has access to the section');
  return t;
}

/** a section the teacher neither leads nor teaches */
export function sectionWithout(ctx: SeedContext, staffId: string) {
  const mine = sectionsOfTeacher(ctx, staffId);
  const s = ctx.sections.find((x) => !mine.has(x.id));
  if (!s) throw new Error('teacher has access to every section');
  return s;
}

/** a parent whose children are ALL in `sectionId` */
export function parentOnlyIn(ctx: SeedContext, sectionId: string) {
  for (const st of studentsIn(ctx, sectionId)) {
    const g = guardianOf(ctx, st);
    if (g.studentIds.every((id) => ctx.students.find((x) => x.id === id)!.sectionId === sectionId)) return { guardian: g, child: st };
  }
  throw new Error('no single-section family');
}

/** a parent none of whose children are in `sectionId` */
export function parentWithout(ctx: SeedContext, sectionId: string) {
  const g = ctx.guardians.find((x) => x.studentIds.every((id) => ctx.students.find((s) => s.id === id)!.sectionId !== sectionId));
  if (!g) throw new Error('every family has a child in the section');
  return g;
}
