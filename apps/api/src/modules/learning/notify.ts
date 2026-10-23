import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { guardians, notifications, studentGuardians, students } from '../../db/tenant/schema';
import { enqueuePush } from '../../core/notify/queue';
import type { Executor } from '../../core/tenancy/pools';
import type { TenantInfo } from '../../core/tenancy/registry';

export interface NotifyRow {
  userId: string;
  type: string;
  title: string;
  body?: string | null;
  data?: Record<string, unknown>;
  priority?: 'normal' | 'high';
}

/** Batch-insert inbox rows (one per recipient, each with its own title/body/data). Returns the new ids. */
export async function insertNotifications(db: Executor, rows: NotifyRow[]): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const out = await db
      .insert(notifications)
      .values(chunk.map((r) => ({ userId: r.userId, type: r.type, title: r.title, body: r.body ?? null, data: r.data ?? {}, priority: r.priority ?? 'normal' })))
      .returning({ id: notifications.id });
    ids.push(...out.map((o) => o.id));
  }
  return ids;
}

/** Insert + hand to the push queue. Call AFTER the business transaction committed (never inside it). */
export async function notifyRows(db: Executor, tenant: TenantInfo, rows: NotifyRow[]): Promise<string[]> {
  if (!rows.length) return [];
  const ids = await insertNotifications(db, rows);
  enqueuePush(tenant, ids);
  return ids;
}

/** Verified guardians' user ids per student (`student_guardians.verified_at is not null`). */
export async function guardianUsers(db: Executor, studentIds: string[]): Promise<{ studentId: string; userId: string }[]> {
  if (!studentIds.length) return [];
  const out: { studentId: string; userId: string }[] = [];
  for (let i = 0; i < studentIds.length; i += 1000) {
    const rows = await db
      .select({ studentId: studentGuardians.studentId, userId: guardians.userId })
      .from(studentGuardians)
      .innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId))
      .where(and(inArray(studentGuardians.studentId, studentIds.slice(i, i + 1000)), isNotNull(studentGuardians.verifiedAt), isNotNull(guardians.userId)));
    for (const r of rows) out.push({ studentId: r.studentId, userId: r.userId! });
  }
  return out;
}

/** Active students of a section with a login. */
export async function sectionStudents(db: Executor, sectionId: string): Promise<{ id: string; userId: string | null }[]> {
  return db
    .select({ id: students.id, userId: students.userId })
    .from(students)
    .where(and(eq(students.currentSectionId, sectionId), eq(students.status, 'active'), isNull(students.archivedAt)));
}
