import { and, eq, isNull, sql } from 'drizzle-orm';
import { usageSnapshots, tenants } from '../../db/control/schema';
import { academicYears, enrollments, guardians, staff, students } from '../../db/tenant/schema';
import { controlDb } from '../tenancy/control-db';
import { tenantDb, type Executor } from '../tenancy/pools';
import type { TenantInfo } from '../tenancy/registry';
import { getLicense } from './license';

/**
 * THE billable unit: a student who has an enrollment in the subscription's academic year,
 * counted once per year (mid-year transfers and section changes don't add or remove a seat;
 * the next year's enrollment is a new seat in the next year's subscription).
 */
export async function countBillableStudents(db: Executor, academicYear: string): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(distinct ${enrollments.studentId})::int` })
    .from(enrollments)
    .innerJoin(academicYears, eq(academicYears.id, enrollments.academicYearId))
    .where(eq(academicYears.name, academicYear));
  return r?.n ?? 0;
}

export interface Usage {
  billableStudents: number;
  activeStudents: number;
  staff: number;
  parents: number;
}

export async function measureUsage(db: Executor, academicYear: string | null): Promise<Usage> {
  const [[a], [s], [g]] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(students).where(and(eq(students.status, 'active'), isNull(students.archivedAt))),
    db.select({ n: sql<number>`count(*)::int` }).from(staff).where(eq(staff.status, 'active')),
    db.select({ n: sql<number>`count(*)::int` }).from(guardians),
  ]);
  return {
    billableStudents: academicYear ? await countBillableStudents(db, academicYear) : (a?.n ?? 0),
    activeStudents: a?.n ?? 0,
    staff: s?.n ?? 0,
    parents: g?.n ?? 0,
  };
}

const today = () => new Date().toISOString().slice(0, 10);

/** Upsert today's usage row for one school. Run daily (cron / `billing snapshot`). */
export async function snapshotTenant(tenant: TenantInfo): Promise<Usage & { subscriptionId: string | null }> {
  const lic = await getLicense(tenant.id);
  const usage = await measureUsage(tenantDb(tenant), lic.subscription?.academicYear ?? null);
  const row = { tenantId: tenant.id, subscriptionId: lic.subscription?.id ?? null, snapshotDate: today(), ...usage };
  await controlDb()
    .insert(usageSnapshots)
    .values(row)
    .onConflictDoUpdate({ target: [usageSnapshots.tenantId, usageSnapshots.snapshotDate], set: { ...usage, subscriptionId: row.subscriptionId, takenAt: new Date() } });
  return { ...usage, subscriptionId: row.subscriptionId };
}

export async function snapshotAllTenants(): Promise<{ code: string; ok: boolean; billableStudents?: number; error?: string }[]> {
  const { tenantByCode } = await import('../tenancy/registry');
  const list = await controlDb().select({ code: tenants.code }).from(tenants).where(eq(tenants.status, 'active'));
  const out: { code: string; ok: boolean; billableStudents?: number; error?: string }[] = [];
  for (const { code } of list) {
    try {
      const t = await tenantByCode(code);
      if (!t) continue;
      const u = await snapshotTenant(t);
      out.push({ code, ok: true, billableStudents: u.billableStudents });
    } catch (e) {
      out.push({ code, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}

export async function peakBillable(subscriptionId: string): Promise<number> {
  const [r] = await controlDb()
    .select({ n: sql<number>`coalesce(max(${usageSnapshots.billableStudents}), 0)::int` })
    .from(usageSnapshots)
    .where(eq(usageSnapshots.subscriptionId, subscriptionId));
  return r?.n ?? 0;
}

