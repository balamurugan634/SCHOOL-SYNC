import { and, asc, desc, eq, gte, ilike, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import type { HomeworkCreateBody, HomeworkItem, HomeworkListQuery, HomeworkRosterResponse, HomeworkStats, HomeworkUpdateBody } from '@school-sync/shared';
import { audit, type AuditActor } from '../../core/audit';
import { assertFilesExist } from '../../core/files';
import { AppError, conflict, forbidden, notFound, unprocessable } from '../../core/errors';
import { addDaysIso, todayIn } from '../../core/http';
import { assertSectionAccess } from '../../core/rbac/scope';
import type { Principal } from '../../core/rbac/principal';
import type { TenantDb } from '../../core/tenancy/pools';
import type { TenantInfo } from '../../core/tenancy/registry';
import { gradeSubjects, grades, homework, homeworkSubmissions, sections, staff, students, subjects, type AttachmentRef } from '../../db/tenant/schema';
import { fullName, iso, isoOrNull, resolveStudent, zonedDayStart } from './common';
import { guardianUsers, notifyRows, sectionStudents, type NotifyRow } from './notify';

export const hwCols = {
  id: homework.id,
  sectionId: homework.sectionId,
  sectionName: sections.name,
  gradeName: grades.name,
  subjectId: homework.subjectId,
  subjectName: subjects.name,
  staffId: homework.staffId,
  firstName: staff.firstName,
  lastName: staff.lastName,
  title: homework.title,
  description: homework.description,
  attachments: homework.attachments,
  assignedAt: homework.assignedAt,
  dueAt: homework.dueAt,
  allowSubmission: homework.allowSubmission,
  maxMarks: homework.maxMarks,
  status: homework.status,
  createdAt: homework.createdAt,
  updatedAt: homework.updatedAt,
};
export type HwRow = {
  id: string;
  sectionId: string;
  sectionName: string;
  gradeName: string;
  subjectId: string;
  subjectName: string;
  staffId: string | null;
  firstName: string | null;
  lastName: string | null;
  title: string;
  description: string | null;
  attachments: AttachmentRef[];
  assignedAt: Date;
  dueAt: Date;
  allowSubmission: boolean;
  maxMarks: number | null;
  status: 'draft' | 'published' | 'closed';
  createdAt: Date;
  updatedAt: Date;
};

/** homework + names; callers add `.where(...)`. */
export function hwSelect(db: TenantDb) {
  return db
    .select(hwCols)
    .from(homework)
    .innerJoin(sections, eq(sections.id, homework.sectionId))
    .innerJoin(grades, eq(grades.id, sections.gradeId))
    .innerJoin(subjects, eq(subjects.id, homework.subjectId))
    .leftJoin(staff, eq(staff.id, homework.staffId));
}

export type SubmissionSummary = NonNullable<NonNullable<HomeworkItem['learner']>['submission']>;

/** learner-facing status of one homework for one student, evaluated in SQL (needs the submissions left join). */
export const learnerStatusSql = (nowIso: string): SQL<string> =>
  sql<string>`case when ${homeworkSubmissions.id} is not null then ${homeworkSubmissions.status} when not ${homework.allowSubmission} then 'not_required' when ${homework.dueAt} < ${nowIso}::timestamptz then 'overdue' else 'pending' end`;

export function summaryOf(s: { id: string; status: SubmissionSummary['status']; submittedAt: Date; marks: number | null; feedback: string | null; reviewedAt: Date | null }, dueAt: Date): SubmissionSummary {
  return { id: s.id, status: s.status, submittedAt: iso(s.submittedAt), isLate: s.submittedAt.getTime() > dueAt.getTime(), marks: s.marks, feedback: s.feedback, reviewedAt: isoOrNull(s.reviewedAt) };
}

export function hwItem(r: HwRow, extra: { learner?: HomeworkItem['learner']; stats?: HomeworkStats | null } = {}): HomeworkItem {
  return {
    id: r.id,
    sectionId: r.sectionId,
    sectionName: r.sectionName,
    gradeName: r.gradeName,
    subjectId: r.subjectId,
    subjectName: r.subjectName,
    staffId: r.staffId,
    teacherName: fullName(r.firstName, r.lastName),
    title: r.title,
    description: r.description,
    attachments: r.attachments,
    assignedAt: iso(r.assignedAt),
    dueAt: iso(r.dueAt),
    allowSubmission: r.allowSubmission,
    maxMarks: r.maxMarks,
    status: r.status,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
    learner: extra.learner ?? null,
    stats: extra.stats ?? null,
  };
}

// ───────────────────────────── access rules ─────────────────────────────

/**
 * Staff access to a homework record. `school` scope: all. `assigned` scope (teachers): homework of a class they lead,
 * of a (section, subject) they teach, or that they authored. Everything else → not visible (404).
 */
export function staffSees(p: Principal, perm: Parameters<Principal['scope']>[0], hw: { sectionId: string; subjectId: string; staffId: string | null }): boolean {
  const sc = p.scope(perm);
  if (sc === 'school') return true;
  if (sc !== 'assigned') return false;
  return p.leadsSection(hw.sectionId) || p.teaches(hw.sectionId, hw.subjectId) || (!!p.staffId && hw.staffId === p.staffId);
}

/** SQL twin of `staffSees` for list queries. */
export function staffHomeworkScope(p: Principal, perm: Parameters<Principal['scope']>[0]): SQL {
  const sc = p.scope(perm);
  if (sc === 'school') return sql`true`;
  if (sc !== 'assigned') return sql`false`;
  const parts: SQL[] = [];
  if (p.classTeacherSectionIds.length) parts.push(inArray(homework.sectionId, p.classTeacherSectionIds));
  if (p.teaching.length) parts.push(sql`(${homework.sectionId}, ${homework.subjectId}) in (${sql.join(p.teaching.map((t) => sql`(${t.sectionId}::uuid, ${t.subjectId}::uuid)`), sql`, `)})`);
  if (p.staffId) parts.push(eq(homework.staffId, p.staffId));
  return parts.length ? (or(...parts) as SQL) : sql`false`;
}

export async function loadHomework(db: TenantDb, id: string): Promise<HwRow | null> {
  const [r] = await hwSelect(db).where(eq(homework.id, id)).limit(1);
  return (r as HwRow | undefined) ?? null;
}

// ───────────────────────────── stats ─────────────────────────────

export async function statsFor(db: TenantDb, rows: { id: string; sectionId: string }[]): Promise<Map<string, HomeworkStats>> {
  const out = new Map<string, HomeworkStats>();
  if (!rows.length) return out;
  const sectionIds = [...new Set(rows.map((r) => r.sectionId))];
  const ids = rows.map((r) => r.id);
  const [totals, counts] = await Promise.all([
    db
      .select({ sectionId: students.currentSectionId, n: sql<number>`count(*)::int` })
      .from(students)
      .where(and(inArray(students.currentSectionId, sectionIds), eq(students.status, 'active'), isNull(students.archivedAt)))
      .groupBy(students.currentSectionId),
    db
      .select({
        homeworkId: homeworkSubmissions.homeworkId,
        submitted: sql<number>`count(*) filter (where ${homeworkSubmissions.status} = 'submitted')::int`,
        late: sql<number>`count(*) filter (where ${homeworkSubmissions.status} = 'late')::int`,
        reviewed: sql<number>`count(*) filter (where ${homeworkSubmissions.status} = 'reviewed')::int`,
        returned: sql<number>`count(*) filter (where ${homeworkSubmissions.status} = 'returned')::int`,
      })
      .from(homeworkSubmissions)
      .innerJoin(homework, eq(homework.id, homeworkSubmissions.homeworkId))
      .innerJoin(students, and(eq(students.id, homeworkSubmissions.studentId), eq(students.currentSectionId, homework.sectionId), eq(students.status, 'active'), isNull(students.archivedAt)))
      .where(inArray(homeworkSubmissions.homeworkId, ids))
      .groupBy(homeworkSubmissions.homeworkId),
  ]);
  const totalBySection = new Map(totals.map((t) => [t.sectionId, t.n]));
  const countById = new Map(counts.map((c) => [c.homeworkId, c]));
  for (const r of rows) {
    const c = countById.get(r.id);
    const total = totalBySection.get(r.sectionId) ?? 0;
    const submitted = c?.submitted ?? 0;
    const late = c?.late ?? 0;
    const reviewed = c?.reviewed ?? 0;
    const returned = c?.returned ?? 0;
    out.set(r.id, { totalStudents: total, submitted, late, reviewed, returned, missing: Math.max(0, total - submitted - late - reviewed - returned) });
  }
  return out;
}

// ───────────────────────────── reads ─────────────────────────────

const dueRange = (tz: string, from?: string, to?: string): SQL[] => [
  ...(from ? [gte(homework.dueAt, zonedDayStart(from, tz))] : []),
  ...(to ? [lt(homework.dueAt, zonedDayStart(addDaysIso(to, 1), tz))] : []),
];

export async function listHomework(db: TenantDb, tenant: TenantInfo, p: Principal, q: HomeworkListQuery & { sort?: 'dueAsc' | 'dueDesc' }): Promise<{ rows: HomeworkItem[]; total: number }> {
  const order = q.sort === 'dueAsc' ? asc(homework.dueAt) : desc(homework.dueAt);
  const limit = q.pageSize;
  const offset = (q.page - 1) * q.pageSize;
  const common = [q.subjectId ? eq(homework.subjectId, q.subjectId) : undefined, q.q ? ilike(homework.title, `%${q.q.replace(/[\\%_]/g, '\\$&')}%`) : undefined, ...dueRange(tenant.timezone, q.dueFrom, q.dueTo)];

  if (p.userType !== 'staff') {
    const st = await resolveStudent(db, p, 'homework:view', q.studentId);
    if (!st?.sectionId) return { rows: [], total: 0 };
    const nowIso = new Date().toISOString();
    const statusExpr = learnerStatusSql(nowIso);
    const where = and(
      eq(homework.sectionId, st.sectionId),
      q.status && q.status !== 'draft' ? eq(homework.status, q.status) : inArray(homework.status, ['published', 'closed']),
      q.learnerStatus ? sql`${statusExpr} = ${q.learnerStatus}` : undefined,
      ...common,
    );
    const joinOn = and(eq(homeworkSubmissions.homeworkId, homework.id), eq(homeworkSubmissions.studentId, st.id));
    const [rows, counted] = await Promise.all([
      db
        .select({ ...hwCols, subId: homeworkSubmissions.id, subStatus: homeworkSubmissions.status, subAt: homeworkSubmissions.submittedAt, subMarks: homeworkSubmissions.marks, subFeedback: homeworkSubmissions.feedback, subReviewedAt: homeworkSubmissions.reviewedAt, learnerStatus: statusExpr })
        .from(homework)
        .innerJoin(sections, eq(sections.id, homework.sectionId))
        .innerJoin(grades, eq(grades.id, sections.gradeId))
        .innerJoin(subjects, eq(subjects.id, homework.subjectId))
        .leftJoin(staff, eq(staff.id, homework.staffId))
        .leftJoin(homeworkSubmissions, joinOn)
        .where(where)
        .orderBy(order, desc(homework.id))
        .limit(limit)
        .offset(offset),
      db.select({ n: sql<number>`count(*)::int` }).from(homework).leftJoin(homeworkSubmissions, joinOn).where(where),
    ]);
    return {
      rows: rows.map((r) =>
        hwItem(r as unknown as HwRow, {
          learner: {
            studentId: st.id,
            status: r.learnerStatus as NonNullable<HomeworkItem['learner']>['status'],
            submission: r.subId ? summaryOf({ id: r.subId, status: r.subStatus!, submittedAt: r.subAt!, marks: r.subMarks, feedback: r.subFeedback, reviewedAt: r.subReviewedAt }, r.dueAt) : null,
          },
        }),
      ),
      total: counted[0]?.n ?? 0,
    };
  }

  // staff (teachers / management)
  if (q.sectionId && p.scope('homework:view') !== 'school') assertSectionAccess(p, 'homework:view', q.sectionId);
  const where = and(
    staffHomeworkScope(p, 'homework:view'),
    q.sectionId ? eq(homework.sectionId, q.sectionId) : undefined,
    q.status ? eq(homework.status, q.status) : undefined,
    q.mine ? or(p.staffId ? eq(homework.staffId, p.staffId) : undefined, eq(homework.createdByUserId, p.userId)) : undefined,
    ...common,
  );
  const [rows, counted] = await Promise.all([
    hwSelect(db).where(where).orderBy(order, desc(homework.id)).limit(limit).offset(offset),
    db.select({ n: sql<number>`count(*)::int` }).from(homework).where(where),
  ]);
  const stats = await statsFor(db, rows);
  return { rows: rows.map((r) => hwItem(r as HwRow, { stats: stats.get(r.id) ?? null })), total: counted[0]?.n ?? 0 };
}

/** A parent following a deep link without ?studentId=: the one linked child who belongs to that section. */
export async function childInSection(db: TenantDb, p: Principal, sectionId: string): Promise<string | undefined> {
  if (p.userType !== 'parent' || p.linkedStudentIds.length < 2) return undefined;
  const kids = await db.select({ id: students.id }).from(students).where(and(inArray(students.id, p.linkedStudentIds), eq(students.currentSectionId, sectionId)));
  if (kids.length === 1) return kids[0]!.id;
  if (kids.length > 1) throw unprocessable('Specify which child with studentId', 'STUDENT_REQUIRED');
  return undefined;
}

export async function getHomework(db: TenantDb, p: Principal, id: string, studentId?: string): Promise<HomeworkItem> {
  const hw = await loadHomework(db, id);
  if (!hw) throw notFound('Homework');
  if (p.userType !== 'staff') {
    if (hw.status === 'draft') throw notFound('Homework');
    const st = await resolveStudent(db, p, 'homework:view', studentId ?? (await childInSection(db, p, hw.sectionId)));
    if (!st || st.sectionId !== hw.sectionId) throw notFound('Homework');
    const [sub] = await db.select().from(homeworkSubmissions).where(and(eq(homeworkSubmissions.homeworkId, id), eq(homeworkSubmissions.studentId, st.id)));
    const status = sub ? sub.status : !hw.allowSubmission ? 'not_required' : hw.dueAt.getTime() < Date.now() ? 'overdue' : 'pending';
    return hwItem(hw, { learner: { studentId: st.id, status, submission: sub ? summaryOf(sub, hw.dueAt) : null } });
  }
  if (!staffSees(p, 'homework:view', hw)) throw notFound('Homework');
  const stats = await statsFor(db, [hw]);
  return hwItem(hw, { stats: stats.get(hw.id) ?? null });
}

export async function homeworkRoster(db: TenantDb, p: Principal, id: string): Promise<HomeworkRosterResponse> {
  if (p.userType !== 'staff') throw forbidden();
  const hw = await loadHomework(db, id);
  if (!hw || !staffSees(p, 'submissions:view', hw)) throw notFound('Homework');
  const [studs, subs, stats] = await Promise.all([
    db
      .select({ id: students.id, firstName: students.firstName, lastName: students.lastName, admissionNo: students.admissionNo, rollNo: students.rollNo })
      .from(students)
      .where(and(eq(students.currentSectionId, hw.sectionId), eq(students.status, 'active'), isNull(students.archivedAt)))
      .orderBy(asc(students.rollNo), asc(students.firstName))
      .limit(300),
    db.select().from(homeworkSubmissions).where(eq(homeworkSubmissions.homeworkId, id)),
    statsFor(db, [hw]),
  ]);
  const byStudent = new Map(subs.map((s) => [s.studentId, s]));
  return {
    homework: hwItem(hw, { stats: stats.get(id) ?? null }),
    data: studs.map((s) => {
      const sub = byStudent.get(s.id);
      return { studentId: s.id, name: fullName(s.firstName, s.lastName) ?? '', admissionNo: s.admissionNo, rollNo: s.rollNo, status: sub ? sub.status : ('missing' as const), submission: sub ? summaryOf(sub, hw.dueAt) : null };
    }),
  };
}

// ───────────────────────────── writes ─────────────────────────────

async function assertSubjectOffered(db: TenantDb, sectionId: string, subjectId: string): Promise<void> {
  const [row] = await db
    .select({ x: gradeSubjects.subjectId })
    .from(sections)
    .innerJoin(gradeSubjects, and(eq(gradeSubjects.gradeId, sections.gradeId), eq(gradeSubjects.subjectId, subjectId)))
    .where(eq(sections.id, sectionId))
    .limit(1);
  if (!row) throw unprocessable('This subject is not offered to the section’s grade', 'SUBJECT_NOT_OFFERED');
}

async function notifyPublished(db: TenantDb, tenant: TenantInfo, hw: HwRow): Promise<void> {
  const studs = await sectionStudents(db, hw.sectionId);
  const guardians = await guardianUsers(db, studs.map((s) => s.id));
  const due = todayIn(tenant.timezone, hw.dueAt);
  const base = { type: 'homework.assigned', title: 'New homework', body: `${hw.subjectName}: ${hw.title}. Due ${due}.` };
  const rows: NotifyRow[] = [
    ...studs.filter((s) => s.userId).map((s) => ({ ...base, userId: s.userId!, data: { route: `/homework/${hw.id}`, homeworkId: hw.id, sectionId: hw.sectionId, studentId: s.id } })),
    ...guardians.map((g) => ({ ...base, userId: g.userId, data: { route: `/homework/${hw.id}`, homeworkId: hw.id, sectionId: hw.sectionId, studentId: g.studentId } })),
  ];
  await notifyRows(db, tenant, rows);
}

const snapshot = (r: HwRow) => ({ sectionId: r.sectionId, subjectId: r.subjectId, title: r.title, description: r.description, dueAt: iso(r.dueAt), allowSubmission: r.allowSubmission, maxMarks: r.maxMarks, status: r.status, attachments: r.attachments.length });

export async function createHomework(db: TenantDb, tenant: TenantInfo, p: Principal, actor: AuditActor, body: HomeworkCreateBody): Promise<HomeworkItem> {
  assertSectionAccess(p, 'homework:create', body.sectionId); // 404 outside my sections
  if (p.scope('homework:create') !== 'school' && !p.teaches(body.sectionId, body.subjectId) && !p.leadsSection(body.sectionId)) throw forbidden('You do not teach this subject in this section', 'NOT_TEACHING_SUBJECT');
  const dueAt = new Date(body.dueAt);
  if (body.publish && dueAt.getTime() <= Date.now()) throw unprocessable('The due date must be in the future', 'DUE_DATE_PAST');
  if (body.publish && !p.can('homework:publish')) throw forbidden();
  const id = await db.transaction(async (tx) => {
    const t = tx as unknown as TenantDb;
    await assertSubjectOffered(t, body.sectionId, body.subjectId);
    await assertFilesExist(tx, body.attachments.map((a) => a.fileId));
    const [row] = await tx
      .insert(homework)
      .values({
        sectionId: body.sectionId,
        subjectId: body.subjectId,
        staffId: p.staffId,
        createdByUserId: p.userId,
        title: body.title,
        description: body.description ?? null,
        attachments: body.attachments,
        dueAt,
        allowSubmission: body.allowSubmission,
        maxMarks: body.maxMarks ?? null,
        status: body.publish ? 'published' : 'draft',
        assignedAt: new Date(),
      })
      .returning({ id: homework.id });
    await audit(tx, actor, { action: 'homework.create', entity: 'homework', entityId: row!.id, summary: body.title, after: { sectionId: body.sectionId, subjectId: body.subjectId, title: body.title, dueAt: body.dueAt, status: body.publish ? 'published' : 'draft' } });
    if (body.publish) await audit(tx, actor, { action: 'homework.publish', entity: 'homework', entityId: row!.id, summary: body.title });
    return row!.id;
  });
  const hw = (await loadHomework(db, id))!;
  if (body.publish) await notifyPublished(db, tenant, hw);
  return hwItem(hw, { stats: (await statsFor(db, [hw])).get(id) });
}

export async function updateHomework(db: TenantDb, p: Principal, actor: AuditActor, id: string, body: HomeworkUpdateBody): Promise<HomeworkItem> {
  await db.transaction(async (tx) => {
    const t = tx as unknown as TenantDb;
    const [row] = await hwSelect(t).where(eq(homework.id, id)).for('update', { of: homework }).limit(1);
    const hw = row as HwRow | undefined;
    if (!hw || !staffSees(p, 'homework:edit', hw)) throw notFound('Homework');
    if (hw.status === 'closed') throw conflict('Closed homework cannot be edited', 'HOMEWORK_CLOSED');
    if (body.attachments) await assertFilesExist(tx, body.attachments.map((a) => a.fileId));
    if (body.maxMarks !== undefined && body.maxMarks !== null) {
      const [over] = await tx.select({ id: homeworkSubmissions.id }).from(homeworkSubmissions).where(and(eq(homeworkSubmissions.homeworkId, id), sql`${homeworkSubmissions.marks} > ${body.maxMarks}`)).limit(1);
      if (over) throw unprocessable('Some submissions already carry more marks than this maximum', 'MARKS_EXCEED_MAX');
    }
    if (body.dueAt && hw.status === 'draft' && new Date(body.dueAt).getTime() <= Date.now()) throw unprocessable('The due date must be in the future', 'DUE_DATE_PAST');
    const set: Partial<typeof homework.$inferInsert> = {};
    if (body.title !== undefined) set.title = body.title;
    if (body.description !== undefined) set.description = body.description;
    if (body.attachments !== undefined) set.attachments = body.attachments;
    if (body.dueAt !== undefined) {
      set.dueAt = new Date(body.dueAt);
      set.dueReminderSentAt = null; // a moved deadline deserves a fresh reminder
    }
    if (body.allowSubmission !== undefined) set.allowSubmission = body.allowSubmission;
    if (body.maxMarks !== undefined) set.maxMarks = body.maxMarks;
    if (!Object.keys(set).length) return;
    await tx.update(homework).set(set).where(eq(homework.id, id));
    await audit(tx, actor, { action: 'homework.update', entity: 'homework', entityId: id, summary: hw.title, before: snapshot(hw), after: { ...snapshot(hw), ...Object.fromEntries(Object.entries(set).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v])) } });
  });
  return getHomework(db, p, id);
}

export async function publishHomework(db: TenantDb, tenant: TenantInfo, p: Principal, actor: AuditActor, id: string): Promise<HomeworkItem> {
  await db.transaction(async (tx) => {
    const t = tx as unknown as TenantDb;
    const [row] = await hwSelect(t).where(eq(homework.id, id)).for('update', { of: homework }).limit(1);
    const hw = row as HwRow | undefined;
    if (!hw || !staffSees(p, 'homework:publish', hw)) throw notFound('Homework');
    if (hw.status !== 'draft') throw conflict(`Homework is already ${hw.status}`, 'INVALID_STATE');
    if (hw.dueAt.getTime() <= Date.now()) throw unprocessable('The due date must be in the future; edit it before publishing', 'DUE_DATE_PAST');
    await tx.update(homework).set({ status: 'published', assignedAt: new Date() }).where(eq(homework.id, id));
    await audit(tx, actor, { action: 'homework.publish', entity: 'homework', entityId: id, summary: hw.title, before: { status: 'draft' }, after: { status: 'published' } });
  });
  const hw = (await loadHomework(db, id))!;
  await notifyPublished(db, tenant, hw);
  return getHomework(db, p, id);
}

export async function closeHomework(db: TenantDb, p: Principal, actor: AuditActor, id: string): Promise<HomeworkItem> {
  await db.transaction(async (tx) => {
    const t = tx as unknown as TenantDb;
    const [row] = await hwSelect(t).where(eq(homework.id, id)).for('update', { of: homework }).limit(1);
    const hw = row as HwRow | undefined;
    if (!hw || !staffSees(p, 'homework:edit', hw)) throw notFound('Homework');
    if (hw.status !== 'published') throw conflict(hw.status === 'draft' ? 'Publish the homework before closing it' : 'Homework is already closed', 'INVALID_STATE');
    await tx.update(homework).set({ status: 'closed' }).where(eq(homework.id, id));
    await audit(tx, actor, { action: 'homework.close', entity: 'homework', entityId: id, summary: hw.title, before: { status: 'published' }, after: { status: 'closed' } });
  });
  return getHomework(db, p, id);
}

export async function deleteHomework(db: TenantDb, p: Principal, actor: AuditActor, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const t = tx as unknown as TenantDb;
    const [row] = await hwSelect(t).where(eq(homework.id, id)).for('update', { of: homework }).limit(1);
    const hw = row as HwRow | undefined;
    if (!hw || !staffSees(p, 'homework:delete', hw)) throw notFound('Homework');
    const [sub] = await tx.select({ id: homeworkSubmissions.id }).from(homeworkSubmissions).where(eq(homeworkSubmissions.homeworkId, id)).limit(1);
    if (sub) throw new AppError(409, 'HOMEWORK_HAS_SUBMISSIONS', 'Homework with submissions cannot be deleted; close it instead');
    await tx.delete(homework).where(eq(homework.id, id));
    await audit(tx, actor, { action: 'homework.delete', entity: 'homework', entityId: id, summary: hw.title, before: snapshot(hw) });
  });
}
