'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/**
 * Filters / page / sort live in the query string so a screen can be deep-linked and survives reloads.
 * `patch` values of `null` / '' remove a key; pass `resetPage: false` to keep the current page.
 */
export function useUrlState() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const get = React.useCallback((k: string) => sp.get(k) ?? '', [sp]);
  const set = React.useCallback(
    (patch: Record<string, string | number | boolean | null | undefined>, opts: { resetPage?: boolean } = {}) => {
      const n = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === undefined || v === '' || v === false) n.delete(k);
        else n.set(k, String(v));
      }
      if (opts.resetPage !== false && !('page' in patch)) n.delete('page');
      const qs = n.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [sp, router, pathname],
  );
  return { get, set, params: sp };
}
