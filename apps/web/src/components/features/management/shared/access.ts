'use client';

import type { PermissionKey, Scope } from '@school-sync/shared';
import { usePermissions } from '@/components/me-context';
import { useSite } from '@/components/site-context';
import { useReadOnly } from '@/lib/client/readonly-store';

/**
 * UI gating for write actions: permission (the API still enforces) AND the school is not in read-only mode (402 SUBSCRIPTION_EXPIRED).
 * `ok(perm)` → show an enabled control; `hint(perm)` → why it is disabled (use as `title` / tooltip text).
 */
export function useAccess() {
  const { can, canAny } = usePermissions();
  const site = useSite();
  const readOnly = useReadOnly(site?.readOnly ?? false);
  return {
    can,
    canAny,
    readOnly,
    ok: (perm: PermissionKey, min?: Scope) => !readOnly && can(perm, min),
    hint: (perm: PermissionKey, min?: Scope): string | undefined => (!can(perm, min) ? 'Your role does not allow this.' : readOnly ? 'The school is in read-only mode until the subscription is renewed.' : undefined),
  };
}
