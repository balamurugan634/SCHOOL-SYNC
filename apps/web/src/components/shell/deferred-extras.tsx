'use client';

import * as React from 'react';
import type { Experience } from '@/lib/experience';

const CommandMenu = React.lazy(() => import('./command-menu').then((m) => ({ default: m.CommandMenu })));
const WelcomeTour = React.lazy(() => import('./tour').then((m) => ({ default: m.WelcomeTour })));

/** True once the browser has nothing better to do (or after a short wait): these pieces are not needed for the first paint. */
function useAfterIdle(timeoutMs = 1500): boolean {
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (h: number) => void };
    if (w.requestIdleCallback) {
      const h = w.requestIdleCallback(() => setReady(true), { timeout: timeoutMs });
      return () => w.cancelIdleCallback?.(h);
    }
    const t = window.setTimeout(() => setReady(true), 300);
    return () => window.clearTimeout(t);
  }, [timeoutMs]);
  return ready;
}

/** ⌘K palette and first-login tour: loaded after the page is interactive, in their own chunks. */
export function DeferredShellExtras({ experience }: { experience: Experience }) {
  const ready = useAfterIdle();
  if (!ready) return null;
  return (
    <React.Suspense fallback={null}>
      <CommandMenu />
      <WelcomeTour experience={experience} />
    </React.Suspense>
  );
}
