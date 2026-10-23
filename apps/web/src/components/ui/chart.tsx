'use client';

import * as React from 'react';
import { BarChart3, Table2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Card, CardBody, CardHeader } from './card';
import { EmptyState } from './empty-state';
import { Skeleton } from './skeleton';

/**
 * Chart plumbing in the shadcn `ChartContainer` pattern (design.md §10).
 * recharts itself lives in chart-recharts.tsx so a screen with a ChartCard does not pay for the library until its chart loads.
 * Colours come ONLY from --chart-1…6 in fixed order (or --brand for a single series); text uses --ink tokens.
 */
export type ChartConfig = Record<string, { label: string; color: string }>;

export const chartTick = { fill: 'var(--ink-3)', fontSize: 12 } as const;
export const chartGrid = { stroke: 'var(--border)', strokeDasharray: '' } as const;

export function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduce(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduce;
}

/** Draws once (400 ms); never replays when data refetches or the tab regains focus. */
export function useDrawOnce(): { active: boolean; duration: number } {
  const reduce = usePrefersReducedMotion();
  const [active, setActive] = React.useState(true);
  React.useEffect(() => {
    const t = setTimeout(() => setActive(false), 700);
    return () => clearTimeout(t);
  }, []);
  return { active: active && !reduce, duration: 400 };
}

interface TipPayload {
  dataKey?: string | number;
  name?: string | number;
  value?: number | string;
  color?: string;
  payload?: Record<string, unknown>;
}

/** Tooltip content: label + one row per series with a swatch (never relies on colour alone — the label is always there). */
export function ChartTooltipContent({ active, payload, label, config, valueFormatter, labelFormatter }: { active?: boolean; payload?: TipPayload[]; label?: string | number; config: ChartConfig; valueFormatter?: (v: number, key: string) => string; labelFormatter?: (l: string | number) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-surface-raised px-3 py-2 shadow-pop">
      {label !== undefined && <p className="t-caption mb-1 font-medium text-ink">{labelFormatter ? labelFormatter(label) : String(label)}</p>}
      <ul className="space-y-0.5">
        {payload.map((p) => {
          const key = String(p.dataKey ?? p.name);
          const c = config[key];
          return (
            <li key={key} className="t-caption flex items-center gap-2">
              <span className="size-2 rounded-[2px]" style={{ background: c?.color ?? p.color }} aria-hidden />
              <span className="text-ink-2">{c?.label ?? key}</span>
              <span className="ml-auto pl-3 font-medium tabular-nums text-ink">{typeof p.value === 'number' ? (valueFormatter ? valueFormatter(p.value, key) : p.value.toLocaleString()) : p.value}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Legend as HTML (always present for ≥ 2 series). */
export function ChartLegend({ config }: { config: ChartConfig }) {
  return (
    <ul className="t-caption mt-3 flex flex-wrap gap-x-4 gap-y-1 text-ink-2" aria-label="Legend">
      {Object.entries(config).map(([k, v]) => (
        <li key={k} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[2px]" style={{ background: v.color }} aria-hidden />
          {v.label}
        </li>
      ))}
    </ul>
  );
}

export interface ChartTable {
  columns: { key: string; label: string; align?: 'left' | 'right'; format?: (v: unknown) => string }[];
  rows: Record<string, unknown>[];
}

/**
 * A card around one chart: title, a text summary (aria-describedby on the chart), a Chart / Table view toggle,
 * a skeleton while loading, an inline error with retry and a plain empty state — all at the same fixed height.
 */
export function ChartCard({
  title,
  description,
  summary,
  height,
  loading,
  error,
  onRetry,
  empty,
  emptyText = 'No data for this period yet.',
  table,
  legend,
  actions,
  children,
  className,
}: {
  title: string;
  description?: string;
  /** one-sentence takeaway; read by screen readers and shown under the chart */
  summary?: string;
  height: number;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  empty?: boolean;
  emptyText?: string;
  table: ChartTable;
  legend?: ChartConfig;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const [view, setView] = React.useState<'chart' | 'table'>('chart');
  const sid = React.useId();
  const tableOn = view === 'table' && !loading && !error && !empty;
  return (
    <Card className={className}>
      <CardHeader
        title={title}
        description={description}
        action={
          <div className="flex items-center gap-2">
            {actions}
            {!loading && !error && !empty && (
              <div className="inline-flex rounded-md border border-border bg-surface-subtle p-0.5" role="group" aria-label="Chart view">
                {([['chart', BarChart3, 'Chart'], ['table', Table2, 'Table']] as const).map(([v, Icon, l]) => (
                  <button key={v} type="button" onClick={() => setView(v)} aria-pressed={view === v} aria-label={`${l} view`} className={cn('tr-colors grid size-7 place-items-center rounded-[6px] sm:size-6', view === v ? 'bg-surface text-ink shadow-[0_0_0_1px_var(--border)]' : 'text-ink-3 hover:text-ink')}>
                    <Icon className="size-3.5" />
                  </button>
                ))}
              </div>
            )}
          </div>
        }
      />
      <CardBody className="pt-4">
        <div style={{ minHeight: height }}>
          {loading ? (
            <Skeleton className="w-full" style={{ height }} />
          ) : error ? (
            <EmptyState compact title="We couldn’t load this chart" description="Check your connection and try again." action={onRetry && <button type="button" onClick={onRetry} className="text-[13px] font-medium text-brand-ink underline-offset-4 hover:underline">Try again</button>} />
          ) : empty ? (
            <EmptyState compact title={emptyText} />
          ) : tableOn ? (
            <div className="overflow-auto rounded-md border border-border" style={{ maxHeight: height }}>
              <table className="t-table w-full">
                <thead>
                  <tr>
                    {table.columns.map((c) => (
                      <th key={c.key} scope="col" className={cn('t-colhead h-9 bg-surface-subtle px-3 text-ink-2', c.align === 'right' ? 'text-right' : 'text-left')}>
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((r, i) => (
                    <tr key={i} className="border-t border-border">
                      {table.columns.map((c) => (
                        <td key={c.key} className={cn('h-9 px-3 tabular-nums', c.align === 'right' && 'text-right')}>
                          {c.format ? c.format(r[c.key]) : String(r[c.key] ?? '')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div aria-describedby={summary ? sid : undefined}>{children}</div>
          )}
        </div>
        {!loading && !error && !empty && legend && Object.keys(legend).length > 1 && <ChartLegend config={legend} />}
        {summary && !loading && !error && !empty && (
          <p id={sid} className="t-caption mt-3 text-ink-2">
            {summary}
          </p>
        )}
      </CardBody>
    </Card>
  );
}
