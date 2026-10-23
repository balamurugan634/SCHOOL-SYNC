import * as React from 'react';
import { Breadcrumbs, type Crumb } from '../ui/breadcrumbs';
import { cn } from '@/lib/cn';

/** Page title (Manrope 26/34), one-line description, primary action on the right. One `h1` per screen. */
export function PageHeader({ title, description, actions, crumbs, className }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; crumbs?: Crumb[]; className?: string; eyebrow?: React.ReactNode }) {
  return (
    <header className={cn('mb-6 sm:mb-8', className)}>
      {crumbs && crumbs.length > 0 && <Breadcrumbs items={crumbs} className="mb-2" />}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="t-page">{title}</h1>
          {description && <p className="mt-1 max-w-[68ch] text-sm leading-[22px] text-ink-2">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
