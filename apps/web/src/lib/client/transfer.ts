'use client';

import type { FilePurpose, FileUploadResponse } from '@school-sync/shared';
import { ApiError } from '../problem';
import { readOnlyStore } from './readonly-store';

type Query = Record<string, string | number | boolean | undefined | null>;

const qs = (q?: Query) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q ?? {})) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

async function problem(res: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {}
  const err = ApiError.fromProblem(res.status, body);
  if (err.isReadOnly) readOnlyStore.set(true);
  return err;
}

/** Multipart upload through the BFF (`POST /files`). Throws ApiError (415 / 413 / 402 …) like `bff()`. */
export async function uploadFile(file: File, purpose: FilePurpose, signal?: AbortSignal): Promise<FileUploadResponse> {
  const form = new FormData();
  form.append('file', file);
  let res: Response;
  try {
    res = await fetch(`/api/bff/files${qs({ purpose })}`, { method: 'POST', body: form, credentials: 'same-origin', signal });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new ApiError({ status: 0, code: 'API_UNREACHABLE', title: 'Network error' });
  }
  if (!res.ok) throw await problem(res);
  return (await res.json()) as FileUploadResponse;
}

/** Fetch a file (CSV export, PDF, upload) through the BFF and hand it to the browser as a download. */
export async function downloadFile(path: string, query?: Query, fallbackName = 'download'): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`/api/bff${path.startsWith('/') ? path : `/${path}`}${qs(query)}`, { credentials: 'same-origin' });
  } catch {
    throw new ApiError({ status: 0, code: 'API_UNREACHABLE', title: 'Network error' });
  }
  if (!res.ok) throw await problem(res);
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') ?? '';
  const name = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd)?.[1];
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name ? decodeURIComponent(name) : fallbackName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const MAX_UPLOAD_MB = 10;
