'use client';

import * as React from 'react';
import { Check, CheckCircle2, ChevronDown, Copy, Lock, XCircle } from 'lucide-react';
import type { MeetingProviderOut, MeetingTestOut } from '@school-sync/shared';
import { Badge } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/input';
import { IconButton } from '@/components/ui/icon-button';
import { toast } from '@/components/ui/toaster';
import { cn } from '@/lib/cn';
import { relativeTime } from '../email/email-bits';

/** Not connected · Connected · Error (the last test failed) · Switched off, plus Default. Icon + words, never colour alone. */
export function ProviderBadges({ p }: { p: MeetingProviderOut }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {!p.connected ? (
        <Badge variant="neutral">Not connected</Badge>
      ) : p.state === 'error' ? (
        <Badge variant="danger" icon={<XCircle aria-hidden />}>Error</Badge>
      ) : (
        <Badge variant="success" icon={<CheckCircle2 aria-hidden />}>Connected</Badge>
      )}
      {p.connected && !p.enabled && <Badge variant="warning-outline">Switched off</Badge>}
      {p.isDefault && <Badge variant="primary">Default</Badge>}
    </div>
  );
}

/** The last connection test, in one line. */
export function LastTest({ p }: { p: MeetingProviderOut }) {
  if (!p.connected) return null;
  if (p.lastTestOk === null || !p.lastTestAt) return <p className="t-caption text-ink-3">Not tested yet. Use “Test connection” after saving.</p>;
  return (
    <p className="t-caption text-ink-2" aria-live="polite">
      Last test {relativeTime(p.lastTestAt)}: {p.lastTestOk ? 'passed.' : `failed. ${p.lastTestError ?? ''}`}
    </p>
  );
}

/** Inline result of “Test connection”. */
export function TestResult({ r }: { r: MeetingTestOut }) {
  return r.ok ? (
    <Banner tone="success" title="The connection works">
      {r.detail}
    </Banner>
  ) : (
    <Banner tone="danger" title="The connection did not work">
      {r.error}
    </Banner>
  );
}

export type SecretMode = 'keep' | 'replace';

/**
 * A write-only secret (Zoom client secret, Google key). Saved: shows “Saved · hidden for your security” with Replace and Remove;
 * its value never comes back from the server. Removing the secret disconnects the provider (a connection without it cannot work).
 */
export function SecretField({ id, label, saved, mode, onMode, onRemove, hint, disabled, children }: { id: string; label: string; saved: boolean; mode: SecretMode; onMode: (m: SecretMode) => void; onRemove: () => void; hint?: React.ReactNode; disabled?: boolean; children: React.ReactNode }) {
  if (saved && mode === 'keep') {
    return (
      <Field label={label} htmlFor={`${id}-saved`} hint={hint}>
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-subtle px-3 py-2" id={`${id}-saved`} role="group" aria-label={`${label} (saved)`}>
          <Badge variant="success" icon={<Lock aria-hidden />}>Saved</Badge>
          <span className="t-caption mr-auto text-ink-2">Hidden for your security</span>
          <Button type="button" size="sm" variant="secondary" disabled={disabled} onClick={() => onMode('replace')}>Replace</Button>
          <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={onRemove}>Remove</Button>
        </div>
      </Field>
    );
  }
  return (
    <div className="space-y-2">
      {children}
      {saved && (
        <Button type="button" size="sm" variant="ghost" onClick={() => onMode('keep')}>
          Keep the saved {label.toLowerCase()}
        </Button>
      )}
    </div>
  );
}

/** A value with a copy button (the Client ID a Workspace admin must authorise). */
export function CopyValue({ label, value }: { label: string; value: string }) {
  const [done, setDone] = React.useState(false);
  return (
    <div className="flex min-w-0 items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-surface-subtle px-2.5 py-1.5 text-[13px] select-all" aria-label={label}>{value}</code>
      <IconButton
        label={`Copy ${label}`}
        variant="secondary"
        size="icon-sm"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setDone(true);
            toast.success(`${label} copied`);
            window.setTimeout(() => setDone(false), 2000);
          } catch {
            toast.error('Could not copy. Select the text and copy it by hand.');
          }
        }}
      >
        {done ? <Check /> : <Copy />}
      </IconButton>
    </div>
  );
}

/** “Where do I find these?” — plain-language setup steps, collapsed by default. */
export function SetupHelp({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  const id = React.useId();
  const [open, setOpen] = React.useState(false);
  return (
    <div className={cn('rounded-lg border border-border', className)}>
      <h3>
        <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)} className="tr-colors flex w-full items-center gap-2 rounded-lg px-4 py-3 text-left text-sm font-medium hover:bg-surface-subtle">
          {title}
          <ChevronDown className={cn('ml-auto size-4 shrink-0 text-ink-3 transition-transform duration-200', open && 'rotate-180')} aria-hidden />
        </button>
      </h3>
      {open && (
        <div id={id} className="space-y-3 border-t border-border px-4 py-3 text-sm leading-6 text-ink-2">
          {children}
        </div>
      )}
    </div>
  );
}

export function Steps({ items }: { items: React.ReactNode[] }) {
  return (
    <ol className="list-decimal space-y-2 pl-5 marker:text-ink-3">
      {items.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </ol>
  );
}

export const Code = ({ children }: { children: React.ReactNode }) => <code className="rounded bg-surface-sunken px-1 py-0.5 text-[12px] text-ink">{children}</code>;
