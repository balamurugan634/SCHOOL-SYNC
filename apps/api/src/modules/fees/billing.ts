import { eq, sql } from 'drizzle-orm';
import type { InvoiceStatus } from '@school-sync/shared';
import { addDaysIso } from '../../core/http';
import type { Executor } from '../../core/tenancy/pools';
import { academicYears, counters } from '../../db/tenant/schema';

/** Pure money rules shared by invoices, payments and reports. All amounts are integer minor units. */

const MS_DAY = 86_400_000;
export const daysBetween = (fromIso: string, toIso: string): number => Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / MS_DAY);
export { addDaysIso };

export interface InvoiceMoney {
  status: InvoiceStatus;
  dueDate: string;
  totalMinor: number;
  discountMinor: number;
  paidMinor: number;
}

export function invoiceMath(inv: InvoiceMoney, today: string, lateFeePerDayMinor: number) {
  const payable = inv.totalMinor - inv.discountMinor;
  const open = inv.status === 'unpaid' || inv.status === 'partial';
  const balanceMinor = inv.status === 'void' ? 0 : Math.max(0, payable - inv.paidMinor);
  const daysOverdue = open && balanceMinor > 0 && inv.dueDate < today ? daysBetween(inv.dueDate, today) : 0;
  const lateFeeMinor = daysOverdue * lateFeePerDayMinor;
  return { payableMinor: payable, balanceMinor, overdue: daysOverdue > 0, daysOverdue, lateFeeMinor, amountDueNowMinor: balanceMinor + lateFeeMinor };
}

/** unpaid / partial / paid from the running totals (void stays void). */
export function statusFor(inv: { status: InvoiceStatus; totalMinor: number; discountMinor: number }, paidMinor: number): InvoiceStatus {
  if (inv.status === 'void') return 'void';
  const payable = inv.totalMinor - inv.discountMinor;
  if (paidMinor >= payable) return 'paid';
  return paidMinor > 0 ? 'partial' : 'unpaid';
}

/**
 * Atomically reserve `n` consecutive numbers of a sequence (gap-tolerant) and return the first one.
 * Concurrent callers serialise on the counter row, so numbers never repeat.
 */
export async function reserveNumbers(tx: Executor, key: string, n = 1): Promise<number> {
  const [row] = await tx
    .insert(counters)
    .values({ key, value: n })
    .onConflictDoUpdate({ target: counters.key, set: { value: sql`${counters.value} + ${n}` } })
    .returning({ value: counters.value });
  return (row?.value ?? n) - n + 1;
}

export const formatNumber = (prefix: string, yearStart: string, seq: number): string => `${prefix}-${yearStart}-${String(seq).padStart(6, '0')}`;

/** Four-digit start year ("2026" for "2026-27") of an academic year, used in invoice/receipt numbers. */
export async function yearToken(db: Executor, academicYearId: string): Promise<string> {
  const [y] = await db.select({ start: academicYears.startDate }).from(academicYears).where(eq(academicYears.id, academicYearId)).limit(1);
  return (y?.start ?? new Date().toISOString()).slice(0, 4);
}

export const clampPct = (n: number) => Math.max(0, Math.min(100, n));
