import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { billingInvoices, platformAudit, subscriptions, tenants, usageSnapshots } from '../../db/control/schema';
import { controlDb } from '../tenancy/control-db';
import { invalidateLicense } from './license';
import { peakBillable } from './metering';

type Invoice = typeof billingInvoices.$inferSelect;

/** BIL-<year>-<5 digits>. Uses the highest number already issued for the year (not a row count), so deleting a school can never recycle a number. */
async function nextNumber(year: string): Promise<string> {
  const prefix = `BIL-${year.slice(0, 4)}-`;
  const [r] = await controlDb()
    .select({ n: sql<number>`coalesce(max((regexp_match(${billingInvoices.number}, '([0-9]+)$'))[1]::int), 0)::int` })
    .from(billingInvoices)
    .where(sql`${billingInvoices.number} like ${`${prefix}%`}`);
  return `${prefix}${String((r?.n ?? 0) + 1).padStart(5, '0')}`;
}

/** Committed-seats invoice at the start of the academic year: licensed seats × price per student. */
export async function issueSeatInvoice(subscriptionId: string, dueOn?: string): Promise<Invoice | null> {
  const db = controlDb();
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.id, subscriptionId)).limit(1);
  if (!sub) throw new Error('Subscription not found');
  const students = sub.licensedStudents ?? (await peakBillable(sub.id));
  const amount = students * sub.pricePerStudentMinor;
  if (amount <= 0) return null;
  const [dup] = await db.select({ id: billingInvoices.id }).from(billingInvoices).where(and(eq(billingInvoices.subscriptionId, sub.id), eq(billingInvoices.kind, 'seats'), ne(billingInvoices.status, 'void'))).limit(1);
  if (dup) throw new Error('A seats invoice already exists for this subscription');
  const [inv] = await db
    .insert(billingInvoices)
    .values({ number: await nextNumber(sub.academicYear), tenantId: sub.tenantId, subscriptionId: sub.id, kind: 'seats', students, unitPriceMinor: sub.pricePerStudentMinor, amountMinor: amount, currency: sub.currency, dueOn: dueOn ?? sub.startsOn, notes: `${students} students × ${sub.academicYear}` })
    .returning();
  return inv!;
}

export interface TrueUpPlan {
  /** highest billable-student count metered during the subscription year */
  peak: number;
  /** students already covered by non-void seats and true-up invoices */
  invoiced: number;
  /** students above what has been invoiced: what a true-up would bill now (never negative) */
  extra: number;
}

/** Per subscription: how many students a true-up would bill right now. One batch of two queries, used by the invoice and by the billing overview. */
export async function trueUpPlan(subscriptionIds: string[]): Promise<Map<string, TrueUpPlan>> {
  const out = new Map<string, TrueUpPlan>();
  if (!subscriptionIds.length) return out;
  const db = controlDb();
  const [peaks, billed] = await Promise.all([
    db
      .select({ id: usageSnapshots.subscriptionId, n: sql<number>`coalesce(max(${usageSnapshots.billableStudents}), 0)::int` })
      .from(usageSnapshots)
      .where(inArray(usageSnapshots.subscriptionId, subscriptionIds))
      .groupBy(usageSnapshots.subscriptionId),
    db
      .select({ id: billingInvoices.subscriptionId, n: sql<number>`coalesce(sum(${billingInvoices.students}), 0)::int` })
      .from(billingInvoices)
      .where(and(inArray(billingInvoices.subscriptionId, subscriptionIds), ne(billingInvoices.status, 'void'), sql`${billingInvoices.kind} in ('seats','true_up')`))
      .groupBy(billingInvoices.subscriptionId),
  ]);
  const peakOf = new Map(peaks.map((p) => [p.id, p.n]));
  const billedOf = new Map(billed.map((b) => [b.id, b.n]));
  for (const id of subscriptionIds) {
    const peak = peakOf.get(id) ?? 0;
    const invoiced = billedOf.get(id) ?? 0;
    out.set(id, { peak, invoiced, extra: Math.max(0, peak - invoiced) });
  }
  return out;
}

/** Bill students above what has been invoiced so far (peak billable in the year minus already-invoiced seats). */
export async function issueTrueUp(subscriptionId: string, dueOn?: string): Promise<Invoice | null> {
  const db = controlDb();
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.id, subscriptionId)).limit(1);
  if (!sub) throw new Error('Subscription not found');
  const plan = (await trueUpPlan([sub.id])).get(sub.id)!;
  if (plan.extra <= 0 || sub.pricePerStudentMinor <= 0) return null;
  const [inv] = await db
    .insert(billingInvoices)
    .values({ number: await nextNumber(sub.academicYear), tenantId: sub.tenantId, subscriptionId: sub.id, kind: 'true_up', students: plan.extra, unitPriceMinor: sub.pricePerStudentMinor, amountMinor: plan.extra * sub.pricePerStudentMinor, currency: sub.currency, dueOn: dueOn ?? null, notes: `True-up: peak ${plan.peak} students, ${plan.invoiced} already invoiced` })
    .returning();
  return inv!;
}

export interface SubscriptionInput {
  tenantCode: string;
  academicYear: string;
  startsOn: string;
  endsOn: string;
  /** major units per student (₹150 → 150); stored as minor units */
  pricePerStudent: number;
  licensedStudents?: number | null;
  overagePolicy?: 'allow_and_bill' | 'block';
  graceDays?: number;
  trial?: boolean;
  currency?: string;
  notes?: string;
}

export async function upsertSubscription(input: SubscriptionInput, actor = 'cli') {
  const db = controlDb();
  const [t] = await db.select().from(tenants).where(eq(tenants.code, input.tenantCode.toLowerCase())).limit(1);
  if (!t) throw new Error(`Site "${input.tenantCode}" not found`);
  const values = {
    tenantId: t.id,
    academicYear: input.academicYear,
    startsOn: input.startsOn,
    endsOn: input.endsOn,
    graceDays: input.graceDays ?? 30,
    status: input.trial ? ('trial' as const) : ('active' as const),
    pricePerStudentMinor: Math.round(input.pricePerStudent * 100),
    currency: input.currency ?? t.currency,
    licensedStudents: input.licensedStudents ?? null,
    overagePolicy: input.overagePolicy ?? ('allow_and_bill' as const),
    notes: input.notes ?? null,
  };
  const [sub] = await db
    .insert(subscriptions)
    .values(values)
    .onConflictDoUpdate({ target: [subscriptions.tenantId, subscriptions.academicYear], set: { ...values, updatedAt: new Date() } })
    .returning();
  await db.insert(platformAudit).values({ actor, action: 'subscription.upsert', tenantCode: t.code, detail: { academicYear: input.academicYear, seats: values.licensedStudents, pricePerStudentMinor: values.pricePerStudentMinor } });
  invalidateLicense(t.id);
  return sub!;
}
