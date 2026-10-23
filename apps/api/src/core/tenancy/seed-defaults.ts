import { eq } from 'drizzle-orm';
import { ROLE_PRESETS, SYSTEM_ROLE_KEYS } from '@school-sync/shared';
import { academicYears, gradeScaleBands, gradeScales, periods, rolePermissions, roles, terms } from '../../db/tenant/schema';
import { putSetting } from '../settings';
import type { Executor } from './pools';

/**
 * Insert system roles and any *missing* preset permissions. Never removes or downgrades rows, so a school's
 * customisations survive upgrades while new permissions introduced by a release are added.
 */
export async function syncSystemRoles(db: Executor): Promise<void> {
  for (const key of SYSTEM_ROLE_KEYS) {
    const preset = ROLE_PRESETS[key];
    const [existing] = await db.select({ id: roles.id }).from(roles).where(eq(roles.key, key)).limit(1);
    let roleId = existing?.id;
    if (!roleId) {
      const [created] = await db.insert(roles).values({ key, name: preset.name, description: preset.description, isSystem: true }).returning({ id: roles.id });
      roleId = created!.id;
    }
    const entries = Object.entries(preset.grants) as [string, (typeof rolePermissions.$inferInsert)['scope']][];
    if (entries.length) {
      await db
        .insert(rolePermissions)
        .values(entries.map(([permission, scope]) => ({ roleId: roleId!, permission, scope })))
        .onConflictDoNothing();
    }
  }
}

/** Indian-style April→March academic year containing `today`, e.g. { name: '2026-27', startDate: '2026-04-01', endDate: '2027-03-31' }. */
export function academicYearSpan(today = new Date()): { name: string; startDate: string; endDate: string } {
  const startYear = today.getUTCMonth() >= 3 ? today.getUTCFullYear() : today.getUTCFullYear() - 1;
  return { name: `${startYear}-${String(startYear + 1).slice(2)}`, startDate: `${startYear}-04-01`, endDate: `${startYear + 1}-03-31` };
}

/** Idempotent first-run defaults: roles, grade scale, periods, current academic year, settings. */
export async function seedTenantDefaults(db: Executor, opts: { schoolName: string; today?: Date }): Promise<void> {
  await syncSystemRoles(db);

  const [hasScale] = await db.select({ id: gradeScales.id }).from(gradeScales).limit(1);
  if (!hasScale) {
    const [scale] = await db.insert(gradeScales).values({ name: 'Standard (percentage)', isDefault: true }).returning({ id: gradeScales.id });
    const bands: [string, number, number, number, string][] = [
      ['A+', 90, 100, 10, 'Outstanding'],
      ['A', 80, 89.99, 9, 'Excellent'],
      ['B+', 70, 79.99, 8, 'Very good'],
      ['B', 60, 69.99, 7, 'Good'],
      ['C', 50, 59.99, 6, 'Satisfactory'],
      ['D', 35, 49.99, 5, 'Needs improvement'],
      ['F', 0, 34.99, 0, 'Fail'],
    ];
    await db.insert(gradeScaleBands).values(bands.map(([label, minPercent, maxPercent, gradePoint, remark]) => ({ scaleId: scale!.id, label, minPercent, maxPercent, gradePoint, remark })));
  }

  const [hasPeriods] = await db.select({ id: periods.id }).from(periods).limit(1);
  if (!hasPeriods) {
    const rows: [string, string, string, boolean][] = [
      ['Period 1', '08:30', '09:15', false],
      ['Period 2', '09:15', '10:00', false],
      ['Short break', '10:00', '10:15', true],
      ['Period 3', '10:15', '11:00', false],
      ['Period 4', '11:00', '11:45', false],
      ['Lunch', '11:45', '12:30', true],
      ['Period 5', '12:30', '13:15', false],
      ['Period 6', '13:15', '14:00', false],
      ['Period 7', '14:00', '14:45', false],
    ];
    await db.insert(periods).values(rows.map(([name, startTime, endTime, isBreak], i) => ({ name, ordinal: i + 1, startTime, endTime, isBreak })));
  }

  const [hasYear] = await db.select({ id: academicYears.id }).from(academicYears).limit(1);
  if (!hasYear) {
    const span = academicYearSpan(opts.today);
    const startYear = Number(span.startDate.slice(0, 4));
    const [year] = await db
      .insert(academicYears)
      .values({ ...span, isCurrent: true })
      .returning({ id: academicYears.id });
    await db.insert(terms).values([
      { academicYearId: year!.id, name: 'Term 1', ordinal: 1, startDate: `${startYear}-04-01`, endDate: `${startYear}-09-30` },
      { academicYearId: year!.id, name: 'Term 2', ordinal: 2, startDate: `${startYear}-10-01`, endDate: `${startYear + 1}-03-31` },
    ]);
  }

  await putSetting(db, 'school', { address: '' });
  await putSetting(db, 'attendance', {});
  await putSetting(db, 'academic', {});
  await putSetting(db, 'exams', {});
  await putSetting(db, 'fees', {});
  await putSetting(db, 'notifications', {});
}
