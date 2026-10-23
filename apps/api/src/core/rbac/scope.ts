import { and, eq, inArray, sql, type SQL, type AnyColumn } from 'drizzle-orm';
import type { PermissionKey } from '@school-sync/shared';
import { students } from '../../db/tenant/schema';
import { forbidden, notFound } from '../errors';
import type { Executor } from '../tenancy/pools';
import type { Principal } from './principal';

/**
 * Turn "permission + scope" into SQL, so the restriction is part of the query itself.
 * Use these in every list/detail query on protected data; never fetch-then-filter in JS.
 */

const NONE = sql`false`;
const ALL = sql`true`;

/** Predicate over the `students` table: which students may this principal see for `perm`? */
export function studentScope(p: Principal, perm: PermissionKey): SQL {
  switch (p.scope(perm)) {
    case 'school':
      return ALL;
    case 'assigned':
      return p.assignedSectionIds.length ? inArray(students.currentSectionId, p.assignedSectionIds) : NONE;
    case 'linked':
      return p.linkedStudentIds.length ? inArray(students.id, p.linkedStudentIds) : NONE;
    case 'own':
      return p.studentId ? eq(students.id, p.studentId) : NONE;
    default:
      return NONE;
  }
}

/** Predicate over any column holding a student id (attendance_records.student_id, invoices.student_id, …). */
export function studentIdScope(p: Principal, perm: PermissionKey, col: AnyColumn): SQL {
  switch (p.scope(perm)) {
    case 'school':
      return ALL;
    case 'assigned':
      return p.assignedSectionIds.length ? sql`${col} in (select ${students.id} from ${students} where ${inArray(students.currentSectionId, p.assignedSectionIds)})` : NONE;
    case 'linked':
      return p.linkedStudentIds.length ? inArray(col, p.linkedStudentIds) : NONE;
    case 'own':
      return p.studentId ? eq(col, p.studentId) : NONE;
    default:
      return NONE;
  }
}

/** Predicate over a column holding a section id. */
export function sectionScope(p: Principal, perm: PermissionKey, col: AnyColumn): SQL {
  switch (p.scope(perm)) {
    case 'school':
      return ALL;
    case 'assigned':
      return p.assignedSectionIds.length ? inArray(col, p.assignedSectionIds) : NONE;
    case 'linked':
      return p.linkedSectionIds.length ? inArray(col, p.linkedSectionIds) : NONE;
    case 'own':
      return p.currentSectionId ? eq(col, p.currentSectionId) : NONE;
    default:
      return NONE;
  }
}

/** May this principal act on this student for `perm`? Throws 404 (not 403) so existence isn't revealed. */
export async function assertStudentAccess(db: Executor, p: Principal, perm: PermissionKey, studentId: string): Promise<void> {
  if (!p.scope(perm)) throw forbidden();
  const [row] = await db
    .select({ id: students.id })
    .from(students)
    .where(and(eq(students.id, studentId), studentScope(p, perm)))
    .limit(1);
  if (!row) throw notFound('Student');
}

/** May this principal act on this section for `perm`? (in-memory check; section lists are small and cached on the principal) */
export function canAccessSection(p: Principal, perm: PermissionKey, sectionId: string): boolean {
  switch (p.scope(perm)) {
    case 'school':
      return true;
    case 'assigned':
      return p.assignedSectionIds.includes(sectionId);
    case 'linked':
      return p.linkedSectionIds.includes(sectionId);
    case 'own':
      return p.currentSectionId === sectionId;
    default:
      return false;
  }
}

export function assertSectionAccess(p: Principal, perm: PermissionKey, sectionId: string): void {
  if (!p.scope(perm)) throw forbidden();
  if (!canAccessSection(p, perm, sectionId)) throw notFound('Section');
}
