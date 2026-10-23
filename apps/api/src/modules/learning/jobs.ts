import { and, eq, gte, inArray, isNotNull, isNull, lt, ne } from 'drizzle-orm';
import type { Job } from '../../core/jobs';
import { addDaysIso, todayIn } from '../../core/http';
import type { Executor } from '../../core/tenancy/pools';
import type { TenantInfo } from '../../core/tenancy/registry';
import { homework, homeworkSubmissions, students, studentTasks, subjects } from '../../db/tenant/schema';
import { localTime, zonedDayStart } from './common';
import { guardianUsers, insertNotifications, type NotifyRow } from './notify';

/** Reminders go out in the afternoon, school-local time, so "due tomorrow" lands when families are checking the app. */
const DUE_REMINDER_FROM = '15:00';
const BATCH = 1000;

/**
 * "Due tomorrow" reminders. Claims homework first (`due_reminder_sent_at` set in the same statement), so a second run — or a
 * second API instance — finds nothing left to send. Students who already submitted (or were reviewed) are skipped; guardians
 * are told only about children who still owe work. Moving a deadline (PATCH dueAt) clears the marker.
 * Returns the number of notifications written. Rows stay `pending` for the push sweeper (we are inside the job's transaction).
 */
export async function sendDueTomorrowReminders(tenant: TenantInfo, db: Executor, opts: { now?: Date; ignoreHour?: boolean } = {}): Promise<number> {
  const now = opts.now ?? new Date();
  if (!opts.ignoreHour && localTime(now, tenant.timezone) < DUE_REMINDER_FROM) return 0;
  const tomorrow = addDaysIso(todayIn(tenant.timezone, now), 1);
  const from = zonedDayStart(tomorrow, tenant.timezone);
  const to = zonedDayStart(addDaysIso(tomorrow, 1), tenant.timezone);

  const claimedIds = (
    await db
      .select({ id: homework.id })
      .from(homework)
      .where(and(eq(homework.status, 'published'), isNull(homework.dueReminderSentAt), gte(homework.dueAt, from), lt(homework.dueAt, to)))
      .limit(BATCH)
  ).map((r) => r.id);
  if (!claimedIds.length) return 0;
  const claimed = await db
    .update(homework)
    .set({ dueReminderSentAt: now })
    .where(and(inArray(homework.id, claimedIds), isNull(homework.dueReminderSentAt)))
    .returning({ id: homework.id, sectionId: homework.sectionId, subjectId: homework.subjectId, title: homework.title, allowSubmission: homework.allowSubmission });
  if (!claimed.length) return 0;

  const sectionIds = [...new Set(claimed.map((h) => h.sectionId))];
  const subjectRows = await db.select({ id: subjects.id, name: subjects.name }).from(subjects).where(inArray(subjects.id, [...new Set(claimed.map((h) => h.subjectId))]));
  const subjectName = new Map(subjectRows.map((s) => [s.id, s.name]));
  const studs = await db
    .select({ id: students.id, userId: students.userId, sectionId: students.currentSectionId })
    .from(students)
    .where(and(inArray(students.currentSectionId, sectionIds), eq(students.status, 'active'), isNull(students.archivedAt)));
  const bySection = Map.groupBy(studs, (s) => s.sectionId!);
  const done = await db
    .select({ homeworkId: homeworkSubmissions.homeworkId, studentId: homeworkSubmissions.studentId })
    .from(homeworkSubmissions)
    .where(and(inArray(homeworkSubmissions.homeworkId, claimed.map((h) => h.id)), ne(homeworkSubmissions.status, 'returned')));
  const doneKey = new Set(done.map((d) => `${d.homeworkId}|${d.studentId}`));
  const guardians = Map.groupBy(await guardianUsers(db, studs.map((s) => s.id)), (g) => g.studentId);

  const rows: NotifyRow[] = [];
  for (const hw of claimed) {
    const base = { type: 'homework.reminder', title: 'Homework due tomorrow', body: `${subjectName.get(hw.subjectId) ?? 'Homework'}: ${hw.title}` };
    for (const s of bySection.get(hw.sectionId) ?? []) {
      if (hw.allowSubmission && doneKey.has(`${hw.id}|${s.id}`)) continue;
      const data = { route: `/homework/${hw.id}`, homeworkId: hw.id, studentId: s.id };
      if (s.userId) rows.push({ ...base, userId: s.userId, data });
      for (const g of guardians.get(s.id) ?? []) rows.push({ ...base, userId: g.userId, data });
    }
  }
  await insertNotifications(db, rows);
  return rows.length;
}

/**
 * Personal task reminders: every task whose `remindAt` has passed (within the last 2 days) and that is not done gets one
 * `tasks.reminder` notification; `reminded_at` is set in the claiming statement, so reruns are no-ops.
 */
export async function sendTaskReminders(_tenant: TenantInfo, db: Executor, now = new Date()): Promise<number> {
  const ids = (
    await db
      .select({ id: studentTasks.id })
      .from(studentTasks)
      .where(and(isNotNull(studentTasks.remindAt), lt(studentTasks.remindAt, new Date(now.getTime() + 1)), gte(studentTasks.remindAt, new Date(now.getTime() - 2 * 86_400_000)), isNull(studentTasks.remindedAt), ne(studentTasks.status, 'done')))
      .limit(BATCH)
  ).map((r) => r.id);
  if (!ids.length) return 0;
  const claimed = await db
    .update(studentTasks)
    .set({ remindedAt: now })
    .where(and(inArray(studentTasks.id, ids), isNull(studentTasks.remindedAt)))
    .returning({ id: studentTasks.id, studentId: studentTasks.studentId, title: studentTasks.title });
  if (!claimed.length) return 0;
  const owners = await db.select({ id: students.id, userId: students.userId }).from(students).where(inArray(students.id, claimed.map((c) => c.studentId)));
  const userOf = new Map(owners.map((o) => [o.id, o.userId]));
  const rows: NotifyRow[] = claimed
    .filter((c) => userOf.get(c.studentId))
    .map((c) => ({ userId: userOf.get(c.studentId)!, type: 'tasks.reminder', title: 'Task reminder', body: c.title, data: { route: '/tasks', taskId: c.id } }));
  await insertNotifications(db, rows);
  return rows.length;
}

export const jobs: Job[] = [
  { name: 'homework.dueTomorrow', everyMinutes: 60, run: async (tenant, db) => void (await sendDueTomorrowReminders(tenant, db)) },
  { name: 'tasks.reminders', everyMinutes: 5, run: async (tenant, db) => void (await sendTaskReminders(tenant, db)) },
];
