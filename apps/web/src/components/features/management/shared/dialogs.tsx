'use client';

import * as React from 'react';
import { Check, Copy, KeyRound } from 'lucide-react';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Textarea } from '@/components/ui/input';
import { toast } from '@/components/ui/toaster';

export interface IssuedLogin {
  /** who the login is for, e.g. "Student", "Parent (Arjun Bose)" */
  label: string;
  username: string;
  temporaryPassword: string;
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = React.useState(false);
  return (
    <Button
      variant="secondary"
      size="sm"
      aria-label={`Copy ${label}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1800);
        } catch {
          toast.error('Could not copy. Select the text and copy it by hand.');
        }
      }}
    >
      {done ? <Check /> : <Copy />} {done ? 'Copied' : 'Copy'}
    </Button>
  );
}

/**
 * One-time temporary passwords (new student / parent / staff login, password reset). The API shows them once;
 * closing the dialog loses them, so it says so and offers copy buttons.
 */
export function CredentialsDialog({ open, onOpenChange, title = 'Sign-in details', logins, note }: { open: boolean; onOpenChange: (o: boolean) => void; title?: string; logins: IssuedLogin[]; note?: React.ReactNode }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} description="Share these with the person now. They must choose a new password the first time they sign in." size="lg" onInteractOutside={(e) => e.preventDefault()}>
        <div className="mt-4 space-y-3">
          <Banner tone="warning" title="This password is shown only once">
            We do not store it in a readable form, so it cannot be shown again. Copy it before you close this window. If it is lost, reset the password from the Users screen.
          </Banner>
          {note}
          <ul className="space-y-3">
            {logins.map((l) => (
              <li key={`${l.label}-${l.username}`} className="rounded-lg border border-border bg-surface-subtle p-3">
                <p className="t-label flex items-center gap-1.5"><KeyRound className="size-3.5 text-ink-3" aria-hidden /> {l.label}</p>
                <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 text-sm">
                  <dt className="t-caption text-ink-2">Username</dt>
                  <dd className="truncate font-mono text-[13px]">{l.username}</dd>
                  <dd><CopyButton text={l.username} label="username" /></dd>
                  <dt className="t-caption text-ink-2">Password</dt>
                  <dd className="select-all break-all font-mono text-[13px]">{l.temporaryPassword}</dd>
                  <dd><CopyButton text={l.temporaryPassword} label="password" /></dd>
                </dl>
              </li>
            ))}
          </ul>
        </div>
        <div className="mt-5 flex justify-end">
          <Button onClick={() => onOpenChange(false)}>I have copied it</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Approve / reject / return with a note. `required` makes the note mandatory (min length) — the API requires one for
 * rejections, returns and post-publication corrections.
 */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  label = 'Note',
  placeholder,
  required,
  minLength = 3,
  confirmLabel,
  destructive,
  consequence,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: React.ReactNode;
  label?: string;
  placeholder?: string;
  required?: boolean;
  minLength?: number;
  confirmLabel: string;
  destructive?: boolean;
  /** what will happen, stated plainly (shown under the field) */
  consequence?: React.ReactNode;
  onSubmit: (note: string) => Promise<boolean | void> | boolean | void;
}) {
  const [note, setNote] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [touched, setTouched] = React.useState(false);
  React.useEffect(() => {
    if (open) {
      setNote('');
      setTouched(false);
    }
  }, [open]);
  const tooShort = required && note.trim().length < minLength;
  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent title={title}>
        <form
          className="mt-3 space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setTouched(true);
            if (tooShort) return;
            setBusy(true);
            try {
              const r = await onSubmit(note.trim());
              if (r !== false) onOpenChange(false);
            } finally {
              setBusy(false);
            }
          }}
        >
          {description && <div className="text-sm text-ink-2">{description}</div>}
          <Field label={label} htmlFor="reason-note" required={required} error={touched && tooShort ? `Write at least ${minLength} characters.` : null} hint={!required ? 'Optional' : undefined}>
            <Textarea id="reason-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={placeholder} invalid={touched && !!tooShort} rows={3} maxLength={500} autoFocus />
          </Field>
          {consequence && <p className="t-caption text-ink-2">{consequence}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" variant={destructive ? 'danger-solid' : 'primary'} loading={busy}>
              {confirmLabel}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
