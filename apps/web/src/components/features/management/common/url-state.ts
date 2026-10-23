'use client';

import * as React from 'react';
import { useUrlState } from '@/lib/client/use-url-state';
import { useDebounced } from '@/lib/client/mgmt';

/**
 * URL-persisted list state: page, page size, a debounced search box and arbitrary filters, so every list can be
 * deep-linked and survives a reload. `q` is typed locally and written to the URL after a short pause.
 */
export function useListState(defaults: { pageSize?: number } = {}) {
  const url = useUrlState();
  const defSize = defaults.pageSize ?? 25;
  const page = Math.max(1, Number(url.get('page')) || 1);
  const pageSize = Math.min(100, Math.max(5, Number(url.get('size')) || defSize));
  const urlQ = url.get('q');
  const [qInput, setQInput] = React.useState(urlQ);
  const debounced = useDebounced(qInput, 350);
  const lastUrlQ = React.useRef(urlQ);
  // typed text → URL (after the pause)
  React.useEffect(() => {
    if (debounced !== lastUrlQ.current) {
      lastUrlQ.current = debounced;
      url.set({ q: debounced || null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  // URL → text (back / forward, "clear filters")
  React.useEffect(() => {
    if (urlQ !== lastUrlQ.current) {
      lastUrlQ.current = urlQ;
      setQInput(urlQ);
    }
  }, [urlQ]);
  const sortRaw = url.get('sort');
  const sort = React.useMemo(() => {
    if (!sortRaw) return null;
    const [id, dir] = sortRaw.split(':');
    return id ? { id, dir: dir === 'desc' ? ('desc' as const) : ('asc' as const) } : null;
  }, [sortRaw]);
  return {
    page,
    pageSize,
    q: urlQ,
    qInput,
    setQInput,
    sort,
    setSort: (s: { id: string; dir: 'asc' | 'desc' } | null) => url.set({ sort: s ? `${s.id}:${s.dir}` : null }),
    setPage: (p: number) => url.set({ page: p === 1 ? null : p }, { resetPage: false }),
    setPageSize: (n: number) => url.set({ size: n === defSize ? null : n, page: null }, { resetPage: false }),
    get: url.get,
    set: url.set,
    /** drop every filter and the search text (keeps `tab` / `view`) */
    clear: (keep: string[] = ['tab', 'view']) => {
      const patch: Record<string, null> = {};
      url.params.forEach((_v, k) => {
        if (!keep.includes(k)) patch[k] = null;
      });
      setQInput('');
      lastUrlQ.current = '';
      url.set(patch);
    },
    hasFilters: (keys: string[]) => keys.some((k) => !!url.get(k)) || !!url.get('q'),
  };
}

/** `?tab=` for a tabbed screen; unknown values fall back to the first allowed tab. Switching tabs resets paging and search. */
export function useTabParam(allowed: string[], fallback?: string): [string, (t: string) => void] {
  const url = useUrlState();
  const raw = url.get('tab');
  const first = fallback ?? allowed[0] ?? '';
  const tab = allowed.includes(raw) ? raw : first;
  return [tab, (t: string) => url.set({ tab: t === first ? null : t, page: null, size: null, q: null, sort: null }, { resetPage: false })];
}
