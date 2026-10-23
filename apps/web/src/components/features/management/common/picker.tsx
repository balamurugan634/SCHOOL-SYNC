'use client';

import * as React from 'react';
import { ChevronDown, Loader2, Search, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { friendlyError, useStaffSearch, useStudentSearch, type StaffLite, type StudentLite } from '@/lib/client/mgmt';
import { controlBase } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export interface PickerOption {
  value: string;
  label: string;
  sub?: string;
}

/**
 * Search-as-you-type single choice (students, staff, books …). The parent keeps the chosen option so its label can be
 * shown; `results` is whatever the search returned for the current text.
 */
export function EntityPicker({
  selected,
  onSelect,
  query,
  onQueryChange,
  results,
  loading,
  error,
  placeholder = 'Search…',
  hint = 'Type at least 2 letters.',
  id,
  invalid,
  disabled,
  clearable = true,
  ariaLabel,
}: {
  selected: PickerOption | null;
  onSelect: (o: PickerOption | null) => void;
  query: string;
  onQueryChange: (q: string) => void;
  results: PickerOption[] | undefined;
  loading?: boolean;
  error?: unknown;
  placeholder?: string;
  hint?: string;
  id?: string;
  invalid?: boolean;
  disabled?: boolean;
  clearable?: boolean;
  ariaLabel?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const listRef = React.useRef<HTMLUListElement>(null);
  const listId = React.useId();
  const focusItem = (dir: 1 | -1) => {
    const items = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('button[data-opt]') ?? []);
    if (!items.length) return;
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(i + dir + items.length) % items.length]?.focus();
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="relative">
        <PopoverTrigger asChild>
          <button
            id={id}
            type="button"
            disabled={disabled}
            aria-label={ariaLabel}
            aria-haspopup="listbox"
            className={cn(controlBase, 'flex h-11 items-center justify-between gap-2 px-3 text-left sm:h-9', clearable && selected && 'pr-14', invalid && 'border-danger')}
          >
            <span className={cn('min-w-0 truncate', !selected && 'text-ink-3')}>
              {selected ? (
                <>
                  {selected.label}
                  {selected.sub && <span className="ml-2 text-ink-3">{selected.sub}</span>}
                </>
              ) : (
                placeholder
              )}
            </span>
            <ChevronDown className="size-4 shrink-0 text-ink-3" aria-hidden />
          </button>
        </PopoverTrigger>
        {clearable && selected && !disabled && (
          <button type="button" onClick={() => onSelect(null)} aria-label="Clear selection" className="tr-colors absolute right-8 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-ink-3 hover:text-ink">
            <X className="size-4" />
          </button>
        )}
      </div>
      <PopoverContent align="start" className="w-[min(26rem,calc(100vw-2rem))]">
        <div className="relative border-b border-border p-2">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
          <input
            autoFocus
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                focusItem(1);
              }
            }}
            placeholder={placeholder}
            aria-label={placeholder}
            aria-controls={listId}
            className={cn(controlBase, 'h-9 pl-9')}
          />
          {loading && <Loader2 className="absolute right-4 top-1/2 size-4 -translate-y-1/2 animate-spin text-ink-3" aria-hidden />}
        </div>
        <ul
          id={listId}
          ref={listRef}
          role="listbox"
          aria-label="Results"
          className="max-h-64 overflow-y-auto p-1"
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              focusItem(1);
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              focusItem(-1);
            }
          }}
        >
          {error ? (
            <li className="px-3 py-4 text-sm text-danger" role="alert">
              {friendlyError(error)}
            </li>
          ) : results === undefined ? (
            <li className="px-3 py-4 text-sm text-ink-3">{hint}</li>
          ) : results.length === 0 ? (
            <li className="px-3 py-4 text-sm text-ink-3">No matches. Check the spelling or try the admission number.</li>
          ) : (
            results.map((o) => (
              <li key={o.value} role="option" aria-selected={selected?.value === o.value}>
                <button
                  type="button"
                  data-opt
                  onClick={() => {
                    onSelect(o);
                    setOpen(false);
                  }}
                  className="tr-colors flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left text-sm hover:bg-surface-subtle focus-visible:bg-surface-subtle"
                >
                  <span className="min-w-0 truncate font-medium">{o.label}</span>
                  {o.sub && <span className="t-caption shrink-0 text-ink-3">{o.sub}</span>}
                </button>
              </li>
            ))
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

export const studentOption = (s: StudentLite): PickerOption => ({ value: s.id, label: s.name, sub: `${s.admissionNo}${s.gradeName ? ` · ${s.gradeName}${s.sectionName ?? ''}` : ''}` });
export const staffOption = (s: StaffLite): PickerOption => ({ value: s.id, label: s.name, sub: `${s.employeeId}${s.designation ? ` · ${s.designation}` : ''}` });

export function StudentPicker({ selected, onSelect, id, invalid, disabled, clearable }: { selected: PickerOption | null; onSelect: (o: PickerOption | null) => void; id?: string; invalid?: boolean; disabled?: boolean; clearable?: boolean }) {
  const [q, setQ] = React.useState('');
  const res = useStudentSearch(q);
  return (
    <EntityPicker
      id={id}
      invalid={invalid}
      disabled={disabled}
      clearable={clearable}
      selected={selected}
      onSelect={onSelect}
      query={q}
      onQueryChange={setQ}
      results={res.data?.data.map(studentOption)}
      loading={res.isFetching}
      error={res.error}
      placeholder="Search student by name or admission no."
      hint="Type at least 2 letters of the name or admission number."
    />
  );
}

export function StaffPicker({ selected, onSelect, id, invalid, disabled }: { selected: PickerOption | null; onSelect: (o: PickerOption | null) => void; id?: string; invalid?: boolean; disabled?: boolean }) {
  const [q, setQ] = React.useState('');
  const res = useStaffSearch(q);
  return (
    <EntityPicker
      id={id}
      invalid={invalid}
      disabled={disabled}
      selected={selected}
      onSelect={onSelect}
      query={q}
      onQueryChange={setQ}
      results={res.data?.data.map(staffOption)}
      loading={res.isFetching}
      error={res.error}
      placeholder="Search staff by name or employee ID"
      hint="Type at least 2 letters of the name or employee ID."
    />
  );
}
