'use client';

import * as React from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import { chartGrid, chartTick, useDrawOnce, type ChartConfig } from '../ui/chart';
import { chartTooltip, ChartContainer } from '../ui/chart-recharts';

/** Single-series line (2 px, ≥ 8 px markers, thin gridlines, recessive axes). Colour = --brand. */
export function LineSeries({ data, xKey, yKey, label, height, xFormat, tooltipLabel, yFormat, valueFormat, domain, ticks }: { data: Record<string, unknown>[]; xKey: string; yKey: string; label: string; height: number; xFormat?: (v: string | number) => string; tooltipLabel?: (v: string | number) => string; yFormat?: (v: number) => string; valueFormat?: (v: number) => string; domain?: [number, number]; ticks?: number[] }) {
  const config: ChartConfig = { [yKey]: { label, color: 'var(--brand)' } };
  const draw = useDrawOnce();
  return (
    <ChartContainer config={config} height={height} label={`${label} chart`}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }} accessibilityLayer>
        <CartesianGrid {...chartGrid} vertical={false} />
        <XAxis dataKey={xKey} tick={chartTick} tickLine={false} axisLine={{ stroke: 'var(--border)' }} tickFormatter={xFormat} tickMargin={8} />
        <YAxis tick={chartTick} tickLine={false} axisLine={false} width={44} tickFormatter={yFormat} domain={domain} ticks={ticks} allowDecimals={false} />
        {chartTooltip(config, { valueFormatter: (v) => (valueFormat ?? yFormat)?.(v) ?? v.toLocaleString(), labelFormatter: (l) => (tooltipLabel ? tooltipLabel(l as string | number) : xFormat ? xFormat(l as string | number) : String(l)) })}
        <Line type="monotone" dataKey={yKey} stroke="var(--brand)" strokeWidth={2} dot={{ r: 4, fill: 'var(--surface)', stroke: 'var(--brand)', strokeWidth: 2 }} activeDot={{ r: 5, fill: 'var(--brand)', stroke: 'var(--surface)', strokeWidth: 2 }} isAnimationActive={draw.active} animationDuration={draw.duration} animationEasing="ease-out" />
      </LineChart>
    </ChartContainer>
  );
}

/** Single-series bars. `horizontal` = ranked bars (category on the Y axis). 4 px rounded data end, baseline-anchored. */
export function BarSeries({ data, xKey, yKey, label, height, horizontal, xFormat, tooltipLabel, yFormat, valueFormat }: { data: Record<string, unknown>[]; xKey: string; yKey: string; label: string; height: number; horizontal?: boolean; xFormat?: (v: string | number) => string; tooltipLabel?: (v: string | number) => string; yFormat?: (v: number) => string; valueFormat?: (v: number) => string }) {
  const config: ChartConfig = { [yKey]: { label, color: 'var(--brand)' } };
  const draw = useDrawOnce();
  return (
    <ChartContainer config={config} height={height} label={`${label} chart`}>
      <BarChart data={data} layout={horizontal ? 'vertical' : 'horizontal'} margin={{ top: 8, right: 12, bottom: 0, left: 0 }} barCategoryGap={horizontal ? '28%' : '24%'} accessibilityLayer>
        <CartesianGrid {...chartGrid} horizontal={!horizontal} vertical={!!horizontal} />
        {horizontal ? (
          <>
            <XAxis type="number" tick={chartTick} tickLine={false} axisLine={false} tickFormatter={yFormat} />
            <YAxis type="category" dataKey={xKey} tick={chartTick} tickLine={false} axisLine={{ stroke: 'var(--border)' }} width={78} />
          </>
        ) : (
          <>
            <XAxis dataKey={xKey} tick={chartTick} tickLine={false} axisLine={{ stroke: 'var(--border)' }} tickFormatter={xFormat} tickMargin={8} />
            <YAxis tick={chartTick} tickLine={false} axisLine={false} width={52} tickFormatter={yFormat} />
          </>
        )}
        {chartTooltip(config, { valueFormatter: (v) => (valueFormat ?? yFormat)?.(v) ?? v.toLocaleString(), labelFormatter: (l) => (tooltipLabel ? tooltipLabel(l as string | number) : xFormat ? xFormat(l as string | number) : String(l)) })}
        <Bar dataKey={yKey} fill="var(--brand)" radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]} maxBarSize={horizontal ? 22 : 36} isAnimationActive={draw.active} animationDuration={draw.duration} animationEasing="ease-out" />
      </BarChart>
    </ChartContainer>
  );
}
