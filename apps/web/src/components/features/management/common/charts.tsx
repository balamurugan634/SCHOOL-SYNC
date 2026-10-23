'use client';

import type * as React from 'react';
import { lazyChart } from '@/components/charts/lazy-chart';
import type { MultiBarSeries as MultiBarImpl } from './charts-impl';

/** The fixed categorical palette (design.md §2.5): slots are used in order and never cycled. */
export const CHART = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)'] as const;

export interface BarSeriesDef {
  key: string;
  label: string;
  color: string;
}

/** Grouped (or stacked) bars with 2+ series. Always render inside <ChartCard legend={…}> so there is a legend, a table view and a text summary. */
export const MultiBarSeries = lazyChart<React.ComponentProps<typeof MultiBarImpl>>(() => import('./charts-impl').then((m) => m.MultiBarSeries));
