import * as React from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface Crumb {
  label: string;
  href?: string;
}

/** Long trails truncate in the middle ("Home › … › Page"). */
export function Breadcrumbs({ items, className }: { items: Crumb[]; className?: string }) {
  const shown = items.length > 4 ? [items[0]!, { label: '…' }, ...items.slice(-2)] : items;
  return (
    <nav aria-label="Breadcrumb" className={className}>
      <ol className="t-caption flex flex-wrap items-center gap-1 text-ink-2">
        {shown.map((c, i) => {
          const last = i === shown.length - 1;
          return (
            <li key={`${c.label}-${i}`} className="flex items-center gap-1">
              {c.href && !last ? (
                <Link href={c.href} className="tr-colors rounded-sm hover:text-ink hover:underline">
                  {c.label}
                </Link>
              ) : (
                <span className={cn(last && 'text-ink')} aria-current={last ? 'page' : undefined}>
                  {c.label}
                </span>
              )}
              {!last && <ChevronRight className="size-3.5 text-ink-3" aria-hidden />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
