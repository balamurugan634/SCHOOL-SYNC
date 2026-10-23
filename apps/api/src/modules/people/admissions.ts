import { and, desc, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { AdmissionOut, admissionCreateBody, admissionEnrollBody, admissionListQuery, admissionStatusBody, admissionUpdateBody } from '@school-sync/shared';
import { audit } from '../../core/audit';
import { AppError, conflict, forbidden, notFound, unprocessable } from '../../core/errors';
import { assertFilesExist } from '../../core/files';
import { ilikeAny } from '../../core/http';
import type { Executor } from '../../core/tenancy/pools';
import { academicYears, admissions, grades, studentDocuments, studentGuardians } from '../../db/tenant/schema';
import { normalizePhone, type Credential } from './accounts';
import { findGuardianByPhone } from './guardians';
import { nextApplicationNo } from './sequences';
import { createStudent, loadCurrentSection } from './students';
import { definedOnly, diff, fullName, iso, type PeopleCtx } from './util';

type Row = typeof admissions.$inferSelect;

const toOut = (r: Row, gradeName: string | null, yearName: string | null): AdmissionOut => ({
  id: r.id,
  applicationNo: r.applicationNo,
  firstName: r.firstName,
  lastName: r.lastName,
  name: fullName(r.firstName, r.lastName),
  dob: r.dob,
  gender: r.gender,
  gradeAppliedId: r.gradeAppliedId,
  gradeAppliedName: gradeName,
  academicYearId: r.academicYearId,
  academicYearName: yearName,
  guardianName: r.guardianName,
  guardianRelationship: r.guardianRelationship,
  guardianPhone: r.guardianPhone,
  guardianEmail: r.guardianEmail,
  previousSchool: r.previousSchool,
  address: r.address ?? null,
  notes: r.notes,
  documents: r.documents,
  status: r.status,
  decidedBy: r.decidedBy,
  decidedAt: iso(r.decidedAt),
  decisionNote: r.decisionNote,
  studentId: r.studentId,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

const base = (db: Executor) => db.select({ a: admissions, gradeName: grades.name, yearName: academicYears.name }).from(admissions).leftJoin(grades, eq(grades.id, admissions.gradeAppliedId)).leftJoin(academicYears, eq(academicYears.id, admissions.academicYearId));

export async function getAdmission(db: Executor, id: string): Promise<AdmissionOut> {
  const [r] = await base(db).where(eq(admissions.id, id)).limit(1);
  if (!r) throw notFound('Admission');
  return toOut(r.a, r.gradeName, r.yearName);
}

export async function listAdmissions(db: Executor, q: z.infer<typeof admissionListQuery>) {
  const where = and(
    q.status ? eq(admissions.status, q.status) : undefined,
    q.gradeId ? eq(admissions.gradeAppliedId, q.gradeId) : undefined,
    q.yearId ? eq(admissions.academicYearId, q.yearId) : undefined,
    q.q ? ilikeAny(q.q, admissions.firstName, admissions.lastName, admissions.applicationNo, admissions.guardianName, admissions.guardianPhone) : undefined,
  );
  const [rows, [total]] = await Promise.all([
    base(db)
      .where(where)
      .orderBy(desc(admissions.createdAt), desc(admissions.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db.select({ n: sql<number>`count(*)::int` }).from(admissions).where(where),
  ]);
  return { rows: rows.map((r) => toOut(r.a, r.gradeName, r.yearName)), total: total?.n ?? 0 };
}

async function currentYearId(db: Executor): Promise<string | null> {
  const [y] = await db.select({ id: academicYears.id }).from(academicYears).where(eq(academicYears.isCurrent, true)).limit(1);
  return y?.id ?? null;
}

export async function createAdmission(tx: Executor, ctx: PeopleCtx, input: z.infer<typeof admissionCreateBody>): Promise<string> {
  const [grade] = await tx.select({ id: grades.id }).from(grades).where(eq(grades.id, input.gradeAppliedId)).limit(1);
  if (!grade) throw unprocessable('The grade applied for does not exist', 'GRADE_NOT_FOUND');
  const yearId = input.academicYearId ?? (await currentYearId(tx));
  if (input.documents?.length) await assertFilesExist(tx, input.documents);
  const applicationNo = await nextApplicationNo(tx, ctx.tenant);
  const [row] = await tx
    .insert(admissions)
    .values({
      applicationNo,
      firstName: input.firstName,
      lastName: input.lastName ?? null,
      dob: input.dob ?? null,
      gender: input.gender ?? null,
      gradeAppliedId: input.gradeAppliedId,
      academicYearId: yearId,
      guardianName: input.guardianName,
      guardianRelationship: input.guardianRelationship,
      guardianPhone: normalizePhone(input.guardianPhone),
      guardianEmail: input.guardianEmail?.toLowerCase() ?? null,
      previousSchool: input.previousSchool ?? null,
      address: input.address ?? null,
      notes: input.notes ?? null,
      documents: input.documents ?? [],
      status: 'submitted',
    })
    .returning({ id: admissions.id });
  await audit(tx, ctx.actor, { action: 'admission.create', entity: 'admission', entityId: row!.id, summary: `Application ${applicationNo} for ${fullName(input.firstName, input.lastName)}`, after: { applicationNo, gradeAppliedId: input.gradeAppliedId, academicYearId: yearId } });
  return row!.id;
}

const EDITABLE: Row['status'][] = ['submitted', 'under_review', 'waitlisted', 'accepted'];

export async function updateAdmission(tx: Executor, ctx: PeopleCtx, id: string, patch: z.infer<typeof admissionUpdateBody>): Promise<void> {
  const [before] = await tx.select().from(admissions).where(eq(admissions.id, id)).limit(1).for('update');
  if (!before) throw notFound('Admission');
  if (!EDITABLE.includes(before.status)) throw conflict(`An application that is ${before.status} can no longer be edited`, 'INVALID_STATE');
  if (patch.documents?.length) await assertFilesExist(tx, patch.documents);
  if (patch.gradeAppliedId) {
    const [g] = await tx.select({ id: grades.id }).from(grades).where(eq(grades.id, patch.gradeAppliedId)).limit(1);
    if (!g) throw unprocessable('The grade applied for does not exist', 'GRADE_NOT_FOUND');
  }
  const next = definedOnly({
    firstName: patch.firstName,
    lastName: patch.lastName,
    dob: patch.dob,
    gender: patch.gender,
    gradeAppliedId: patch.gradeAppliedId,
    academicYearId: patch.academicYearId,
    guardianName: patch.guardianName,
    guardianRelationship: patch.guardianRelationship,
    guardianPhone: patch.guardianPhone ? normalizePhone(patch.guardianPhone) : undefined,
    guardianEmail: patch.guardianEmail?.toLowerCase(),
    previousSchool: patch.previousSchool,
    address: patch.address,
    notes: patch.notes,
    documents: patch.documents,
  });
  if (!Object.keys(next).length) return;
  await tx.update(admissions).set(next).where(eq(admissions.id, id));
  const d = diff(before, next);
  await audit(tx, ctx.actor, { action: 'admission.update', entity: 'admission', entityId: id, summary: `Edited application ${before.applicationNo}`, before: d.before, after: d.after });
}

/** submitted → under_review → waitlisted | accepted | rejected; enrolling is a separate step (`enroll`). */
const TRANSITIONS: Record<Row['status'], Row['status'][]> = {
  submitted: ['under_review', 'rejected'],
  under_review: ['waitlisted', 'accepted', 'rejected'],
  waitlisted: ['under_review', 'accepted', 'rejected'],
  accepted: ['rejected'],
  rejected: ['under_review'],
  enrolled: [],
};

export async function changeAdmissionStatus(tx: Executor, ctx: PeopleCtx, id: string, input: z.infer<typeof admissionStatusBody>): Promise<void> {
  const [a] = await tx.select().from(admissions).where(eq(admissions.id, id)).limit(1).for('update');
  if (!a) throw notFound('Admission');
  if (!TRANSITIONS[a.status].includes(input.status)) throw new AppError(409, 'INVALID_TRANSITION', `An application that is ${a.status} cannot become ${input.status}`, { from: a.status, allowed: TRANSITIONS[a.status] });
  // moving into review is clerical; every decision (and reopening a rejection) is an approval
  const needed = input.status === 'under_review' && a.status === 'submitted' ? 'admissions:edit' : 'admissions:approve';
  if (!ctx.principal.can(needed, 'school')) throw forbidden();
  const decision = input.status !== 'under_review';
  await tx
    .update(admissions)
    .set({ status: input.status, decidedBy: decision ? (ctx.actor.userId ?? null) : null, decidedAt: decision ? new Date() : null, decisionNote: input.note ?? null })
    .where(eq(admissions.id, id));
  await audit(tx, ctx.actor, {
    action: `admission.${input.status}`,
    entity: 'admission',
    entityId: id,
    summary: `Application ${a.applicationNo} (${fullName(a.firstName, a.lastName)}): ${a.status} → ${input.status}${input.note ? ` — ${input.note}` : ''}`,
    before: { status: a.status },
    after: { status: input.status, note: input.note ?? null },
  });
}

export interface EnrollResult {
  studentId: string;
  admissionNo: string;
  guardianId: string;
  guardianLinkVerified: boolean;
  credentials: { student: { username: string; temporaryPassword: string } | null; guardian: { username: string; temporaryPassword: string } | null };
  userIds: string[];
}

/**
 * Accepted application → real student: student record + login, parent (new, or the registered one with that phone number),
 * guardian link, and the enrollment in the current year — one transaction, seat-checked.
 */
export async function enrollAdmission(tx: Executor, ctx: PeopleCtx, id: string, input: z.infer<typeof admissionEnrollBody>, prepared: { student?: Credential; guardian?: Credential }): Promise<EnrollResult> {
  const [a] = await tx.select().from(admissions).where(eq(admissions.id, id)).limit(1).for('update');
  if (!a) throw notFound('Admission');
  if (a.status === 'enrolled') throw conflict('This application has already been enrolled', 'ALREADY_ENROLLED');
  if (a.status !== 'accepted') throw new AppError(409, 'ADMISSION_NOT_ACCEPTED', 'Only accepted applications can be enrolled', { status: a.status });

  const section = await loadCurrentSection(tx, input.sectionId);
  if (a.gradeAppliedId && section.gradeId !== a.gradeAppliedId) throw unprocessable('That section belongs to a different grade than the one applied for', 'GRADE_MISMATCH');

  const existing = await findGuardianByPhone(tx, a.guardianPhone);
  const [first, ...rest] = a.guardianName.trim().split(/\s+/);
  const relationship = a.guardianRelationship ?? 'guardian';
  const guardianInput = existing
    ? { guardianId: existing.id, relationship, isPrimary: true, createLogin: false, verified: input.verifyExistingGuardian }
    : { firstName: first ?? a.guardianName, lastName: rest.join(' ') || undefined, phone: a.guardianPhone, email: a.guardianEmail ?? undefined, relationship, isPrimary: true, createLogin: input.createParentLogin, verified: true };

  const created = await createStudent(
    tx,
    ctx,
    {
      firstName: a.firstName,
      lastName: a.lastName,
      dob: a.dob,
      gender: a.gender,
      address: a.address,
      sectionId: section.id,
      rollNo: input.rollNo,
      createLogin: input.createStudentLogin,
      emergencyContacts: [{ name: a.guardianName, relationship, phone: a.guardianPhone }],
      guardians: [guardianInput],
    },
    { student: prepared.student, guardians: [prepared.guardian] },
  );
  const [link] = await tx.select({ guardianId: studentGuardians.guardianId, verifiedAt: studentGuardians.verifiedAt }).from(studentGuardians).where(eq(studentGuardians.studentId, created.id)).limit(1);
  if (a.documents.length) {
    await tx.insert(studentDocuments).values(a.documents.map((fileId) => ({ studentId: created.id, kind: 'other' as const, title: 'Admission document', fileId, uploadedBy: ctx.actor.userId ?? null })));
  }
  await tx.update(admissions).set({ status: 'enrolled', studentId: created.id }).where(eq(admissions.id, id));
  await audit(tx, ctx.actor, {
    action: 'admission.enroll',
    entity: 'admission',
    entityId: id,
    summary: `Enrolled ${fullName(a.firstName, a.lastName)} from application ${a.applicationNo} as ${created.admissionNo}`,
    before: { status: a.status },
    after: { status: 'enrolled', studentId: created.id, admissionNo: created.admissionNo, sectionId: section.id, guardianReused: !!existing },
  });
  return {
    studentId: created.id,
    admissionNo: created.admissionNo,
    guardianId: link!.guardianId,
    guardianLinkVerified: !!link!.verifiedAt,
    credentials: { student: created.credentials.student, guardian: created.credentials.guardians[0] ? { username: created.credentials.guardians[0].username, temporaryPassword: created.credentials.guardians[0].temporaryPassword } : null },
    userIds: created.userIds,
  };
}
