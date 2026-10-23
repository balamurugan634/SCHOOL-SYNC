'use client';

import type * as React from 'react';
import { lazyChart } from './lazy-chart';
import type { BarSeries as BarImpl, LineSeries as LineImpl } from './series-charts-impl';

/** Single-series line and bar charts. The implementation (and recharts) loads after first paint: see lazy-chart.tsx. */
export const LineSeries = lazyChart<React.ComponentProps<typeof LineImpl>>(() => import('./series-charts-impl').then((m) => m.LineSeries));
export const BarSeries = lazyChart<React.ComponentProps<typeof BarImpl>>(() => import('./series-charts-impl').then((m) => m.BarSeries));
