'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

/** Read / write the query string without scrolling or adding history entries (filters, page, tab live in the URL). */
export function useUrlParams() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const spString = sp.toString();
  const get = React.useCallback((k: string): string | null => new URLSearchParams(spString).get(k), [spString]);
  const set = React.useCallback(
    (patch: Record<string, string | number | null | undefined>, opts: { push?: boolean } = {}) => {
      const next = new URLSearchParams(spString);
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === undefined || v === '') next.delete(k);
        else next.set(k, String(v));
      }
      const qs = next.toString();
      const url = qs ? `${pathname}?${qs}` : pathname;
      if (opts.push) router.push(url, { scroll: false });
      else router.replace(url, { scroll: false });
    },
    [router, pathname, spString],
  );
  return { get, set, pathname };
}

/** `?tab=` state limited to a known set of values. */
export function useTabParam<T extends string>(allowed: readonly T[], fallback: T, param = 'tab'): [T, (t: T) => void] {
  const { get, set } = useUrlParams();
  const raw = get(param);
  const tab = (allowed as readonly string[]).includes(raw ?? '') ? (raw as T) : fallback;
  const setTab = React.useCallback((t: T) => set({ [param]: t === fallback ? null : t }), [set, param, fallback]);
  return [tab, setTab];
}

/** `?page=` as a positive integer. */
export function usePageParam(param = 'page'): [number, (p: number) => void] {
  const { get, set } = useUrlParams();
  const n = Number(get(param));
  const page = Number.isInteger(n) && n >= 1 ? n : 1;
  return [page, (p) => set({ [param]: p <= 1 ? null : p })];
}

export interface TabDef<T extends string> {
  value: T;
  label: string;
  hidden?: boolean;
}

/** Underline tabs that live in the URL. The caller renders the matching panel itself. */
export function UrlTabs<T extends string>({ tabs, tab, onTab, label }: { tabs: TabDef<T>[]; tab: T; onTab: (t: T) => void; label: string }) {
  return (
    <Tabs value={tab} onValueChange={(v) => onTab(v as T)}>
      <TabsList aria-label={label} className="mb-5">
        {tabs.filter((t) => !t.hidden).map((t) => (
          <TabsTrigger key={t.value} value={t.value}>
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
