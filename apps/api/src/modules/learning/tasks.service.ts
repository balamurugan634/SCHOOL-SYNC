import { and, asc, desc, eq, gte, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import type { TaskCreateBody, TaskItem, TasksFeedItem, TaskUpdateBody } from '@school-sync/shared';
import { forbidden, notFound, unprocessable } from '../../core/errors';
import { addDaysIso } from '../../core/http';
import type { Principal } from '../../core/rbac/principal';
import type { TenantDb } from '../../core/tenancy/pools';
import type { TenantInfo } from '../../core/tenancy/registry';
import { homework, homeworkSubmissions, studentTasks, subjects } from '../../db/tenant/schema';
import { iso, isoOrNull, zonedDayStart } from './common';

/** Open (not done) tasks one student may keep; keeps the feed and the reminder scan small. */
const MAX_OPEN_TASKS = 300;
/** Overdue homework stays in the feed for this long, then drops out (the teacher can still see it as missing). */
const OVERDUE_FEED_DAYS = 30;

const cols = {
  id: studentTasks.id,
  title: studentTasks.title,
  notes: studentTasks.notes,
  dueAt: studentTasks.dueAt,
  remindAt: studentTasks.remindAt,
  priority: studentTasks.priority,
  status: studentTasks.status,
  completedAt: studentTasks.completedAt,
  createdAt: studentTasks.createdAt,
  updatedAt: studentTasks.updatedAt,
};
type Row = typeof studentTasks.$inferSelect;

const toItem = (r: Pick<Row, keyof typeof cols>): TaskItem => ({
  id: r.id,
  title: r.title,
  notes: r.notes,
  dueAt: isoOrNull(r.dueAt),
  remindAt: isoOrNull(r.remindAt),
  priority: r.priority,
  status: r.status,
  completedAt: isoOrNull(r.completedAt),
  createdAt: iso(r.createdAt),
  updatedAt: iso(r.updatedAt),
});

/** Personal tasks belong to the student's own profile; staff accounts have no task list. */
const ownerOrNull = (p: Principal): string | null => (p.userType === 'student' ? p.studentId : null);

export async function listTasks(db: TenantDb, tenant: TenantInfo, p: Principal, q: { page: number; pageSize: number; status?: TaskItem['status']; priority?: TaskItem['priority']; dueFrom?: string; dueTo?: string }) {
  const owner = ownerOrNull(p);
  if (!owner) return { rows: [] as TaskItem[], total: 0 };
  const where = and(
    eq(studentTasks.studentId, owner),
    q.status ? eq(studentTasks.status, q.status) : undefined,
    q.priority ? eq(studentTasks.priority, q.priority) : undefined,
    q.dueFrom ? sql`${studentTasks.dueAt} >= ${zonedDayStart(q.dueFrom, tenant.timezone)}` : undefined,
    q.dueTo ? sql`${studentTasks.dueAt} < ${zonedDayStart(addDaysIso(q.dueTo, 1), tenant.timezone)}` : undefined,
  );
  const [rows, counted] = await Promise.all([
    db
      .select(cols)
      .from(studentTasks)
      .where(where)
      .orderBy(sql`${studentTasks.status} = 'done'`, sql`${studentTasks.dueAt} asc nulls last`, desc(studentTasks.createdAt), desc(studentTasks.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db.select({ n: sql<number>`count(*)::int` }).from(studentTasks).where(where),
  ]);
  return { rows: rows.map(toItem), total: counted[0]?.n ?? 0 };
}

export async function getTask(db: TenantDb, p: Principal, id: string): Promise<TaskItem> {
  const owner = ownerOrNull(p);
  if (!owner) throw notFound('Task');
  const [r] = await db.select(cols).from(studentTasks).where(and(eq(studentTasks.id, id), eq(studentTasks.studentId, owner))).limit(1); // someone else's task → 404
  if (!r) throw notFound('Task');
  return toItem(r);
}

export async function createTask(db: TenantDb, p: Principal, body: TaskCreateBody): Promise<TaskItem> {
  const owner = ownerOrNull(p);
  if (!owner) throw forbidden('Personal tasks are available to students only', 'TASKS_STUDENTS_ONLY');
  const remindAt = body.remindAt ? new Date(body.remindAt) : null;
  if (remindAt && remindAt.getTime() < Date.now() - 60_000) throw unprocessable('The reminder time is in the past', 'REMIND_IN_PAST');
  const [open] = await db.select({ n: sql<number>`count(*)::int` }).from(studentTasks).where(and(eq(studentTasks.studentId, owner), ne(studentTasks.status, 'done')));
  if ((open?.n ?? 0) >= MAX_OPEN_TASKS) throw unprocessable(`You can keep up to ${MAX_OPEN_TASKS} open tasks; finish or delete some first`, 'TOO_MANY_TASKS');
  const [row] = await db
    .insert(studentTasks)
    .values({ studentId: owner, title: body.title, notes: body.notes ?? null, dueAt: body.dueAt ? new Date(body.dueAt) : null, remindAt, priority: body.priority })
    .returning(cols);
  return toItem(row!);
}

export async function updateTask(db: TenantDb, p: Principal, id: string, body: TaskUpdateBody): Promise<TaskItem> {
  const owner = ownerOrNull(p);
  if (!owner) throw notFound('Task');
  const [cur] = await db.select().from(studentTasks).where(and(eq(studentTasks.id, id), eq(studentTasks.studentId, owner))).limit(1);
  if (!cur) throw notFound('Task');
  const set: Partial<typeof studentTasks.$inferInsert> = {};
  if (body.title !== undefined) set.title = body.title;
  if (body.notes !== undefined) set.notes = body.notes;
  if (body.dueAt !== undefined) set.dueAt = body.dueAt ? new Date(body.dueAt) : null;
  if (body.priority !== undefined) set.priority = body.priority;
  if (body.remindAt !== undefined) {
    const next = body.remindAt ? new Date(body.remindAt) : null;
    if (next && next.getTime() < Date.now() - 60_000) throw unprocessable('The reminder time is in the past', 'REMIND_IN_PAST');
    set.remindAt = next;
    set.remindedAt = null; // a new reminder time deserves a new reminder
  }
  if (body.status !== undefined && body.status !== cur.status) {
    set.status = body.status;
    set.completedAt = body.status === 'done' ? new Date() : null;
    if (cur.status === 'done' && body.status !== 'done') {
      const [open] = await db.select({ n: sql<number>`count(*)::int` }).from(studentTasks).where(and(eq(studentTasks.studentId, owner), ne(studentTasks.status, 'done')));
      if ((open?.n ?? 0) >= MAX_OPEN_TASKS) throw unprocessable(`You can keep up to ${MAX_OPEN_TASKS} open tasks`, 'TOO_MANY_TASKS');
    }
  }
  if (!Object.keys(set).length) return toItem(cur);
  const [row] = await db.update(studentTasks).set(set).where(eq(studentTasks.id, id)).returning(cols);
  return toItem(row!);
}

export async function deleteTask(db: TenantDb, p: Principal, id: string): Promise<void> {
  const owner = ownerOrNull(p);
  if (!owner) throw notFound('Task');
  const gone = await db.delete(studentTasks).where(and(eq(studentTasks.id, id), eq(studentTasks.studentId, owner))).returning({ id: studentTasks.id });
  if (!gone.length) throw notFound('Task');
}

// ───────────────────────────── "My Tasks" feed ─────────────────────────────

const byDue = (a: TasksFeedItem, b: TasksFeedItem) => {
  if (a.dueAt === b.dueAt) return 0;
  if (!a.dueAt) return 1;
  if (!b.dueAt) return -1;
  return a.dueAt < b.dueAt ? -1 : 1;
};

/**
 * Personal tasks + the student's homework that still needs attention, as one list sorted by due date (undated last).
 * Homework is virtual (never copied into student_tasks): published, not yet submitted and overdue by < 30 days or still pending,
 * homework returned for rework, and no-submission homework until its due date. Each list is capped at `limit` in SQL, so the
 * merged top-`limit` is exact.
 */
export async function tasksFeed(db: TenantDb, p: Principal, q: { limit: number; includeDone?: boolean }): Promise<TasksFeedItem[]> {
  const owner = ownerOrNull(p);
  if (!owner) return [];
  const now = new Date();
  const sectionId = p.currentSectionId;

  const taskRows = await db
    .select(cols)
    .from(studentTasks)
    .where(and(eq(studentTasks.studentId, owner), q.includeDone ? undefined : ne(studentTasks.status, 'done')))
    .orderBy(sql`${studentTasks.status} = 'done'`, sql`${studentTasks.dueAt} asc nulls last`, desc(studentTasks.createdAt))
    .limit(q.limit);

  const hwRows = sectionId
    ? await db
        .select({ id: homework.id, title: homework.title, subjectName: subjects.name, dueAt: homework.dueAt, allowSubmission: homework.allowSubmission, subStatus: homeworkSubmissions.status })
        .from(homework)
        .innerJoin(subjects, eq(subjects.id, homework.subjectId))
        .leftJoin(homeworkSubmissions, and(eq(homeworkSubmissions.homeworkId, homework.id), eq(homeworkSubmissions.studentId, owner)))
        .where(
          and(
            eq(homework.sectionId, sectionId),
            eq(homework.status, 'published'),
            or(
              and(isNull(homeworkSubmissions.id), eq(homework.allowSubmission, true), gte(homework.dueAt, new Date(now.getTime() - OVERDUE_FEED_DAYS * 86_400_000))) as SQL,
              eq(homeworkSubmissions.status, 'returned'),
              and(isNull(homeworkSubmissions.id), eq(homework.allowSubmission, false), gte(homework.dueAt, now)) as SQL,
            ),
          ),
        )
        .orderBy(asc(homework.dueAt))
        .limit(q.limit)
    : [];

  const items: TasksFeedItem[] = [
    ...taskRows.map((t) => ({
      kind: 'task' as const,
      id: t.id,
      title: t.title,
      subtitle: t.notes,
      dueAt: isoOrNull(t.dueAt),
      priority: t.priority,
      status: t.status,
      overdue: t.status !== 'done' && !!t.dueAt && t.dueAt.getTime() < now.getTime(),
      route: '/tasks',
    })),
    ...hwRows.map((h) => {
      const returned = h.subStatus === 'returned';
      const overdue = !returned && h.dueAt.getTime() < now.getTime();
      return {
        kind: 'homework' as const,
        id: h.id,
        title: h.title,
        subtitle: h.subjectName,
        dueAt: iso(h.dueAt),
        priority: null,
        status: returned ? 'returned' : !h.allowSubmission ? 'not_required' : overdue ? 'overdue' : 'pending',
        overdue,
        route: `/homework/${h.id}`,
      };
    }),
  ];
  return items.sort(byDue).slice(0, q.limit);
}
