import type { PermissionKey, Scope } from '@school-sync/shared';
import { NoAccess } from '@/components/dashboard/coming-online';
import { can } from '@/lib/permissions';
import { requireMe } from '@/lib/server/session';

/**
 * Server-side page gate: renders <NoAccess/> unless the signed-in user holds ANY of the permissions.
 * (UI gating only — every API call is enforced again by the API.)
 *   export default function Page() { return <Gate perm="students:view"><StudentsPage/></Gate>; }
 */
export async function Gate({ perm, min, children }: { perm: PermissionKey | PermissionKey[]; min?: Scope; children: React.ReactNode }) {
  const me = await requireMe();
  const perms = Array.isArray(perm) ? perm : [perm];
  if (!perms.some((p) => can(me.permissions, p, min))) return <NoAccess />;
  return <>{children}</>;
}
