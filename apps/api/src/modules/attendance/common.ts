import { and, eq, gte, inArray, lte, sql, type AnyColumn } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { AttendanceStatus, AttendanceStatusCounts, AttendanceTotals } from '@school-sync/shared';
import { actorOf, type AuditActor } from '../../core/audit';
import { forbidden, notFound } from '../../core/errors';
import { addDaysIso, isoWeekday } from '../../core/http';
import type { Principal } from '../../core/rbac/principal';
import type { Executor, TenantDb } from '../../core/tenancy/pools';
import type { TenantInfo } from '../../core/tenancy/registry';
import { academicYears, events, grades, leaveRequests, rolePermissions, sections, staff, userRoles, users } from '../../db/tenant/schema';
import { fullName } from '../learning/common';

export { addDaysIso, isoWeekday };
export { fullName, localTime, zonedDayStart } from '../learning/common';

export const MAX_RANGE_DAYS = 400;

// ── dates ────────────────────────────────────────────────────────────────────────────────

/** Every YYYY-MM-DD from `from` to `to` inclusive (callers cap the range first). */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDaysIso(d, 1)) out.push(d);
  return out;
}

export const daysBetween = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export interface HolidayRange {
  title: string;
  startDate: string;
  endDate: string;
}

/** Published holiday events overlapping [from, to]. */
export async function holidaysBetween(db: Executor, from: string, to: string): Promise<HolidayRange[]> {
  return db
    .select({ title: events.title, startDate: events.startDate, endDate: events.endDate })
    .from(events)
    .where(and(eq(events.kind, 'holiday'), eq(events.status, 'published'), lte(events.startDate, to), gte(events.endDate, from)));
}

export const holidayOn = (holidays: HolidayRange[], date: string): string | null => holidays.find((h) => h.startDate <= date && date <= h.endDate)?.title ?? null;

/** School days (working weekday, not a holiday) in [from, to]. */
export async function schoolDaysBetween(db: Executor, workingDays: number[], from: string, to: string): Promise<string[]> {
  if (from > to) return [];
  const holidays = await holidaysBetween(db, from, to);
  return datesBetween(from, to).filter((d) => workingDays.includes(isoWeekday(d)) && !holidayOn(holidays, d));
}

export async function currentYear(db: Executor): Promise<{ id: string; name: string; startDate: string; endDate: string } | null> {
  const [y] = await db.select({ id: academicYears.id, name: academicYears.name, startDate: academicYears.startDate, endDate: academicYears.endDate }).from(academicYears).where(eq(academicYears.isCurrent, true)).limit(1);
  return y ?? null;
}

/** Validate/default a `from`/`to` pair: defaults to [yearStart or `defaultFrom`, today]. */
export function resolveRange(q: { from?: string | undefined; to?: string | undefined }, today: string, defaultFrom: string): { from: string; to: string } {
  const to = q.to ?? today;
  const from = q.from ?? (defaultFrom <= to ? defaultFrom : to);
  return { from, to };
}

// ── status maths ────────────────────────────────────────────────────────────────────────

/** SQL count columns for a status column: `{ present, absent, late, leave, half_day }` as ints. */
export function statusCountCols(status: AnyColumn) {
  return {
    present: sql<number>`(count(*) filter (where ${status} = 'present'))::int`,
    absent: sql<number>`(count(*) filter (where ${status} = 'absent'))::int`,
    late: sql<number>`(count(*) filter (where ${status} = 'late'))::int`,
    leave: sql<number>`(count(*) filter (where ${status} = 'leave'))::int`,
    half_day: sql<number>`(count(*) filter (where ${status} = 'half_day'))::int`,
  };
}

export const emptyCounts = (): AttendanceStatusCounts => ({ present: 0, absent: 0, late: 0, leave: 0, half_day: 0 });

export function percentage(c: AttendanceStatusCounts): number | null {
  const denom = c.present + c.absent + c.late + c.half_day;
  if (!denom) return null;
  return Math.round(((c.present + c.late + c.half_day * 0.5) / denom) * 1000) / 10;
}

export const totalOf = (c: AttendanceStatusCounts): number => c.present + c.absent + c.late + c.leave + c.half_day;

export function totalsOf(c: AttendanceStatusCounts): AttendanceTotals {
  return { present: c.present, absent: c.absent, late: c.late, leave: c.leave, half_day: c.half_day, total: totalOf(c), percentage: percentage(c) };
}

export function addCounts(a: AttendanceStatusCounts, status: AttendanceStatus, n = 1): AttendanceStatusCounts {
  a[status] += n;
  return a;
}

// ── sections ─────────────────────────────────────────────────────────────────────────────

export interface SectionRow {
  id: string;
  name: string;
  gradeId: string;
  gradeName: string;
  classTeacherId: string | null;
  academicYearId: string;
}

export const sectionLabel = (gradeName: string, name: string): string => `${gradeName}-${name}`;

export async function loadSection(db: Executor, sectionId: string): Promise<SectionRow | null> {
  const [row] = await db
    .select({ id: sections.id, name: sections.name, gradeId: sections.gradeId, gradeName: grades.name, classTeacherId: sections.classTeacherId, academicYearId: sections.academicYearId })
    .from(sections)
    .innerJoin(grades, eq(grades.id, sections.gradeId))
    .where(eq(sections.id, sectionId))
    .limit(1);
  return row ?? null;
}

// ── who may do what to a section's attendance ──────────────────────────────────────────

export type MarkRight = 'school' | 'class' | 'subject';

/**
 * May this caller take attendance for the section? (non-throwing; returns why not)
 *  - `school`: attendance:create at school scope, or attendance:edit at school scope (administrator override)
 *  - `class`: the section's class teacher (daily mode: the only teacher who marks)
 *  - `subject`: any teacher assigned to the section, period mode only (the slot's teacher is checked by the caller)
 */
export function markRight(p: Principal, sectionId: string, mode: 'daily' | 'period'): { right: MarkRight } | { denied: 'NOT_ALLOWED_TO_MARK' | 'NOT_CLASS_TEACHER'; hidden: boolean } {
  if (p.userType !== 'staff') return { denied: 'NOT_ALLOWED_TO_MARK', hidden: false };
  if (p.can('attendance:create', 'school') || p.can('attendance:edit', 'school')) return { right: 'school' };
  if (!p.can('attendance:create', 'assigned')) return { denied: 'NOT_ALLOWED_TO_MARK', hidden: false };
  if (!p.assignedSectionIds.includes(sectionId)) return { denied: 'NOT_ALLOWED_TO_MARK', hidden: true };
  if (p.leadsSection(sectionId)) return { right: 'class' };
  if (mode === 'period') return { right: 'subject' };
  return { denied: 'NOT_CLASS_TEACHER', hidden: false };
}

/** Throwing variant: 404 for sections outside the caller's reach, 403 for sections they may see but not mark. */
export function assertMarkRight(p: Principal, sectionId: string, mode: 'daily' | 'period'): MarkRight {
  const r = markRight(p, sectionId, mode);
  if ('right' in r) return r.right;
  if (r.hidden) throw notFound('Section');
  if (r.denied === 'NOT_CLASS_TEACHER') throw forbidden('Only the class teacher can take daily attendance for this section', 'NOT_CLASS_TEACHER');
  throw forbidden('You may not take attendance', 'NOT_ALLOWED_TO_MARK');
}

/** Staff who may look at a section's roll call / history: attendance:view at assigned (own sections) or school scope. */
export function assertRosterAccess(p: Principal, sectionId: string): void {
  if (p.userType !== 'staff' || !p.scope('attendance:view')) throw forbidden();
  if (p.can('attendance:view', 'school')) return;
  if (!p.can('attendance:view', 'assigned') || !p.assignedSectionIds.includes(sectionId)) throw notFound('Section');
}

/** Sections whose corrections / leave this caller may decide: school → all, otherwise the sections they lead. */
export function approvableSections(p: Principal, perm: 'attendance:approve' | 'leave:approve'): 'all' | string[] {
  if (p.can(perm, 'school')) return 'all';
  if (p.scope(perm)) return p.classTeacherSectionIds;
  return [];
}

export const canDecideFor = (p: Principal, perm: 'attendance:approve' | 'leave:approve', sectionId: string | null): boolean => {
  const a = approvableSections(p, perm);
  return a === 'all' || (!!sectionId && a.includes(sectionId));
};

// ── approved leave ───────────────────────────────────────────────────────────────────────

/** Students (of the given ids) with an approved leave request covering `date`. */
export async function studentsOnLeave(db: Executor, studentIds: string[], date: string): Promise<Set<string>> {
  if (!studentIds.length) return new Set();
  const rows = await db
    .select({ studentId: leaveRequests.studentId })
    .from(leaveRequests)
    .where(and(inArray(leaveRequests.studentId, studentIds), eq(leaveRequests.status, 'approved'), lte(leaveRequests.fromDate, date), gte(leaveRequests.toDate, date)));
  return new Set(rows.map((r) => r.studentId));
}

// ── names ────────────────────────────────────────────────────────────────────────────────

/** user id → display name for a set of users (audit-ish "who did it" labels). */
export async function userNames(db: Executor, ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (!unique.length) return new Map();
  const rows = await db.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, unique));
  return new Map(rows.map((r) => [r.id, r.name]));
}

export async function staffUserId(db: Executor, staffId: string | null | undefined): Promise<string | null> {
  if (!staffId) return null;
  const [r] = await db.select({ userId: staff.userId }).from(staff).where(eq(staff.id, staffId)).limit(1);
  return r?.userId ?? null;
}

export const staffName = (first: string, last: string | null): string => fullName(first, last) ?? first;


// ── request context + helpers shared by the attendance services ───────────────────────────

export interface Ctx {
  db: TenantDb;
  tenant: TenantInfo;
  p: Principal;
  actor: AuditActor;
  log: { error: (o: unknown, m?: string) => void };
}
export const ctxOf = (req: FastifyRequest): Ctx => ({ db: req.db, tenant: req.tenant, p: req.auth, actor: actorOf(req), log: req.log });

/** Active users holding `perm` (optionally only at `school` scope) through any role. */
export async function usersWithPermission(db: Executor, perm: string, schoolOnly = false): Promise<string[]> {
  const rows = await db
    .selectDistinct({ id: users.id })
    .from(rolePermissions)
    .innerJoin(userRoles, eq(userRoles.roleId, rolePermissions.roleId))
    .innerJoin(users, eq(users.id, userRoles.userId))
    .where(and(eq(rolePermissions.permission, perm), eq(users.status, 'active'), schoolOnly ? eq(rolePermissions.scope, 'school') : undefined));
  return rows.map((r) => r.id);
}

/** "21 Oct 2026" */
export function prettyDate(date: string): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
}

export const STATUS_WORDS: Record<AttendanceStatus, string> = { present: 'present', absent: 'absent', late: 'late', leave: 'on leave', half_day: 'marked half day' };
