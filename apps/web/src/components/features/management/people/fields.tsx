'use client';

import * as React from 'react';
import { Controller, type Control, type FieldValues } from 'react-hook-form';
import { ChevronDown, Lock, Search, X } from 'lucide-react';
import { Field, Input, SearchField } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { FormInput } from '@/components/ui/form';
import { cn } from '@/lib/cn';
import { useGuardianLookup } from '@/lib/client/people';
import { useDebounced } from '@/lib/client/url-state';
import type { GuardianOut } from '@school-sync/shared';

/** Any form's control: the field helpers below address fields by string path, so the form's own value types do not matter here. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyControl = Control<any, any, any>;
export const anyControl = (c: unknown) => c as AnyControl;

/** Number input for react-hook-form: the field value is a number (or undefined when empty), never a string. */
export function FormNumber({ control, name, label, hint, required, min, max, className }: { control: AnyControl; name: string; label: string; hint?: React.ReactNode; required?: boolean; min?: number; max?: number; className?: string }) {
  const id = React.useId();
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field label={label} htmlFor={id} hint={hint} error={fieldState.error?.message} required={required} className={className}>
          <Input
            id={id}
            inputMode="numeric"
            type="number"
            min={min}
            max={max}
            name={field.name}
            ref={field.ref}
            onBlur={field.onBlur}
            value={field.value ?? ''}
            onChange={(e) => field.onChange(e.target.value === '' ? undefined : Number(e.target.value))}
            invalid={!!fieldState.error}
          />
        </Field>
      )}
    />
  );
}

/** Postal address as six inputs under `prefix` (e.g. `address`). */
export function AddressFields({ control, prefix = 'address' }: { control: AnyControl; prefix?: string }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <FormInput control={control} name={`${prefix}.line1`} label="Address line 1" className="sm:col-span-2" autoComplete="off" />
      <FormInput control={control} name={`${prefix}.line2`} label="Address line 2" className="sm:col-span-2" autoComplete="off" />
      <FormInput control={control} name={`${prefix}.city`} label="City" autoComplete="off" />
      <FormInput control={control} name={`${prefix}.state`} label="State" autoComplete="off" />
      <FormInput control={control} name={`${prefix}.postalCode`} label="Postal code" autoComplete="off" />
      <FormInput control={control} name={`${prefix}.country`} label="Country" autoComplete="off" />
    </div>
  );
}

/** "More details" disclosure for the rarely used fields of a long form. */
export function Disclosure({ label, children, defaultOpen = false }: { label: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = React.useState(defaultOpen);
  const id = React.useId();
  return (
    <div>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={id} className="tr-colors -mx-1 inline-flex items-center gap-1.5 rounded-md px-1 py-1 text-[13px] font-medium text-brand-ink hover:underline">
        <ChevronDown className={cn('size-4 transition-transform duration-200', open && 'rotate-180')} aria-hidden />
        {open ? 'Hide' : 'Show'} {label}
      </button>
      <div id={id} hidden={!open} className="mt-4 space-y-5">
        {children}
      </div>
    </div>
  );
}

/** Shown where the API hid a sensitive field from this caller (medical notes, documents, contact details). */
export function Restricted({ what }: { what: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-ink-3">
      <Lock className="size-3.5" aria-hidden /> {what} is restricted for your role
    </span>
  );
}

/** Search-as-you-type picker over registered parents (GET /guardians?q=). */
export function GuardianPicker({ onPick, exclude = [], placeholder = 'Search a parent by name, phone or email' }: { onPick: (g: GuardianOut) => void; exclude?: string[]; placeholder?: string }) {
  const [text, setText] = React.useState('');
  const q = useDebounced(text.trim(), 300);
  const res = useGuardianLookup(q);
  const rows = (res.data ?? []).filter((g) => !exclude.includes(g.id));
  return (
    <div className="space-y-2">
      <SearchField value={text} onChange={setText} placeholder={placeholder} hint={null} />
      {q.length >= 2 && (
        <div className="rounded-lg border border-border bg-surface" role="listbox" aria-label="Matching parents">
          {res.isFetching && !res.data ? (
            <div className="space-y-2 p-3">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-1/3" />
            </div>
          ) : res.isError ? (
            <p className="p-3 text-sm text-danger">Could not search parents. Check your connection and try again.</p>
          ) : rows.length === 0 ? (
            <p className="flex items-center gap-2 p-3 text-sm text-ink-2">
              <Search className="size-4 text-ink-3" aria-hidden /> No registered parent matches “{q}”.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((g) => (
                <li key={g.id}>
                  <button type="button" role="option" aria-selected={false} onClick={() => onPick(g)} className="tr-colors flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-surface-subtle">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{g.name}</span>
                      <span className="t-caption block truncate text-ink-2">{[g.phone, g.email].filter(Boolean).join(' · ') || 'No contact details visible'}</span>
                    </span>
                    <Badge variant="neutral">{g.children.length} {g.children.length === 1 ? 'child' : 'children'}</Badge>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export function ChosenGuardian({ g, onClear }: { g: Pick<GuardianOut, 'name' | 'phone' | 'email'>; onClear?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-subtle px-3 py-2.5">
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{g.name}</span>
        <span className="t-caption block truncate text-ink-2">{[g.phone, g.email].filter(Boolean).join(' · ') || 'No contact details visible'}</span>
      </span>
      {onClear && (
        <button type="button" onClick={onClear} aria-label={`Choose a different parent than ${g.name}`} className="tr-colors grid size-8 shrink-0 place-items-center rounded-md text-ink-3 hover:bg-surface-sunken hover:text-ink">
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}

export type { FieldValues };
