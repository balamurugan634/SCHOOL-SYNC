/** Tiny CSV helpers for client-side exports (the API has no CSV endpoint for these lists). */
type Cell = string | number | boolean | null | undefined;

const esc = (c: Cell) => {
  const s = c === null || c === undefined ? '' : String(c);
  // neutralise spreadsheet formulas in user-supplied text
  const safe = /^[=+\-@\t\r]/.test(s) && Number.isNaN(Number(s)) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export const toCsv = (header: string[], rows: Cell[][]): string => [header, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');

export function saveText(filename: string, text: string, mime = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob(['﻿', text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
