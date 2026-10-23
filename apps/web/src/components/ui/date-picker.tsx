'use client';

import * as React from 'react';
import { addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, isToday, parseISO, startOfMonth, startOfWeek } from 'date-fns';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Popover, PopoverContent, PopoverTrigger } from './popover';

const iso = (d: Date) => format(d, 'yyyy-MM-dd');

/**
 * Lightweight date picker: value is an ISO `YYYY-MM-DD` string (what the API expects).
 * Keyboard: arrows move by day / week, PageUp/PageDown by month, Enter selects.
 */
export function DatePicker({
  value,
  onChange,
  placeholder = 'Pick a date',
  min,
  max,
  id,
  disabled,
  invalid,
  className,
  weekStartsOn = 1,
  presets,
}: {
  value?: string | null;
  onChange: (v: string) => void;
  placeholder?: string;
  min?: string;
  max?: string;
  id?: string;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
  /** 0 = Sunday … 6 = Saturday (a school setting) */
  weekStartsOn?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  /** quick picks shown under the calendar, e.g. Today / This week / This term */
  presets?: { label: string; value: string }[];
}) {
  const selected = value ? parseISO(value) : null;
  const [open, setOpen] = React.useState(false);
  const [cursor, setCursor] = React.useState<Date>(selected ?? new Date());
  const [focusDay, setFocusDay] = React.useState<Date>(selected ?? new Date());
  const gridRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (open) {
      const base = selected ?? new Date();
      setCursor(base);
      setFocusDay(base);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const days = eachDayOfInterval({ start: startOfWeek(startOfMonth(cursor), { weekStartsOn }), end: endOfWeek(endOfMonth(cursor), { weekStartsOn }) });
  const blocked = (d: Date) => (min ? iso(d) < min : false) || (max ? iso(d) > max : false);

  const move = (d: Date) => {
    setFocusDay(d);
    setCursor(d);
    requestAnimationFrame(() => gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${iso(d)}"]`)?.focus());
  };
  const onKey = (e: React.KeyboardEvent) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key as 'ArrowLeft'];
    if (step) {
      e.preventDefault();
      move(new Date(focusDay.getFullYear(), focusDay.getMonth(), focusDay.getDate() + step));
    } else if (e.key === 'PageDown' || e.key === 'PageUp') {
      e.preventDefault();
      move(addMonths(focusDay, e.key === 'PageDown' ? 1 : -1));
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          disabled={disabled}
          data-invalid={invalid || undefined}
          className={cn(
            'flex h-11 w-full items-center justify-between gap-2 rounded-md border border-border-strong bg-surface px-3 text-left text-sm transition-colors sm:h-9',
            'focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60 data-[invalid=true]:border-danger',
            className,
          )}
        >
          <span className={cn(!selected && 'text-subtle')}>{selected ? format(selected, 'd MMM yyyy') : placeholder}</span>
          <CalendarDays className="size-4 text-subtle" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[19rem] p-3">
        <div className="mb-2 flex items-center justify-between">
          <button type="button" onClick={() => setCursor(addMonths(cursor, -1))} className="grid size-8 place-items-center rounded-md hover:bg-surface-2" aria-label="Previous month">
            <ChevronLeft className="size-4" />
          </button>
          <div className="text-sm font-semibold" aria-live="polite">
            {format(cursor, 'MMMM yyyy')}
          </div>
          <button type="button" onClick={() => setCursor(addMonths(cursor, 1))} className="grid size-8 place-items-center rounded-md hover:bg-surface-2" aria-label="Next month">
            <ChevronRight className="size-4" />
          </button>
        </div>
        <div className="grid grid-cols-7 text-center text-xs font-medium text-subtle" aria-hidden>
          {Array.from({ length: 7 }, (_, i) => ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'][(i + weekStartsOn) % 7]!).map((d) => (
            <div key={d} className="py-1">
              {d}
            </div>
          ))}
        </div>
        <div ref={gridRef} className="grid grid-cols-7 gap-y-0.5" role="grid" onKeyDown={onKey}>
          {days.map((d) => {
            const isSel = selected && isSameDay(d, selected);
            const out = !isSameMonth(d, cursor);
            return (
              <button
                key={iso(d)}
                type="button"
                role="gridcell"
                data-day={iso(d)}
                tabIndex={isSameDay(d, focusDay) ? 0 : -1}
                disabled={blocked(d)}
                aria-selected={isSel || undefined}
                aria-label={format(d, 'EEEE, d MMMM yyyy')}
                onClick={() => {
                  onChange(iso(d));
                  setOpen(false);
                }}
                className={cn(
                  'mx-auto grid size-9 place-items-center rounded-md text-sm transition-colors',
                  out ? 'text-subtle/70' : 'text-foreground',
                  !isSel && 'hover:bg-surface-2',
                  isToday(d) && !isSel && 'font-semibold text-primary-ink',
                  isSel && 'bg-primary font-medium text-primary-foreground',
                  'disabled:pointer-events-none disabled:opacity-30',
                )}
              >
                {d.getDate()}
              </button>
            );
          })}
        </div>
        <div className="mt-2 flex flex-wrap gap-1 border-t border-border pt-2">
          {[{ label: 'Today', value: iso(new Date()) }, ...(presets ?? [])].map((p) => (
            <button key={p.label} type="button" className="tr-colors rounded-md px-2 py-1 text-[13px] font-medium text-brand-ink hover:bg-surface-subtle" onClick={() => { onChange(p.value); setOpen(false); }}>
              {p.label}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
