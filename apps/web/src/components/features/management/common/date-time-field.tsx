'use client';

import * as React from 'react';
import { Controller, type Control, type FieldPath, type FieldValues } from 'react-hook-form';
import { isoToZoned, zonedToIso } from '@/lib/zoned';
import { DatePicker } from '@/components/ui/date-picker';
import { Field, Input } from '@/components/ui/input';

/**
 * A date + time in the SCHOOL's timezone, stored as an ISO instant (what the API takes for publishAt / expiresAt /
 * registrationDeadline). Empty = null.
 */
export function DateTimeField({ value, onChange, tz, min, id, invalid, defaultTime = '09:00' }: { value: string | null | undefined; onChange: (iso: string | null) => void; tz: string; min?: string; id?: string; invalid?: boolean; defaultTime?: string }) {
  const z = value ? isoToZoned(value, tz) : null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <DatePicker id={id} value={z?.date ?? null} min={min} invalid={invalid} className="w-40" placeholder="Pick a date" onChange={(d) => onChange(zonedToIso(d, z?.time ?? defaultTime, tz))} />
      <Input type="time" aria-label="Time" className="w-28" value={z?.time ?? ''} disabled={!z} onChange={(e) => z && e.target.value && onChange(zonedToIso(z.date, e.target.value, tz))} />
      {value && (
        <button type="button" onClick={() => onChange(null)} className="tr-colors rounded-md px-2 py-1 text-[13px] font-medium text-brand-ink hover:underline">
          Clear
        </button>
      )}
    </div>
  );
}

export function FormDateTime<T extends FieldValues>({ control, name, label, hint, tz, min, required }: { control: Control<T, any, any>; name: FieldPath<T>; label: string; hint?: React.ReactNode; tz: string; min?: string; required?: boolean }) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const id = React.useId();
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field label={label} htmlFor={id} hint={hint} error={fieldState.error?.message} required={required}>
          <DateTimeField id={id} value={(field.value as string | null | undefined) ?? null} onChange={field.onChange} tz={tz} min={min} invalid={!!fieldState.error} />
        </Field>
      )}
    />
  );
}
