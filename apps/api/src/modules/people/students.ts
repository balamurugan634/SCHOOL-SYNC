import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type {
  StudentCreateBody,
  StudentDetailOut,
  StudentListItem,
  studentDocumentCreateBody,
  studentListQuery,
  studentMoveSectionBody,
  studentStatusBody,
  studentUpdateBody,
} from '@school-sync/shared';
import { audit } from '../../core/audit';
import { fileUrl, revokeAllSessions } from '../../core/auth/service';
import { assertSeatAvailable } from '../../core/billing/license';
import { AppError, conflict, notFound, unprocessable } from '../../core/errors';
import { assertFilesExist } from '../../core/files';
import { todayIn } from '../../core/http';
import { assertStudentAccess, studentScope } from '../../core/rbac/scope';
import type { Executor } from '../../core/tenancy/pools';
import { academicYears, enrollments, grades, guardians, sections, studentDocuments, studentGuardians, students, users } from '../../db/tenant/schema';
import { createLogin, type Credential } from './accounts';
import { createGuardianRecord } from './guardians';
import { nextAdmissionNumbers } from './sequences';
import { definedOnly, diff, fullName, guardianUserIdsOf, iso, type PeopleCtx } from './util';

// ───────────────────────────────────────────────────────────────────────────────────────────────
// Reads
// ───────────────────────────────────────────────────────────────────────────────────────────────

const itemColumns = {
  id: students.id,
  admissionNo: students.admissionNo,
  firstName: students.firstName,
  lastName: students.lastName,
  gender: students.gender,
  dob: students.dob,
  photoFileId: students.photoFileId,
  status: students.status,
  gradeId: students.currentGradeId,
  gradeName: grades.name,
  sectionId: students.currentSectionId,
  sectionName: sections.name,
  rollNo: students.rollNo,
};
type ItemRow = {
  id: string;
  admissionNo: string;
  firstName: string;
  lastName: string | null;
  gender: StudentListItem['gender'];
  dob: string | null;
  photoFileId: string | null;
  status: StudentListItem['status'];
  gradeId: string | null;
  gradeName: string | null;
  sectionId: string | null;
  sectionName: string | null;
  rollNo: number | null;
};
const toItem = (r: ItemRow): StudentListItem => ({
  id: r.id,
  admissionNo: r.admissionNo,
  firstName: r.firstName,
  lastName: r.lastName,
  name: fullName(r.firstName, r.lastName),
  gender: r.gender,
  dob: r.dob,
  photoUrl: fileUrl(r.photoFileId),
  status: r.status,
  gradeId: r.gradeId,
  gradeName: r.gradeName,
  sectionId: r.sectionId,
  sectionName: r.sectionName,
  rollNo: r.rollNo,
});

const itemQuery = (db: Executor) => db.select(itemColumns).from(students).leftJoin(sections, eq(sections.id, students.currentSectionId)).leftJoin(grades, eq(grades.id, students.currentGradeId));

export async function listStudents(db: Executor, ctx: PeopleCtx, q: z.infer<typeof studentListQuery>) {
  const search = q.q
    ? (() => {
        const pattern = `%${q.q.replace(/[\\%_]/g, '\\$&')}%`;
        return sql`(${students.firstName} ilike ${pattern} or ${students.lastName} ilike ${pattern} or ${students.admissionNo} ilike ${pattern} or concat_ws(' ', ${students.firstName}, ${students.lastName}) ilike ${pattern})`;
      })()
    : undefined;
  const where = and(
    // the scope is part of the query: a teacher gets assigned sections only, a parent their verified children, a student themselves
    studentScope(ctx.principal, 'students:view'),
    q.status ? eq(students.status, q.status) : isNull(students.archivedAt),
    q.gradeId ? eq(students.currentGradeId, q.gradeId) : undefined,
    q.sectionId ? eq(students.currentSectionId, q.sectionId) : undefined,
    search,
  );
  const [rows, [total]] = await Promise.all([
    itemQuery(db)
      .where(where)
      .orderBy(asc(grades.ordinal), asc(sections.name), asc(students.rollNo), asc(students.firstName), asc(students.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db.select({ n: sql<number>`count(*)::int` }).from(students).where(where),
  ]);
  return { rows: rows.map(toItem), total: total?.n ?? 0 };
}

/** Full record, shaped for the caller: sensitive parts (medical notes, documents, login, contact details) only when permitted. */
export async function getStudentDetail(db: Executor, ctx: PeopleCtx, id: string): Promise<StudentDetailOut> {
  const p = ctx.principal;
  const [row] = await db
    .select({ ...itemColumns, bloodGroup: students.bloodGroup, nationality: students.nationality, religion: students.religion, category: students.category, address: students.address, admissionDate: students.admissionDate, emergencyContacts: students.emergencyContacts, authorizedPickups: students.authorizedPickups, medicalNotes: students.medicalNotes, userId: students.userId })
    .from(students)
    .leftJoin(sections, eq(sections.id, students.currentSectionId))
    .leftJoin(grades, eq(grades.id, students.currentGradeId))
    .where(and(eq(students.id, id), studentScope(p, 'students:view')))
    .limit(1);
  if (!row) throw notFound('Student');

  const canManageLinks = p.can('guardians:edit', 'school');
  const seeContacts = !!p.scope('guardians:view');
  const docsAllowed = p.scope('student_documents:view') ? (await db.select({ id: students.id }).from(students).where(and(eq(students.id, id), studentScope(p, 'student_documents:view'))).limit(1)).length > 0 : false;

  const [links, history, docs, login] = await Promise.all([
    db
      .select({ g: guardians, rel: studentGuardians })
      .from(studentGuardians)
      .innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId))
      .where(and(eq(studentGuardians.studentId, id), canManageLinks ? undefined : sql`${studentGuardians.verifiedAt} is not null`))
      .orderBy(desc(studentGuardians.isPrimary), asc(guardians.firstName)),
    db
      .select({ id: enrollments.id, academicYearId: enrollments.academicYearId, academicYearName: academicYears.name, gradeId: enrollments.gradeId, gradeName: grades.name, sectionId: enrollments.sectionId, sectionName: sections.name, rollNo: enrollments.rollNo, status: enrollments.status, startedAt: enrollments.startedAt, endedAt: enrollments.endedAt })
      .from(enrollments)
      .innerJoin(academicYears, eq(academicYears.id, enrollments.academicYearId))
      .innerJoin(grades, eq(grades.id, enrollments.gradeId))
      .innerJoin(sections, eq(sections.id, enrollments.sectionId))
      .where(eq(enrollments.studentId, id))
      .orderBy(desc(academicYears.startDate)),
    docsAllowed ? listDocuments(db, id) : Promise.resolve(null),
    p.scope('users:view') && row.userId ? db.select({ username: users.username }).from(users).where(eq(users.id, row.userId)).limit(1) : Promise.resolve([]),
  ]);

  return {
    ...toItem(row),
    bloodGroup: row.bloodGroup,
    nationality: row.nationality,
    religion: row.religion,
    category: row.category,
    address: row.address ?? null,
    admissionDate: row.admissionDate,
    emergencyContacts: row.emergencyContacts,
    authorizedPickups: row.authorizedPickups,
    // medical notes: school-wide editors and the child's own (verified) guardians — never the student, never other families
    medicalNotes: p.can('students:edit', 'school') || (p.userType === 'parent' && p.linkedStudentIds.includes(id)) ? row.medicalNotes : null,
    username: login[0]?.username ?? null,
    guardians: links.map(({ g, rel }) => {
      const own = !!p.guardianId && p.guardianId === g.id;
      const showContact = seeContacts || own;
      return {
        guardianId: g.id,
        name: fullName(g.firstName, g.lastName),
        relationship: rel.relationship,
        isPrimary: rel.isPrimary,
        canPickup: rel.canPickup,
        isEmergencyContact: rel.isEmergencyContact,
        verified: !!rel.verifiedAt,
        verifiedAt: iso(rel.verifiedAt),
        phone: showContact ? g.phone : null,
        email: showContact ? g.email : null,
        hasLogin: !!g.userId,
      };
    }),
    enrollments: history,
    documents: docs,
  };
}

// ───────────────────────────────────────────────────────────────────────────────────────────────
// Create
// ───────────────────────────────────────────────────────────────────────────────────────────────

/** The section must belong to the CURRENT year (locked so two admissions can't both take the last place). */
export async function loadCurrentSection(tx: Executor, sectionId: string) {
  const [row] = await tx
    .select({ id: sections.id, gradeId: sections.gradeId, yearId: sections.academicYearId, name: sections.name, capacity: sections.capacity, isCurrent: academicYears.isCurrent })
    .from(sections)
    .innerJoin(academicYears, eq(academicYears.id, sections.academicYearId))
    .where(eq(sections.id, sectionId))
    .limit(1)
    .for('update', { of: sections });
  if (!row) throw unprocessable('Section not found', 'SECTION_NOT_FOUND');
  if (!row.isCurrent) throw unprocessable('Choose a section of the current academic year', 'SECTION_NOT_CURRENT_YEAR');
  return row;
}

export async function assertRoomInSection(tx: Executor, section: { id: string; capacity: number | null; name: string }, adding = 1): Promise<void> {
  if (section.capacity == null) return;
  const [c] = await tx.select({ n: sql<number>`count(*)::int` }).from(enrollments).where(and(eq(enrollments.sectionId, section.id), eq(enrollments.status, 'enrolled')));
  if ((c?.n ?? 0) + adding > section.capacity) throw conflict(`Section ${section.name} is full (${c?.n ?? 0}/${section.capacity})`, 'SECTION_FULL');
}

export async function nextRollNo(tx: Executor, sectionId: string): Promise<number> {
  const [r] = await tx.select({ m: sql<number>`coalesce(max(${enrollments.rollNo}), 0)::int` }).from(enrollments).where(eq(enrollments.sectionId, sectionId));
  return (r?.m ?? 0) + 1;
}

export interface PreparedCredentials {
  student?: Credential;
  /** aligned with `input.guardians` */
  guardians: (Credential | undefined)[];
}

export interface CreatedStudent {
  id: string;
  admissionNo: string;
  credentials: { student: { username: string; temporaryPassword: string } | null; guardians: { guardianId: string; username: string; temporaryPassword: string }[] };
  /** logins to refresh after commit */
  userIds: string[];
}

/** Manual add: one student, their enrollment in the current year (uses a billable seat), optional logins and guardian links. */
export async function createStudent(tx: Executor, ctx: PeopleCtx, input: StudentCreateBody, prepared: PreparedCredentials): Promise<CreatedStudent> {
  const section = await loadCurrentSection(tx, input.sectionId);
  await assertRoomInSection(tx, section);
  await assertSeatAvailable(ctx.tenant, tx, 1);
  if (input.photoFileId) await assertFilesExist(tx, [input.photoFileId]);

  const [admissionNo] = await nextAdmissionNumbers(tx, ctx.tenant, 1);
  const name = fullName(input.firstName, input.lastName);
  let loginInfo: { userId: string; username: string; temporaryPassword: string } | null = null;
  if (input.createLogin) {
    loginInfo = await createLogin(tx, { username: admissionNo!.toLowerCase(), displayName: name, userType: 'student', roleKeys: ['student'], credential: prepared.student }, ctx.actor.userId);
  }
  const [student] = await tx
    .insert(students)
    .values({
      userId: loginInfo?.userId ?? null,
      admissionNo: admissionNo!,
      firstName: input.firstName,
      lastName: input.lastName ?? null,
      dob: input.dob ?? null,
      gender: input.gender ?? null,
      bloodGroup: input.bloodGroup ?? null,
      nationality: input.nationality ?? null,
      religion: input.religion ?? null,
      category: input.category ?? null,
      photoFileId: input.photoFileId ?? null,
      address: input.address ?? null,
      medicalNotes: input.medicalNotes ?? null,
      emergencyContacts: input.emergencyContacts ?? [],
      authorizedPickups: input.authorizedPickups ?? [],
      admissionDate: input.admissionDate ?? todayIn(ctx.tenant.timezone),
      currentSectionId: section.id,
      currentGradeId: section.gradeId,
    })
    .returning({ id: students.id });
  const studentId = student!.id;
  const rollNo = input.rollNo ?? (await nextRollNo(tx, section.id));
  await tx.update(students).set({ rollNo }).where(eq(students.id, studentId));
  await tx.insert(enrollments).values({ studentId, academicYearId: section.yearId, gradeId: section.gradeId, sectionId: section.id, rollNo, status: 'enrolled', startedAt: todayIn(ctx.tenant.timezone) });

  const guardianCreds: CreatedStudent['credentials']['guardians'] = [];
  const userIds: string[] = loginInfo ? [loginInfo.userId] : [];
  const gInputs = input.guardians ?? [];
  for (const [i, g] of gInputs.entries()) {
    let guardianId = g.guardianId;
    let guardianUserId: string | null = null;
    if (guardianId) {
      const [found] = await tx.select({ id: guardians.id, userId: guardians.userId }).from(guardians).where(eq(guardians.id, guardianId)).limit(1);
      if (!found) throw unprocessable('A guardian you listed does not exist', 'GUARDIAN_NOT_FOUND');
      guardianUserId = found.userId;
    } else {
      const created = await createGuardianRecord(tx, ctx, { firstName: g.firstName!, lastName: g.lastName ?? null, phone: g.phone ?? null, email: g.email ?? null, occupation: g.occupation ?? null, createLogin: g.createLogin }, prepared.guardians[i]);
      guardianId = created.id;
      guardianUserId = created.userId;
      if (created.credential) guardianCreds.push({ guardianId, ...created.credential });
    }
    await tx.insert(studentGuardians).values({
      studentId,
      guardianId,
      relationship: g.relationship,
      isPrimary: g.isPrimary ?? i === 0,
      canPickup: g.canPickup ?? true,
      isEmergencyContact: g.isEmergencyContact ?? false,
      verifiedAt: g.verified ? new Date() : null,
      verifiedBy: g.verified ? (ctx.actor.userId ?? null) : null,
    });
    if (guardianUserId) userIds.push(guardianUserId);
  }

  await audit(tx, ctx.actor, {
    action: 'student.create',
    entity: 'student',
    entityId: studentId,
    summary: `Added student ${name} (${admissionNo}) to ${section.name}`,
    after: { admissionNo, name, sectionId: section.id, academicYearId: section.yearId, hasLogin: !!loginInfo, guardians: gInputs.length },
  });
  return { id: studentId, admissionNo: admissionNo!, credentials: { student: loginInfo ? { username: loginInfo.username, temporaryPassword: loginInfo.temporaryPassword } : null, guardians: guardianCreds }, userIds };
}

// ───────────────────────────────────────────────────────────────────────────────────────────────
// Edit
// ───────────────────────────────────────────────────────────────────────────────────────────────

export async function updateStudent(tx: Executor, ctx: PeopleCtx, id: string, patch: z.infer<typeof studentUpdateBody>): Promise<void> {
  const [before] = await tx
    .select()
    .from(students)
    .where(and(eq(students.id, id), studentScope(ctx.principal, 'students:edit')))
    .limit(1)
    .for('update');
  if (!before) throw notFound('Student');
  if (patch.photoFileId) await assertFilesExist(tx, [patch.photoFileId]);
  const next = definedOnly({
    firstName: patch.firstName,
    lastName: patch.lastName,
    dob: patch.dob,
    gender: patch.gender,
    bloodGroup: patch.bloodGroup,
    nationality: patch.nationality,
    religion: patch.religion,
    category: patch.category,
    address: patch.address,
    medicalNotes: patch.medicalNotes,
    emergencyContacts: patch.emergencyContacts,
    authorizedPickups: patch.authorizedPickups,
    admissionDate: patch.admissionDate,
    photoFileId: patch.photoFileId,
  });
  if (!Object.keys(next).length) return;
  await tx.update(students).set(next).where(eq(students.id, id));
  if (before.userId && (next.firstName !== undefined || next.lastName !== undefined)) {
    await tx.update(users).set({ displayName: fullName(next.firstName ?? before.firstName, next.lastName === undefined ? before.lastName : next.lastName) }).where(eq(users.id, before.userId));
  }
  const d = diff(before, next);
  // free text like medical notes is not echoed into the audit trail — only that it changed
  const mask = (o: Record<string, unknown>) => (o.medicalNotes !== undefined ? { ...o, medicalNotes: '[changed]' } : o);
  await audit(tx, ctx.actor, { action: 'student.update', entity: 'student', entityId: id, summary: `Updated student ${fullName(before.firstName, before.lastName)} (${before.admissionNo})`, before: mask(d.before), after: mask(d.after) });
}

// ───────────────────────────────────────────────────────────────────────────────────────────────
// Status transitions (archive — never delete)
// ───────────────────────────────────────────────────────────────────────────────────────────────

export const ARCHIVING_STATUSES = ['transferred', 'withdrawn', 'alumni'] as const;
const ENROLLMENT_FOR: Record<(typeof ARCHIVING_STATUSES)[number], 'transferred' | 'left' | 'promoted'> = { transferred: 'transferred', withdrawn: 'left', alumni: 'promoted' };

/**
 * active ⇄ suspended; active|suspended → transferred | withdrawn | alumni (archived: out of every section, login off);
 * archived → active only if the current-year enrollment is still there (it is reopened); otherwise re-admit through admissions.
 */
export async function changeStudentStatus(tx: Executor, ctx: PeopleCtx, id: string, input: z.infer<typeof studentStatusBody>): Promise<{ userIds: string[] }> {
  const [s] = await tx
    .select()
    .from(students)
    .where(and(eq(students.id, id), studentScope(ctx.principal, 'students:edit')))
    .limit(1)
    .for('update');
  if (!s) throw notFound('Student');
  const to = input.status;
  if (s.status === to) return { userIds: [] };
  const archivedNow = (ARCHIVING_STATUSES as readonly string[]).includes(to);
  const wasArchived = !!s.archivedAt;
  const today = input.effectiveDate ?? todayIn(ctx.tenant.timezone);
  if (archivedNow && !ctx.principal.can('students:delete', 'school')) throw new AppError(403, 'FORBIDDEN', 'Transferring, withdrawing or graduating a student needs the permission to archive students');
  if (wasArchived && archivedNow) throw conflict('Reinstate the student first before changing the reason they left', 'INVALID_TRANSITION');

  const [current] = await tx
    .select({ e: enrollments, isCurrent: academicYears.isCurrent })
    .from(enrollments)
    .innerJoin(academicYears, eq(academicYears.id, enrollments.academicYearId))
    .where(and(eq(enrollments.studentId, id), eq(academicYears.isCurrent, true)))
    .limit(1);

  const patch: Partial<typeof students.$inferInsert> = { status: to };
  let userStatus: 'active' | 'suspended' | 'deactivated' = 'active';
  if (to === 'suspended') userStatus = 'suspended';
  if (archivedNow) {
    userStatus = 'deactivated';
    patch.archivedAt = new Date();
    patch.currentSectionId = null;
    if (current) await tx.update(enrollments).set({ status: ENROLLMENT_FOR[to as (typeof ARCHIVING_STATUSES)[number]], endedAt: today }).where(eq(enrollments.id, current.e.id));
  }
  if (to === 'active' && wasArchived) {
    if (!current || !['transferred', 'left'].includes(current.e.status)) throw unprocessable('This student has no open place this year to return to; re-admit them through admissions', 'CANNOT_REINSTATE');
    const [sec] = await tx.select({ id: sections.id, capacity: sections.capacity, name: sections.name }).from(sections).where(eq(sections.id, current.e.sectionId)).limit(1);
    if (sec) await assertRoomInSection(tx, sec);
    patch.archivedAt = null;
    patch.currentSectionId = current.e.sectionId;
    patch.currentGradeId = current.e.gradeId;
    await tx.update(enrollments).set({ status: 'enrolled', endedAt: null }).where(eq(enrollments.id, current.e.id));
  }
  await tx.update(students).set(patch).where(eq(students.id, id));
  if (s.userId) {
    await tx.update(users).set({ status: userStatus, authVersion: sql`${users.authVersion} + 1` }).where(eq(users.id, s.userId));
    if (userStatus !== 'active') await revokeAllSessions(tx, ctx.tenant.id, s.userId, `student_${to}`);
  }
  await audit(tx, ctx.actor, {
    action: 'student.status',
    entity: 'student',
    entityId: id,
    summary: `${fullName(s.firstName, s.lastName)} (${s.admissionNo}): ${s.status} → ${to}${input.reason ? ` — ${input.reason}` : ''}`,
    before: { status: s.status },
    after: { status: to, reason: input.reason ?? null, effectiveDate: today },
  });
  return { userIds: [s.userId, ...(await guardianUserIdsOf(tx, [id]))].filter((x): x is string => !!x) };
}

// ───────────────────────────────────────────────────────────────────────────────────────────────
// Move to another section (same academic year)
// ───────────────────────────────────────────────────────────────────────────────────────────────

export async function moveStudentSection(tx: Executor, ctx: PeopleCtx, id: string, input: z.infer<typeof studentMoveSectionBody>): Promise<{ userIds: string[] }> {
  const [s] = await tx
    .select()
    .from(students)
    .where(and(eq(students.id, id), studentScope(ctx.principal, 'students:edit')))
    .limit(1)
    .for('update');
  if (!s) throw notFound('Student');
  if (s.status !== 'active' && s.status !== 'suspended') throw conflict('Only students currently at the school can change section', 'INVALID_STATE');
  const [enr] = await tx
    .select({ e: enrollments })
    .from(enrollments)
    .innerJoin(academicYears, eq(academicYears.id, enrollments.academicYearId))
    .where(and(eq(enrollments.studentId, id), eq(academicYears.isCurrent, true), eq(enrollments.status, 'enrolled')))
    .limit(1);
  if (!enr) throw unprocessable('The student has no enrollment in the current year', 'NOT_ENROLLED');
  const target = await loadCurrentSection(tx, input.sectionId);
  if (target.id === enr.e.sectionId) throw conflict('The student is already in that section', 'SAME_SECTION');
  if (!input.force) await assertRoomInSection(tx, target);
  const rollNo = input.rollNo ?? (await nextRollNo(tx, target.id));
  await tx.update(enrollments).set({ sectionId: target.id, gradeId: target.gradeId, rollNo }).where(eq(enrollments.id, enr.e.id));
  await tx.update(students).set({ currentSectionId: target.id, currentGradeId: target.gradeId, rollNo }).where(eq(students.id, id));
  await audit(tx, ctx.actor, {
    action: 'student.move_section',
    entity: 'student',
    entityId: id,
    summary: `Moved ${fullName(s.firstName, s.lastName)} (${s.admissionNo}) to section ${target.name}`,
    before: { sectionId: enr.e.sectionId, gradeId: enr.e.gradeId, rollNo: enr.e.rollNo },
    after: { sectionId: target.id, gradeId: target.gradeId, rollNo },
  });
  return { userIds: [s.userId, ...(await guardianUserIdsOf(tx, [id]))].filter((x): x is string => !!x) };
}

// ───────────────────────────────────────────────────────────────────────────────────────────────
// Documents (sensitive)
// ───────────────────────────────────────────────────────────────────────────────────────────────

const toDoc = (d: typeof studentDocuments.$inferSelect): StudentDetailOut['documents'] extends (infer A)[] | null ? A : never => ({
  id: d.id,
  studentId: d.studentId,
  kind: d.kind,
  title: d.title,
  fileId: d.fileId,
  fileUrl: fileUrl(d.fileId)!,
  verified: !!d.verifiedAt,
  verifiedAt: iso(d.verifiedAt),
  uploadedBy: d.uploadedBy,
  createdAt: d.createdAt.toISOString(),
});

export async function listDocuments(db: Executor, studentId: string) {
  const rows = await db.select().from(studentDocuments).where(eq(studentDocuments.studentId, studentId)).orderBy(desc(studentDocuments.createdAt));
  return rows.map(toDoc);
}

export async function addDocument(tx: Executor, ctx: PeopleCtx, studentId: string, input: z.infer<typeof studentDocumentCreateBody>) {
  await assertStudentAccess(tx, ctx.principal, 'student_documents:create', studentId);
  await assertFilesExist(tx, [input.fileId]);
  const [row] = await tx.insert(studentDocuments).values({ studentId, kind: input.kind, title: input.title ?? null, fileId: input.fileId, uploadedBy: ctx.actor.userId ?? null }).returning();
  await audit(tx, ctx.actor, { action: 'student.document_add', entity: 'student', entityId: studentId, summary: `Added a ${input.kind.replace(/_/g, ' ')} document`, after: { documentId: row!.id, kind: input.kind, fileId: input.fileId } });
  return toDoc(row!);
}

export async function verifyDocument(tx: Executor, ctx: PeopleCtx, studentId: string, docId: string) {
  await assertStudentAccess(tx, ctx.principal, 'student_documents:create', studentId);
  const [doc] = await tx.select().from(studentDocuments).where(and(eq(studentDocuments.id, docId), eq(studentDocuments.studentId, studentId))).limit(1).for('update');
  if (!doc) throw notFound('Document');
  if (!doc.verifiedAt) {
    await tx.update(studentDocuments).set({ verifiedAt: new Date() }).where(eq(studentDocuments.id, docId));
    await audit(tx, ctx.actor, { action: 'student.document_verify', entity: 'student', entityId: studentId, summary: `Verified a ${doc.kind.replace(/_/g, ' ')} document`, after: { documentId: docId } });
  }
  const [after] = await tx.select().from(studentDocuments).where(eq(studentDocuments.id, docId)).limit(1);
  return toDoc(after!);
}

export async function deleteDocument(tx: Executor, ctx: PeopleCtx, studentId: string, docId: string) {
  await assertStudentAccess(tx, ctx.principal, 'student_documents:delete', studentId);
  const removed = await tx.delete(studentDocuments).where(and(eq(studentDocuments.id, docId), eq(studentDocuments.studentId, studentId))).returning();
  if (!removed.length) throw notFound('Document');
  await audit(tx, ctx.actor, { action: 'student.document_delete', entity: 'student', entityId: studentId, summary: 'Removed a student document', before: { documentId: docId, kind: removed[0]!.kind, fileId: removed[0]!.fileId } });
}
