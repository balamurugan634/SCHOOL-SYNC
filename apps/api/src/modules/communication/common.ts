import { and, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { USER_TYPES, type AudienceTargetOut, type AudienceTargetType, type FileAttachment, type PermissionKey } from '@school-sync/shared';
import { forbidden, unprocessable } from '../../core/errors';
import type { Principal } from '../../core/rbac/principal';
import type { Executor } from '../../core/tenancy/pools';
import { audienceTargets, files, grades, roles, sections } from '../../db/tenant/schema';
import type { AttachmentRef } from '../../db/tenant/schema/learning';
import { fileUrl } from '../files/service';
import type { AudienceTargetInput, OwnerType } from './audience';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USER_TYPE_LABEL: Record<string, string> = { student: 'Students', parent: 'Parents', staff: 'Staff' };

export interface Target {
  type: AudienceTargetType;
  id: string;
}

/**
 * Validate and canonicalise an audience. Everything must exist; callers without school scope for `perm`
 * (teachers at "assigned" scope) may only address `section` targets for sections they lead or teach.
 */
export async function normalizeTargets(db: Executor, p: Principal, perm: PermissionKey, input: AudienceTargetInput[]): Promise<Target[]> {
  const seen = new Set<string>();
  const out: Target[] = [];
  for (const t of input) {
    const id = t.type === 'all' ? '*' : (t.id ?? '').trim();
    if (t.type !== 'all' && !id) throw unprocessable(`Audience target "${t.type}" needs an id`, 'AUDIENCE_INVALID');
    if ((t.type === 'grade' || t.type === 'section') && !UUID_RE.test(id)) throw unprocessable(`Audience ${t.type} id must be a UUID`, 'AUDIENCE_INVALID');
    if (t.type === 'user_type' && !(USER_TYPES as readonly string[]).includes(id)) throw unprocessable('Audience user_type must be student, parent or staff', 'AUDIENCE_INVALID');
    const key = `${t.type}:${id.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ type: t.type, id: t.type === 'grade' || t.type === 'section' ? id.toLowerCase() : id });
  }
  if (!out.length) throw unprocessable('Choose who this is for', 'AUDIENCE_EMPTY');

  if (p.scope(perm) !== 'school') {
    const bad = out.find((t) => t.type !== 'section' || !p.assignedSectionIds.includes(t.id));
    if (bad) throw forbidden('You can only address sections you lead or teach', 'AUDIENCE_NOT_ALLOWED');
  }

  const ids = (type: AudienceTargetType) => out.filter((t) => t.type === type).map((t) => t.id);
  // sequential on purpose: `db` may be a transaction, and one connection runs one query at a time
  const roleRows = ids('role').length ? await db.select({ key: roles.key }).from(roles).where(inArray(roles.key, ids('role'))) : [];
  const gradeRows = ids('grade').length ? await db.select({ id: grades.id }).from(grades).where(inArray(grades.id, ids('grade'))) : [];
  const sectionRows = ids('section').length ? await db.select({ id: sections.id }).from(sections).where(inArray(sections.id, ids('section'))) : [];
  const known = new Set([...roleRows.map((r) => `role:${r.key}`), ...gradeRows.map((g) => `grade:${g.id}`), ...sectionRows.map((s) => `section:${s.id}`)]);
  const missing = out.find((t) => ['role', 'grade', 'section'].includes(t.type) && !known.has(`${t.type}:${t.id}`));
  if (missing) throw unprocessable(`Unknown audience ${missing.type}`, 'AUDIENCE_INVALID');
  return out;
}

export async function replaceTargets(db: Executor, ownerType: OwnerType, ownerId: string, targets: Target[]): Promise<void> {
  await db.delete(audienceTargets).where(and(eq(audienceTargets.ownerType, ownerType), eq(audienceTargets.ownerId, ownerId)));
  if (targets.length) await db.insert(audienceTargets).values(targets.map((t) => ({ ownerType, ownerId, targetType: t.type, targetId: t.id })));
}

/** Targets of many owners with human labels (grade / section / role names), in two extra queries at most. */
export async function loadAudience(db: Executor, ownerType: OwnerType, ownerIds: string[]): Promise<Map<string, AudienceTargetOut[]>> {
  const result = new Map<string, AudienceTargetOut[]>();
  if (!ownerIds.length) return result;
  const rows = await db
    .select()
    .from(audienceTargets)
    .where(and(eq(audienceTargets.ownerType, ownerType), inArray(audienceTargets.ownerId, ownerIds)));
  const gradeIds = rows.filter((r) => r.targetType === 'grade').map((r) => r.targetId);
  const sectionIds = rows.filter((r) => r.targetType === 'section').map((r) => r.targetId);
  const roleKeys = rows.filter((r) => r.targetType === 'role').map((r) => r.targetId);
  const [g, s, r] = await Promise.all([
    gradeIds.length ? db.select({ id: grades.id, name: grades.name }).from(grades).where(inArray(grades.id, gradeIds)) : [],
    sectionIds.length ? db.select({ id: sections.id, name: sections.name, grade: grades.name }).from(sections).innerJoin(grades, eq(grades.id, sections.gradeId)).where(inArray(sections.id, sectionIds)) : [],
    roleKeys.length ? db.select({ key: roles.key, name: roles.name }).from(roles).where(inArray(roles.key, roleKeys)) : [],
  ]);
  const gMap = new Map(g.map((x) => [x.id, x.name]));
  const sMap = new Map(s.map((x) => [x.id, `${x.grade} ${x.name}`]));
  const rMap = new Map(r.map((x) => [x.key, x.name]));
  for (const row of rows) {
    const label =
      row.targetType === 'all' ? 'Everyone' : row.targetType === 'user_type' ? (USER_TYPE_LABEL[row.targetId] ?? row.targetId) : row.targetType === 'role' ? (rMap.get(row.targetId) ?? row.targetId) : row.targetType === 'grade' ? (gMap.get(row.targetId) ?? 'Grade') : (sMap.get(row.targetId) ?? 'Section');
    const list = result.get(row.ownerId) ?? [];
    list.push({ type: row.targetType, id: row.targetId, label });
    result.set(row.ownerId, list);
  }
  return result;
}

/** Build the stored attachment refs from the author's own uploaded files (order preserved). */
export async function attachmentRefsFor(db: Executor, userId: string, fileIds: string[]): Promise<AttachmentRef[]> {
  const unique = [...new Set(fileIds)];
  if (!unique.length) return [];
  const rows = await db
    .select({ id: files.id, name: files.originalName, mimeType: files.mimeType, sizeBytes: files.sizeBytes })
    .from(files)
    .where(and(inArray(files.id, unique), eq(files.uploadedBy, userId), sql`${files.deletedAt} is null`));
  if (rows.length !== unique.length) throw unprocessable('One or more attachments were not found (upload them first, with purpose "announcement")', 'ATTACHMENT_NOT_FOUND');
  const byId = new Map(rows.map((r) => [r.id, r]));
  return unique.map((id) => {
    const r = byId.get(id)!;
    return { fileId: r.id, name: r.name, mimeType: r.mimeType, sizeBytes: r.sizeBytes };
  });
}

export const toAttachments = (refs: AttachmentRef[]): FileAttachment[] => refs.map((a) => ({ ...a, url: fileUrl(a.fileId) }));

/** preValidation hook for routes whose JSON body is optional: a missing body (null) is treated as `{}`. */
export const emptyBodyOk = async (req: FastifyRequest): Promise<void> => {
  if (req.body == null) (req as { body: unknown }).body = {};
};

export const snippet = (text: string, max = 140): string => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);
