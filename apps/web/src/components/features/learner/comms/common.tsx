'use client';

import * as React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';
import { cn } from '@/lib/cn';
import { dateOnly } from '@/lib/format';
import { IconButton } from '@/components/ui/icon-button';

/** Two-or-three-way toggle for list filters (All / Unread, Upcoming / Past). Each button announces its pressed state. */
export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-md border border-border bg-surface-subtle p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn('tr-colors h-10 rounded-[6px] px-3 text-[13px] font-medium sm:h-8', value === o.value ? 'bg-surface text-ink shadow-[0_0_0_1px_var(--border)]' : 'text-ink-2 hover:text-ink')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Offset pager used under the card lists (page lives in the URL, owned by the caller). */
export function Pager({ page, totalPages, total, onPage, noun = 'items' }: { page: number; totalPages: number; total: number; onPage: (p: number) => void; noun?: string }) {
  if (total === 0) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-2.5 max-sm:px-4">
      <span className="t-caption tnum text-ink-2">
        {total.toLocaleString()} {noun}
      </span>
      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <IconButton label="Previous page" variant="ghost" size="icon-sm" onClick={() => onPage(Math.max(1, page - 1))} disabled={page <= 1}>
            <ChevronLeft />
          </IconButton>
          <span className="t-caption tnum min-w-20 text-center text-ink-2">
            Page {page} of {totalPages}
          </span>
          <IconButton label="Next page" variant="ghost" size="icon-sm" onClick={() => onPage(Math.min(totalPages, page + 1))} disabled={page >= totalPages}>
            <ChevronRight />
          </IconButton>
        </div>
      )}
    </div>
  );
}

/** "21 Oct, 3:59 pm" — instants from the API are ISO strings with an offset. */
export const fmtWhen = (iso: string): string => new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
export const fmtShortWhen = (iso: string): string => new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
export const ago = (iso: string): string => formatDistanceToNowStrict(new Date(iso), { addSuffix: true });

/** "Mon 3 Nov" — or "3–5 Nov" for a range. */
export function fmtSpan(start: string, end: string): string {
  const a = dateOnly(start);
  if (start === end) return new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(a);
  const b = dateOnly(end);
  const sameMonth = a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
  const d = (x: Date, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(undefined, o).format(x);
  return sameMonth ? `${d(a, { day: 'numeric' })}–${d(b, { day: 'numeric', month: 'short', year: 'numeric' })}` : `${d(a, { day: 'numeric', month: 'short' })} – ${d(b, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

export const isoDate = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
