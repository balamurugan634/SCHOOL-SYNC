import { and, eq, inArray, notExists, sql } from 'drizzle-orm';
import type { Job } from '../../core/jobs';
import { addDaysIso, todayIn } from '../../core/http';
import { notify } from '../../core/notify';
import type { Executor } from '../../core/tenancy/pools';
import type { TenantInfo } from '../../core/tenancy/registry';
import { feeReminders, invoices, students } from '../../db/tenant/schema';
import { recipientsForStudents } from '../exams/common';

const BAL = sql`(${invoices.totalMinor} - ${invoices.discountMinor} - ${invoices.paidMinor})`;
/** an overdue invoice is re-announced at most this often (days) */
export const OVERDUE_REPEAT_DAYS = 7;
/** an invoice due within this many days gets one "due soon" reminder */
export const DUE_SOON_DAYS = 3;

/**
 * Daily fee reminders to the VERIFIED guardians of students with
 *   - an unpaid/partial invoice due within the next 3 days (one `due_soon` reminder per invoice), or
 *   - an overdue invoice (a reminder the first day it is overdue, then weekly while it stays unpaid).
 * Idempotent: every (invoice, kind, day) is claimed in `fee_reminders` with a unique key *before* anyone is notified, so
 * running the job twice on the same day — or from two instances — sends nothing the second time.
 * Titles/bodies are neutral (no amounts); details are visible only after opening the app.
 */
export async function runFeeReminders(tenant: TenantInfo, db: Executor, now = new Date()): Promise<{ dueSoon: number; overdue: number }> {
  if (!tenant.features.fees) return { dueSoon: 0, overdue: 0 };
  const today = todayIn(tenant.timezone, now);
  const soon = addDaysIso(today, DUE_SOON_DAYS);
  const repeatAfter = addDaysIso(today, -OVERDUE_REPEAT_DAYS);
  const open = and(inArray(invoices.status, ['unpaid', 'partial']), sql`${BAL} > 0`);
  const out = { dueSoon: 0, overdue: 0 };

  for (const kind of ['due_soon', 'overdue'] as const) {
    const candidates = await db
      .select({ id: invoices.id, studentId: invoices.studentId })
      .from(invoices)
      .innerJoin(students, eq(students.id, invoices.studentId))
      .where(
        and(
          open,
          kind === 'due_soon' ? sql`${invoices.dueDate} between ${today}::date and ${soon}::date` : sql`${invoices.dueDate} < ${today}::date`,
          // due_soon: never reminded before; overdue: no overdue reminder within the repeat window
          kind === 'due_soon'
            ? notExists(db.select({ x: sql`1` }).from(feeReminders).where(and(eq(feeReminders.invoiceId, invoices.id), eq(feeReminders.kind, 'due_soon'))))
            : notExists(db.select({ x: sql`1` }).from(feeReminders).where(and(eq(feeReminders.invoiceId, invoices.id), eq(feeReminders.kind, 'overdue'), sql`${feeReminders.sentOn} > ${repeatAfter}::date`))),
          sql`${students.archivedAt} is null`,
        ),
      )
      .limit(5000);
    if (!candidates.length) continue;

    // claim first (unique key), notify only what we claimed
    const claimed: typeof candidates = [];
    for (let i = 0; i < candidates.length; i += 500) {
      const part = candidates.slice(i, i + 500);
      const rows = await db.insert(feeReminders).values(part.map((c) => ({ invoiceId: c.id, kind, sentOn: today }))).onConflictDoNothing().returning({ invoiceId: feeReminders.invoiceId });
      const got = new Set(rows.map((r) => r.invoiceId));
      claimed.push(...part.filter((c) => got.has(c.id)));
    }
    const byStudent = Map.groupBy(claimed, (c) => c.studentId);
    for (const [studentId, list] of byStudent) {
      const users = await recipientsForStudents(db, [studentId], { includeStudents: false });
      if (!users.length) continue;
      await notify(db, tenant, {
        userIds: users,
        type: 'fees.due',
        title: kind === 'due_soon' ? 'Fee payment due soon' : 'Fee payment overdue',
        body: 'Please open the fees section for details.',
        data: { route: list.length === 1 ? `/fees/invoices/${list[0]!.id}` : '/fees', kind },
      });
      if (kind === 'due_soon') out.dueSoon += list.length;
      else out.overdue += list.length;
    }
  }
  return out;
}

export const jobs: Job[] = [{ name: 'fees.reminders', everyMinutes: 60, run: async (tenant, db) => void (await runFeeReminders(tenant, db)) }];
