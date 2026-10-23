import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { LRUCache } from 'lru-cache';
import { scopeAtLeast, widerScope, type Grants, type PermissionKey, type Scope, type UserType } from '@school-sync/shared';
import { academicYears, guardians, roles, rolePermissions, sections, staff, studentGuardians, students, teachingAssignments, userRoles, users } from '../../db/tenant/schema';
import type { Executor } from '../tenancy/pools';

export interface TeachingPair {
  sectionId: string;
  subjectId: string;
}

/** Everything the API needs to know about "who is calling", loaded once and cached briefly. */
export class Principal {
  constructor(
    public readonly userId: string,
    public readonly userType: UserType,
    public readonly displayName: string,
    public readonly username: string,
    public readonly authVersion: number,
    public readonly status: string,
    public readonly roles: string[],
    public readonly grants: Grants,
    public readonly studentId: string | null,
    public readonly guardianId: string | null,
    public readonly staffId: string | null,
    /** the student's own section (student principals) */
    public readonly currentSectionId: string | null,
    /** children reachable through a *verified* guardian link */
    public readonly linkedStudentIds: string[],
    public readonly linkedSectionIds: string[],
    /** current-year sections this teacher leads */
    public readonly classTeacherSectionIds: string[],
    /** class-teacher sections ∪ sections with a teaching assignment */
    public readonly assignedSectionIds: string[],
    public readonly teaching: TeachingPair[],
  ) {}

  scope(perm: PermissionKey): Scope | undefined {
    return this.grants[perm];
  }
  /** Has the permission at `min` scope or wider. */
  can(perm: PermissionKey, min: Scope = 'own'): boolean {
    return scopeAtLeast(this.grants[perm], min);
  }
  hasRole(key: string): boolean {
    return this.roles.includes(key);
  }
  /** Teaches this subject in this section? (subject-level rights such as marks entry) */
  teaches(sectionId: string, subjectId: string): boolean {
    return this.teaching.some((t) => t.sectionId === sectionId && t.subjectId === subjectId);
  }
  leadsSection(sectionId: string): boolean {
    return this.classTeacherSectionIds.includes(sectionId);
  }
}

export async function loadPrincipal(db: Executor, userId: string): Promise<Principal | null> {
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u) return null;

  const roleRows = await db
    .select({ roleKey: roles.key, permission: rolePermissions.permission, scope: rolePermissions.scope })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .where(eq(userRoles.userId, userId));
  const roleKeys = [...new Set(roleRows.map((r) => r.roleKey))];
  const grants: Grants = {};
  for (const r of roleRows) if (r.permission && r.scope) grants[r.permission as PermissionKey] = widerScope(grants[r.permission as PermissionKey], r.scope);

  let studentId: string | null = null;
  let guardianId: string | null = null;
  let staffId: string | null = null;
  let currentSectionId: string | null = null;
  let linkedStudentIds: string[] = [];
  let linkedSectionIds: string[] = [];
  let classTeacherSectionIds: string[] = [];
  let assignedSectionIds: string[] = [];
  let teaching: TeachingPair[] = [];

  if (u.userType === 'student') {
    const [s] = await db.select({ id: students.id, sectionId: students.currentSectionId }).from(students).where(eq(students.userId, userId)).limit(1);
    studentId = s?.id ?? null;
    currentSectionId = s?.sectionId ?? null;
  } else if (u.userType === 'parent') {
    const [g] = await db.select({ id: guardians.id }).from(guardians).where(eq(guardians.userId, userId)).limit(1);
    guardianId = g?.id ?? null;
    if (g) {
      const rows = await db
        .select({ id: students.id, sectionId: students.currentSectionId })
        .from(studentGuardians)
        .innerJoin(students, eq(students.id, studentGuardians.studentId))
        // the "school-approved process": unverified links grant nothing
        .where(and(eq(studentGuardians.guardianId, g.id), isNotNull(studentGuardians.verifiedAt), isNull(students.archivedAt)));
      linkedStudentIds = rows.map((r) => r.id);
      linkedSectionIds = [...new Set(rows.map((r) => r.sectionId).filter((x): x is string => !!x))];
    }
  } else {
    const [st] = await db.select({ id: staff.id }).from(staff).where(eq(staff.userId, userId)).limit(1);
    staffId = st?.id ?? null;
    if (st) {
      const led = await db
        .select({ id: sections.id })
        .from(sections)
        .innerJoin(academicYears, and(eq(academicYears.id, sections.academicYearId), eq(academicYears.isCurrent, true)))
        .where(eq(sections.classTeacherId, st.id));
      classTeacherSectionIds = led.map((r) => r.id);
      const taught = await db
        .select({ sectionId: teachingAssignments.sectionId, subjectId: teachingAssignments.subjectId })
        .from(teachingAssignments)
        .innerJoin(sections, eq(sections.id, teachingAssignments.sectionId))
        .innerJoin(academicYears, and(eq(academicYears.id, sections.academicYearId), eq(academicYears.isCurrent, true)))
        .where(eq(teachingAssignments.staffId, st.id));
      teaching = taught;
      assignedSectionIds = [...new Set([...classTeacherSectionIds, ...taught.map((t) => t.sectionId)])];
    }
  }

  return new Principal(u.id, u.userType, u.displayName, u.username, u.authVersion, u.status, roleKeys, grants, studentId, guardianId, staffId, currentSectionId, linkedStudentIds, linkedSectionIds, classTeacherSectionIds, assignedSectionIds, teaching);
}

const cache = new LRUCache<string, Principal>({ max: 20_000, ttl: 15_000 });

/** Cached for 15 s: role/assignment changes and revocations propagate within that window on every instance. */
export async function getPrincipal(db: Executor, tenantId: string, userId: string): Promise<Principal | null> {
  const key = `${tenantId}:${userId}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const p = await loadPrincipal(db, userId);
  if (p) cache.set(key, p);
  return p;
}

export function invalidatePrincipal(tenantId: string, userId?: string): void {
  if (userId) cache.delete(`${tenantId}:${userId}`);
  else for (const k of cache.keys()) if (k.startsWith(`${tenantId}:`)) cache.delete(k);
}
