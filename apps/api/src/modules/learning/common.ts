import { and, eq, isNull } from 'drizzle-orm';
import { academicYears, students } from '../../db/tenant/schema';
import { getSetting } from '../../core/settings';
import { unprocessable, notFound } from '../../core/errors';
import { studentScope } from '../../core/rbac/scope';
import type { Principal } from '../../core/rbac/principal';
import type { Executor } from '../../core/tenancy/pools';
import type { PermissionKey } from '@school-sync/shared';

export const fullName = (first?: string | null, last?: string | null): string | null => {
  const n = [first, last].filter(Boolean).join(' ').trim();
  return n || null;
};
export const hhmm = (t: string): string => t.slice(0, 5);
export const iso = (d: Date): string => d.toISOString();
export const isoOrNull = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

/** School-local `HH:MM` for an instant. */
export function localTime(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now);
  const h = String(Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24).padStart(2, '0');
  return `${h}:${parts.find((p) => p.type === 'minute')?.value ?? '00'}`;
}

export async function currentYearId(db: Executor): Promise<string | null> {
  const [y] = await db.select({ id: academicYears.id }).from(academicYears).where(eq(academicYears.isCurrent, true)).limit(1);
  return y?.id ?? null;
}

export async function workingDays(db: Executor): Promise<number[]> {
  return (await getSetting(db, 'academic')).workingDays;
}

/** Student / parent callers get the learner view; every staff user gets the staff view. */
export const isLearner = (p: Principal): boolean => p.userType !== 'staff';

export interface LearnerStudent {
  id: string;
  name: string;
  rollNo: number | null;
  sectionId: string | null;
  gradeId: string | null;
}

/**
 * Which student does a learner-facing request concern?
 *  - student: always themselves (an explicit other id → 404)
 *  - parent: `studentId` must be a verified-linked child; omitted → the only child (422 STUDENT_REQUIRED when several)
 *  - staff: only when `studentId` is given and in scope
 * Returns null when there is nobody (e.g. a guardian with no verified link): callers answer with an empty result.
 */
export async function resolveStudent(db: Executor, p: Principal, perm: PermissionKey, studentId?: string): Promise<LearnerStudent | null> {
  let id = studentId;
  if (!id) {
    if (p.userType === 'student') id = p.studentId ?? undefined;
    else if (p.userType === 'parent') {
      if (p.linkedStudentIds.length > 1) throw unprocessable('Specify which child with studentId', 'STUDENT_REQUIRED');
      id = p.linkedStudentIds[0];
    }
    if (!id) return null;
  }
  const [row] = await db
    .select({ id: students.id, firstName: students.firstName, lastName: students.lastName, rollNo: students.rollNo, sectionId: students.currentSectionId, gradeId: students.currentGradeId })
    .from(students)
    .where(and(eq(students.id, id), isNull(students.archivedAt), studentScope(p, perm)))
    .limit(1);
  if (!row) {
    // a parent/student naming somebody else's child, or staff outside their scope → don't reveal existence
    if (studentId || p.userType !== 'staff') throw notFound('Student');
    return null;
  }
  return { id: row.id, name: fullName(row.firstName, row.lastName) ?? '', rollNo: row.rollNo, sectionId: row.sectionId, gradeId: row.gradeId };
}


function tzOffsetMs(ts: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ts));
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second')) - Math.floor(ts / 1000) * 1000;
}

/** The instant at which `YYYY-MM-DD` begins in the school's timezone (lets date filters use plain timestamp indexes). */
export function zonedDayStart(date: string, timeZone: string): Date {
  const guess = Date.parse(`${date}T00:00:00Z`);
  let t = guess - tzOffsetMs(guess, timeZone);
  const second = guess - tzOffsetMs(t, timeZone);
  if (second !== t) t = second;
  return new Date(t);
}
