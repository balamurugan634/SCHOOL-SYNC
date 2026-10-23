'use client';

import { useSyncExternalStore } from 'react';

/**
 * "Read-only school" state shared across the UI. Seeded from site info (`readOnly`) and flipped on the fly when
 * any mutation comes back `402 SUBSCRIPTION_EXPIRED`, so the persistent banner appears without a reload.
 */
let readOnly = false;
const listeners = new Set<() => void>();

export const readOnlyStore = {
  set(v: boolean) {
    if (readOnly === v) return;
    readOnly = v;
    listeners.forEach((l) => l());
  },
  get: () => readOnly,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export function useReadOnly(initial = false): boolean {
  return useSyncExternalStore(readOnlyStore.subscribe, () => readOnlyStore.get() || initial, () => initial);
}
