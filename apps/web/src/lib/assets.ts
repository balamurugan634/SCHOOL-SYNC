/** API file URLs (`/api/v1/files/<id>`) are served to the browser through the BFF. */
export function assetUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith('/api/v1/')) return `/api/bff/${url.slice('/api/v1/'.length)}`;
  return url;
}
