import { and, desc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { MaterialCreateBody, MaterialItem, MaterialUpdateBody } from '@school-sync/shared';
import { audit, type AuditActor } from '../../core/audit';
import { forbidden, notFound, unprocessable } from '../../core/errors';
import { assertFilesExist } from '../../core/files';
import { ilikeAny } from '../../core/http';
import type { Principal } from '../../core/rbac/principal';
import { assertSectionAccess } from '../../core/rbac/scope';
import type { TenantDb } from '../../core/tenancy/pools';
import { gradeSubjects, grades, materials, sections, subjects, users } from '../../db/tenant/schema';
import { iso, isoOrNull, resolveStudent } from './common';

const cols = {
  id: materials.id,
  title: materials.title,
  description: materials.description,
  subjectId: materials.subjectId,
  subjectName: subjects.name,
  gradeId: materials.gradeId,
  gradeName: grades.name,
  sectionId: materials.sectionId,
  sectionName: sections.name,
  fileId: materials.fileId,
  url: materials.url,
  createdBy: materials.createdBy,
  createdByName: users.displayName,
  createdAt: materials.createdAt,
  archivedAt: materials.archivedAt,
};

const select = (db: TenantDb) =>
  db
    .select(cols)
    .from(materials)
    .innerJoin(subjects, eq(subjects.id, materials.subjectId))
    .leftJoin(grades, eq(grades.id, materials.gradeId))
    .leftJoin(sections, eq(sections.id, materials.sectionId))
    .leftJoin(users, eq(users.id, materials.createdBy));
type Row = Awaited<ReturnType<ReturnType<typeof select>['limit']>>[number];

const toItem = (r: Row): MaterialItem => ({
  id: r.id,
  title: r.title,
  description: r.description,
  subjectId: r.subjectId,
  subjectName: r.subjectName,
  gradeId: r.gradeId,
  gradeName: r.gradeName,
  sectionId: r.sectionId,
  sectionName: r.sectionName,
  fileId: r.fileId,
  url: r.url,
  createdBy: r.createdBy,
  createdByName: r.createdByName,
  createdAt: iso(r.createdAt),
  archivedAt: isoOrNull(r.archivedAt),
});

async function gradesOfSections(db: TenantDb, sectionIds: string[]): Promise<string[]> {
  if (!sectionIds.length) return [];
  const rows = await db.selectDistinct({ gradeId: sections.gradeId }).from(sections).where(inArray(sections.id, sectionIds));
  return rows.map((r) => r.gradeId);
}

/**
 * Visibility of materials (SQL, never filtered in JS).
 *  - student / parent: non-archived materials of the child's section, or grade-wide ones for the child's grade
 *  - teacher (assigned): their own uploads, materials for their sections, grade-wide ones for the grades they teach
 *  - school scope: everything
 */
async function visibility(db: TenantDb, p: Principal, studentId?: string): Promise<SQL> {
  if (p.userType !== 'staff') {
    const st = await resolveStudent(db, p, 'materials:view', studentId);
    if (!st) return sql`false`;
    return and(
      isNull(materials.archivedAt),
      or(
        st.sectionId ? eq(materials.sectionId, st.sectionId) : undefined,
        st.gradeId ? and(isNull(materials.sectionId), eq(materials.gradeId, st.gradeId)) : undefined,
      ),
    ) as SQL;
  }
  const sc = p.scope('materials:view');
  if (sc === 'school') return sql`true`;
  if (sc !== 'assigned') return sql`false`;
  const gradeIds = await gradesOfSections(db, p.assignedSectionIds);
  const parts: (SQL | undefined)[] = [eq(materials.createdBy, p.userId)];
  if (p.assignedSectionIds.length) parts.push(inArray(materials.sectionId, p.assignedSectionIds));
  if (gradeIds.length) parts.push(and(isNull(materials.sectionId), inArray(materials.gradeId, gradeIds)));
  return or(...parts) as SQL;
}

export async function listMaterials(
  db: TenantDb,
  p: Principal,
  q: { page: number; pageSize: number; q?: string; subjectId?: string; sectionId?: string; gradeId?: string; studentId?: string; archived?: boolean },
): Promise<{ rows: MaterialItem[]; total: number }> {
  const staffView = p.userType === 'staff';
  const where = and(
    await visibility(db, p, q.studentId),
    staffView && q.archived ? undefined : isNull(materials.archivedAt),
    q.subjectId ? eq(materials.subjectId, q.subjectId) : undefined,
    q.sectionId ? eq(materials.sectionId, q.sectionId) : undefined,
    q.gradeId ? eq(materials.gradeId, q.gradeId) : undefined,
    q.q ? sql`(${ilikeAny(q.q, materials.title, materials.description)})` : undefined,
  );
  const [rows, counted] = await Promise.all([
    select(db)
      .where(where)
      .orderBy(desc(materials.createdAt), desc(materials.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db.select({ n: sql<number>`count(*)::int` }).from(materials).where(where),
  ]);
  return { rows: rows.map(toItem), total: counted[0]?.n ?? 0 };
}

export async function getMaterial(db: TenantDb, p: Principal, id: string, studentId?: string): Promise<MaterialItem> {
  const [r] = await select(db)
    .where(and(eq(materials.id, id), await visibility(db, p, studentId), p.userType === 'staff' ? undefined : isNull(materials.archivedAt)))
    .limit(1);
  if (!r) throw notFound('Material');
  return toItem(r);
}

/** May this teacher teach `subjectId` somewhere in `gradeId`? (grade-wide uploads) */
async function teachesInGrade(db: TenantDb, p: Principal, gradeId: string, subjectId: string): Promise<boolean> {
  const ids = p.teaching.filter((t) => t.subjectId === subjectId).map((t) => t.sectionId);
  if (!ids.length) return false;
  const [row] = await db.select({ id: sections.id }).from(sections).where(and(inArray(sections.id, ids), eq(sections.gradeId, gradeId))).limit(1);
  return !!row;
}

/**
 * Publishing rules: `school` scope any target; teachers only for a section they teach the subject in (or lead), or
 * grade-wide when they teach the subject in at least one section of that grade. The subject must be offered to the grade.
 */
export async function createMaterial(db: TenantDb, p: Principal, actor: AuditActor, body: MaterialCreateBody): Promise<MaterialItem> {
  const school = p.scope('materials:create') === 'school';
  let gradeId = body.gradeId ?? null;
  const sectionId = body.sectionId ?? null;
  if (sectionId) {
    assertSectionAccess(p, 'materials:create', sectionId); // 404 outside my sections
    const [sec] = await db.select({ gradeId: sections.gradeId }).from(sections).where(eq(sections.id, sectionId));
    if (!sec) throw notFound('Section');
    if (gradeId && gradeId !== sec.gradeId) throw unprocessable('The section does not belong to that grade', 'SECTION_GRADE_MISMATCH');
    gradeId = sec.gradeId;
    if (!school && !p.teaches(sectionId, body.subjectId) && !p.leadsSection(sectionId)) throw forbidden('You do not teach this subject in this section', 'NOT_TEACHING_SUBJECT');
  } else {
    const [g] = await db.select({ id: grades.id }).from(grades).where(eq(grades.id, gradeId!));
    if (!g) throw notFound('Grade');
    if (!school && !(await teachesInGrade(db, p, gradeId!, body.subjectId))) throw forbidden('You do not teach this subject in this grade', 'NOT_TEACHING_SUBJECT');
  }
  const id = await db.transaction(async (tx) => {
    const t = tx as unknown as TenantDb;
    const [offered] = await t.select({ s: gradeSubjects.subjectId }).from(gradeSubjects).where(and(eq(gradeSubjects.gradeId, gradeId!), eq(gradeSubjects.subjectId, body.subjectId)));
    if (!offered) throw unprocessable('This subject is not offered to the grade', 'SUBJECT_NOT_OFFERED');
    if (body.fileId) await assertFilesExist(tx, [body.fileId]);
    const [row] = await tx
      .insert(materials)
      .values({ title: body.title, description: body.description ?? null, subjectId: body.subjectId, gradeId, sectionId, fileId: body.fileId ?? null, url: body.url ?? null, createdBy: p.userId })
      .returning({ id: materials.id });
    await audit(tx, actor, { action: 'material.create', entity: 'material', entityId: row!.id, summary: body.title, after: { title: body.title, subjectId: body.subjectId, gradeId, sectionId, fileId: body.fileId ?? null, url: body.url ?? null } });
    return row!.id;
  });
  return getMaterial(db, p, id);
}

/** school scope manages everything; teachers manage what they uploaded or what belongs to a section they teach/lead. */
async function loadManageable(db: TenantDb, p: Principal, perm: 'materials:edit' | 'materials:delete', id: string): Promise<Row> {
  const [r] = await select(db).where(eq(materials.id, id)).limit(1);
  if (!r) throw notFound('Material');
  const sc = p.scope(perm);
  const mine = r.createdBy === p.userId || (!!r.sectionId && (p.teaches(r.sectionId, r.subjectId) || p.leadsSection(r.sectionId)));
  if (sc !== 'school' && !(sc === 'assigned' && mine)) throw notFound('Material');
  return r;
}

export async function updateMaterial(db: TenantDb, p: Principal, actor: AuditActor, id: string, body: MaterialUpdateBody): Promise<MaterialItem> {
  await db.transaction(async (tx) => {
    const t = tx as unknown as TenantDb;
    const m = await loadManageable(t, p, 'materials:edit', id);
    if (m.archivedAt) throw unprocessable('Archived materials cannot be edited', 'MATERIAL_ARCHIVED');
    const next = { title: body.title ?? m.title, description: body.description !== undefined ? body.description : m.description, url: body.url !== undefined ? body.url : m.url, fileId: body.fileId !== undefined ? body.fileId : m.fileId };
    if (!next.url && !next.fileId) throw unprocessable('A material needs a file or a link', 'MATERIAL_EMPTY');
    if (body.fileId) await assertFilesExist(tx, [body.fileId]);
    await tx.update(materials).set(next).where(eq(materials.id, id));
    await audit(tx, actor, { action: 'material.update', entity: 'material', entityId: id, summary: next.title, before: { title: m.title, description: m.description, url: m.url, fileId: m.fileId }, after: next });
  });
  return getMaterial(db, p, id);
}

/** Soft delete: archived materials disappear for learners but stay for management (history is preserved). */
export async function archiveMaterial(db: TenantDb, p: Principal, actor: AuditActor, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const t = tx as unknown as TenantDb;
    const m = await loadManageable(t, p, 'materials:delete', id);
    if (m.archivedAt) return;
    await tx.update(materials).set({ archivedAt: new Date() }).where(eq(materials.id, id));
    await audit(tx, actor, { action: 'material.archive', entity: 'material', entityId: id, summary: m.title, before: { archivedAt: null }, after: { archivedAt: 'now' } });
  });
}
