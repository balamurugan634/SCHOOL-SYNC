import { and, asc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import type { StaffCreateBody, StaffDetailOut, StaffListItem, StaffWorkloadOut, staffDeactivateBody, staffListQuery, staffUpdateBody } from '@school-sync/shared';
import { audit } from '../../core/audit';
import { fileUrl, revokeAllSessions } from '../../core/auth/service';
import { AppError, conflict, forbidden, notFound, unprocessable } from '../../core/errors';
import { assertFilesExist } from '../../core/files';
import { ilikeAny } from '../../core/http';
import type { Principal } from '../../core/rbac/principal';
import type { Executor } from '../../core/tenancy/pools';
import { academicYears, enrollments, gradeSubjects, grades, roles, sections, staff, subjects, teachingAssignments, timetableSlots, userRoles, users } from '../../db/tenant/schema';
import { assertRolesFitUserType, SUPER_ADMIN } from '../settings/roles';
import { assertContactFree, createLogin, normalizeEmail, normalizePhone, type Credential } from './accounts';
import { nextEmployeeId } from './sequences';
import { definedOnly, diff, fullName, type PeopleCtx } from './util';

type StaffRow = typeof staff.$inferSelect;

/** Staff rows the caller may see: school scope = everyone; `own` = just themselves (a teacher's own profile). */
export function staffScope(p: Principal, perm: 'staff:view' | 'staff:edit' | 'staff:delete'): SQL {
  switch (p.scope(perm)) {
    case 'school':
      return sql`true`;
    case 'own':
      return p.staffId ? eq(staff.id, p.staffId) : sql`false`;
    default:
      return sql`false`;
  }
}

const toItem = (s: StaffRow, roleKeys: string[]): StaffListItem => ({
  id: s.id,
  employeeId: s.employeeId,
  firstName: s.firstName,
  lastName: s.lastName,
  name: fullName(s.firstName, s.lastName),
  designation: s.designation,
  department: s.department,
  staffType: s.staffType,
  status: s.status,
  email: s.email,
  phone: s.phone,
  photoUrl: fileUrl(s.photoFileId),
  hasLogin: !!s.userId,
  roles: roleKeys,
});

async function roleKeysFor(db: Executor, userIds: string[]): Promise<Map<string, string[]>> {
  if (!userIds.length) return new Map();
  const rows = await db.select({ userId: userRoles.userId, key: roles.key }).from(userRoles).innerJoin(roles, eq(roles.id, userRoles.roleId)).where(inArray(userRoles.userId, userIds)).orderBy(asc(roles.key));
  return new Map([...Map.groupBy(rows, (r) => r.userId)].map(([k, v]) => [k, v.map((r) => r.key)]));
}

export async function listStaff(db: Executor, ctx: PeopleCtx, q: z.infer<typeof staffListQuery>) {
  const where = and(
    staffScope(ctx.principal, 'staff:view'),
    q.staffType ? eq(staff.staffType, q.staffType) : undefined,
    q.status ? eq(staff.status, q.status) : undefined,
    q.department ? eq(staff.department, q.department) : undefined,
    q.q ? ilikeAny(q.q, staff.firstName, staff.lastName, staff.employeeId, staff.email, staff.phone, staff.designation) : undefined,
  );
  const [rows, [total]] = await Promise.all([
    db
      .select()
      .from(staff)
      .where(where)
      .orderBy(asc(staff.firstName), asc(staff.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db.select({ n: sql<number>`count(*)::int` }).from(staff).where(where),
  ]);
  const roleMap = await roleKeysFor(db, rows.map((r) => r.userId).filter((x): x is string => !!x));
  return { rows: rows.map((r) => toItem(r, (r.userId && roleMap.get(r.userId)) || [])), total: total?.n ?? 0 };
}

export async function getStaffDetail(db: Executor, ctx: PeopleCtx, id: string): Promise<StaffDetailOut> {
  const [row] = await db
    .select({ s: staff, username: users.username, userStatus: users.status })
    .from(staff)
    .leftJoin(users, eq(users.id, staff.userId))
    .where(and(eq(staff.id, id), staffScope(ctx.principal, 'staff:view')))
    .limit(1);
  if (!row) throw notFound('Staff member');
  const s = row.s;
  const roleMap = await roleKeysFor(db, s.userId ? [s.userId] : []);
  return {
    ...toItem(s, (s.userId && roleMap.get(s.userId)) || []),
    gender: s.gender,
    dob: s.dob,
    joinDate: s.joinDate,
    qualification: s.qualification,
    address: s.address ?? null,
    emergencyContact: s.emergencyContact ?? null,
    userId: s.userId,
    username: row.username ?? null,
    userStatus: row.userStatus ?? null,
  };
}

// ── create / edit ───────────────────────────────────────────────────────────────────────────────
export async function createStaff(tx: Executor, ctx: PeopleCtx, input: StaffCreateBody, cred?: Credential): Promise<{ id: string; userId: string | null; credential: { username: string; temporaryPassword: string } | null }> {
  const p = ctx.principal;
  const requested = [...new Set(input.roleKeys ?? [])];
  // teaching staff get the teacher role automatically; any other role is an access decision that needs roles:edit
  const baseKeys = input.staffType === 'teaching' ? ['teacher'] : [];
  if (requested.some((k) => !baseKeys.includes(k)) && !p.scope('roles:edit')) throw forbidden('Assigning roles needs the permission to edit roles', 'ROLES_EDIT_REQUIRED');
  const roleKeys = [...new Set([...baseKeys, ...requested])];
  if (roleKeys.length) {
    const rows = await tx.select({ key: roles.key, isSystem: roles.isSystem }).from(roles).where(inArray(roles.key, roleKeys));
    if (rows.length !== roleKeys.length) throw new AppError(422, 'ROLE_NOT_FOUND', 'One or more roles do not exist');
    assertRolesFitUserType(rows, 'staff');
    if (roleKeys.includes(SUPER_ADMIN) && !p.hasRole(SUPER_ADMIN)) throw forbidden('Only a super administrator can create a super administrator', 'ONLY_SUPER_ADMIN');
  }
  if (input.photoFileId) await assertFilesExist(tx, [input.photoFileId]);

  const employeeId = await nextEmployeeId(tx);
  const email = input.email ? normalizeEmail(input.email) : null;
  const phone = input.phone ? normalizePhone(input.phone) : null;
  let login: { userId: string; username: string; temporaryPassword: string } | null = null;
  if (input.createLogin) {
    login = await createLogin(tx, { username: input.username ?? employeeId.toLowerCase(), displayName: fullName(input.firstName, input.lastName), userType: 'staff', email, phone, roleKeys, credential: cred }, p.userId);
  }
  const [row] = await tx
    .insert(staff)
    .values({
      userId: login?.userId ?? null,
      employeeId,
      firstName: input.firstName,
      lastName: input.lastName ?? null,
      designation: input.designation ?? null,
      department: input.department ?? null,
      staffType: input.staffType,
      gender: input.gender ?? null,
      dob: input.dob ?? null,
      joinDate: input.joinDate ?? null,
      qualification: input.qualification ?? null,
      phone,
      email,
      address: input.address ?? null,
      emergencyContact: input.emergencyContact ?? null,
      photoFileId: input.photoFileId ?? null,
    })
    .returning({ id: staff.id });
  await audit(tx, ctx.actor, { action: 'staff.create', entity: 'staff', entityId: row!.id, summary: `Added ${input.staffType === 'teaching' ? 'teacher' : 'staff member'} ${fullName(input.firstName, input.lastName)} (${employeeId})`, after: { employeeId, staffType: input.staffType, designation: input.designation ?? null, hasLogin: !!login, roles: login ? roleKeys : [] } });
  return { id: row!.id, userId: login?.userId ?? null, credential: login ? { username: login.username, temporaryPassword: login.temporaryPassword } : null };
}

export async function updateStaff(tx: Executor, ctx: PeopleCtx, id: string, patch: z.infer<typeof staffUpdateBody>): Promise<void> {
  const [before] = await tx
    .select()
    .from(staff)
    .where(and(eq(staff.id, id), staffScope(ctx.principal, 'staff:edit')))
    .limit(1)
    .for('update');
  if (!before) throw notFound('Staff member');
  if (patch.photoFileId) await assertFilesExist(tx, [patch.photoFileId]);
  const next = definedOnly({
    firstName: patch.firstName,
    lastName: patch.lastName,
    designation: patch.designation,
    department: patch.department,
    staffType: patch.staffType,
    gender: patch.gender,
    dob: patch.dob,
    joinDate: patch.joinDate,
    qualification: patch.qualification,
    phone: patch.phone === undefined ? undefined : patch.phone ? normalizePhone(patch.phone) : null,
    email: patch.email === undefined ? undefined : patch.email ? normalizeEmail(patch.email) : null,
    address: patch.address,
    emergencyContact: patch.emergencyContact,
    photoFileId: patch.photoFileId,
  });
  if (!Object.keys(next).length) return;
  if (before.userId) await assertContactFree(tx, { email: next.email, phone: next.phone, exceptUserId: before.userId });
  await tx.update(staff).set(next).where(eq(staff.id, id));
  if (before.userId) {
    const userPatch = definedOnly({
      phone: next.phone,
      email: next.email,
      displayName: next.firstName !== undefined || next.lastName !== undefined ? fullName(next.firstName ?? before.firstName, next.lastName === undefined ? before.lastName : next.lastName) : undefined,
    });
    if (Object.keys(userPatch).length) await tx.update(users).set(userPatch).where(eq(users.id, before.userId));
  }
  const d = diff(before, next);
  await audit(tx, ctx.actor, { action: 'staff.update', entity: 'staff', entityId: id, summary: `Updated ${fullName(before.firstName, before.lastName)} (${before.employeeId})`, before: d.before, after: d.after });
}

// ── deactivate / reactivate ─────────────────────────────────────────────────────────────────────
/** Sections (current or future year) that name this person class teacher, and their subject-teaching rows. */
async function openAssignments(tx: Executor, staffId: string) {
  const led = await tx
    .select({ id: sections.id })
    .from(sections)
    .innerJoin(academicYears, eq(academicYears.id, sections.academicYearId))
    .where(and(eq(sections.classTeacherId, staffId), sql`${academicYears.endDate} >= current_date`));
  const taught = await tx
    .select({ id: teachingAssignments.id })
    .from(teachingAssignments)
    .innerJoin(sections, eq(sections.id, teachingAssignments.sectionId))
    .innerJoin(academicYears, eq(academicYears.id, sections.academicYearId))
    .where(and(eq(teachingAssignments.staffId, staffId), sql`${academicYears.endDate} >= current_date`));
  return { ledIds: led.map((l) => l.id), taughtIds: taught.map((t) => t.id) };
}

export async function deactivateStaff(tx: Executor, ctx: PeopleCtx, id: string, input: z.infer<typeof staffDeactivateBody>): Promise<{ userIds: string[] }> {
  const [s] = await tx
    .select()
    .from(staff)
    .where(and(eq(staff.id, id), staffScope(ctx.principal, 'staff:delete')))
    .limit(1)
    .for('update');
  if (!s) throw notFound('Staff member');
  if (s.userId && s.userId === ctx.principal.userId) throw forbidden('You cannot deactivate your own account', 'CANNOT_MODIFY_SELF');
  if (s.status === 'resigned' || s.status === 'terminated') throw conflict('This staff member is already deactivated', 'ALREADY_DEACTIVATED');

  const open = await openAssignments(tx, id);
  if ((open.ledIds.length || open.taughtIds.length) && !input.releaseAssignments) {
    throw new AppError(409, 'STAFF_HAS_ASSIGNMENTS', `${fullName(s.firstName, s.lastName)} is class teacher of ${open.ledIds.length} section(s) and teaches ${open.taughtIds.length} subject assignment(s). Reassign them first, or deactivate with releaseAssignments.`, {
      classTeacherSections: open.ledIds.length,
      teachingAssignments: open.taughtIds.length,
    });
  }
  if (open.ledIds.length) await tx.update(sections).set({ classTeacherId: null }).where(inArray(sections.id, open.ledIds));
  if (open.taughtIds.length) await tx.delete(teachingAssignments).where(inArray(teachingAssignments.id, open.taughtIds));

  await tx.update(staff).set({ status: input.status }).where(eq(staff.id, id));
  if (s.userId) {
    await tx.update(users).set({ status: 'deactivated', authVersion: sql`${users.authVersion} + 1` }).where(eq(users.id, s.userId));
    await revokeAllSessions(tx, ctx.tenant.id, s.userId, 'account_deactivated');
  }
  await audit(tx, ctx.actor, {
    action: 'staff.deactivate',
    entity: 'staff',
    entityId: id,
    summary: `${fullName(s.firstName, s.lastName)} (${s.employeeId}) is now ${input.status}${input.reason ? ` — ${input.reason}` : ''}`,
    before: { status: s.status },
    after: { status: input.status, reason: input.reason ?? null, releasedClassTeacherSections: open.ledIds.length, releasedTeachingAssignments: open.taughtIds.length },
  });
  return { userIds: s.userId ? [s.userId] : [] };
}

export async function reactivateStaff(tx: Executor, ctx: PeopleCtx, id: string): Promise<{ userIds: string[] }> {
  const [s] = await tx
    .select()
    .from(staff)
    .where(and(eq(staff.id, id), staffScope(ctx.principal, 'staff:edit')))
    .limit(1)
    .for('update');
  if (!s) throw notFound('Staff member');
  if (s.status === 'active') return { userIds: [] };
  await tx.update(staff).set({ status: 'active' }).where(eq(staff.id, id));
  if (s.userId) await tx.update(users).set({ status: 'active', failedLoginCount: 0, lockedUntil: null, authVersion: sql`${users.authVersion} + 1` }).where(eq(users.id, s.userId));
  await audit(tx, ctx.actor, { action: 'staff.reactivate', entity: 'staff', entityId: id, summary: `Reactivated ${fullName(s.firstName, s.lastName)} (${s.employeeId})`, before: { status: s.status }, after: { status: 'active' } });
  return { userIds: s.userId ? [s.userId] : [] };
}

export async function staffUserId(db: Executor, ctx: PeopleCtx, id: string): Promise<string> {
  const [s] = await db
    .select({ userId: staff.userId })
    .from(staff)
    .where(and(eq(staff.id, id), staffScope(ctx.principal, 'staff:edit')))
    .limit(1);
  if (!s) throw notFound('Staff member');
  if (!s.userId) throw unprocessable('This staff member has no login yet', 'NO_LOGIN');
  return s.userId;
}

// ── workload ────────────────────────────────────────────────────────────────────────────────────
export async function staffWorkload(db: Executor, ctx: PeopleCtx, id: string): Promise<StaffWorkloadOut> {
  const [person] = await db
    .select({ id: staff.id, first: staff.firstName, last: staff.lastName })
    .from(staff)
    .where(and(eq(staff.id, id), staffScope(ctx.principal, 'staff:view')))
    .limit(1);
  if (!person) throw notFound('Staff member');
  const [year] = await db.select({ id: academicYears.id, name: academicYears.name }).from(academicYears).where(eq(academicYears.isCurrent, true)).limit(1);
  if (!year) return { staffId: id, name: fullName(person.first, person.last), academicYear: null, sectionsLed: [], assignments: [], totals: { sections: 0, subjects: 0, periodsPerWeek: 0, timetabledPeriods: 0 } };

  const [led, taught, [slots]] = await Promise.all([
    db
      .select({ sectionId: sections.id, gradeName: grades.name, sectionName: sections.name, studentCount: sql<number>`(select count(*)::int from ${enrollments} where ${enrollments.sectionId} = ${sections.id} and ${enrollments.status} = 'enrolled')` })
      .from(sections)
      .innerJoin(grades, eq(grades.id, sections.gradeId))
      .where(and(eq(sections.classTeacherId, id), eq(sections.academicYearId, year.id)))
      .orderBy(asc(grades.ordinal), asc(sections.name)),
    db
      .select({ assignmentId: teachingAssignments.id, sectionId: sections.id, gradeName: grades.name, sectionName: sections.name, subjectId: subjects.id, subjectCode: subjects.code, subjectName: subjects.name, periodsPerWeek: gradeSubjects.periodsPerWeek })
      .from(teachingAssignments)
      .innerJoin(sections, eq(sections.id, teachingAssignments.sectionId))
      .innerJoin(grades, eq(grades.id, sections.gradeId))
      .innerJoin(subjects, eq(subjects.id, teachingAssignments.subjectId))
      .leftJoin(gradeSubjects, and(eq(gradeSubjects.gradeId, sections.gradeId), eq(gradeSubjects.subjectId, teachingAssignments.subjectId)))
      .where(and(eq(teachingAssignments.staffId, id), eq(sections.academicYearId, year.id)))
      .orderBy(asc(grades.ordinal), asc(sections.name), asc(subjects.name)),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(timetableSlots)
      .innerJoin(sections, eq(sections.id, timetableSlots.sectionId))
      .where(and(eq(timetableSlots.staffId, id), eq(sections.academicYearId, year.id))),
  ]);
  const sectionIds = new Set([...led.map((l) => l.sectionId), ...taught.map((t) => t.sectionId)]);
  return {
    staffId: id,
    name: fullName(person.first, person.last),
    academicYear: year.name,
    sectionsLed: led,
    assignments: taught.map((t) => ({ ...t, periodsPerWeek: t.periodsPerWeek ?? null })),
    totals: { sections: sectionIds.size, subjects: new Set(taught.map((t) => t.subjectId)).size, periodsPerWeek: taught.reduce((n, t) => n + (t.periodsPerWeek ?? 0), 0), timetabledPeriods: slots?.n ?? 0 },
  };
}
