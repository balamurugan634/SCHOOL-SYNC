import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import type { AuditActor } from '../../core/audit';
import { invalidatePrincipal, type Principal } from '../../core/rbac/principal';
import type { Executor } from '../../core/tenancy/pools';
import type { TenantInfo } from '../../core/tenancy/registry';
import { guardians, studentGuardians } from '../../db/tenant/schema';

/** What every people service function needs to know about the request. */
export interface PeopleCtx {
  tenant: TenantInfo;
  actor: AuditActor;
  principal: Principal;
}

export const fullName = (first: string | null | undefined, last: string | null | undefined): string => [first, last].filter(Boolean).join(' ');
export const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

/** Drop `undefined` keys (a PATCH body only touches the fields that were sent). */
export function definedOnly<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** Only the keys whose value changed, as { before, after } — keeps audit rows small and readable. */
export function diff(before: Record<string, unknown>, after: Record<string, unknown>): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const k of Object.keys(after)) {
    if (JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null)) {
      b[k] = before[k] ?? null;
      a[k] = after[k] ?? null;
    }
  }
  return { before: b, after: a };
}

/** Drop cached principals after the transaction committed (roles, links or sections changed for these users). */
export function refreshPrincipals(tenantId: string, userIds: (string | null | undefined)[]): void {
  for (const id of new Set(userIds)) if (id) invalidatePrincipal(tenantId, id);
}

/** User ids of every guardian (verified or not) linked to the student — their cached access must be refreshed when the student changes. */
export async function guardianUserIdsOf(db: Executor, studentIds: string[]): Promise<string[]> {
  if (!studentIds.length) return [];
  const rows = await db
    .select({ userId: guardians.userId })
    .from(studentGuardians)
    .innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId))
    .where(and(inArray(studentGuardians.studentId, studentIds), isNotNull(guardians.userId)));
  return rows.map((r) => r.userId!);
}

export const chunk = <T>(rows: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
};
