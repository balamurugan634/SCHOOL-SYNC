import * as React from 'react';
import { cn } from '@/lib/cn';
import { Illustration, type IllustrationName } from '../illustrations/illustration';

/**
 * Illustration (soft geometry) or a small icon + one sentence + one primary action.
 * "No results" variant: pass `filters` (the active filter chips) and a `Clear filters` action.
 */
export function EmptyState({
  icon,
  illustration,
  title,
  description,
  action,
  compact,
  className,
  filters,
}: {
  icon?: React.ReactNode;
  /** an illustration name (or a rendered node) — only for empty / no-results / success / error states (design.md §7) */
  illustration?: IllustrationName | React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  compact?: boolean;
  /** kept for call-site compatibility */
  tone?: 'neutral' | 'danger';
  className?: string;
  filters?: React.ReactNode;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center', compact ? 'px-4 py-8' : 'px-6 py-12', className)}>
      {illustration ? <div className={cn('mb-4 w-full', compact ? 'max-w-[160px]' : 'max-w-[220px]')}>{typeof illustration === 'string' ? <Illustration name={illustration as IllustrationName} /> : illustration}</div> : icon ? <span className="mb-3 grid size-10 place-items-center rounded-full bg-surface-sunken text-ink-2 [&_svg]:size-5">{icon}</span> : null}
      <h3 className="text-sm font-semibold">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-ink-2">{description}</p>}
      {filters && <div className="mt-3 flex flex-wrap justify-center gap-1.5">{filters}</div>}
      {action && <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}
