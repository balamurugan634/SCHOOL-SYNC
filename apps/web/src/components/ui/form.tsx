'use client';

import * as React from 'react';
import { Controller, type Control, type FieldPath, type FieldValues } from 'react-hook-form';
import { cn } from '@/lib/cn';
import { Checkbox } from './checkbox';
import { DatePicker } from './date-picker';
import { Field, Input, Textarea, type InputProps } from './input';
import { Select, type SelectOption } from './select';

/**
 * Forms (design.md §8): group fields in sections with a title (≤ 7 visible fields per group, the rest behind an
 * "Advanced" disclosure), inline validation on blur, a summary on submit, an unsaved-changes guard
 * (`useUnsavedGuard`) and a toast on success. These wrappers connect the controls to react-hook-form.
 */
export function FormSection({ title, description, children, className }: { title: string; description?: string; children: React.ReactNode; className?: string }) {
  const id = React.useId();
  return (
    // role=group + aria-labelledby gives the same grouping semantics as <fieldset>/<legend> without the legend's special layout
    // (a legend is taken out of normal flow, which made a following description overlap the title)
    <section role="group" aria-labelledby={id} className={cn('space-y-4', className)}>
      <header>
        <h3 id={id} className="t-section">
          {title}
        </h3>
        {description && <p className="t-caption mt-0.5 text-ink-2">{description}</p>}
      </header>
      {children}
    </section>
  );
}

/** Sticky action row (cancel left of the primary action) for the bottom of a drawer or page form. */
export function FormActions({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('sticky bottom-0 flex flex-wrap items-center justify-end gap-2 border-t border-border bg-surface-raised px-5 py-3 max-sm:pb-[max(0.75rem,env(safe-area-inset-bottom))]', className)}>{children}</div>;
}

interface Base<T extends FieldValues> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  control: Control<T, any, any>;
  name: FieldPath<T>;
  label: string;
  hint?: React.ReactNode;
  required?: boolean;
  className?: string;
}

export function FormInput<T extends FieldValues>({ control, name, label, hint, required, className, ...input }: Base<T> & Omit<InputProps, 'name' | 'value' | 'onChange' | 'onBlur' | 'invalid'>) {
  const id = React.useId();
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field label={label} htmlFor={id} hint={hint} error={fieldState.error?.message} required={required} className={className}>
          <Input id={id} {...input} {...field} value={(field.value as string | number | undefined) ?? ''} invalid={!!fieldState.error} aria-describedby={fieldState.error ? `${id}-error` : hint ? `${id}-hint` : undefined} />
        </Field>
      )}
    />
  );
}

export function FormTextarea<T extends FieldValues>({ control, name, label, hint, required, className, ...rest }: Base<T> & Omit<React.ComponentProps<'textarea'>, 'name' | 'value' | 'onChange' | 'onBlur'>) {
  const id = React.useId();
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field label={label} htmlFor={id} hint={hint} error={fieldState.error?.message} required={required} className={className}>
          <Textarea id={id} {...rest} {...field} value={(field.value as string | undefined) ?? ''} invalid={!!fieldState.error} />
        </Field>
      )}
    />
  );
}

export function FormSelect<T extends FieldValues>({ control, name, label, hint, required, className, options, placeholder }: Base<T> & { options: SelectOption[]; placeholder?: string }) {
  const id = React.useId();
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field label={label} htmlFor={id} hint={hint} error={fieldState.error?.message} required={required} className={className}>
          <Select id={id} options={options} placeholder={placeholder} value={(field.value as string | undefined) ?? ''} onValueChange={field.onChange} invalid={!!fieldState.error} />
        </Field>
      )}
    />
  );
}

/** Value is an ISO `YYYY-MM-DD` string — exactly what the API expects. */
export function FormDate<T extends FieldValues>({ control, name, label, hint, required, className, min, max }: Base<T> & { min?: string; max?: string }) {
  const id = React.useId();
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field label={label} htmlFor={id} hint={hint} error={fieldState.error?.message} required={required} className={className}>
          <DatePicker id={id} value={(field.value as string | undefined) ?? null} onChange={field.onChange} min={min} max={max} invalid={!!fieldState.error} />
        </Field>
      )}
    />
  );
}

export function FormCheckbox<T extends FieldValues>({ control, name, label, hint, className }: Omit<Base<T>, 'required'>) {
  const id = React.useId();
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <div className={cn('flex items-start gap-2.5', className)}>
          <Checkbox id={id} checked={!!field.value} onCheckedChange={(v) => field.onChange(v === true)} className="mt-0.5" />
          <label htmlFor={id} className="text-sm">
            {label}
            {hint && <span className="t-caption block text-ink-3">{hint}</span>}
          </label>
        </div>
      )}
    />
  );
}
