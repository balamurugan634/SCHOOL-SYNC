'use client';

import * as React from 'react';
import { m } from 'motion/react';

const seen = new Set<string>();

/** True only the first time a screen mounts in this browser session (dashboard "first load only" stagger). */
export function useFirstLoad(key: string): boolean {
  const [first] = React.useState(() => !seen.has(key));
  React.useEffect(() => {
    seen.add(key);
  }, [key]);
  return first;
}

/** ≤ 6 items × 40 ms, 200 ms fade + 8 px rise. Reduced-motion: opacity only (MotionConfig). */
export function Reveal({ index = 0, first, className, children }: { index?: number; first: boolean; className?: string; children: React.ReactNode }) {
  if (!first) return <div className={className}>{children}</div>;
  return (
    <m.div className={className} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: Math.min(index, 5) * 0.04, ease: [0.2, 0, 0, 1] }}>
      {children}
    </m.div>
  );
}
