'use client';

import * as React from 'react';
import { Controller, type Control, type FieldPath, type FieldValues } from 'react-hook-form';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { AudienceTargetIn, AudienceTargetOut } from '@school-sync/shared';
import { cn } from '@/lib/cn';
import { sectionOutLabel, useMySections } from '@/lib/client/teacher';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, Input, Textarea, type InputProps } from '@/components/ui/input';
import { IconButton } from '@/components/ui/icon-button';
import { Skeleton } from '@/components/ui/skeleton';
import { DateTimeField, ErrorCard } from '../common';

interface Base<T extends FieldValues> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  control: Control<T, any, any>;
  name: FieldPath<T>;
  label: string;
  hint?: React.ReactNode;
  required?: boolean;
  className?: string;
}

/**
 * Text input for an OPTIONAL field whose schema is `nullish`: an empty box is stored as `null` (not `''`), so the shared zod
 * schemas (`phoneStr.nullish()`, `timeStr.nullable()`, …) accept it. Also used for `type="time"`.
 */
export function NullableInput<T extends FieldValues>({ control, name, label, hint, required, className, empty = 'null', ...input }: Base<T> & Omit<InputProps, 'name' | 'value' | 'onChange' | 'onBlur' | 'invalid'> & { /** what an empty box is stored as: `null` for `.nullish()` fields, `undefined` for `.optional()` ones */ empty?: 'null' | 'undefined' }) {
  const id = React.useId();
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field label={label} htmlFor={id} hint={hint} error={fieldState.error?.message} required={required} className={className}>
          <Input
            id={id}
            {...input}
            name={field.name}
            ref={field.ref}
            onBlur={field.onBlur}
            value={(field.value as string | null | undefined) ?? ''}
            onChange={(e) => field.onChange(e.target.value === '' ? (empty === 'null' ? null : undefined) : e.target.value)}
            invalid={!!fieldState.error}
            aria-describedby={fieldState.error ? `${id}-error` : hint ? `${id}-hint` : undefined}
          />
        </Field>
      )}
    />
  );
}

export function NullableTextarea<T extends FieldValues>({ control, name, label, hint, required, className, ...rest }: Base<T> & Omit<React.ComponentProps<'textarea'>, 'name' | 'value' | 'onChange' | 'onBlur'>) {
  const id = React.useId();
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field label={label} htmlFor={id} hint={hint} error={fieldState.error?.message} required={required} className={className}>
          <Textarea id={id} {...rest} name={field.name} ref={field.ref} onBlur={field.onBlur} value={(field.value as string | null | undefined) ?? ''} onChange={(e) => field.onChange(e.target.value === '' ? null : e.target.value)} invalid={!!fieldState.error} />
        </Field>
      )}
    />
  );
}

/**
 * Who a class announcement / event is for. A teacher may only address sections they teach or lead (the API answers
 * `AUDIENCE_INVALID` otherwise), so this is a checklist of `useMySections()`. Targets that are not one of my sections
 * (e.g. a grade set by the office on an existing event) are kept, shown ticked and locked.
 */
export function AudiencePicker({ value, onChange, known, disabled, error }: { value: AudienceTargetIn[]; onChange: (v: AudienceTargetIn[]) => void; known?: AudienceTargetOut[]; disabled?: boolean; error?: string | null }) {
  const sections = useMySections();
  const id = React.useId();
  const mineIds = new Set((sections.data ?? []).map((s) => s.id));
  const chosen = new Set(value.filter((a) => a.type === 'section' && a.id).map((a) => a.id!));
  const locked = value.filter((a) => !(a.type === 'section' && a.id && mineIds.has(a.id)));
  const labelOf = (a: AudienceTargetIn) => known?.find((k) => k.type === a.type && k.id === a.id)?.label ?? (a.type === 'all' ? 'Everyone' : a.id ?? a.type);

  const toggle = (sid: string, on: boolean) => {
    const next = on ? [...value, { type: 'section' as const, id: sid }] : value.filter((a) => !(a.type === 'section' && a.id === sid));
    onChange(next);
  };

  return (
    <fieldset className="space-y-2" aria-describedby={error ? `${id}-error` : undefined}>
      <div className="flex items-center justify-between gap-3">
        <legend className="t-label p-0 text-ink">
          Send to <span className="text-danger" aria-hidden>*</span>
        </legend>
        {sections.data && sections.data.length > 1 && !disabled && (
          <div className="flex gap-1">
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange([...locked, ...sections.data!.map((s) => ({ type: 'section' as const, id: s.id }))])}>
              All my classes
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange([...locked])} disabled={chosen.size === 0}>
              Clear
            </Button>
          </div>
        )}
      </div>
      {sections.isPending ? (
        <div className="space-y-2" aria-busy>
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : sections.isError ? (
        <ErrorCard error={sections.error} onRetry={() => void sections.refetch()} title="We couldn’t load your classes" />
      ) : sections.data.length === 0 ? (
        <p className="rounded-md border border-border bg-surface-subtle px-3 py-3 text-sm text-ink-2">You don’t teach or lead a class this year, so there is nobody to address. Ask the school office to assign you.</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border-strong bg-surface" role="group" aria-label="Classes">
          {sections.data.map((s) => {
            const cid = `${id}-${s.id}`;
            return (
              <li key={s.id}>
                <label htmlFor={cid} className={cn('flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm', disabled && 'cursor-not-allowed text-ink-disabled')}>
                  <Checkbox id={cid} checked={chosen.has(s.id)} disabled={disabled} onCheckedChange={(v) => toggle(s.id, v === true)} />
                  <span className="min-w-0 flex-1">{sectionOutLabel(s)}</span>
                  <span className="t-caption text-ink-3">{s.studentCount} students</span>
                </label>
              </li>
            );
          })}
          {locked.map((a, i) => (
            <li key={`${a.type}-${a.id ?? i}`} className="flex min-h-11 items-center gap-3 px-3 py-2 text-sm text-ink-2">
              <Checkbox checked disabled aria-label={`${labelOf(a)} (set by the school office)`} />
              <span className="min-w-0 flex-1">{labelOf(a)}</span>
              <span className="t-caption text-ink-3">set by the office</span>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="t-caption text-danger">
          {error}
        </p>
      )}
    </fieldset>
  );
}

/** Previous / next with "Page x of y" for card lists (tables use DataTable's own footer). */
export function Pager({ page, pageSize, total, onPage, noun = 'items' }: { page: number; pageSize: number; total: number; onPage: (p: number) => void; noun?: string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return total > 0 ? <p className="t-caption tnum text-ink-2">{total.toLocaleString()} {noun}</p> : null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span className="t-caption tnum text-ink-2">
        {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()}
      </span>
      <div className="flex items-center gap-1">
        <IconButton label="Previous page" variant="ghost" size="icon-sm" onClick={() => onPage(Math.max(1, page - 1))} disabled={page <= 1}>
          <ChevronLeft />
        </IconButton>
        <span className="t-caption tnum min-w-20 text-center text-ink-2">
          Page {page} of {pages}
        </span>
        <IconButton label="Next page" variant="ghost" size="icon-sm" onClick={() => onPage(Math.min(pages, page + 1))} disabled={page >= pages}>
          <ChevronRight />
        </IconButton>
      </div>
    </div>
  );
}

/**
 * `DateTimeField` that can be emptied again. The inner field keeps its own date/time while editing, so it is re-mounted when the
 * value flips between empty and set (otherwise a cleared value would still show the old date).
 */
export function ClearableDateTime({ value, onChange, min, defaultTime, invalid, disabled, clearLabel = 'Clear' }: { value: string | null | undefined; onChange: (iso: string | null) => void; min?: string; defaultTime?: string; invalid?: boolean; disabled?: boolean; clearLabel?: string }) {
  return (
    <div className="space-y-1.5">
      <DateTimeField key={value ? 'set' : 'empty'} value={value} onChange={onChange} min={min} defaultTime={defaultTime} invalid={invalid} disabled={disabled} />
      {value && (
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)} disabled={disabled}>
          {clearLabel}
        </Button>
      )}
    </div>
  );
}

/** True when the ISO instant is now or earlier (kept out of components so render stays pure). */
export const isPast = (iso: string): boolean => new Date(iso).getTime() <= Date.now();

/** `value` after it has stopped changing for `ms` (search boxes that write to the URL). */
export function useDebouncedValue<T>(value: T, ms = 300): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** A small titled block inside a drawer. */
export function DrawerSection({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('space-y-3', className)}>
      <h3 className="t-section">{title}</h3>
      {children}
    </section>
  );
}
