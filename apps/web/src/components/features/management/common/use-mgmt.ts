'use client';

import * as React from 'react';
import type { PermissionKey, Scope } from '@school-sync/shared';
import { useMeContext, usePermissions } from '@/components/me-context';
import { useSite } from '@/components/site-context';
import { useReadOnly } from '@/lib/client/readonly-store';
import { money as fmtMoney, moneyCompact as fmtMoneyCompact } from '@/lib/format';

/**
 * What a management screen needs to decide what to enable: permissions (UI only; the API enforces), the school's
 * read-only state (a lapsed subscription refuses every write with 402), currency and timezone.
 */
export function useMgmt() {
  const site = useSite();
  const { can, canAny } = usePermissions();
  const { me, base } = useMeContext();
  const readOnly = useReadOnly(site?.readOnly ?? false);
  const currency = site?.currency ?? 'INR';
  const tz = site?.timezone ?? 'Asia/Kolkata';
  return React.useMemo(() => {
    const writeBlock = (perm: PermissionKey | PermissionKey[], min?: Scope): string | null => {
      const perms = Array.isArray(perm) ? perm : [perm];
      if (readOnly) return 'The school is in read-only mode, so changes are switched off until the subscription is renewed.';
      if (!perms.some((p) => can(p, min))) return 'Your role does not include this action.';
      return null;
    };
    return {
      me,
      base,
      site,
      can,
      canAny,
      readOnly,
      currency,
      tz,
      features: site?.features,
      /** null when allowed, otherwise the reason it is switched off (shown as a tooltip on the disabled control) */
      writeBlock,
      canWrite: (perm: PermissionKey | PermissionKey[], min?: Scope) => writeBlock(perm, min) === null,
      money: (minor: number) => fmtMoney(minor, currency),
      moneyCompact: (minor: number) => fmtMoneyCompact(minor, currency),
    };
  }, [site, can, canAny, me, base, readOnly, currency, tz]);
}
