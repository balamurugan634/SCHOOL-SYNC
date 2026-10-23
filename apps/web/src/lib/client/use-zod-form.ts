'use client';

import { useForm, type FieldValues, type Path, type Resolver, type UseFormProps, type UseFormReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { ApiError } from '../problem';

/**
 * react-hook-form + a zod schema (use the schemas from `@school-sync/shared` so the browser validates exactly what the API will).
 * Validates on blur, re-validates on change (inline validation on blur, summary on submit — design.md §8).
 */
export function useZodForm<S extends z.ZodType<FieldValues, FieldValues>>(schema: S, options?: Omit<UseFormProps<z.input<S>, unknown, z.output<S>>, 'resolver'>): UseFormReturn<z.input<S>, unknown, z.output<S>> {
  return useForm<z.input<S>, unknown, z.output<S>>({ resolver: zodResolver(schema) as unknown as Resolver<z.input<S>, unknown, z.output<S>>, mode: 'onBlur', reValidateMode: 'onChange', ...options });
}

/**
 * Put an API problem+json's `errors[]` (`{path, message}`) onto the matching form fields.
 * Returns the message to show in a form-level Banner when nothing could be attached to a field.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyApiErrors<T extends FieldValues>(form: UseFormReturn<T, any, any>, err: unknown, map: Record<string, Path<T>> = {}): string | null {
  if (!(err instanceof ApiError)) return err instanceof Error ? err.message : 'Something went wrong. Please try again.';
  let attached = 0;
  for (const e of err.errors) {
    const field = (map[e.path] ?? e.path) as Path<T>;
    if (field && field in (form.getValues() as object)) {
      form.setError(field, { type: 'server', message: e.message });
      attached++;
    }
  }
  return attached > 0 && err.code === 'VALIDATION_ERROR' ? null : (err.detail ?? err.message);
}

/**
 * Use instead of `formState.isDirty` for unsaved-changes guards: `isDirty` is also true for a pristine form whose Controllers
 * register fields that have no default value (the value's key set then differs from `defaultValues`), which would raise a
 * "Leave site?" prompt on an untouched form. `dirtyFields` only lists what the user actually changed.
 */
export const hasDirtyFields = (state: { dirtyFields: object }): boolean => Object.keys(state.dirtyFields).length > 0;
