'use client';

import * as React from 'react';
import { X } from 'lucide-react';
import { DatePicker } from '@/components/ui/date-picker';
import { Select, type SelectOption } from '@/components/ui/select';
import { SearchField } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

const ALL = '__all';

/** A labelled select for list filters. "All" is the empty value (Radix selects cannot hold ''). */
export function FilterSelect({ label, value, onChange, options, allLabel = 'All', className }: { label: string; value: string; onChange: (v: string) => void; options: SelectOption[]; allLabel?: string | null; className?: string }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="t-caption text-ink-2">{label}</span>
      <Select
        aria-label={label}
        className={className ?? 'w-40'}
        value={value || (allLabel === null ? undefined : ALL)}
        onValueChange={(v) => onChange(v === ALL ? '' : v)}
        options={allLabel === null ? options : [{ value: ALL, label: allLabel }, ...options]}
      />
    </label>
  );
}

export function FilterDate({ label, value, onChange, min, max }: { label: string; value: string; onChange: (v: string) => void; min?: string; max?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="t-caption text-ink-2" id={`fd-${label}`}>
        {label}
      </span>
      <div className="flex items-center gap-1">
        <DatePicker value={value || null} onChange={onChange} min={min} max={max} className="w-36" placeholder="Any date" />
        {value && (
          <button type="button" onClick={() => onChange('')} aria-label={`Clear ${label}`} className="tr-colors grid size-8 place-items-center rounded-md text-ink-3 hover:text-ink">
            <X className="size-4" />
          </button>
        )}
      </div>
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder = 'Search', className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return <SearchField value={value} onChange={onChange} placeholder={placeholder} className={className ?? 'w-full sm:w-64'} />;
}

/** Row of filter controls above a table; wraps on phones. */
export function FilterBar({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={`flex flex-wrap items-end gap-3 ${className ?? ''}`}>{children}</div>;
}

/** Active-filter chips for the "no results" empty state. */
export function FilterChips({ chips }: { chips: { label: string; value: string }[] }) {
  return (
    <>
      {chips.map((c) => (
        <span key={c.label} className="t-caption inline-flex items-center gap-1 rounded-md bg-surface-sunken px-2 py-1 text-ink-2">
          {c.label}: <span className="font-medium text-ink">{c.value}</span>
        </span>
      ))}
    </>
  );
}

export function ClearFilters({ onClear }: { onClear: () => void }) {
  return (
    <Button variant="secondary" size="sm" onClick={onClear}>
      Clear filters
    </Button>
  );
}

/** Pill-style single choice (e.g. announcement state). Buttons, `aria-pressed`, arrow-free for simplicity. */
export function ChoicePills<T extends string>({ value, onChange, options, label }: { value: T | ''; onChange: (v: T | '') => void; options: { value: T | ''; label: string; count?: number }[]; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = value === o.value;
        return (
          <button
            key={`${o.value}|${o.label}`}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={`tr-colors inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium ${on ? 'border-brand bg-brand-soft text-brand-ink' : 'border-border-strong bg-surface text-ink-2 hover:bg-surface-subtle hover:text-ink'}`}
          >
            {o.label}
            {o.count !== undefined && <span className="tnum text-ink-3">{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
