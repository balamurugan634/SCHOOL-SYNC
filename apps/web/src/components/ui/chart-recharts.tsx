'use client';

import * as React from 'react';
import { ResponsiveContainer, Tooltip } from 'recharts';
import { cn } from '@/lib/cn';
import { ChartTooltipContent, type ChartConfig } from './chart';

/** Fixed-height wrapper (no layout shift); exposes each series colour as `--color-<key>`. */
export function ChartContainer({ config, height, className, children, label }: { config: ChartConfig; height: number; className?: string; children: React.ReactElement; label: string }) {
  const style = { height, ...Object.fromEntries(Object.entries(config).map(([k, v]) => [`--color-${k}`, v.color])) } as React.CSSProperties;
  return (
    <div className={cn('w-full [&_.recharts-surface]:outline-none', className)} style={style} role="group" aria-label={label}>
      <ResponsiveContainer width="100%" height={height} initialDimension={{ width: 320, height }}>
        {children}
      </ResponsiveContainer>
    </div>
  );
}

export function chartTooltip(config: ChartConfig, opts?: { valueFormatter?: (v: number, key: string) => string; labelFormatter?: (l: string | number) => string }) {
  return <Tooltip cursor={{ stroke: 'var(--border-strong)', fill: 'var(--surface-subtle)', fillOpacity: 0.6 }} content={<ChartTooltipContent config={config} {...opts} />} />;
}
