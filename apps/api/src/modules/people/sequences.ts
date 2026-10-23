import { sql } from 'drizzle-orm';
import { academicYears, counters, staff, students } from '../../db/tenant/schema';
import type { Executor } from '../../core/tenancy/pools';
import { todayIn } from '../../core/http';
import type { TenantInfo } from '../../core/tenancy/registry';
import { eq } from 'drizzle-orm';

/**
 * Atomically reserve `count` consecutive numbers from the named sequence (row in `counters`) and return the FIRST one.
 * Run inside the same transaction that uses the numbers, so a rollback gives them back (no gaps, no duplicates).
 * `floor` is consulted only the first time a sequence is used: it must return the highest number already issued by
 * other means (e.g. rows created by the demo seed or an import), so the counter continues after them.
 */
export async function nextSequence(db: Executor, key: string, opts: { count?: number; floor?: () => Promise<number> } = {}): Promise<number> {
  const count = Math.max(1, opts.count ?? 1);
  const [row] = await db
    .insert(counters)
    .values({ key, value: count })
    .onConflictDoUpdate({ target: counters.key, set: { value: sql`${counters.value} + ${count}` } })
    .returning({ value: counters.value, inserted: sql<boolean>`(xmax = 0)` });
  let start = row!.value - count + 1;
  if (row!.inserted && opts.floor) {
    const floor = await opts.floor();
    if (floor >= start) {
      start = floor + 1;
      await db.update(counters).set({ value: floor + count }).where(eq(counters.key, key));
    }
  }
  return start;
}

/** Letters used in admission numbers: initials of the first two words of the school name ("Green Valley Public School" → GV). */
export function schoolPrefix(tenant: Pick<TenantInfo, 'name' | 'branding' | 'code'>): string {
  const base = (tenant.branding.shortName || tenant.name || tenant.code).replace(/[^A-Za-z\s]/g, ' ').trim();
  const words = base.split(/\s+/).filter(Boolean);
  const p = words.length >= 2 ? words.slice(0, 2).map((w) => w[0]).join('') : (words[0] ?? 'SS').slice(0, 3);
  return p.toUpperCase().padEnd(2, 'X');
}

/** Calendar year in which the current academic year starts (falls back to this year). */
export async function currentYearStart(db: Executor, tenant: Pick<TenantInfo, 'timezone'>): Promise<number> {
  const [y] = await db.select({ startDate: academicYears.startDate }).from(academicYears).where(eq(academicYears.isCurrent, true)).limit(1);
  return Number((y?.startDate ?? todayIn(tenant.timezone)).slice(0, 4));
}

const maxSuffix = async (db: Executor, table: typeof students.admissionNo | typeof staff.employeeId, prefix: string): Promise<number> => {
  const r = await db.execute(sql`select coalesce(max(nullif(regexp_replace(substring(${table} from ${prefix.length + 1}), '\D', '', 'g'), '')::bigint), 0)::float8 as m from ${table.table} where ${table} like ${`${prefix}%`}`);
  return Number((r.rows[0] as { m: number } | undefined)?.m ?? 0);
};

/** Reserve `count` admission numbers like GV20260123 (school initials + academic-year start + 4-digit sequence). */
export async function nextAdmissionNumbers(db: Executor, tenant: TenantInfo, count = 1): Promise<string[]> {
  const prefix = `${schoolPrefix(tenant)}${await currentYearStart(db, tenant)}`;
  for (let attempt = 0; attempt < 5; attempt++) {
    const first = await nextSequence(db, `admission_no:${prefix}`, { count, floor: () => maxSuffix(db, students.admissionNo, prefix) });
    const numbers = Array.from({ length: count }, (_, i) => `${prefix}${String(first + i).padStart(4, '0')}`);
    // belt and braces: never hand out a number somebody typed in by hand
    const clash = await db.execute(sql`select 1 from ${students} where ${students.admissionNo} in (${sql.join(numbers.map((n) => sql`${n}`), sql`, `)}) limit 1`);
    if (!clash.rows.length) return numbers;
  }
  throw new Error('Could not allocate admission numbers');
}

/** Reserve the next employee id (EMP216 …). */
export async function nextEmployeeId(db: Executor): Promise<string> {
  const n = await nextSequence(db, 'employee_id', { floor: () => maxSuffix(db, staff.employeeId, 'EMP') });
  return `EMP${n}`;
}

/** Reserve the next admission application number (APP-2026-0007). */
export async function nextApplicationNo(db: Executor, tenant: TenantInfo): Promise<string> {
  const year = await currentYearStart(db, tenant);
  const n = await nextSequence(db, `application_no:${year}`);
  return `APP-${year}-${String(n).padStart(4, '0')}`;
}
