import { and, eq, inArray, isNotNull, isNull, lt, lte, or } from 'drizzle-orm';
import type { Job } from '../../core/jobs';
import { addDaysIso, todayIn } from '../../core/http';
import { deferPush } from '../../core/notify';
import type { Executor } from '../../core/tenancy/pools';
import type { TenantInfo } from '../../core/tenancy/registry';
import { guardians, libraryBooks, libraryIssues, notifications, staff, studentGuardians, students } from '../../db/tenant/schema';

const BATCH = 500;

/**
 * Remind borrowers (and the verified guardians of student borrowers) about overdue books — at most once a week per loan.
 * Idempotent: the `last_reminded_on` stamp is the claim, written in the same transaction as the notifications, so a
 * second run on the same day (or from another instance) finds nothing to do.
 */
export async function sendOverdueReminders(tenant: TenantInfo, db: Executor, now = new Date()): Promise<number> {
  const today = todayIn(tenant.timezone, now);
  const due = and(isNull(libraryIssues.returnedOn), lt(libraryIssues.dueOn, today), or(isNull(libraryIssues.lastRemindedOn), lte(libraryIssues.lastRemindedOn, addDaysIso(today, -7))));
  let total = 0;
  for (;;) {
    const ids = (await db.select({ id: libraryIssues.id }).from(libraryIssues).where(due).limit(BATCH)).map((r) => r.id);
    if (!ids.length) break;
    // claim first (re-checking the condition), then notify exactly the rows we claimed
    const claimed = await db.update(libraryIssues).set({ lastRemindedOn: today }).where(and(inArray(libraryIssues.id, ids), due)).returning({ id: libraryIssues.id, bookId: libraryIssues.bookId, studentId: libraryIssues.studentId, staffId: libraryIssues.staffId, dueOn: libraryIssues.dueOn });
    if (!claimed.length) break;
    total += claimed.length;

    const studentIds = [...new Set(claimed.map((c) => c.studentId).filter((x): x is string => !!x))];
    const staffIds = [...new Set(claimed.map((c) => c.staffId).filter((x): x is string => !!x))];
    // sequential: the job's executor is a transaction (one connection, one query at a time)
    const books = await db.select({ id: libraryBooks.id, title: libraryBooks.title }).from(libraryBooks).where(inArray(libraryBooks.id, [...new Set(claimed.map((c) => c.bookId))]));
    const studentUsers = studentIds.length ? await db.select({ id: students.id, userId: students.userId }).from(students).where(inArray(students.id, studentIds)) : [];
    const guardianLinks = studentIds.length
      ? await db
          .select({ studentId: studentGuardians.studentId, userId: guardians.userId })
          .from(studentGuardians)
          .innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId))
          // only guardians the school has verified may be told about a child's library loans
          .where(and(inArray(studentGuardians.studentId, studentIds), isNotNull(studentGuardians.verifiedAt)))
      : [];
    const staffUsers = staffIds.length ? await db.select({ id: staff.id, userId: staff.userId }).from(staff).where(inArray(staff.id, staffIds)) : [];
    const title = new Map(books.map((b) => [b.id, b.title]));
    const studentUser = new Map(studentUsers.map((s) => [s.id, s.userId]));
    const guardianUsers = Map.groupBy(guardianLinks.filter((g) => g.userId), (g) => g.studentId);
    const staffUser = new Map(staffUsers.map((s) => [s.id, s.userId]));

    const rows: (typeof notifications.$inferInsert)[] = [];
    for (const c of claimed) {
      const recipients = c.studentId ? [studentUser.get(c.studentId), ...(guardianUsers.get(c.studentId) ?? []).map((g) => g.userId)] : [staffUser.get(c.staffId!)];
      for (const userId of new Set(recipients.filter((u): u is string => !!u))) {
        rows.push({
          userId,
          type: 'system.library_overdue',
          title: 'Library book overdue',
          body: `“${title.get(c.bookId) ?? 'A library book'}” was due on ${c.dueOn}. Please return it to avoid fines.`,
          data: { route: '/library', issueId: c.id },
        });
      }
    }
    // inbox rows commit with the claim above; the push follows once the transaction has committed
    for (let i = 0; i < rows.length; i += BATCH) {
      const ids = await db.insert(notifications).values(rows.slice(i, i + BATCH)).returning({ id: notifications.id });
      deferPush(tenant, ids.map((r) => r.id));
    }
  }
  return total;
}

export const jobs: Job[] = [
  {
    name: 'library.overdue-reminders',
    everyMinutes: 24 * 60,
    run: async (tenant, db) => {
      await sendOverdueReminders(tenant, db);
    },
  },
];
