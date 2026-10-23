import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { settings } from '../db/tenant/schema';
import type { Executor } from './tenancy/pools';

/** Typed, defaulted school settings stored as JSON rows in `settings`. Add new groups here. */
export const SETTING_DEFS = {
  attendance: z.object({
    mode: z.enum(['daily', 'period']).default('daily'),
    shortagePercent: z.number().min(0).max(100).default(75),
    notifyParentsOnAbsent: z.boolean().default(true),
    /** teachers may edit their own submitted attendance for this long; afterwards a correction request is required */
    editWindowHours: z.number().min(0).max(168).default(24),
    /** approved student leave automatically marks attendance as `leave` */
    leaveMarksAttendance: z.boolean().default(true),
  }),
  academic: z.object({
    /** ISO weekdays (1=Mon) that are school days */
    workingDays: z.array(z.number().int().min(1).max(7)).default([1, 2, 3, 4, 5, 6]),
  }),
  school: z.object({
    address: z.string().default(''),
    phone: z.string().default(''),
    email: z.string().default(''),
    website: z.string().default(''),
    affiliation: z.string().default(''),
  }),
  exams: z.object({
    /** marks reach students only after principal approval + publish */
    requireApproval: z.boolean().default(true),
  }),
  fees: z.object({
    lateFeePerDayMinor: z.number().int().min(0).default(0),
    receiptPrefix: z.string().default('RCT'),
    invoicePrefix: z.string().default('INV'),
    parentsCanPayOnline: z.boolean().default(false),
    /** expenses above this amount (minor units) are created `pending` and need `expenses:approve`; 0 = approve every expense */
    expenseApprovalThresholdMinor: z.number().int().min(0).default(1_000_000),
  }),
  library: z.object({
    /** default loan period for students, in days */
    loanDays: z.number().int().min(1).max(365).default(14),
    /** default loan period for staff */
    staffLoanDays: z.number().int().min(1).max(365).default(30),
    /** overdue fine per day, minor units (paise); 0 = no fines */
    finePerDayMinor: z.number().int().min(0).default(100),
    maxLoansPerStudent: z.number().int().min(1).max(50).default(3),
    maxLoansPerStaff: z.number().int().min(1).max(50).default(5),
  }),
  notifications: z.object({
    quietFrom: z.string().default('21:00'),
    quietTo: z.string().default('07:00'),
    /** push bodies for these categories are replaced with a generic line (privacy on lock screens) */
    privateCategories: z.array(z.string()).default(['fees', 'marks', 'meeting', 'leave']),
  }),
} as const;

export type SettingKey = keyof typeof SETTING_DEFS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTING_DEFS)[K]>;

export async function getSetting<K extends SettingKey>(db: Executor, key: K): Promise<SettingValue<K>> {
  const [row] = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
  return SETTING_DEFS[key].parse(row?.value ?? {}) as SettingValue<K>;
}

export async function putSetting<K extends SettingKey>(db: Executor, key: K, value: Partial<SettingValue<K>>, userId?: string): Promise<SettingValue<K>> {
  const current = await getSetting(db, key);
  const next = SETTING_DEFS[key].parse({ ...current, ...value }) as SettingValue<K>;
  await db
    .insert(settings)
    .values({ key, value: next, updatedBy: userId ?? null })
    .onConflictDoUpdate({ target: settings.key, set: { value: next, updatedBy: userId ?? null, updatedAt: new Date() } });
  return next;
}
