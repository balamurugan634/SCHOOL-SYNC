import { sql, type SQL } from 'drizzle-orm';
import type { PermissionKey } from '@school-sync/shared';
import { studentIdScope, studentScope } from '../../core/rbac/scope';
import type { Principal } from '../../core/rbac/principal';
import type { Executor } from '../../core/tenancy/pools';
import { admissions, announcements, expenses, files, homework, homeworkSubmissions, leaveRequests, materials, staff, studentDocuments, students } from '../../db/tenant/schema';
import { audienceMatchesPrincipal } from '../communication/audience';

/**
 * Per-file authorisation (`canReadFile`).
 *
 * A file is readable by:
 *   1. its uploader;
 *   2. anyone, for `avatar` files (profile pictures are visible to every signed-in member of the school);
 *   3. school-scope staff of the domain the file's purpose belongs to (e.g. `homework:view` at school scope for homework files);
 *   4. anyone who can see an entity that references the file — each reference below applies the same record-level scope
 *      predicate that entity's own endpoints use (published-only for learners, linked children for parents, …).
 *
 * References are looked up with JSONB containment (`@>`, backed by GIN indexes) or plain indexed column equality, all in
 * ONE round-trip (`select (A or B or …)`). Other modules that start referencing files add a rule with
 * `registerFileAccessRule` (and are then covered by `canReadFile` and by the "file in use" delete guard).
 */

export type FileRow = typeof files.$inferSelect;

/**
 * Returns a boolean SQL expression, or null when the rule cannot apply.
 * `p === null` means "referenced by anything, regardless of who is asking" (used by the delete guard).
 */
export type FileAccessRule = (p: Principal | null, fileId: string) => SQL | null;

const TRUE = sql`true`;
const jsonContains = (col: SQL, fileId: string) => sql`${col} @> ${JSON.stringify([{ fileId }])}::jsonb`;
const sectionVisible = (p: Principal, perm: PermissionKey, col: SQL): SQL => {
  switch (p.scope(perm)) {
    case 'school':
      return TRUE;
    case 'assigned':
      return p.assignedSectionIds.length ? sql`${col} in (${sql.join(p.assignedSectionIds.map((s) => sql`${s}`), sql`, `)})` : sql`false`;
    case 'linked':
      return p.linkedSectionIds.length ? sql`${col} in (${sql.join(p.linkedSectionIds.map((s) => sql`${s}`), sql`, `)})` : sql`false`;
    case 'own':
      return p.currentSectionId ? sql`${col} = ${p.currentSectionId}` : sql`false`;
    default:
      return sql`false`;
  }
};
const learnerSees = (p: Principal) => p.scope('homework:view') === 'own' || p.scope('homework:view') === 'linked';

const rules: FileAccessRule[] = [
  // homework attachments — learners only see published homework of their section(s)
  (p, id) => {
    const body = sql`select 1 from ${homework} where ${jsonContains(sql`${homework.attachments}`, id)}`;
    if (!p) return sql`exists (${body})`;
    if (!p.scope('homework:view')) return null;
    return sql`exists (${body} and ${sectionVisible(p, 'homework:view', sql`${homework.sectionId}`)} and (${learnerSees(p) ? sql`${homework.status} = 'published'` : TRUE}))`;
  },
  // submission attachments — the student, their linked parents, and teachers of the student's section
  (p, id) => {
    const body = sql`select 1 from ${homeworkSubmissions} where ${jsonContains(sql`${homeworkSubmissions.attachments}`, id)}`;
    if (!p) return sql`exists (${body})`;
    if (!p.scope('submissions:view')) return null;
    return sql`exists (${body} and ${studentIdScope(p, 'submissions:view', homeworkSubmissions.studentId)})`;
  },
  // study materials (grade-wide, section-specific, or school-wide when both are null)
  (p, id) => {
    const body = sql`select 1 from ${materials} where ${materials.fileId} = ${id} and ${materials.archivedAt} is null`;
    if (!p) return sql`exists (${body})`;
    const perm: PermissionKey = 'materials:view';
    const scope = p.scope(perm);
    if (!scope) return null;
    if (scope === 'school') return sql`exists (${body})`;
    if (scope === 'assigned') {
      if (!p.assignedSectionIds.length) return sql`exists (${body} and ${materials.createdBy} = ${p.userId})`;
      const secs = sql.join(p.assignedSectionIds.map((s) => sql`${s}`), sql`, `);
      return sql`exists (${body} and (${materials.createdBy} = ${p.userId} or ${materials.sectionId} in (${secs}) or (${materials.sectionId} is null and (${materials.gradeId} is null or ${materials.gradeId} in (select sec.grade_id from sections sec where sec.id in (${secs}))))))`;
    }
    const ids = scope === 'own' ? (p.studentId ? [p.studentId] : []) : p.linkedStudentIds;
    if (!ids.length) return null;
    const who = sql.join(ids.map((s) => sql`${s}`), sql`, `);
    return sql`exists (${body} and exists (select 1 from ${students} where ${students.id} in (${who}) and (${materials.sectionId} = ${students.currentSectionId} or (${materials.sectionId} is null and (${materials.gradeId} is null or ${materials.gradeId} = ${students.currentGradeId})))))`;
  },
  // announcement attachments — recipients of a live announcement, its author, and school-scope editors (any state)
  (p, id) => {
    const body = sql`select 1 from ${announcements} where ${jsonContains(sql`${announcements.attachments}`, id)}`;
    if (!p) return sql`exists (${body})`;
    if (p.scope('announcements:edit') === 'school') return sql`exists (${body})`;
    const now = new Date();
    const live = sql`${announcements.status} = 'published' and (${announcements.publishAt} is null or ${announcements.publishAt} <= ${now}) and (${announcements.expiresAt} is null or ${announcements.expiresAt} > ${now})`;
    return sql`exists (${body} and (${announcements.createdBy} = ${p.userId} or (${live} and ${audienceMatchesPrincipal(p, 'announcement', announcements.id)})))`;
  },
  // student documents — sensitive: `student_documents:view`, scoped to the student
  (p, id) => {
    const body = sql`select 1 from ${studentDocuments} where ${studentDocuments.fileId} = ${id}`;
    if (!p) return sql`exists (${body})`;
    if (!p.scope('student_documents:view')) return null;
    return sql`exists (${body} and ${studentIdScope(p, 'student_documents:view', studentDocuments.studentId)})`;
  },
  // a student's profile photo — whoever may view that student
  (p, id) => {
    const body = sql`select 1 from ${students} where ${students.photoFileId} = ${id}`;
    if (!p) return sql`exists (${body})`;
    if (!p.scope('students:view')) return null;
    return sql`exists (${body} and ${studentScope(p, 'students:view')})`;
  },
  // staff photos are directory information for every signed-in member of the school
  (_p, id) => sql`exists (select 1 from ${staff} where ${staff.photoFileId} = ${id})`,
  // leave-request attachments (e.g. a medical certificate)
  (p, id) => {
    const body = sql`select 1 from ${leaveRequests} where ${leaveRequests.attachmentFileId} = ${id}`;
    if (!p) return sql`exists (${body})`;
    if (!p.scope('leave:view')) return null;
    return sql`exists (${body} and ${studentIdScope(p, 'leave:view', leaveRequests.studentId)})`;
  },
  // expense receipts
  (p, id) => {
    const body = sql`select 1 from ${expenses} where ${expenses.receiptFileId} = ${id}`;
    if (!p) return sql`exists (${body})`;
    return p.can('expenses:view', 'school') ? sql`exists (${body})` : null;
  },
  // admission documents (array of file ids)
  (p, id) => {
    const body = sql`select 1 from ${admissions} where ${admissions.documents} @> ${JSON.stringify([id])}::jsonb`;
    if (!p) return sql`exists (${body})`;
    return p.can('admissions:view', 'school') ? sql`exists (${body})` : null;
  },
];

/** Let another module declare that it references files (so reading them follows that module's visibility). */
export function registerFileAccessRule(rule: FileAccessRule): void {
  rules.push(rule);
}

/** Domain permission that grants *school-scope* staff access to files of a purpose, without needing a reference. */
const DOMAIN_PERMS: Partial<Record<FileRow['purpose'], PermissionKey[]>> = {
  homework: ['homework:view'],
  submission: ['submissions:view'],
  material: ['materials:view'],
  // admission documents are reached through their admission (admissions:view) by the reference rule below, not by purpose
  document: ['student_documents:view'],
  announcement: ['announcements:edit'],
  receipt: ['payments:view', 'expenses:view'],
};

export async function canReadFile(p: Principal, db: Executor, file: FileRow): Promise<boolean> {
  if (file.deletedAt) return false;
  if (file.uploadedBy && file.uploadedBy === p.userId) return true;
  if (file.purpose === 'avatar') return true;
  if (DOMAIN_PERMS[file.purpose]?.some((perm) => p.scope(perm) === 'school')) return true;
  return anyRule(db, p, file.id);
}

/** Is the file referenced by any entity at all (ignoring who is asking)? */
export function isFileReferenced(db: Executor, fileId: string): Promise<boolean> {
  return anyRule(db, null, fileId);
}

async function anyRule(db: Executor, p: Principal | null, fileId: string): Promise<boolean> {
  const conds = rules.map((r) => r(p, fileId)).filter((c): c is SQL => c !== null);
  if (!conds.length) return false;
  const res = await db.execute<{ ok: boolean }>(sql`select (${sql.join(conds, sql` or `)}) as ok`);
  return res.rows[0]?.ok === true;
}
