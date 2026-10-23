'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { FileText, Loader2, Paperclip, ShieldAlert, X } from 'lucide-react';
import type { FilePurpose, LearningAttachmentRef } from '@school-sync/shared';
import { cn } from '@/lib/cn';
import { teacherError } from '@/lib/client/teacher-errors';
import { fileHref, uploadFile, MAX_UPLOAD_MB } from '@/lib/client/teacher-upload';
import { useReadOnly } from '@/lib/client/readonly-store';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DatePicker } from '@/components/ui/date-picker';
import { EmptyState } from '@/components/ui/empty-state';
import { IconButton } from '@/components/ui/icon-button';
import { Select, type SelectOption } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useMeContext } from '@/components/me-context';
import { useSite } from '@/components/site-context';

/* ───────────────────────── navigation between sibling pages ───────────────────────── */

export interface SubNavItem {
  href: string;
  label: string;
  /** hide the tab (e.g. class-teacher-only pages for a subject teacher) */
  hidden?: boolean;
  /** match exactly (the index page of a section) instead of by prefix */
  exact?: boolean;
  badge?: number | null;
}

/** Underline "tabs" that are real links (each sibling page is its own route). `href` is relative to the experience base. */
export function SubNav({ items, label }: { items: SubNavItem[]; label: string }) {
  const pathname = usePathname();
  const { base } = useMeContext();
  const shown = items.filter((i) => !i.hidden);
  return (
    <nav aria-label={label} className="-mt-2 mb-6 flex items-center gap-1 overflow-x-auto border-b border-border">
      {shown.map((i) => {
        const full = `${base}${i.href}`;
        const active = i.exact ? pathname === full : pathname === full || pathname.startsWith(`${full}/`);
        return (
          <Link key={i.href} href={full} aria-current={active ? 'page' : undefined} className={cn('tr-colors relative inline-flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap px-3 text-[13px] font-medium sm:h-10', active ? 'text-brand-ink' : 'text-ink-2 hover:text-ink')}>
            {i.label}
            {i.badge ? <span className="tnum grid min-w-5 place-items-center rounded-full bg-accent-soft px-1.5 text-[11px] leading-5 text-accent-ink">{i.badge}</span> : null}
            {active && <span aria-hidden className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-brand" />}
          </Link>
        );
      })}
    </nav>
  );
}

/* ───────────────────────── URL state (filters, page, tab kept in the query string) ───────────────────────── */

export function useUrlState() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const get = React.useCallback((k: string, d = ''): string => sp.get(k) ?? d, [sp]);
  const num = React.useCallback(
    (k: string, d: number): number => {
      const v = Number(sp.get(k));
      return Number.isFinite(v) && v > 0 ? v : d;
    },
    [sp],
  );
  /** merge `patch` into the query string; null / '' / the default removes the key. `page` resets to 1 unless patched. */
  const set = React.useCallback(
    (patch: Record<string, string | number | null | undefined>, opts?: { keepPage?: boolean; push?: boolean }) => {
      const n = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === undefined || v === '') n.delete(k);
        else n.set(k, String(v));
      }
      if (!opts?.keepPage && !('page' in patch)) n.delete('page');
      const q = n.toString();
      (opts?.push ? router.push : router.replace)(q ? `${pathname}?${q}` : pathname, { scroll: false });
    },
    [sp, router, pathname],
  );
  return { sp, get, num, set };
}

/* ───────────────────────── write gating ───────────────────────── */

/** Subscription lapsed → every write is refused by the API; disable buttons gracefully with a reason. */
export function useWriteGate() {
  const site = useSite();
  const readOnly = useReadOnly(site?.readOnly ?? false);
  return { readOnly, reason: readOnly ? 'The school is in read-only mode, so changes are switched off until the subscription is renewed.' : undefined };
}

/* ───────────────────────── states ───────────────────────── */

/** An error card with a retry. Pass `scope` for a 403/404 so it says "outside your classes" instead of "couldn't load". */
export function ErrorCard({ error, onRetry, title = 'We couldn’t load this', className }: { error: unknown; onRetry?: () => void; title?: string; className?: string }) {
  return (
    <Card className={className}>
      <EmptyState illustration="error-offline" compact title={title} description={teacherError(error)} action={onRetry && <Button variant="secondary" size="sm" onClick={onRetry}>Try again</Button>} />
    </Card>
  );
}

/** The record is outside the teacher's scope (404 / 403): a calm explanation and a way back. */
export function OutOfScope({ what = 'This', backHref, backLabel = 'Go back' }: { what?: string; backHref: string; backLabel?: string }) {
  return (
    <Card>
      <EmptyState
        icon={<ShieldAlert />}
        title={`${what} isn’t available to you`}
        description="It may have been removed, or it belongs to a class you don’t teach or lead. If that looks wrong, ask the school office."
        action={
          <Button asChild variant="secondary" size="sm">
            <Link href={backHref}>{backLabel}</Link>
          </Button>
        }
      />
    </Card>
  );
}

export function CardListSkeleton({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('space-y-3', className)} aria-busy>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-[72px] w-full" />
      ))}
    </div>
  );
}

/* ───────────────────────── small pieces ───────────────────────── */

const ALL = '__all';
/** A filter `Select` with an "All …" first option (Radix Select cannot hold an empty value). */
export function FilterSelect({ value, onChange, options, allLabel, label, className }: { value: string; onChange: (v: string) => void; options: SelectOption[]; allLabel: string; label: string; className?: string }) {
  return <Select aria-label={label} className={cn('w-full sm:w-auto sm:min-w-40', className)} value={value || ALL} onValueChange={(v) => onChange(v === ALL ? '' : v)} options={[{ value: ALL, label: allLabel }, ...options]} />;
}

/** `<dl>` of label / value pairs for detail drawers and cards. */
export function Meta({ items, className, cols = 2 }: { items: { label: string; value: React.ReactNode; hidden?: boolean }[]; className?: string; cols?: 1 | 2 | 3 }) {
  return (
    <dl className={cn('grid gap-x-6 gap-y-3', cols === 1 ? 'grid-cols-1' : cols === 3 ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2', className)}>
      {items
        .filter((i) => !i.hidden)
        .map((i) => (
          <div key={i.label} className="min-w-0">
            <dt className="t-caption text-ink-2">{i.label}</dt>
            <dd className="mt-0.5 break-words text-sm">{i.value ?? '—'}</dd>
          </div>
        ))}
    </dl>
  );
}

export const fmtBytes = (n: number | undefined): string => (n === undefined ? '' : n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/** Read-only list of attachments (opens through the BFF). */
export function AttachmentLinks({ items, className }: { items: LearningAttachmentRef[] | { fileId: string; name: string; sizeBytes?: number }[]; className?: string }) {
  if (items.length === 0) return null;
  return (
    <ul className={cn('flex flex-wrap gap-2', className)} aria-label="Attachments">
      {items.map((a) => (
        <li key={a.fileId}>
          <a href={fileHref(a.fileId)} target="_blank" rel="noreferrer" className="tr-colors inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-md border border-border-strong bg-surface px-2.5 text-[13px] text-ink hover:bg-surface-subtle">
            <FileText className="size-4 shrink-0 text-ink-3" aria-hidden />
            <span className="truncate">{a.name}</span>
            {a.sizeBytes !== undefined && <span className="t-caption shrink-0 text-ink-3">{fmtBytes(a.sizeBytes)}</span>}
          </a>
        </li>
      ))}
    </ul>
  );
}

interface Uploading {
  key: string;
  name: string;
  error?: string;
}

/**
 * Upload files (`POST /files` multipart, `purpose`) and hold the resulting attachment refs. Each file shows progress and a
 * clear error (type, size, read-only school). `value` is what the API wants in `attachments`.
 */
export function AttachmentPicker({ value, onChange, purpose, max = 10, disabled, label = 'Attachments', hint, accept }: { value: LearningAttachmentRef[]; onChange: (v: LearningAttachmentRef[]) => void; purpose: FilePurpose; max?: number; disabled?: boolean; label?: string; hint?: React.ReactNode; accept?: string }) {
  const input = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState<Uploading[]>([]);
  const valueRef = React.useRef(value);
  valueRef.current = value;
  const id = React.useId();

  const add = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const room = max - valueRef.current.length;
    const list = Array.from(files).slice(0, Math.max(0, room));
    for (const f of list) {
      const key = `${f.name}-${f.size}-${Math.random().toString(36).slice(2)}`;
      if (f.size > MAX_UPLOAD_MB * 1024 * 1024) {
        setBusy((b) => [...b, { key, name: f.name, error: `Larger than ${MAX_UPLOAD_MB} MB` }]);
        continue;
      }
      setBusy((b) => [...b, { key, name: f.name }]);
      try {
        const r = await uploadFile(f, purpose);
        onChange([...valueRef.current, { fileId: r.id, name: r.name, mimeType: r.mimeType, sizeBytes: r.sizeBytes }]);
        valueRef.current = [...valueRef.current, { fileId: r.id, name: r.name, mimeType: r.mimeType, sizeBytes: r.sizeBytes }];
        setBusy((b) => b.filter((x) => x.key !== key));
      } catch (e) {
        setBusy((b) => b.map((x) => (x.key === key ? { ...x, error: teacherError(e) } : x)));
      }
    }
    if (input.current) input.current.value = '';
  };

  const full = value.length >= max;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="t-label text-ink">
          {label}
        </label>
        <Button type="button" variant="secondary" size="sm" disabled={disabled || full || busy.some((b) => !b.error)} onClick={() => input.current?.click()}>
          <Paperclip /> Add file
        </Button>
      </div>
      <input id={id} ref={input} type="file" multiple accept={accept} className="sr-only" tabIndex={-1} onChange={(e) => void add(e.target.files)} />
      {(value.length > 0 || busy.length > 0) && (
        <ul className="space-y-1.5" aria-label={label}>
          {value.map((a) => (
            <li key={a.fileId} className="flex items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm">
              <FileText className="size-4 shrink-0 text-ink-3" aria-hidden />
              <a href={fileHref(a.fileId)} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:underline">
                {a.name}
              </a>
              <span className="t-caption shrink-0 text-ink-3">{fmtBytes(a.sizeBytes)}</span>
              <IconButton label={`Remove ${a.name}`} size="icon-sm" disabled={disabled} onClick={() => onChange(value.filter((x) => x.fileId !== a.fileId))}>
                <X />
              </IconButton>
            </li>
          ))}
          {busy.map((b) => (
            <li key={b.key} className={cn('flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm', b.error ? 'border-danger/40 bg-danger-soft' : 'border-border bg-surface')} role={b.error ? 'alert' : undefined}>
              {b.error ? <X className="size-4 shrink-0 text-danger" aria-hidden /> : <Loader2 className="size-4 shrink-0 animate-spin text-ink-3" aria-hidden />}
              <span className="min-w-0 flex-1 truncate">{b.name}</span>
              <span className={cn('t-caption', b.error ? 'text-danger' : 'text-ink-3')}>{b.error ?? 'Uploading…'}</span>
              {b.error && (
                <IconButton label={`Dismiss ${b.name}`} size="icon-sm" onClick={() => setBusy((x) => x.filter((y) => y.key !== b.key))}>
                  <X />
                </IconButton>
              )}
            </li>
          ))}
        </ul>
      )}
      {hint && <p className="t-caption text-ink-3">{hint}</p>}
      {full && <p className="t-caption text-ink-3">The limit of {max} files is reached.</p>}
    </div>
  );
}

/* ───────────────────────── date + time (ISO instant) ───────────────────────── */

const pad = (n: number) => String(n).padStart(2, '0');
export const toLocalParts = (iso: string | null | undefined): { date: string; time: string } | null => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
};
export const fromLocalParts = (date: string, time: string): string => new Date(`${date}T${time || '00:00'}:00`).toISOString();

/** A date picker plus a time input producing an ISO instant (`dueAt`, `scheduledAt`, `publishAt`). `null` while either part is empty. */
export function DateTimeField({ value, onChange, id, invalid, min, defaultTime = '17:00', disabled }: { value: string | null | undefined; onChange: (iso: string | null) => void; id?: string; invalid?: boolean; min?: string; defaultTime?: string; disabled?: boolean }) {
  const parts = toLocalParts(value);
  const [date, setDate] = React.useState(parts?.date ?? '');
  const [time, setTime] = React.useState(parts?.time ?? defaultTime);
  const emit = (d: string, t: string) => onChange(d && t ? fromLocalParts(d, t) : null);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_7.5rem] gap-2">
      <DatePicker id={id} value={date || null} min={min} invalid={invalid} disabled={disabled} onChange={(d) => { setDate(d); emit(d, time); }} />
      <input
        type="time"
        aria-label="Time"
        value={time}
        disabled={disabled}
        onChange={(e) => {
          setTime(e.target.value);
          emit(date, e.target.value);
        }}
        aria-invalid={invalid || undefined}
        className="h-11 w-full rounded-md border border-border-strong bg-surface px-2.5 text-sm tr-colors hover:border-ink-3 focus:border-brand focus:outline-none focus:shadow-[0_0_0_3px_var(--ring)] disabled:border-border disabled:bg-surface-subtle disabled:text-ink-disabled aria-[invalid=true]:border-danger sm:h-9"
      />
    </div>
  );
}
