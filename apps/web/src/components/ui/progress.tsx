'use client';

import * as React from 'react';
import { cn } from '@/lib/cn';

const FILL = { brand: 'bg-brand', success: 'bg-success', warning: 'bg-warning', danger: 'bg-danger', neutral: 'bg-ink-3' } as const;

/** Linear 6 px: sunken track, brand fill that grows once (400 ms ease-out). */
export function ProgressBar({ value, max = 100, tone = 'brand', label, className }: { value: number; max?: number; tone?: keyof typeof FILL; label: string; className?: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <div className={cn('h-1.5 overflow-hidden rounded-full bg-surface-sunken', className)} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.min(value, max)}>
      <div className={cn('bar-grow h-full rounded-full', FILL[tone])} style={{ width: `${pct * 100}%` }} />
    </div>
  );
}

/** Ring for single KPIs (setup progress, attendance %). */
export function ProgressRing({ value, size = 72, stroke = 7, tone = 'brand', label, children }: { value: number; size?: number; stroke?: number; tone?: keyof typeof FILL; label: string; children?: React.ReactNode }) {
  const v = Math.max(0, Math.min(1, value));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const color = { brand: 'var(--brand)', success: 'var(--success)', warning: 'var(--warning)', danger: 'var(--danger)', neutral: 'var(--ink-3)' }[tone];
  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-sunken)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - v)} style={{ transition: 'stroke-dashoffset 400ms var(--ease-enter)' }} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
    </div>
  );
}
