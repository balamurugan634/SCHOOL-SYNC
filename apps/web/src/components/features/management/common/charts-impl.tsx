'use client';

import * as React from 'react';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { chartGrid, chartTick, useDrawOnce, type ChartConfig } from '@/components/ui/chart';
import { chartTooltip, ChartContainer } from '@/components/ui/chart-recharts';
import type { BarSeriesDef } from './charts';

/** Grouped (or stacked) bars with 2+ series. Always render inside <ChartCard legend={…}> so there is a legend, a table view and a text summary. */
export function MultiBarSeries({
  data,
  xKey,
  series,
  height,
  horizontal,
  stacked,
  xFormat,
  tooltipLabel,
  yFormat,
  valueFormat,
  yWidth,
  label,
}: {
  data: Record<string, unknown>[];
  xKey: string;
  series: BarSeriesDef[];
  height: number;
  horizontal?: boolean;
  stacked?: boolean;
  xFormat?: (v: string | number) => string;
  tooltipLabel?: (v: string | number) => string;
  yFormat?: (v: number) => string;
  valueFormat?: (v: number) => string;
  yWidth?: number;
  label: string;
}) {
  const config: ChartConfig = Object.fromEntries(series.map((s) => [s.key, { label: s.label, color: s.color }]));
  const draw = useDrawOnce();
  return (
    <ChartContainer config={config} height={height} label={label}>
      <BarChart data={data} layout={horizontal ? 'vertical' : 'horizontal'} margin={{ top: 8, right: 12, bottom: 0, left: 0 }} barCategoryGap={horizontal ? '28%' : '22%'} barGap={2} accessibilityLayer>
        <CartesianGrid {...chartGrid} horizontal={!horizontal} vertical={!!horizontal} />
        {horizontal ? (
          <>
            <XAxis type="number" tick={chartTick} tickLine={false} axisLine={false} tickFormatter={yFormat} />
            <YAxis type="category" dataKey={xKey} tick={chartTick} tickLine={false} axisLine={{ stroke: 'var(--border)' }} width={yWidth ?? 96} />
          </>
        ) : (
          <>
            <XAxis dataKey={xKey} tick={chartTick} tickLine={false} axisLine={{ stroke: 'var(--border)' }} tickFormatter={xFormat} tickMargin={8} />
            <YAxis tick={chartTick} tickLine={false} axisLine={false} width={yWidth ?? 56} tickFormatter={yFormat} />
          </>
        )}
        {chartTooltip(config, { valueFormatter: (v) => (valueFormat ?? yFormat)?.(v) ?? v.toLocaleString(), labelFormatter: (l) => (tooltipLabel ? tooltipLabel(l as string | number) : xFormat ? xFormat(l as string | number) : String(l)) })}
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            fill={s.color}
            stackId={stacked ? 'a' : undefined}
            stroke={stacked ? 'var(--surface)' : undefined}
            strokeWidth={stacked ? 2 : 0}
            radius={stacked ? (i === series.length - 1 ? (horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]) : 0) : horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
            maxBarSize={horizontal ? 18 : 28}
            isAnimationActive={draw.active}
            animationDuration={draw.duration}
            animationEasing="ease-out"
          />
        ))}
      </BarChart>
    </ChartContainer>
  );
}
