'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

type Primitive = string | number | boolean;
export type UrlDefaults = Record<string, Primitive>;
export type UrlPatch<D> = { [K in keyof D]?: D[K] | undefined };

/**
 * Filters, sort, page and tab kept in the query string so a screen can be deep-linked and survives a reload.
 * Types follow the defaults (number / boolean / string); a value equal to its default is left out of the URL;
 * changing anything except `page` resets `page` to 1. Params that are not in `defaults` are preserved.
 */
export function useUrlState<D extends UrlDefaults>(defaults: D) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const defaultsKey = JSON.stringify(defaults);
  const defs = React.useMemo(() => JSON.parse(defaultsKey) as D, [defaultsKey]);
  const spKey = sp.toString();

  const value = React.useMemo(() => {
    const p = new URLSearchParams(spKey);
    const out: Record<string, Primitive> = {};
    for (const [k, d] of Object.entries(defs)) {
      const raw = p.get(k);
      if (raw === null) out[k] = d;
      else if (typeof d === 'number') {
        const n = Number(raw);
        out[k] = Number.isFinite(n) ? n : d;
      } else if (typeof d === 'boolean') out[k] = raw === 'true' || raw === '1';
      else out[k] = raw;
    }
    return out as D;
  }, [spKey, defs]);

  const set = React.useCallback(
    (patch: UrlPatch<D>, opts?: { push?: boolean }) => {
      const p = new URLSearchParams(window.location.search);
      for (const [k, v] of Object.entries(patch)) {
        const d = defs[k];
        if (v === undefined || v === d || v === '') p.delete(k);
        else p.set(k, String(v));
      }
      if (!('page' in patch) && 'page' in defs) p.delete('page');
      const qs = p.toString();
      const url = qs ? `${pathname}?${qs}` : pathname;
      if (opts?.push) router.push(url, { scroll: false });
      else router.replace(url, { scroll: false });
    },
    [pathname, router, defs],
  );

  const reset = React.useCallback(
    (keys?: (keyof D)[]) => {
      const p = new URLSearchParams(window.location.search);
      for (const k of keys ?? (Object.keys(defs) as (keyof D)[])) p.delete(String(k));
      const qs = p.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, defs],
  );

  return [value, set, reset] as const;
}

/** A value that follows `value` after `delay` ms of quiet (search boxes). */
export function useDebounced<T>(value: T, delay = 300): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}
