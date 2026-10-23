'use client';

import * as React from 'react';
import { AlertCircle, Eye, EyeOff, Search, X } from 'lucide-react';
import { cn } from '@/lib/cn';

/** 36 px (44 on phones), 1 px border-strong, radius 8. Focus = brand border + soft ring. Error = danger border + icon + message. */
export const controlBase =
  'w-full rounded-md border border-border-strong bg-surface text-sm text-ink placeholder:text-ink-3 tr-colors ' +
  'hover:border-ink-3 focus:border-brand focus:outline-none focus:shadow-[0_0_0_3px_var(--ring)] ' +
  'disabled:cursor-not-allowed disabled:border-border disabled:bg-surface-subtle disabled:text-ink-disabled disabled:placeholder:text-ink-disabled disabled:hover:border-border ' +
  'aria-[invalid=true]:border-danger aria-[invalid=true]:focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--danger)_30%,transparent)]';

export interface InputProps extends Omit<React.ComponentProps<'input'>, 'size'> {
  leftIcon?: React.ReactNode;
  rightSlot?: React.ReactNode;
  invalid?: boolean;
  /** kept for call-site compatibility — a single control height (36 px; 44 px on phones) */
  inputSize?: 'md' | 'lg';
}

export function Input({ className, leftIcon, rightSlot, invalid, inputSize: _ignored, ...props }: InputProps) {
  return (
    <div className="relative flex items-center">
      {leftIcon && <span className="pointer-events-none absolute left-3 flex text-ink-3 [&_svg]:size-4">{leftIcon}</span>}
      <input className={cn(controlBase, 'h-11 px-3 sm:h-9', leftIcon && 'pl-9', (rightSlot || invalid) && 'pr-10', className)} aria-invalid={invalid || undefined} {...props} />
      {rightSlot ? <span className="absolute right-1 flex items-center">{rightSlot}</span> : invalid ? <AlertCircle className="pointer-events-none absolute right-3 size-4 text-danger" aria-hidden /> : null}
    </div>
  );
}

export function PasswordInput({ className, inputSize, ...props }: Omit<InputProps, 'type' | 'rightSlot'>) {
  const [show, setShow] = React.useState(false);
  return (
    <Input
      {...props}
      inputSize={inputSize}
      type={show ? 'text' : 'password'}
      className={className}
      rightSlot={
        <button type="button" onClick={() => setShow((s) => !s)} className="tr-colors grid size-9 place-items-center rounded-md text-ink-3 hover:text-ink sm:size-7" aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}>
          {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      }
    />
  );
}

/** Search field: leading icon, clear button, and a `/` hint on desktop when empty. */
export function SearchField({ value, onChange, placeholder = 'Search', className, id, 'aria-label': ariaLabel, hint = '/' }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string; id?: string; 'aria-label'?: string; hint?: string | null }) {
  const ref = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (!hint) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key === hint && !e.metaKey && !e.ctrlKey && t && !/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) && !t.isContentEditable) {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hint]);
  return (
    <div className={cn('relative flex items-center', className)}>
      <Search className="pointer-events-none absolute left-3 size-4 text-ink-3" aria-hidden />
      <input ref={ref} id={id} type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={ariaLabel ?? placeholder} className={cn(controlBase, 'h-11 pl-9 pr-9 sm:h-9 [&::-webkit-search-cancel-button]:hidden')} />
      {value ? (
        <button type="button" onClick={() => { onChange(''); ref.current?.focus(); }} className="absolute right-1 grid size-9 place-items-center rounded-md text-ink-3 hover:text-ink sm:size-7" aria-label="Clear search">
          <X className="size-4" />
        </button>
      ) : hint ? (
        <kbd className="pointer-events-none absolute right-2.5 hidden rounded border border-border bg-surface-subtle px-1.5 text-[11px] leading-5 text-ink-3 sm:block">{hint}</kbd>
      ) : null}
    </div>
  );
}

export function Textarea({ className, invalid, ...props }: React.ComponentProps<'textarea'> & { invalid?: boolean }) {
  return <textarea className={cn(controlBase, 'min-h-24 resize-y px-3 py-2 leading-5', className)} aria-invalid={invalid || undefined} {...props} />;
}

export interface FieldProps {
  label?: React.ReactNode;
  htmlFor?: string;
  hint?: React.ReactNode;
  error?: string | null;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}

/** Label above (13/500), control, helper below (12). An error shows an icon + message (never colour alone). */
export function Field({ label, htmlFor, hint, error, required, className, children, action }: FieldProps) {
  return (
    <div className={cn('space-y-1.5', className)}>
      {(label || action) && (
        <div className="flex items-baseline justify-between gap-3">
          {label && (
            <label htmlFor={htmlFor} className="t-label text-ink">
              {label}
              {required && (
                <span className="ml-0.5 text-danger" aria-hidden>
                  *
                </span>
              )}
            </label>
          )}
          {action}
        </div>
      )}
      {children}
      {error ? (
        <p id={htmlFor ? `${htmlFor}-error` : undefined} role="alert" className="t-caption flex items-start gap-1.5 text-danger">
          <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      ) : hint ? (
        <p id={htmlFor ? `${htmlFor}-hint` : undefined} className="t-caption text-ink-3">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
