import { and, asc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { SyllabusCoverageItem, SyllabusTopicCreateBody, SyllabusTopicItem, SyllabusTopicUpdateBody, SyllabusProgressStatus } from '@school-sync/shared';
import { audit, type AuditActor } from '../../core/audit';
import { forbidden, notFound, unprocessable } from '../../core/errors';
import type { Principal } from '../../core/rbac/principal';
import { assertSectionAccess, sectionScope } from '../../core/rbac/scope';
import type { TenantDb } from '../../core/tenancy/pools';
import { academicYears, gradeSubjects, grades, sections, subjects, syllabusTopics, terms, topicProgress } from '../../db/tenant/schema';
import { iso, isoOrNull, resolveStudent } from './common';

const TOPIC_LIST_CAP = 2000;

const topicCols = {
  id: syllabusTopics.id,
  gradeId: syllabusTopics.gradeId,
  gradeName: grades.name,
  subjectId: syllabusTopics.subjectId,
  subjectName: subjects.name,
  termId: syllabusTopics.termId,
  termName: terms.name,
  title: syllabusTopics.title,
  ordinal: syllabusTopics.ordinal,
  plannedHours: syllabusTopics.plannedHours,
};
const topicSelect = (db: TenantDb) =>
  db
    .select(topicCols)
    .from(syllabusTopics)
    .innerJoin(grades, eq(grades.id, syllabusTopics.gradeId))
    .innerJoin(subjects, eq(subjects.id, syllabusTopics.subjectId))
    .leftJoin(terms, eq(terms.id, syllabusTopics.termId));
type TopicRow = Awaited<ReturnType<ReturnType<typeof topicSelect>['limit']>>[number];

const topicItem = (r: TopicRow, progress: SyllabusTopicItem['progress'] = null): SyllabusTopicItem => ({ ...r, progress });

/** Grades a teacher may see syllabus for: the grades of every section they lead or teach in. */
async function gradesOfSections(db: TenantDb, sectionIds: string[]): Promise<string[]> {
  if (!sectionIds.length) return [];
  return (await db.selectDistinct({ gradeId: sections.gradeId }).from(sections).where(inArray(sections.id, sectionIds))).map((r) => r.gradeId);
}

/** May the caller author topics for this grade+subject? School scope: any. Teachers: only where they teach that subject in the grade. */
async function assertCanAuthor(db: TenantDb, p: Principal, perm: 'syllabus:create' | 'syllabus:edit', gradeId: string, subjectId: string): Promise<void> {
  const sc = p.scope(perm);
  if (sc === 'school') return;
  if (sc !== 'assigned') throw forbidden();
  const ids = p.teaching.filter((t) => t.subjectId === subjectId).map((t) => t.sectionId);
  const [row] = ids.length ? await db.select({ id: sections.id }).from(sections).where(and(inArray(sections.id, ids), eq(sections.gradeId, gradeId))).limit(1) : [];
  if (!row) throw forbidden('You do not teach this subject in this grade', 'NOT_TEACHING_SUBJECT');
}

export async function listTopics(
  db: TenantDb,
  p: Principal,
  q: { gradeId?: string; subjectId?: string; termId?: string; sectionId?: string; studentId?: string },
): Promise<SyllabusTopicItem[]> {
  let gradeId = q.gradeId;
  let progressSection: string | undefined = q.sectionId;
  let gradeFilter: SQL | undefined;

  if (p.userType !== 'staff') {
    const st = await resolveStudent(db, p, 'syllabus:view', q.studentId);
    if (!st?.gradeId) return [];
    gradeId = st.gradeId; // learners only ever see their own grade
    progressSection = st.sectionId ?? undefined;
  } else {
    if (progressSection) {
      assertSectionAccess(p, 'syllabus:view', progressSection); // 404 outside my sections
      const [sec] = await db.select({ gradeId: sections.gradeId }).from(sections).where(eq(sections.id, progressSection));
      if (!sec) throw notFound('Section');
      if (gradeId && gradeId !== sec.gradeId) throw unprocessable('The section does not belong to that grade', 'SECTION_GRADE_MISMATCH');
      gradeId = sec.gradeId;
    }
    if (p.scope('syllabus:view') === 'assigned') {
      const allowed = await gradesOfSections(db, p.assignedSectionIds);
      if (!allowed.length || (gradeId && !allowed.includes(gradeId))) return [];
      if (!gradeId) gradeFilter = inArray(syllabusTopics.gradeId, allowed);
    }
  }

  const rows = await topicSelect(db)
    .where(and(gradeFilter, gradeId ? eq(syllabusTopics.gradeId, gradeId) : undefined, q.subjectId ? eq(syllabusTopics.subjectId, q.subjectId) : undefined, q.termId ? eq(syllabusTopics.termId, q.termId) : undefined))
    .orderBy(asc(grades.ordinal), asc(subjects.name), asc(syllabusTopics.ordinal), asc(syllabusTopics.id))
    .limit(TOPIC_LIST_CAP);

  if (!progressSection || !rows.length) return rows.map((r) => topicItem(r));
  const prog = await db
    .select()
    .from(topicProgress)
    .where(and(eq(topicProgress.sectionId, progressSection), inArray(topicProgress.topicId, rows.map((r) => r.id))));
  const byTopic = new Map(prog.map((x) => [x.topicId, x]));
  return rows.map((r) => {
    const x = byTopic.get(r.id);
    return topicItem(r, { sectionId: progressSection!, status: x?.status ?? 'not_started', completedAt: isoOrNull(x?.completedAt), updatedAt: isoOrNull(x?.updatedAt) });
  });
}

export async function createTopic(db: TenantDb, p: Principal, actor: AuditActor, body: SyllabusTopicCreateBody): Promise<SyllabusTopicItem> {
  await assertCanAuthor(db, p, 'syllabus:create', body.gradeId, body.subjectId);
  const id = await db.transaction(async (tx) => {
    const t = tx as unknown as TenantDb;
    const [offered] = await t.select({ s: gradeSubjects.subjectId }).from(gradeSubjects).where(and(eq(gradeSubjects.gradeId, body.gradeId), eq(gradeSubjects.subjectId, body.subjectId)));
    if (!offered) throw unprocessable('This subject is not offered to the grade', 'SUBJECT_NOT_OFFERED');
    if (body.termId) {
      const [term] = await t.select({ id: terms.id }).from(terms).innerJoin(academicYears, eq(academicYears.id, terms.academicYearId)).where(and(eq(terms.id, body.termId), eq(academicYears.isCurrent, true)));
      if (!term) throw unprocessable('Term not found in the current academic year', 'TERM_NOT_FOUND');
    }
    let ordinal = body.ordinal;
    if (ordinal === undefined) {
      const [mx] = await t
        .select({ n: sql<number>`coalesce(max(${syllabusTopics.ordinal}), 0)::int` })
        .from(syllabusTopics)
        .where(and(eq(syllabusTopics.gradeId, body.gradeId), eq(syllabusTopics.subjectId, body.subjectId)));
      ordinal = (mx?.n ?? 0) + 1;
    }
    const [row] = await tx
      .insert(syllabusTopics)
      .values({ gradeId: body.gradeId, subjectId: body.subjectId, termId: body.termId ?? null, title: body.title, ordinal, plannedHours: body.plannedHours ?? null })
      .returning({ id: syllabusTopics.id });
    await audit(tx, actor, { action: 'syllabus.topic.create', entity: 'syllabus_topic', entityId: row!.id, summary: body.title, after: { gradeId: body.gradeId, subjectId: body.subjectId, termId: body.termId ?? null, title: body.title, ordinal } });
    return row!.id;
  });
  const [r] = await topicSelect(db).where(eq(syllabusTopics.id, id));
  return topicItem(r!);
}

async function loadTopic(db: TenantDb, id: string): Promise<TopicRow> {
  const [r] = await topicSelect(db).where(eq(syllabusTopics.id, id)).limit(1);
  if (!r) throw notFound('Syllabus topic');
  return r;
}

export async function updateTopic(db: TenantDb, p: Principal, actor: AuditActor, id: string, body: SyllabusTopicUpdateBody): Promise<SyllabusTopicItem> {
  await db.transaction(async (tx) => {
    const t = tx as unknown as TenantDb;
    const topic = await loadTopic(t, id);
    await assertCanAuthor(t, p, 'syllabus:edit', topic.gradeId, topic.subjectId);
    const set: Partial<typeof syllabusTopics.$inferInsert> = {};
    if (body.title !== undefined) set.title = body.title;
    if (body.termId !== undefined) set.termId = body.termId;
    if (body.ordinal !== undefined) set.ordinal = body.ordinal;
    if (body.plannedHours !== undefined) set.plannedHours = body.plannedHours;
    if (!Object.keys(set).length) return;
    await tx.update(syllabusTopics).set(set).where(eq(syllabusTopics.id, id));
    await audit(tx, actor, { action: 'syllabus.topic.update', entity: 'syllabus_topic', entityId: id, summary: topic.title, before: { title: topic.title, termId: topic.termId, ordinal: topic.ordinal, plannedHours: topic.plannedHours }, after: set });
  });
  const [r] = await topicSelect(db).where(eq(syllabusTopics.id, id));
  return topicItem(r!);
}

export async function deleteTopic(db: TenantDb, p: Principal, actor: AuditActor, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const t = tx as unknown as TenantDb;
    const topic = await loadTopic(t, id);
    await assertCanAuthor(t, p, 'syllabus:edit', topic.gradeId, topic.subjectId);
    await tx.delete(syllabusTopics).where(eq(syllabusTopics.id, id)); // progress rows cascade
    await audit(tx, actor, { action: 'syllabus.topic.delete', entity: 'syllabus_topic', entityId: id, summary: topic.title, before: { gradeId: topic.gradeId, subjectId: topic.subjectId, title: topic.title } });
  });
}

// ───────────────────────────── lesson progress ─────────────────────────────

type ProgressInput = { topicId: string; status: SyllabusProgressStatus };

/**
 * Teachers mark progress per section. Rules: the section is one the caller may edit (404 otherwise); the topic belongs to the
 * section's grade (422); the caller teaches that topic's subject in that section, leads the section, or holds school scope (403).
 */
export async function setProgress(db: TenantDb, p: Principal, actor: AuditActor, sectionId: string, items: ProgressInput[]) {
  assertSectionAccess(p, 'syllabus:edit', sectionId);
  const unique = new Map(items.map((i) => [i.topicId, i.status]));
  const ids = [...unique.keys()];
  return db.transaction(async (tx) => {
    const t = tx as unknown as TenantDb;
    const [sec] = await t.select({ gradeId: sections.gradeId }).from(sections).where(eq(sections.id, sectionId));
    if (!sec) throw notFound('Section');
    const topics = await t.select({ id: syllabusTopics.id, gradeId: syllabusTopics.gradeId, subjectId: syllabusTopics.subjectId, title: syllabusTopics.title }).from(syllabusTopics).where(inArray(syllabusTopics.id, ids));
    if (topics.length !== ids.length) throw notFound('Syllabus topic');
    for (const tp of topics) {
      if (tp.gradeId !== sec.gradeId) throw unprocessable('A topic does not belong to this section’s grade', 'TOPIC_NOT_FOR_SECTION');
      if (p.scope('syllabus:edit') !== 'school' && !p.teaches(sectionId, tp.subjectId) && !p.leadsSection(sectionId)) throw forbidden('You do not teach this subject in this section', 'NOT_TEACHING_SUBJECT');
    }
    const before = await t.select().from(topicProgress).where(and(eq(topicProgress.sectionId, sectionId), inArray(topicProgress.topicId, ids)));
    const beforeBy = new Map(before.map((b) => [b.topicId, b.status]));
    const now = new Date();
    const out = await tx
      .insert(topicProgress)
      .values(ids.map((topicId) => ({ topicId, sectionId, status: unique.get(topicId)!, completedAt: unique.get(topicId) === 'completed' ? now : null, updatedBy: p.userId, updatedAt: now })))
      .onConflictDoUpdate({
        target: [topicProgress.topicId, topicProgress.sectionId],
        set: { status: sql`excluded.status`, completedAt: sql`excluded.completed_at`, updatedBy: sql`excluded.updated_by`, updatedAt: now },
      })
      .returning({ topicId: topicProgress.topicId, sectionId: topicProgress.sectionId, status: topicProgress.status, completedAt: topicProgress.completedAt, updatedAt: topicProgress.updatedAt });
    await audit(tx, actor, {
      action: 'syllabus.progress',
      entity: 'section_syllabus',
      entityId: sectionId,
      summary: `${ids.length} topic(s)`,
      before: ids.map((topicId) => ({ topicId, status: beforeBy.get(topicId) ?? 'not_started' })),
      after: ids.map((topicId) => ({ topicId, status: unique.get(topicId) })),
    });
    return out.map((o) => ({ topicId: o.topicId, sectionId: o.sectionId, status: o.status, completedAt: isoOrNull(o.completedAt), updatedAt: iso(o.updatedAt) }));
  });
}

// ───────────────────────────── coverage ─────────────────────────────

/**
 * Coverage per (section × subject): topics of the section's grade vs. progress rows of that section, aggregated in SQL.
 * Students / parents see their own (child's) section; teachers their sections; school scope everything.
 */
export async function coverage(db: TenantDb, p: Principal, q: { sectionId?: string; gradeId?: string; subjectId?: string; studentId?: string }): Promise<SyllabusCoverageItem[]> {
  let scope: SQL;
  let sectionId = q.sectionId;
  if (p.userType !== 'staff') {
    const st = await resolveStudent(db, p, 'syllabus:view', q.studentId);
    if (!st?.sectionId) return [];
    sectionId = st.sectionId;
    scope = eq(sections.id, st.sectionId);
  } else {
    if (sectionId) assertSectionAccess(p, 'syllabus:view', sectionId);
    scope = sectionScope(p, 'syllabus:view', sections.id);
  }
  const rows = await db
    .select({
      sectionId: sections.id,
      sectionName: sections.name,
      gradeId: grades.id,
      gradeName: grades.name,
      subjectId: subjects.id,
      subjectName: subjects.name,
      total: sql<number>`count(distinct ${syllabusTopics.id})::int`,
      completed: sql<number>`count(distinct ${topicProgress.id}) filter (where ${topicProgress.status} = 'completed')::int`,
      inProgress: sql<number>`count(distinct ${topicProgress.id}) filter (where ${topicProgress.status} = 'in_progress')::int`,
    })
    .from(sections)
    .innerJoin(academicYears, and(eq(academicYears.id, sections.academicYearId), eq(academicYears.isCurrent, true)))
    .innerJoin(grades, eq(grades.id, sections.gradeId))
    .innerJoin(syllabusTopics, eq(syllabusTopics.gradeId, sections.gradeId))
    .innerJoin(subjects, eq(subjects.id, syllabusTopics.subjectId))
    .leftJoin(topicProgress, and(eq(topicProgress.topicId, syllabusTopics.id), eq(topicProgress.sectionId, sections.id)))
    .where(and(scope, sectionId ? eq(sections.id, sectionId) : undefined, q.gradeId ? eq(sections.gradeId, q.gradeId) : undefined, q.subjectId ? eq(syllabusTopics.subjectId, q.subjectId) : undefined))
    .groupBy(sections.id, sections.name, grades.id, grades.name, grades.ordinal, subjects.id, subjects.name)
    .orderBy(asc(grades.ordinal), asc(sections.name), asc(subjects.name));
  return rows.map((r) => ({
    sectionId: r.sectionId,
    sectionName: r.sectionName,
    gradeId: r.gradeId,
    gradeName: r.gradeName,
    subjectId: r.subjectId,
    subjectName: r.subjectName,
    totalTopics: r.total,
    completed: r.completed,
    inProgress: r.inProgress,
    notStarted: Math.max(0, r.total - r.completed - r.inProgress),
    percent: r.total ? Math.round((r.completed / r.total) * 1000) / 10 : 0,
  }));
}
