'use client';

import * as React from 'react';
import { FileText, Loader2, Paperclip, X } from 'lucide-react';
import type { FilePurpose } from '@school-sync/shared';
import { fileHref, friendlyError, uploadFile } from '@/lib/client/mgmt';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';

export interface UploadedFile {
  fileId: string;
  name: string;
  sizeBytes?: number;
  mimeType?: string;
}

const kb = (n?: number) => (n === undefined ? '' : n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/**
 * Upload one or several files with POST /files (`purpose` picks the accepted types: receipt = images + PDF,
 * announcement = images + documents). Shows progress, per-file errors and a remove button; files already uploaded
 * open through the BFF.
 */
export function FileUploader({ purpose, value, onChange, max = 1, accept, disabled, label = 'Attach a file', hint }: { purpose: FilePurpose; value: UploadedFile[]; onChange: (v: UploadedFile[]) => void; max?: number; accept?: string; disabled?: boolean; label?: string; hint?: string }) {
  const input = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);
  const full = value.length >= max;
  const hintId = React.useId();

  const pick = async (files: FileList | null) => {
    if (!files?.length) return;
    setError(null);
    const room = max - value.length;
    const list = Array.from(files).slice(0, room);
    if (files.length > room) setError(`You can attach up to ${max} file${max === 1 ? '' : 's'}.`);
    const added: UploadedFile[] = [];
    setBusy(list.length);
    for (const f of list) {
      try {
        const r = await uploadFile(f, purpose);
        added.push({ fileId: r.id, name: r.name, sizeBytes: r.sizeBytes, mimeType: r.mimeType });
      } catch (e) {
        setError(`${f.name}: ${friendlyError(e)}`);
      }
      setBusy((n) => n - 1);
    }
    if (added.length) onChange([...value, ...added]);
    if (input.current) input.current.value = '';
  };

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <ul className="divide-y divide-border rounded-md border border-border" aria-label="Attached files">
          {value.map((f) => (
            <li key={f.fileId} className="flex items-center gap-3 px-3 py-2">
              <FileText className="size-4 shrink-0 text-ink-3" aria-hidden />
              <a href={fileHref(f.fileId)} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-sm text-brand-ink underline-offset-4 hover:underline">
                {f.name}
              </a>
              <span className="t-caption shrink-0 text-ink-3">{kb(f.sizeBytes)}</span>
              <IconButton label={`Remove ${f.name}`} size="icon-sm" variant="ghost" type="button" disabled={disabled} onClick={() => onChange(value.filter((x) => x.fileId !== f.fileId))}>
                <X />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      {!full && (
        <div className="flex flex-wrap items-center gap-3">
          <input ref={input} type="file" className="sr-only" tabIndex={-1} multiple={max > 1} accept={accept} onChange={(e) => void pick(e.target.files)} aria-describedby={hint ? hintId : undefined} disabled={disabled || busy > 0} />
          <Button type="button" variant="secondary" size="sm" disabled={disabled || busy > 0} onClick={() => input.current?.click()}>
            {busy > 0 ? <Loader2 className="animate-spin" /> : <Paperclip />}
            {busy > 0 ? 'Uploading…' : label}
          </Button>
          {hint && (
            <span id={hintId} className="t-caption text-ink-3">
              {hint}
            </span>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="t-caption text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
