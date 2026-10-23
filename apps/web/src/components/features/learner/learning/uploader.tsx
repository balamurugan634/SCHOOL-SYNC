'use client';

import * as React from 'react';
import { AlertCircle, CheckCircle2, FileText, Loader2, RotateCw, Trash2, UploadCloud, X } from 'lucide-react';
import type { FilePurpose, LearningAttachmentRef } from '@school-sync/shared';
import { bff } from '@/lib/client/fetcher';
import { checkUpload, formatBytes, MAX_UPLOAD_BYTES, UPLOAD_ACCEPT, uploadFile } from '@/lib/client/learner-files';
import { ApiError, errorMessage } from '@/lib/problem';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { ProgressBar } from '@/components/ui/progress';

export interface UploadItem {
  key: string;
  name: string;
  size: number;
  status: 'uploading' | 'done' | 'error';
  progress: number;
  ref?: LearningAttachmentRef;
  error?: string;
  /** kept so a failed upload can be retried without picking the file again */
  file?: File;
  /** already attached to the saved submission (not uploaded in this session) */
  existing?: boolean;
}

/** Upload state for an attachment list: progress per file, cancel, retry, remove. Files go to `POST /files?purpose=…` as soon as they are chosen. */
export function useAttachmentUploads(initial: LearningAttachmentRef[], purpose: FilePurpose, max = 10) {
  const [items, setItems] = React.useState<UploadItem[]>(() => initial.map((a) => ({ key: a.fileId, name: a.name, size: a.sizeBytes ?? 0, status: 'done', progress: 100, ref: a, existing: true })));
  const itemsRef = React.useRef(items);
  React.useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  const aborts = React.useRef(new Map<string, AbortController>());
  const [notice, setNotice] = React.useState<string | null>(null);
  const [changed, setChanged] = React.useState(false);

  const patch = React.useCallback((key: string, p: Partial<UploadItem>) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...p } : x))), []);

  const start = React.useCallback(
    async (key: string, file: File) => {
      const ctl = new AbortController();
      aborts.current.set(key, ctl);
      patch(key, { status: 'uploading', progress: 0, error: undefined });
      try {
        const res = await uploadFile(file, purpose, { signal: ctl.signal, onProgress: (pct) => patch(key, { progress: pct }) });
        patch(key, { status: 'done', progress: 100, ref: { fileId: res.id, name: res.name, mimeType: res.mimeType, sizeBytes: res.sizeBytes }, file: undefined });
      } catch (e) {
        if (e instanceof ApiError && e.code === 'UPLOAD_ABORTED') return;
        patch(key, { status: 'error', error: uploadMessage(e) });
      } finally {
        aborts.current.delete(key);
      }
    },
    [patch, purpose],
  );

  const add = React.useCallback(
    (files: FileList | File[]) => {
      setNotice(null);
      const list = Array.from(files);
      const room = max - items.length;
      if (room <= 0) {
        setNotice(`You can attach up to ${max} files.`);
        return;
      }
      const accepted: File[] = [];
      const problems: string[] = [];
      for (const f of list.slice(0, room)) {
        const p = checkUpload(f);
        if (p) problems.push(p);
        else accepted.push(f);
      }
      if (list.length > room) problems.push(`Only ${max} files fit — ${list.length - room} not added.`);
      if (problems.length) setNotice(problems.join(' '));
      if (accepted.length === 0) return;
      setChanged(true);
      const added = accepted.map((file) => ({ key: `${Date.now()}-${Math.random().toString(36).slice(2)}`, name: file.name, size: file.size, status: 'uploading' as const, progress: 0, file }));
      setItems((xs) => [...xs, ...added]);
      for (const a of added) void start(a.key, a.file!);
    },
    [items.length, max, start],
  );

  const remove = React.useCallback(
    (key: string) => {
      setChanged(true);
      aborts.current.get(key)?.abort();
      const gone = itemsRef.current.find((x) => x.key === key);
      // a file uploaded in this session and never attached to anything can be discarded on the server too (best effort)
      if (gone?.ref && !gone.existing) void bff(`/files/${gone.ref.fileId}`, { method: 'DELETE' }).catch(() => undefined);
      setItems((xs) => xs.filter((x) => x.key !== key));
    },
    [],
  );

  const retry = React.useCallback(
    (key: string) => {
      const it = itemsRef.current.find((x) => x.key === key);
      if (it?.file) void start(key, it.file);
    },
    [start],
  );

  React.useEffect(() => {
    const m = aborts.current;
    return () => m.forEach((c) => c.abort());
  }, []);

  const refs = items.filter((i) => i.status === 'done' && i.ref).map((i) => i.ref!);
  return { items, add, remove, retry, notice, setNotice, busy: items.some((i) => i.status === 'uploading'), failed: items.some((i) => i.status === 'error'), refs, changed, count: items.length, max };
}

function uploadMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'API_UNREACHABLE') return 'The connection dropped. Check your internet and retry.';
    if (e.code === 'FILE_TYPE_NOT_ALLOWED') return e.detail ?? 'That file type isn’t allowed. Use a photo, PDF or Office document.';
    if (e.code === 'PAYLOAD_TOO_LARGE') return e.detail ?? 'That file is too large.';
    if (e.status === 403) return 'You can’t upload files for this right now.';
  }
  return errorMessage(e, 'The upload failed. Please try again.');
}

/** Drag-and-drop zone + file list. The zone is also a real button, so it works with a keyboard and on phones. */
export function AttachmentPicker({ uploads, disabled, label = 'Attach files' }: { uploads: ReturnType<typeof useAttachmentUploads>; disabled?: boolean; label?: string }) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [over, setOver] = React.useState(false);
  const { items } = uploads;
  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (!disabled && e.dataTransfer.files.length) uploads.add(e.dataTransfer.files);
        }}
        className={cn('flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-5 text-center', over ? 'border-brand bg-brand-soft' : 'border-border-strong bg-surface-subtle')}
      >
        <UploadCloud className="size-5 text-ink-3" aria-hidden />
        <p className="text-sm text-ink-2">Drop files here, or</p>
        <Button type="button" variant="secondary" size="sm" disabled={disabled || uploads.count >= uploads.max} onClick={() => inputRef.current?.click()}>
          {label}
        </Button>
        <p className="t-caption text-ink-3">Photos, PDF or Office files · up to {formatBytes(MAX_UPLOAD_BYTES)} each · max {uploads.max} files</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={UPLOAD_ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-label={label}
          onChange={(e) => {
            if (e.target.files?.length) uploads.add(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      {uploads.notice && (
        <p role="alert" className="t-caption flex items-start gap-1.5 text-danger">
          <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden /> {uploads.notice}
        </p>
      )}
      {items.length > 0 && (
        <ul className="space-y-2" aria-label="Files to hand in" aria-live="polite">
          {items.map((it) => (
            <li key={it.key} className="rounded-md border border-border bg-surface px-3 py-2.5">
              <div className="flex items-center gap-3">
                {it.status === 'uploading' ? <Loader2 className="size-4 shrink-0 animate-spin text-ink-3 motion-reduce:animate-none" aria-hidden /> : it.status === 'error' ? <AlertCircle className="size-4 shrink-0 text-danger" aria-hidden /> : <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden />}
                <FileText className="size-4 shrink-0 text-ink-3" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{it.name}</span>
                  <span className="t-caption block text-ink-2">
                    {formatBytes(it.size)}
                    {it.status === 'uploading' ? ` · uploading ${it.progress}%` : it.status === 'done' ? ' · ready' : ''}
                  </span>
                </span>
                {it.status === 'error' && it.file && (
                  <Button type="button" variant="secondary" size="sm" onClick={() => uploads.retry(it.key)}>
                    <RotateCw /> Retry
                  </Button>
                )}
                <IconButton label={it.status === 'uploading' ? `Cancel upload of ${it.name}` : `Remove ${it.name}`} size="icon-sm" type="button" onClick={() => uploads.remove(it.key)}>
                  {it.status === 'uploading' ? <X /> : <Trash2 />}
                </IconButton>
              </div>
              {it.status === 'uploading' && <ProgressBar className="mt-2" value={it.progress} label={`Uploading ${it.name}`} />}
              {it.status === 'error' && <p className="t-caption mt-1.5 text-danger">{it.error}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
