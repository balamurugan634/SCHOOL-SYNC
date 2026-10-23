import type { TenantDb } from '../../core/tenancy/pools';
import type { TenantInfo } from '../../core/tenancy/registry';

export type SeedSize = 'small' | 'full' | 'xl';

export interface SeedStaff {
  id: string;
  userId: string;
  username: string;
  name: string;
}
export interface SeedSection {
  id: string;
  gradeId: string;
  gradeName: string;
  gradeOrdinal: number;
  name: string;
  classTeacherId: string;
}
export interface SeedStudent {
  id: string;
  userId: string;
  admissionNo: string;
  username: string;
  name: string;
  sectionId: string;
  gradeId: string;
  guardianId: string;
  rollNo: number;
}
export interface SeedGuardian {
  id: string;
  userId: string;
  username: string;
  name: string;
  studentIds: string[];
}

/** Everything a module seeder needs; produced by seedFoundation and passed to each module's `seed(ctx)`. */
export interface SeedContext {
  db: TenantDb;
  tenant: TenantInfo;
  size: SeedSize;
  /** deterministic PRNG (same data every run) */
  rng: () => number;
  pick: <T>(arr: readonly T[]) => T;
  int: (min: number, max: number) => number;
  /** today, YYYY-MM-DD (school-local) */
  today: string;
  password: string;
  passwordHash: string;
  yearId: string;
  yearName: string;
  termIds: string[];
  grades: { id: string; name: string; ordinal: number }[];
  subjects: { id: string; code: string; name: string }[];
  sections: SeedSection[];
  teachers: SeedStaff[];
  /** named management staff: principal, office, accounts, hr, librarian, transport */
  staff: Record<string, SeedStaff>;
  students: SeedStudent[];
  guardians: SeedGuardian[];
  assignments: { sectionId: string; subjectId: string; staffId: string }[];
  roleIds: Record<string, string>;
  /** super admin user created at provisioning */
  adminUserId: string;
}

/** Module seeders implement this and are called in order by seedDemo (see ./index.ts). */
export type ModuleSeeder = (ctx: SeedContext) => Promise<void>;
