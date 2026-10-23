'use client';

import * as React from 'react';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { chartGrid, chartTick, useDrawOnce, type ChartConfig } from '@/components/ui/chart';
import { chartTooltip, ChartContainer } from '@/components/ui/chart-recharts';
import { CLASS_CONFIG } from './results-charts';

const pct = (v: number) => `${Math.round(v * 10) / 10}%`;

/**
 * Ranked horizontal bars (0–100 %) with room for long category labels ("Mathematics 8B").
 * Single series → `--brand` (design.md §10); 4 px rounded data end, baseline-anchored, no per-bar labels.
 */
export function RankedBars({ data, label, height, labelWidth = 132 }: { data: { label: string; value: number }[]; label: string; height: number; labelWidth?: number }) {
  const config: ChartConfig = { value: { label, color: 'var(--brand)' } };
  const draw = useDrawOnce();
  return (
    <ChartContainer config={config} height={height} label={`${label} chart`}>
      <BarChart data={data} layout="vertical" margin={{ top: 8, right: 16, bottom: 0, left: 0 }} barCategoryGap="28%" accessibilityLayer>
        <CartesianGrid {...chartGrid} horizontal={false} vertical />
        <XAxis type="number" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tick={chartTick} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} />
        <YAxis type="category" dataKey="label" tick={chartTick} tickLine={false} axisLine={{ stroke: 'var(--border)' }} width={labelWidth} interval={0} />
        {chartTooltip(config, { valueFormatter: (v) => pct(v) })}
        <Bar dataKey="value" fill="var(--brand)" radius={[0, 4, 4, 0]} maxBarSize={22} isAnimationActive={draw.active} animationDuration={draw.duration} animationEasing="ease-out" />
      </BarChart>
    </ChartContainer>
  );
}

export function ClassBars({ data, height }: { data: { label: string; average: number | null; pass: number | null }[]; height: number }) {
  const draw = useDrawOnce();
  return (
    <ChartContainer config={CLASS_CONFIG} height={height} label="Class average and pass rate chart">
      <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }} barCategoryGap="24%" barGap={2} accessibilityLayer>
        <CartesianGrid {...chartGrid} vertical={false} />
        <XAxis dataKey="label" tick={chartTick} tickLine={false} axisLine={{ stroke: 'var(--border)' }} tickMargin={8} interval={0} />
        <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tick={chartTick} tickLine={false} axisLine={false} width={44} tickFormatter={(v) => `${v}%`} />
        {chartTooltip(CLASS_CONFIG, { valueFormatter: (v) => pct(v) })}
        <Bar dataKey="average" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={draw.active} animationDuration={draw.duration} animationEasing="ease-out" />
        <Bar dataKey="pass" fill="var(--chart-3)" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={draw.active} animationDuration={draw.duration} animationEasing="ease-out" />
      </BarChart>
    </ChartContainer>
  );
}
