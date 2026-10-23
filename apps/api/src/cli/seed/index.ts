import { closeAllTenantPools, tenantDb } from '../../core/tenancy/pools';
import { tenantByCode } from '../../core/tenancy/registry';
import { seed as attendance } from './attendance';
import { seed as communication } from './communication';
import { DEMO_PASSWORD, seedFoundation } from './core';
import { seed as exams } from './exams';
import { seed as fees } from './fees';
import { seed as learning } from './learning';
import { seed as operations } from './operations';
import { seed as people } from './people';
import type { SeedContext, SeedSize } from './context';

/** Order matters: later seeders may rely on earlier ones (e.g. exams → fees → communication reference students/sections). */
export const MODULE_SEEDERS: { name: string; seed: (ctx: SeedContext) => Promise<void> }[] = [
  { name: 'people', seed: people },
  { name: 'attendance', seed: attendance },
  { name: 'learning', seed: learning },
  { name: 'exams', seed: exams },
  { name: 'fees', seed: fees },
  { name: 'communication', seed: communication },
  { name: 'operations', seed: operations },
];

export async function seedDemo(siteCode: string, size: SeedSize = 'full'): Promise<SeedContext | null> {
  const tenant = await tenantByCode(siteCode);
  if (!tenant) throw new Error(`Site "${siteCode}" not found`);
  const db = tenantDb(tenant);
  const ctx = await seedFoundation(db, tenant, size);
  if (!ctx) {
    console.log(`Site "${siteCode}" already has data — skipping demo seed.`);
    return null;
  }
  for (const m of MODULE_SEEDERS) {
    const t0 = Date.now();
    await m.seed(ctx);
    console.log(`  ✔ ${m.name} (${Date.now() - t0} ms)`);
  }
  console.log(`\nDemo data ready for "${siteCode}": ${ctx.students.length} students, ${ctx.guardians.length} parents, ${ctx.teachers.length} teachers, ${ctx.sections.length} sections.`);
  console.log(`Logins (password ${DEMO_PASSWORD}):  student ${ctx.students[0]!.username} | parent ${ctx.guardians[0]!.username} | teacher t001 | principal | office | accounts | hr | librarian | transport`);
  return ctx;
}

export { closeAllTenantPools };
