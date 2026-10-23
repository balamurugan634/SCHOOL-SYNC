'use client';

import * as React from 'react';
import { Download, X } from 'lucide-react';
import { toast } from '@/components/ui/toaster';
import { Button } from '@/components/ui/button';
import { Field, SearchField } from '@/components/ui/input';
import { Select, type SelectOption } from '@/components/ui/select';
import { cn } from '@/lib/cn';
import { downloadFile } from '@/lib/client/transfer';
import { errorMessage } from '@/lib/problem';

const ALL = '__all__';

/** A labelled filter select with an "All …" choice. `value` '' = all. */
export function FilterSelect({ label, value, onChange, options, allLabel = 'All', className, disabled }: { label: string; value: string; onChange: (v: string) => void; options: SelectOption[]; allLabel?: string; className?: string; disabled?: boolean }) {
  return (
    <Select
      aria-label={label}
      className={cn('min-w-[9.5rem] sm:w-auto', className)}
      value={value || ALL}
      disabled={disabled}
      onValueChange={(v) => onChange(v === ALL ? '' : v)}
      options={[{ value: ALL, label: allLabel }, ...options]}
    />
  );
}

/** Same as FilterSelect but with a visible label above (forms and dialogs). */
export function LabelledSelect({ label, value, onChange, options, placeholder, hint, error, required, id }: { label: string; value: string; onChange: (v: string) => void; options: SelectOption[]; placeholder?: string; hint?: React.ReactNode; error?: string | null; required?: boolean; id?: string }) {
  const rid = React.useId();
  const fid = id ?? rid;
  return (
    <Field label={label} htmlFor={fid} hint={hint} error={error} required={required}>
      <Select id={fid} value={value} onValueChange={onChange} options={options} placeholder={placeholder} invalid={!!error} />
    </Field>
  );
}

/** Search box that reports its value `delay` ms after typing stops and follows external changes (Clear filters). */
export function SearchBox({ value, onChange, placeholder = 'Search', delay = 350, className }: { value: string; onChange: (v: string) => void; placeholder?: string; delay?: number; className?: string }) {
  const [local, setLocal] = React.useState(value);
  const last = React.useRef(value);
  React.useEffect(() => {
    if (value !== last.current) {
      last.current = value;
      setLocal(value);
    }
  }, [value]);
  React.useEffect(() => {
    if (local === last.current) return;
    const t = setTimeout(() => {
      last.current = local;
      onChange(local);
    }, local === '' ? 0 : delay);
    return () => clearTimeout(t);
  }, [local, delay, onChange]);
  return <SearchField value={local} onChange={setLocal} placeholder={placeholder} className={cn('w-full sm:w-64', className)} />;
}

/** A removable chip for an active filter ("Grade 6 ×"). */
export function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex h-7 items-center gap-1 rounded-md bg-brand-soft pl-2 pr-1 text-xs font-medium text-brand-ink">
      {label}
      <button type="button" onClick={onRemove} aria-label={`Remove filter ${label}`} className="tr-colors grid size-5 place-items-center rounded hover:bg-surface/60">
        <X className="size-3" />
      </button>
    </span>
  );
}

export function ClearFiltersButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick}>
      Clear filters
    </Button>
  );
}

/** Downloads a CSV / file through the BFF with a spinner and an error toast (403 / 402 / 422 …). */
export function ExportButton({ path, query, filename, label = 'Export CSV', disabled, title }: { path: string; query?: Record<string, string | number | boolean | undefined | null>; filename: string; label?: string; disabled?: boolean; title?: string }) {
  const [busy, setBusy] = React.useState(false);
  return (
    <Button
      variant="secondary"
      loading={busy}
      disabled={disabled}
      title={title}
      onClick={async () => {
        setBusy(true);
        try {
          await downloadFile(path, query, filename);
        } catch (e) {
          toast.error(errorMessage(e), { duration: 8000 });
        } finally {
          setBusy(false);
        }
      }}
    >
      <Download /> {label}
    </Button>
  );
}
