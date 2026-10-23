'use client';

import * as React from 'react';
import { Controller, type Control, type FieldPath, type FieldValues } from 'react-hook-form';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { Field, Input } from '@/components/ui/input';
import { Select, type SelectOption } from '@/components/ui/select';

interface Base<T extends FieldValues> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  control: Control<T, any, any>;
  name: FieldPath<T>;
  label: string;
  hint?: React.ReactNode;
  required?: boolean;
  className?: string;
}

/** A number field that stores a real number (or `undefined` / `null` when empty), which is what the shared zod schemas expect. */
export function FormNumber<T extends FieldValues>({ control, name, label, hint, required, className, min, max, step, empty = 'undefined' }: Base<T> & { min?: number; max?: number; step?: number | 'any'; empty?: 'undefined' | 'null' }) {
  const id = React.useId();
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field label={label} htmlFor={id} hint={hint} error={fieldState.error?.message} required={required} className={className}>
          <Input
            id={id}
            type="number"
            inputMode="decimal"
            min={min}
            max={max}
            step={step ?? 'any'}
            name={field.name}
            ref={field.ref}
            onBlur={field.onBlur}
            value={field.value === null || field.value === undefined || Number.isNaN(field.value) ? '' : String(field.value)}
            onChange={(e) => {
              const v = e.target.value;
              field.onChange(v === '' ? (empty === 'null' ? null : undefined) : Number(v));
            }}
            invalid={!!fieldState.error}
            aria-describedby={fieldState.error ? `${id}-error` : hint ? `${id}-hint` : undefined}
          />
        </Field>
      )}
    />
  );
}

const NONE = '__none__';

/** A select whose "none" choice stores `null` (e.g. "No term", "School default scale"). */
export function FormSelectNullable<T extends FieldValues>({ control, name, label, hint, required, className, options, noneLabel, placeholder }: Base<T> & { options: SelectOption[]; noneLabel: string; placeholder?: string }) {
  const id = React.useId();
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field label={label} htmlFor={id} hint={hint} error={fieldState.error?.message} required={required} className={className}>
          <Select id={id} options={[{ value: NONE, label: noneLabel }, ...options]} placeholder={placeholder} value={(field.value as string | null | undefined) ?? NONE} onValueChange={(v) => field.onChange(v === NONE ? null : v)} invalid={!!fieldState.error} />
        </Field>
      )}
    />
  );
}

/** An optional date with a Clear button (stores `null`). */
export function FormDateOptional<T extends FieldValues>({ control, name, label, hint, className, min, max }: Base<T> & { min?: string; max?: string }) {
  const id = React.useId();
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field label={label} htmlFor={id} hint={hint} error={fieldState.error?.message} className={className}>
          <div className="flex items-center gap-1.5">
            <div className="min-w-0 flex-1">
              <DatePicker id={id} value={(field.value as string | null | undefined) ?? null} onChange={field.onChange} min={min} max={max} invalid={!!fieldState.error} />
            </div>
            {field.value ? (
              <Button type="button" variant="ghost" size="icon" aria-label={`Clear ${label.toLowerCase()}`} onClick={() => field.onChange(null)}>
                <X />
              </Button>
            ) : null}
          </div>
        </Field>
      )}
    />
  );
}

/** `HH:MM` time field (native time input, 24 h value). Empty = `null`. */
export function FormTime<T extends FieldValues>({ control, name, label, hint, className }: Base<T>) {
  const id = React.useId();
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field label={label} htmlFor={id} hint={hint} error={fieldState.error?.message} className={className}>
          <Input id={id} type="time" name={field.name} ref={field.ref} onBlur={field.onBlur} value={(field.value as string | null | undefined) ?? ''} onChange={(e) => field.onChange(e.target.value === '' ? null : e.target.value)} invalid={!!fieldState.error} />
        </Field>
      )}
    />
  );
}
