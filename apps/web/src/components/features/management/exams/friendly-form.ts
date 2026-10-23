'use client';

import { useForm, type FieldErrors, type FieldValues, type Resolver, type UseFormProps, type UseFormReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';

/** zod's stock sentences ("Too small: expected string to have >=2 characters", "Invalid UUID") rewritten for people. */
export function friendlyMessage(m: string): string {
  let r: RegExpExecArray | null;
  if (/^Invalid UUID/i.test(m)) return 'Choose an option.';
  if (/^Invalid input: expected \w+, received (undefined|null|NaN)/i.test(m)) return 'This field is required.';
  if ((r = /expected string to have >=(\d+) characters/.exec(m))) return r[1] === '1' ? 'This field is required.' : `Enter at least ${r[1]} characters.`;
  if ((r = /expected string to have <=(\d+) characters/.exec(m))) return `Use at most ${r[1]} characters.`;
  if ((r = /expected number to be >=(-?[\d.]+)/.exec(m))) return `Must be ${r[1]} or more.`;
  if ((r = /expected number to be <=(-?[\d.]+)/.exec(m))) return `Must be ${r[1]} or less.`;
  if ((r = /expected number to be >(-?[\d.]+)/.exec(m))) return `Must be more than ${r[1]}.`;
  return m;
}

function rewrite(errors: FieldErrors): FieldErrors {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(errors)) {
    if (v && typeof v === 'object' && 'message' in v && typeof v.message === 'string') out[k] = { ...v, message: friendlyMessage(v.message) };
    else if (v && typeof v === 'object') out[k] = rewrite(v as FieldErrors);
    else out[k] = v;
  }
  return out as FieldErrors;
}

/** `useZodForm` (same schema, same validation on blur) with the error sentences made readable. */
export function useFriendlyForm<S extends z.ZodType<FieldValues, FieldValues>>(schema: S, options?: Omit<UseFormProps<z.input<S>, unknown, z.output<S>>, 'resolver'>): UseFormReturn<z.input<S>, unknown, z.output<S>> {
  const base = zodResolver(schema) as unknown as Resolver<FieldValues>;
  const wrapped: Resolver<FieldValues> = async (values, context, opts) => {
    const r = await base(values, context, opts);
    return r.errors && Object.keys(r.errors).length ? { values: {}, errors: rewrite(r.errors as FieldErrors) } : r;
  };
  const resolver = wrapped as unknown as Resolver<z.input<S>, unknown, z.output<S>>;
  return useForm<z.input<S>, unknown, z.output<S>>({ resolver, mode: 'onBlur', reValidateMode: 'onChange', ...options });
}
