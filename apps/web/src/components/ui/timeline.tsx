import * as React from 'react';
import { formatDistanceToNowStrict, format } from 'date-fns';
import { cn } from '@/lib/cn';

export interface TimelineItem {
  id: string;
  title: React.ReactNode;
  detail?: React.ReactNode;
  at: string | Date;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'brand';
}

const NODE = { neutral: 'bg-ink-3', success: 'bg-success', warning: 'bg-warning', danger: 'bg-danger', brand: 'bg-brand' } as const;

/** 1 px rail, 8 px nodes in status colours, relative times with the absolute time on hover. */
export function Timeline({ items, className }: { items: TimelineItem[]; className?: string }) {
  return (
    <ol className={cn('relative', className)}>
      {items.map((it, i) => {
        const d = new Date(it.at);
        return (
          <li key={it.id} className="relative pb-5 pl-6 last:pb-0">
            {i < items.length - 1 && <span className="absolute left-[3.5px] top-3 h-full w-px bg-border" aria-hidden />}
            <span className={cn('absolute left-0 top-[7px] size-2 rounded-full', NODE[it.tone ?? 'neutral'])} aria-hidden />
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <p className="text-sm font-medium">{it.title}</p>
              <time dateTime={d.toISOString()} title={format(d, 'd MMM yyyy, h:mm a')} className="t-caption text-ink-3">
                {formatDistanceToNowStrict(d, { addSuffix: true })}
              </time>
            </div>
            {it.detail && <p className="t-caption mt-0.5 text-ink-2">{it.detail}</p>}
          </li>
        );
      })}
    </ol>
  );
}
