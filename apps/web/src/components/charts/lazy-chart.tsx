'use client';

import * as React from 'react';
import { Skeleton } from '../ui/skeleton';

/**
 * Loads a chart implementation (and recharts with it) after the screen's first paint instead of in its initial bundle.
 * A skeleton of the chart's own height holds the space, so nothing shifts when the chart arrives.
 */
export function lazyChart<P extends { height: number }>(load: () => Promise<React.ComponentType<P>>): React.ComponentType<P> {
  const Lazy = React.lazy(async () => ({ default: await load() }));
  return function LazyChart(props: P) {
    return (
      <React.Suspense fallback={<Skeleton className="w-full" style={{ height: props.height }} />}>
        {React.createElement(Lazy as React.ComponentType<P>, props)}
      </React.Suspense>
    );
  };
}
