'use client';

import type { FilePurpose, FileUploadResponse } from '@school-sync/shared';
import { ApiError } from '../problem';
import { readOnlyStore } from './readonly-store';

export const MAX_UPLOAD_MB = 10;

/** `/api/bff/files/<id>` — files are streamed through the BFF so the cookie session authorises the download. */
export const fileHref = (fileId: string, download = false): string => `/api/bff/files/${fileId}${download ? '?download=1' : ''}`;

/**
 * Multipart upload (`POST /files?purpose=…`) through the BFF. `bff()` is JSON-only, so this builds the FormData itself
 * (no content-type header: the browser adds the boundary). Throws `ApiError` like every other call.
 */
export async function uploadFile(file: File, purpose: FilePurpose, signal?: AbortSignal): Promise<FileUploadResponse> {
  const body = new FormData();
  body.append('file', file, file.name);
  let res: Response;
  try {
    res = await fetch(`/api/bff/files?purpose=${encodeURIComponent(purpose)}`, { method: 'POST', body, credentials: 'same-origin', headers: { accept: 'application/json' }, signal });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new ApiError({ status: 0, code: 'API_UNREACHABLE', title: 'Network error' });
  }
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { detail: text.slice(0, 200) };
    }
  }
  if (!res.ok) {
    const err = ApiError.fromProblem(res.status, data);
    if (err.isReadOnly) readOnlyStore.set(true);
    throw err;
  }
  return data as FileUploadResponse;
}
