import { and, desc, eq } from 'drizzle-orm';
import { LRUCache } from 'lru-cache';
import { subscriptions } from '../../db/control/schema';
import { academicYears } from '../../db/tenant/schema';
import { AppError } from '../errors';
import { controlDb } from '../tenancy/control-db';
import type { Executor } from '../tenancy/pools';
import type { TenantInfo } from '../tenancy/registry';
import { countBillableStudents } from './metering';

export type Subscription = typeof subscriptions.$inferSelect;

/**
 * unlicensed  no subscription on file (dev/demo, or onboarding) — unlimited, flagged in platform reports
 * trial|active within the paid/trial period
 * grace       period ended, still inside the renewal window — full access plus warnings
 * expired     past grace — school is READ-ONLY (data stays visible; writes get 402) until renewed
 * cancelled   subscription cancelled — read-only
 */
export type LicenseState = 'unlicensed' | 'trial' | 'active' | 'grace' | 'expired' | 'cancelled';

export interface License {
  state: LicenseState;
  readOnly: boolean;
  subscription: Subscription | null;
  licensedStudents: number | null;
  overagePolicy: 'allow_and_bill' | 'block';
  /** days until the period ends (negative once ended) */
  daysLeft: number | null;
  graceEndsOn: string | null;
}

const MS_DAY = 86_400_000;
const addDays = (isoDate: string, days: number) => new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * MS_DAY).toISOString().slice(0, 10);
const daysBetween = (fromIso: string, toIso: string) => Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / MS_DAY);

export function computeLicense(subs: Subscription[], today: string): License {
  const none: License = { state: 'unlicensed', readOnly: false, subscription: null, licensedStudents: null, overagePolicy: 'allow_and_bill', daysLeft: null, graceEndsOn: null };
  if (!subs.length) return none;
  // the period covering today, else the most recently ended one, else the earliest upcoming
  const covering = subs.find((s) => s.startsOn <= today && today <= s.endsOn);
  const past = subs.filter((s) => s.endsOn < today).sort((a, b) => (a.endsOn < b.endsOn ? 1 : -1))[0];
  const future = subs.filter((s) => s.startsOn > today).sort((a, b) => (a.startsOn < b.startsOn ? -1 : 1))[0];
  const sub = covering ?? past ?? future!;
  const base = { subscription: sub, licensedStudents: sub.licensedStudents, overagePolicy: sub.overagePolicy, daysLeft: daysBetween(today, sub.endsOn), graceEndsOn: addDays(sub.endsOn, sub.graceDays) };
  if (sub.status === 'cancelled') return { ...base, state: 'cancelled', readOnly: true };
  if (sub.startsOn > today || sub.endsOn >= today) return { ...base, state: sub.status === 'trial' ? 'trial' : 'active', readOnly: false };
  if (today <= base.graceEndsOn) return { ...base, state: 'grace', readOnly: false };
  return { ...base, state: 'expired', readOnly: true };
}

const cache = new LRUCache<string, License>({ max: 5000, ttl: 60_000 });
const todayIso = () => new Date().toISOString().slice(0, 10);

export async function getLicense(tenantId: string): Promise<License> {
  const hit = cache.get(tenantId);
  if (hit) return hit;
  const subs = await controlDb().select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId)).orderBy(desc(subscriptions.endsOn)).limit(10);
  const lic = computeLicense(subs, todayIso());
  cache.set(tenantId, lic);
  return lic;
}

export function invalidateLicense(tenantId?: string): void {
  if (tenantId) cache.delete(tenantId);
  else cache.clear();
}

export interface SeatUsage {
  used: number;
  licensed: number | null;
  remaining: number | null;
  /** ≥ 90% of committed seats */
  nearLimit: boolean;
  overBy: number;
}

export async function seatUsage(db: Executor, lic: License): Promise<SeatUsage> {
  const used = lic.subscription ? await countBillableStudents(db, lic.subscription.academicYear) : 0;
  const licensed = lic.licensedStudents;
  return { used, licensed, remaining: licensed == null ? null : Math.max(0, licensed - used), nearLimit: licensed != null && licensed > 0 && used >= licensed * 0.9, overBy: licensed == null ? 0 : Math.max(0, used - licensed) };
}

/**
 * Call BEFORE creating a student enrollment (admission confirm, manual add, CSV import, year-end promotion).
 * `adding` = number of students who do NOT yet have an enrollment in that year.
 * The seats checked are those of `opts.academicYear` — by default the school's current academic year — so promoting
 * into next year is measured against next year's subscription, not this year's.
 * - `block` policy: refuse once the committed seats are used up.
 * - `allow_and_bill`: always allowed; the excess is invoiced as a true-up.
 * - a year with no subscription yet: nothing to enforce (it is billed once the subscription exists).
 */
export async function assertSeatAvailable(tenant: Pick<TenantInfo, 'id'>, db: Executor, adding = 1, opts: { academicYear?: string } = {}): Promise<void> {
  const lic = await getLicense(tenant.id);
  if (lic.readOnly) throw new AppError(402, 'SUBSCRIPTION_EXPIRED', 'This school’s subscription has expired. Renew to add students.');
  if (adding <= 0) return;

  let year = opts.academicYear;
  if (!year) {
    const [cur] = await db.select({ name: academicYears.name }).from(academicYears).where(eq(academicYears.isCurrent, true)).limit(1);
    year = cur?.name ?? lic.subscription?.academicYear;
  }
  let licensed = lic.licensedStudents;
  let policy = lic.overagePolicy;
  if (year && year !== lic.subscription?.academicYear) {
    const [sub] = await controlDb().select().from(subscriptions).where(and(eq(subscriptions.tenantId, tenant.id), eq(subscriptions.academicYear, year))).limit(1);
    if (!sub) return;
    if (sub.status === 'cancelled') throw new AppError(402, 'SUBSCRIPTION_EXPIRED', `The subscription for ${year} is cancelled.`);
    licensed = sub.licensedStudents;
    policy = sub.overagePolicy;
  }
  if (!year || licensed == null || policy !== 'block') return;
  const used = await countBillableStudents(db, year);
  if (used + adding > licensed) {
    throw new AppError(402, 'LICENSE_LIMIT_REACHED', `Student limit reached (${used}/${licensed} for ${year}). Contact support to add seats.`, { used, licensed });
  }
}
