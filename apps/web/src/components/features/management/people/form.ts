'use client';

import * as React from 'react';
import { useForm, type FieldErrors, type FieldValues, type Resolver, type UseFormProps, type UseFormReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';

/** Removes blank strings (and objects that end up empty) so an optional field the user left empty validates as "not given". */
export function stripBlank<T>(v: T): T {
  if (typeof v === 'string') return (v.trim() === '' ? undefined : v) as T;
  if (Array.isArray(v)) return v.map(stripBlank) as T;
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      const s = stripBlank(x);
      if (s !== undefined) out[k] = s;
    }
    return (Object.keys(out).length ? out : undefined) as T;
  }
  return v;
}

/**
 * Like `useZodForm` (shared zod schema, validate on blur) but blank text fields are treated as "not given" before
 * validation, and the submitted values are the cleaned ones — so `phone: ''` does not fail the phone pattern.
 */
export function usePeopleForm<S extends z.ZodType<FieldValues, FieldValues>>(schema: S, options?: Omit<UseFormProps<z.input<S>, unknown, z.output<S>>, 'resolver'>): UseFormReturn<z.input<S>, unknown, z.output<S>> {
  const resolver = React.useMemo<Resolver<z.input<S>, unknown, z.output<S>>>(
    () => (values, context, opts) => (zodResolver(schema) as unknown as Resolver<z.input<S>, unknown, z.output<S>>)((stripBlank(values) ?? {}) as z.input<S>, context, opts),
    [schema],
  );
  return useForm<z.input<S>, unknown, z.output<S>>({ resolver, mode: 'onBlur', reValidateMode: 'onChange', ...options });
}

/** A form-level (root / refine) error message, if the schema produced one that is not attached to a field. */
export function rootError(errors: FieldErrors): string | null {
  const e = errors as Record<string, { message?: string } | undefined>;
  return e.root?.message ?? e['']?.message ?? null;
}

/** For PATCH bodies: keys the user cleared (missing after stripBlank) become `null` so the API clears them. */
export function nullMissing<T extends Record<string, unknown>>(values: T, keys: string[]): T {
  const out: Record<string, unknown> = { ...values };
  for (const k of keys) if (out[k] === undefined) out[k] = null;
  return out as T;
}
