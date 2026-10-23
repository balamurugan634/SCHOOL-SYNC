'use client';

import type { FilePurpose, FileUploadResponse } from '@school-sync/shared';
import { ApiError } from '../problem';
import { readOnlyStore } from './readonly-store';

/**
 * The BFF (`/api/bff/*`) buffers request bodies and Next's proxy only keeps the first 10 MB of one
 * (`experimental.proxyClientMaxBodySize`), so a bigger multipart upload would reach the API cut short.
 * The API itself allows 15 MB; until that Next limit is raised the browser refuses anything above 9 MB up front
 * (leaving room for the multipart framing) instead of sending a truncated file.
 */
export const MAX_UPLOAD_BYTES = 9 * 1024 * 1024;
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

/** Types the API accepts for non-avatar uploads (it re-checks the real bytes; this only avoids a pointless round trip). */
export const UPLOAD_ACCEPT = '.jpg,.jpeg,.png,.webp,.gif,.heic,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,image/*,application/pdf';
export const AVATAR_ACCEPT = 'image/jpeg,image/png,image/webp';

export const fileHref = (fileId: string, download = false): string => `/api/bff/files/${fileId}${download ? '?download=1' : ''}`;

export function formatBytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export type UploadProgress = (pct: number) => void;

/**
 * Multipart upload through the BFF with real upload progress (fetch cannot report it, XMLHttpRequest can).
 * Resolves with the parsed JSON, rejects with an `ApiError` (problem+json, `API_UNREACHABLE` for network failures,
 * `UPLOAD_ABORTED` when cancelled). A 402 flips the app to read-only like every other mutation.
 */
export function uploadMultipart<T>(path: string, file: File, opts: { method?: 'POST' | 'PUT'; query?: Record<string, string>; onProgress?: UploadProgress; signal?: AbortSignal } = {}): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const form = new FormData();
    form.append('file', file, file.name);
    const qs = opts.query ? `?${new URLSearchParams(opts.query).toString()}` : '';
    const xhr = new XMLHttpRequest();
    xhr.open(opts.method ?? 'POST', `/api/bff${path}${qs}`);
    xhr.setRequestHeader('accept', 'application/json');
    xhr.responseType = 'text';
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && opts.onProgress) opts.onProgress(Math.min(99, Math.round((e.loaded / e.total) * 100)));
    };
    xhr.onerror = () => reject(new ApiError({ status: 0, code: 'API_UNREACHABLE', title: 'Network error' }));
    xhr.onabort = () => reject(new ApiError({ status: 0, code: 'UPLOAD_ABORTED', title: 'Upload cancelled', detail: 'The upload was cancelled.' }));
    xhr.onload = () => {
      let data: unknown = null;
      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        data = { detail: xhr.responseText.slice(0, 200) };
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        opts.onProgress?.(100);
        resolve(data as T);
        return;
      }
      const err = ApiError.fromProblem(xhr.status, data);
      if (err.isReadOnly) readOnlyStore.set(true);
      reject(err);
    };
    if (opts.signal) {
      if (opts.signal.aborted) {
        xhr.abort();
        return;
      }
      opts.signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }
    xhr.send(form);
  });
}

/** `POST /files?purpose=…` — the returned `attachment` goes straight into an `attachments` array. */
export const uploadFile = (file: File, purpose: FilePurpose, opts: { onProgress?: UploadProgress; signal?: AbortSignal } = {}) => uploadMultipart<FileUploadResponse>('/files', file, { query: { purpose }, ...opts });

/** Client-side pre-check; returns a human message or null. */
export function checkUpload(file: File, max = MAX_UPLOAD_BYTES): string | null {
  if (file.size === 0) return `“${file.name}” is empty.`;
  if (file.size > max) return `“${file.name}” is ${formatBytes(file.size)}. The limit is ${formatBytes(max)} — please pick a smaller file or compress it.`;
  return null;
}
