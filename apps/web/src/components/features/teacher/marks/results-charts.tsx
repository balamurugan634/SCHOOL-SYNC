'use client';

import type * as React from 'react';
import { lazyChart } from '@/components/charts/lazy-chart';
import type { ChartConfig } from '@/components/ui/chart';
import type { ClassBars as ClassBarsImpl, RankedBars as RankedBarsImpl } from './results-charts-impl';

/** Two series side by side per class: average (--chart-1) and pass rate (--chart-3), fixed palette order, legend supplied by `ChartCard`. */
export const CLASS_CONFIG: ChartConfig = {
  average: { label: 'Average %', color: 'var(--chart-1)' },
  pass: { label: 'Pass rate %', color: 'var(--chart-3)' },
};

export const RankedBars = lazyChart<React.ComponentProps<typeof RankedBarsImpl>>(() => import('./results-charts-impl').then((m) => m.RankedBars));
export const ClassBars = lazyChart<React.ComponentProps<typeof ClassBarsImpl>>(() => import('./results-charts-impl').then((m) => m.ClassBars));
