import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { HomeworkSubmitBody, SubmissionItem, SubmissionReturnBody, SubmissionReviewBody } from '@school-sync/shared';
import { audit, type AuditActor } from '../../core/audit';
import { assertFilesExist } from '../../core/files';
import { AppError, conflict, forbidden, notFound, unprocessable } from '../../core/errors';
import { canAccessSection, studentIdScope } from '../../core/rbac/scope';
import type { Principal } from '../../core/rbac/principal';
import type { TenantDb } from '../../core/tenancy/pools';
import type { TenantInfo } from '../../core/tenancy/registry';
import { homework, homeworkSubmissions, students, type AttachmentRef } from '../../db/tenant/schema';
import { fullName, iso, isoOrNull, resolveStudent } from './common';
import { childInSection, hwSelect, loadHomework, staffHomeworkScope, staffSees, type HwRow } from './homework.service';
import { notifyRows } from './notify';

const subCols = {
  id: homeworkSubmissions.id,
  homeworkId: homeworkSubmissions.homeworkId,
  studentId: homeworkSubmissions.studentId,
  text: homeworkSubmissions.text,
  attachments: homeworkSubmissions.attachments,
  submittedAt: homeworkSubmissions.submittedAt,
  status: homeworkSubmissions.status,
  marks: homeworkSubmissions.marks,
  feedback: homeworkSubmissions.feedback,
  reviewedBy: homeworkSubmissions.reviewedBy,
  reviewedAt: homeworkSubmissions.reviewedAt,
  updatedAt: homeworkSubmissions.updatedAt,
  dueAt: homework.dueAt,
  firstName: students.firstName,
  lastName: students.lastName,
  rollNo: students.rollNo,
};
const subSelect = (db: TenantDb) =>
  db
    .select(subCols)
    .from(homeworkSubmissions)
    .innerJoin(homework, eq(homework.id, homeworkSubmissions.homeworkId))
    .innerJoin(students, eq(students.id, homeworkSubmissions.studentId));
type SubRow = Awaited<ReturnType<ReturnType<typeof subSelect>['limit']>>[number];

function item(r: SubRow): SubmissionItem {
  return {
    id: r.id,
    homeworkId: r.homeworkId,
    studentId: r.studentId,
    studentName: fullName(r.firstName, r.lastName) ?? '',
    rollNo: r.rollNo,
    text: r.text,
    attachments: r.attachments,
    submittedAt: iso(r.submittedAt),
    status: r.status,
    isLate: r.submittedAt.getTime() > r.dueAt.getTime(),
    marks: r.marks,
    feedback: r.feedback,
    reviewedBy: r.reviewedBy,
    reviewedAt: isoOrNull(r.reviewedAt),
    updatedAt: iso(r.updatedAt),
  };
}

async function loadSubmission(db: TenantDb, id: string): Promise<SubRow | null> {
  const [r] = await subSelect(db).where(eq(homeworkSubmissions.id, id)).limit(1);
  return r ?? null;
}

/**
 * Student submits / resubmits.
 *  - homework must be published (drafts are invisible → 404) and not closed (409 HOMEWORK_CLOSED), and accept submissions
 *  - first submit creates the row; resubmitting is allowed while the submission is submitted | late | returned
 *  - `late` when the submission time is after dueAt (re-evaluated on every resubmission)
 *  - once reviewed the submission is locked (409 SUBMISSION_LOCKED) unless the teacher returns it for rework
 */
export async function submitHomework(db: TenantDb, p: Principal, homeworkId: string, body: HomeworkSubmitBody): Promise<SubmissionItem> {
  if (!p.studentId) throw forbidden('Only students can submit homework', 'SUBMISSIONS_STUDENTS_ONLY');
  const studentId = p.studentId;
  const id = await db.transaction(async (tx) => {
    const t = tx as unknown as TenantDb;
    const hw = await loadHomework(t, homeworkId);
    if (!hw || hw.status === 'draft' || !canAccessSection(p, 'submissions:create', hw.sectionId)) throw notFound('Homework');
    if (hw.status === 'closed') throw conflict('This homework is closed', 'HOMEWORK_CLOSED');
    if (!hw.allowSubmission) throw conflict('This homework does not take online submissions', 'SUBMISSION_NOT_ALLOWED');
    const text = body.text?.trim() || null;
    if (!text && !body.attachments.length) throw unprocessable('Add some text or an attachment', 'EMPTY_SUBMISSION');
    await assertFilesExist(tx, body.attachments.map((a) => a.fileId));
    const now = new Date();
    const status = now.getTime() > hw.dueAt.getTime() ? 'late' : 'submitted';
    const [row] = await tx
      .insert(homeworkSubmissions)
      .values({ homeworkId, studentId, text, attachments: body.attachments as AttachmentRef[], submittedAt: now, status })
      .onConflictDoUpdate({
        target: [homeworkSubmissions.homeworkId, homeworkSubmissions.studentId],
        set: { text, attachments: body.attachments as AttachmentRef[], submittedAt: now, status, marks: null, reviewedBy: null, reviewedAt: null },
        setWhere: sql`${homeworkSubmissions.status} <> 'reviewed'`,
      })
      .returning({ id: homeworkSubmissions.id });
    if (!row) throw conflict('This submission has been reviewed and can no longer be changed', 'SUBMISSION_LOCKED');
    return row.id;
  });
  return item((await loadSubmission(db, id))!);
}

/** The caller's (or, for parents, the child's) submission for a homework. */
export async function mySubmission(db: TenantDb, p: Principal, homeworkId: string, studentId?: string): Promise<SubmissionItem> {
  const hw = await loadHomework(db, homeworkId);
  if (!hw) throw notFound('Homework');
  let sid: string | undefined;
  if (p.userType === 'staff') {
    if (!studentId || !staffSees(p, 'submissions:view', hw)) throw notFound('Submission');
    sid = studentId;
  } else {
    if (hw.status === 'draft') throw notFound('Homework');
    const st = await resolveStudent(db, p, 'submissions:view', studentId ?? (await childInSection(db, p, hw.sectionId)));
    if (!st || st.sectionId !== hw.sectionId) throw notFound('Homework');
    sid = st.id;
  }
  const [r] = await subSelect(db).where(and(eq(homeworkSubmissions.homeworkId, homeworkId), eq(homeworkSubmissions.studentId, sid))).limit(1);
  if (!r) throw new AppError(404, 'NOT_SUBMITTED', 'No submission yet');
  return item(r);
}

export async function getSubmission(db: TenantDb, p: Principal, id: string): Promise<SubmissionItem> {
  const r = await loadSubmission(db, id);
  if (!r) throw notFound('Submission');
  const hw = (await loadHomework(db, r.homeworkId))!;
  if (p.userType === 'staff') {
    if (!staffSees(p, 'submissions:view', hw)) throw notFound('Submission');
  } else {
    if (hw.status === 'draft') throw notFound('Submission');
    const [ok] = await db.select({ id: students.id }).from(students).where(and(eq(students.id, r.studentId), studentIdScope(p, 'submissions:view', students.id)));
    if (!ok) throw notFound('Submission');
  }
  return item(r);
}

export async function listSubmissions(db: TenantDb, p: Principal, q: { page: number; pageSize: number; homeworkId?: string; status?: SubmissionItem['status']; sectionId?: string }) {
  const where = and(
    p.userType === 'staff' ? staffHomeworkScope(p, 'submissions:view') : and(studentIdScope(p, 'submissions:view', homeworkSubmissions.studentId), inArray(homework.status, ['published', 'closed'])),
    q.homeworkId ? eq(homeworkSubmissions.homeworkId, q.homeworkId) : undefined,
    q.status ? eq(homeworkSubmissions.status, q.status) : undefined,
    q.sectionId ? eq(homework.sectionId, q.sectionId) : undefined,
  );
  const [rows, counted] = await Promise.all([
    subSelect(db)
      .where(where)
      .orderBy(desc(homeworkSubmissions.submittedAt), desc(homeworkSubmissions.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db.select({ n: sql<number>`count(*)::int` }).from(homeworkSubmissions).innerJoin(homework, eq(homework.id, homeworkSubmissions.homeworkId)).where(where),
  ]);
  return { rows: rows.map(item), total: counted[0]?.n ?? 0 };
}

async function loadForDecision(tx: TenantDb, p: Principal, id: string): Promise<{ sub: SubRow; hw: HwRow }> {
  const [locked] = await tx.select({ id: homeworkSubmissions.id }).from(homeworkSubmissions).where(eq(homeworkSubmissions.id, id)).for('update').limit(1);
  const sub = locked ? await loadSubmission(tx, id) : null;
  if (!sub) throw notFound('Submission');
  const hw = (await hwSelect(tx).where(eq(homework.id, sub.homeworkId)).limit(1))[0] as HwRow;
  if (!staffSees(p, 'submissions:edit', hw)) throw notFound('Submission');
  return { sub, hw };
}

/** Teacher review: marks (≤ maxMarks) and/or feedback → `reviewed`. Allowed from submitted | late | reviewed (re-review). */
export async function reviewSubmission(db: TenantDb, tenant: TenantInfo, p: Principal, actor: AuditActor, id: string, body: SubmissionReviewBody): Promise<SubmissionItem> {
  if (body.marks === undefined && !body.feedback) throw unprocessable('Give marks or feedback', 'EMPTY_REVIEW');
  const { hw, studentId } = await db.transaction(async (tx) => {
    const t = tx as unknown as TenantDb;
    const { sub, hw } = await loadForDecision(t, p, id);
    if (sub.status === 'returned') throw conflict('Waiting for the student to resubmit after rework', 'INVALID_STATE');
    if (body.marks !== undefined) {
      if (hw.maxMarks === null) throw unprocessable('This homework has no marks', 'MARKS_NOT_ENABLED');
      if (body.marks > hw.maxMarks) throw unprocessable(`Marks cannot exceed ${hw.maxMarks}`, 'MARKS_EXCEED_MAX');
    }
    const next = { status: 'reviewed' as const, marks: body.marks !== undefined ? body.marks : sub.marks, feedback: body.feedback ?? sub.feedback, reviewedBy: p.userId, reviewedAt: new Date() };
    await tx.update(homeworkSubmissions).set(next).where(eq(homeworkSubmissions.id, id));
    await audit(tx, actor, {
      action: 'submission.review',
      entity: 'homework_submission',
      entityId: id,
      summary: hw.title,
      before: { status: sub.status, marks: sub.marks, feedback: sub.feedback },
      after: { status: 'reviewed', marks: next.marks, feedback: next.feedback },
    });
    return { hw, studentId: sub.studentId };
  });
  await notifyStudent(db, tenant, hw, studentId, 'Homework reviewed', `${hw.subjectName}: ${hw.title} has been reviewed.`);
  return item((await loadSubmission(db, id))!);
}

/** Teacher sends it back for rework: feedback required, marks cleared; the student may resubmit. From submitted | late | reviewed. */
export async function returnSubmission(db: TenantDb, tenant: TenantInfo, p: Principal, actor: AuditActor, id: string, body: SubmissionReturnBody): Promise<SubmissionItem> {
  const { hw, studentId } = await db.transaction(async (tx) => {
    const t = tx as unknown as TenantDb;
    const { sub, hw } = await loadForDecision(t, p, id);
    if (sub.status === 'returned') throw conflict('Already returned for rework', 'INVALID_STATE');
    if (hw.status === 'closed') throw conflict('This homework is closed', 'HOMEWORK_CLOSED');
    await tx.update(homeworkSubmissions).set({ status: 'returned', marks: null, feedback: body.feedback, reviewedBy: p.userId, reviewedAt: new Date() }).where(eq(homeworkSubmissions.id, id));
    await audit(tx, actor, { action: 'submission.return', entity: 'homework_submission', entityId: id, summary: hw.title, before: { status: sub.status, marks: sub.marks, feedback: sub.feedback }, after: { status: 'returned', feedback: body.feedback } });
    return { hw, studentId: sub.studentId };
  });
  await notifyStudent(db, tenant, hw, studentId, 'Homework needs rework', `${hw.subjectName}: ${hw.title} was returned with feedback.`);
  return item((await loadSubmission(db, id))!);
}

async function notifyStudent(db: TenantDb, tenant: TenantInfo, hw: HwRow, studentId: string, title: string, body: string) {
  const [st] = await db.select({ userId: students.userId }).from(students).where(eq(students.id, studentId));
  if (st?.userId) await notifyRows(db, tenant, [{ userId: st.userId, type: 'homework.reviewed', title, body, data: { route: `/homework/${hw.id}`, homeworkId: hw.id, studentId } }]);
}

