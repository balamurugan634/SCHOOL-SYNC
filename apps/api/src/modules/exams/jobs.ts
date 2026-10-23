import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import type { Job } from '../../core/jobs';
import { addDaysIso, todayIn } from '../../core/http';
import { notify } from '../../core/notify';
import type { Executor } from '../../core/tenancy/pools';
import type { TenantInfo } from '../../core/tenancy/registry';
import { examPapers, examReminders, exams, students } from '../../db/tenant/schema';
import { recipientsForStudents } from './common';

/**
 * "Exam tomorrow" reminders: for every exam (scheduled / marks entry / review) with a paper dated tomorrow in the
 * school's timezone, each affected grade's students and verified guardians get one neutral notification.
 * Idempotent: (exam, grade, date) is claimed in `exam_reminders` BEFORE anyone is notified, so a second run (or a
 * second API instance) the same day sends nothing.
 */
export async function runExamReminders(tenant: TenantInfo, db: Executor, now = new Date()): Promise<{ grades: number; notified: number }> {
  const tomorrow = addDaysIso(todayIn(tenant.timezone, now), 1);
  const due = await db
    .selectDistinct({ examId: examPapers.examId, gradeId: examPapers.gradeId, examName: exams.name })
    .from(examPapers)
    .innerJoin(exams, eq(exams.id, examPapers.examId))
    .where(and(eq(examPapers.examDate, tomorrow), inArray(exams.status, ['scheduled', 'marks_entry', 'under_review'])));
  const out = { grades: 0, notified: 0 };
  for (const d of due) {
    const claimed = await db.insert(examReminders).values({ examId: d.examId, gradeId: d.gradeId, forDate: tomorrow }).onConflictDoNothing().returning({ id: examReminders.id });
    if (!claimed.length) continue;
    const roster = await db
      .select({ id: students.id })
      .from(students)
      .where(and(eq(students.currentGradeId, d.gradeId), sql`${students.archivedAt} is null`, notInArray(students.status, ['transferred', 'withdrawn', 'alumni'])));
    const users = await recipientsForStudents(db, roster.map((r) => r.id));
    for (let i = 0; i < users.length; i += 1000) {
      await notify(db, tenant, { userIds: users.slice(i, i + 1000), type: 'marks.exam_tomorrow', title: 'Exam tomorrow', body: 'An exam is scheduled for tomorrow. Open the app for the timetable.', data: { route: `/exams/${d.examId}`, examId: d.examId } });
    }
    await db.update(examReminders).set({ recipients: users.length }).where(eq(examReminders.id, claimed[0]!.id));
    out.grades++;
    out.notified += users.length;
  }
  return out;
}

export const jobs: Job[] = [{ name: 'exams.reminders', everyMinutes: 60, run: async (tenant, db) => void (await runExamReminders(tenant, db)) }];
