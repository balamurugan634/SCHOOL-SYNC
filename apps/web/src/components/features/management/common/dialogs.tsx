'use client';

import * as React from 'react';
import { friendlyError } from '@/lib/client/mgmt';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Textarea } from '@/components/ui/input';

/**
 * A confirm dialog that asks for a note / reason (void an invoice, reject a refund, decline a meeting …).
 * It states the object and the consequence; focus starts in the box. `onConfirm` may throw: the message stays in the dialog.
 */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  label = 'Reason',
  hint,
  required = true,
  minLength = 3,
  maxLength = 300,
  confirmLabel,
  destructive,
  onConfirm,
  extra,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description: React.ReactNode;
  label?: string;
  hint?: string;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: (reason: string) => Promise<unknown>;
  extra?: React.ReactNode;
}) {
  const [text, setText] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const id = React.useId();
  React.useEffect(() => {
    if (open) {
      setText('');
      setError(null);
      setBusy(false);
    }
  }, [open]);
  const trimmed = text.trim();
  const tooShort = required && trimmed.length < minLength;
  const submit = async () => {
    if (tooShort) {
      setError(`Please write at least ${minLength} characters.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onConfirm(trimmed);
      onOpenChange(false);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent title={title}>
        <div className="mt-2 space-y-4">
          <div className="text-sm text-ink-2">{description}</div>
          {extra}
          <Field label={label} htmlFor={id} hint={hint} required={required} error={error && tooShort ? error : null}>
            <Textarea id={id} value={text} onChange={(e) => setText(e.target.value)} maxLength={maxLength} rows={3} autoFocus invalid={!!error && tooShort} />
          </Field>
          {error && !tooShort && <Banner tone="danger">{error}</Banner>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant={destructive ? 'danger-solid' : 'primary'} loading={busy} onClick={() => void submit()}>
              {confirmLabel}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** ConfirmDialog variant whose action is async and whose failure message stays visible in the dialog. */
export function AsyncConfirm({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => Promise<unknown>;
}) {
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const cancelRef = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (open) {
      setError(null);
      setBusy(false);
    }
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent
        title={title}
        hideClose
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          cancelRef.current?.focus();
        }}
      >
        <div className="mt-2 space-y-4">
          <div className="text-sm text-ink-2">{description}</div>
          {error && <Banner tone="danger">{error}</Banner>}
          <div className="flex justify-end gap-2">
            <Button ref={cancelRef} variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant={destructive ? 'danger-solid' : 'primary'}
              loading={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await onConfirm();
                  onOpenChange(false);
                } catch (e) {
                  setError(friendlyError(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {confirmLabel}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
