import { and, eq, inArray, or, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import type { PermissionKey } from '@school-sync/shared';
import { forbidden, notFound } from '../../core/errors';
import type { Principal } from '../../core/rbac/principal';
import { sectionScope, studentScope } from '../../core/rbac/scope';
import type { Executor } from '../../core/tenancy/pools';
import { sections, students } from '../../db/tenant/schema';

const NONE = sql`false`;
const ALL = sql`true`;

/** May this caller see draft exams and sheet-progress figures (i.e. manage exams)? */
export const managesExams = (p: Principal): boolean => p.can('exams:create', 'school') || p.can('exams:edit', 'school') || p.can('exams:publish', 'school');

/**
 * Which mark sheets may this caller see for `perm`?
 *  school   -> every sheet
 *  assigned -> sheets of sections they lead (class-wide) and of (section, subject) pairs they teach
 *  linked / own -> PUBLISHED sheets of their children's / own section only (the publish gate), and the entries are
 *                  narrowed to their own students by the caller (`studentIdScope`).
 */
export function sheetScope(p: Principal, perm: PermissionKey, c: { sectionId: AnyColumn; subjectId: AnyColumn; status: AnyColumn }): SQL {
  switch (p.scope(perm)) {
    case 'school':
      return ALL;
    case 'assigned': {
      const parts: SQL[] = [];
      if (p.classTeacherSectionIds.length) parts.push(inArray(c.sectionId, p.classTeacherSectionIds));
      if (p.teaching.length) {
        parts.push(sql`(${c.sectionId}, ${c.subjectId}) in (${sql.join(p.teaching.map((t) => sql`(${t.sectionId}::uuid, ${t.subjectId}::uuid)`), sql`, `)})`);
      }
      return parts.length ? (or(...parts) as SQL) : NONE;
    }
    case 'linked':
    case 'own':
      return and(eq(c.status, 'published'), sectionScope(p, perm, c.sectionId)) as SQL;
    default:
      return NONE;
  }
}

/** Grade ids reachable through the caller's sections for `perm` (a subquery usable in `grade_id in (...)`). */
export function gradesOfScope(p: Principal, perm: PermissionKey): SQL {
  return sql`(select ${sections.gradeId} from ${sections} where ${sectionScope(p, perm, sections.id)})`;
}

/**
 * Results of one student. `school` scope: any student. `linked` / `own`: the student must be theirs.
 * `assigned`: only the class teacher of the student's section — subject teachers use the mark sheets of their subject.
 * Out of scope answers 404 so existence is never revealed.
 */
export async function assertResultAccess(db: Executor, p: Principal, perm: PermissionKey, studentId: string): Promise<{ sectionId: string | null }> {
  const scope = p.scope(perm);
  if (!scope) throw forbidden();
  const [row] = await db
    .select({ id: students.id, sectionId: students.currentSectionId })
    .from(students)
    .where(and(eq(students.id, studentId), studentScope(p, perm)))
    .limit(1);
  if (!row) throw notFound('Student');
  if (scope === 'assigned' && !(row.sectionId && p.leadsSection(row.sectionId))) throw notFound('Student');
  return { sectionId: row.sectionId };
}
