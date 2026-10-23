import * as React from 'react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Skeleton } from './skeleton';

/** Label (12/ink-2) → value (Manrope 32) → sub / delta (12, status colour + icon). No icon tile; optional sparkline. */
export function StatTile({
  label,
  value,
  hint,
  delta,
  spark,
  state = 'ready',
  className,
  href: _href,
}: {
  label: string;
  value?: number | string | null;
  hint?: React.ReactNode;
  /** a signed change — shown with an arrow icon and status colour */
  delta?: { value: string; direction: 'up' | 'down'; good?: boolean } | null;
  /** 0..n series drawn as a thin brand sparkline */
  spark?: number[];
  state?: 'ready' | 'loading';
  className?: string;
  href?: string;
  /** kept for call-site compatibility */
  format?: (n: number) => string;
  icon?: React.ReactNode;
  tone?: string;
}) {
  return (
    <div className={cn('rounded-lg border border-border bg-surface p-4 shadow-card sm:p-5', className)}>
      <p className="t-caption text-ink-2">{label}</p>
      <div className="mt-1.5 flex min-h-10 items-end justify-between gap-3">
        {state === 'loading' ? <Skeleton className="h-8 w-24" /> : <span className="figure text-[32px] leading-10">{typeof value === 'number' ? value.toLocaleString() : (value ?? '—')}</span>}
        {spark && spark.length > 1 && state !== 'loading' && <Sparkline data={spark} />}
      </div>
      {state !== 'loading' && (hint || delta) && (
        <p className={cn('t-caption mt-1 flex items-center gap-1', delta ? (delta.good === false ? 'text-danger' : 'text-success') : 'text-ink-2')}>
          {delta && (delta.direction === 'up' ? <ArrowUpRight className="size-3.5" aria-hidden /> : <ArrowDownRight className="size-3.5" aria-hidden />)}
          {delta?.value} {hint && <span className="text-ink-2">{hint}</span>}
        </p>
      )}
    </div>
  );
}

function Sparkline({ data }: { data: number[] }) {
  const w = 72, h = 28, min = Math.min(...data), max = Math.max(...data), span = max - min || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - 3 - ((v - min) / span) * (h - 6)}`).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0 overflow-visible" aria-hidden>
      <polyline points={pts} fill="none" stroke="var(--brand)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
