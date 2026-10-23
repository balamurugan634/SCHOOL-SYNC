'use client';

import * as React from 'react';
import { Controller, type Control, type FieldPath, type FieldValues } from 'react-hook-form';
import { Field, Input } from '@/components/ui/input';

/** Number input for react-hook-form: the field holds a number (or undefined when empty), as the shared zod schemas expect. */
export function FormNumber<T extends FieldValues>({ control, name, label, hint, required, min, max, step, className, placeholder }: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  control: Control<T, any, any>;
  name: FieldPath<T>;
  label: string;
  hint?: React.ReactNode;
  required?: boolean;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
  placeholder?: string;
}) {
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
            inputMode="numeric"
            min={min}
            max={max}
            step={step}
            placeholder={placeholder}
            name={field.name}
            ref={field.ref}
            onBlur={field.onBlur}
            value={field.value === undefined || field.value === null || Number.isNaN(field.value) ? '' : String(field.value)}
            onChange={(e) => field.onChange(e.target.value === '' ? undefined : Number(e.target.value))}
            invalid={!!fieldState.error}
            aria-describedby={fieldState.error ? `${id}-error` : hint ? `${id}-hint` : undefined}
          />
        </Field>
      )}
    />
  );
}

/** `HH:MM` time input (native picker; the value is exactly what the API expects). */
export function FormTime<T extends FieldValues>({ control, name, label, hint, required, className }: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  control: Control<T, any, any>;
  name: FieldPath<T>;
  label: string;
  hint?: React.ReactNode;
  required?: boolean;
  className?: string;
}) {
  const id = React.useId();
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field label={label} htmlFor={id} hint={hint} error={fieldState.error?.message} required={required} className={className}>
          <Input id={id} type="time" name={field.name} ref={field.ref} onBlur={field.onBlur} value={(field.value as string | undefined) ?? ''} onChange={(e) => field.onChange(e.target.value)} invalid={!!fieldState.error} aria-describedby={fieldState.error ? `${id}-error` : hint ? `${id}-hint` : undefined} />
        </Field>
      )}
    />
  );
}

/** Shared helpers for the academics screens. */
export const TYPE_LABEL: Record<string, string> = { core: 'Core', elective: 'Elective', co_scholastic: 'Co-scholastic' };
export const SUBJECT_TYPE_OPTIONS = [
  { value: 'core', label: 'Core' },
  { value: 'elective', label: 'Elective' },
  { value: 'co_scholastic', label: 'Co-scholastic' },
];
