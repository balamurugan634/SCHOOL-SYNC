'use client';

import * as React from 'react';
import { format, parseISO } from 'date-fns';
import { X } from 'lucide-react';
import { Controller, type Control, type FieldPath, type FieldValues } from 'react-hook-form';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { Field, Input } from '@/components/ui/input';

/** A date + a time that together make one ISO instant (what the API stores). Empty = no value. Built in the browser's time zone. */
export function DateTimeField({ value, onChange, defaultTime = '09:00', invalid, idBase, min }: { value: string | null | undefined; onChange: (iso: string | null) => void; defaultTime?: string; invalid?: boolean; idBase: string; min?: string }) {
  const d = value ? parseISO(value) : null;
  const date = d ? format(d, 'yyyy-MM-dd') : null;
  const time = d ? format(d, 'HH:mm') : '';
  const compose = (nextDate: string | null, nextTime: string) => {
    if (!nextDate) return onChange(null);
    const when = new Date(`${nextDate}T${nextTime || defaultTime}:00`);
    onChange(Number.isNaN(when.getTime()) ? null : when.toISOString());
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="min-w-[10.5rem] flex-1">
        <DatePicker id={`${idBase}-date`} value={date} min={min} onChange={(v) => compose(v, time)} invalid={invalid} placeholder="No date" />
      </div>
      <div className="w-[7.5rem]">
        <Input id={`${idBase}-time`} type="time" aria-label="Time" value={time} disabled={!date} onChange={(e) => compose(date, e.target.value)} invalid={invalid} />
      </div>
      {value && (
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)} aria-label="Clear date and time">
          <X /> Clear
        </Button>
      )}
    </div>
  );
}

export function FormDateTime<T extends FieldValues>({ control, name, label, hint, defaultTime, className, min }: { control: Control<T>; name: FieldPath<T>; label: string; hint?: React.ReactNode; defaultTime?: string; className?: string; min?: string }) {
  const id = React.useId();
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field label={label} htmlFor={`${id}-date`} hint={hint} error={fieldState.error?.message} className={cn(className)}>
          <DateTimeField idBase={id} value={field.value as string | null | undefined} onChange={field.onChange} defaultTime={defaultTime} invalid={!!fieldState.error} min={min} />
        </Field>
      )}
    />
  );
}
