import { Readable } from 'node:stream';

export type CsvCell = string | number | boolean | null | undefined;

/** RFC 4180 quoting, plus a guard against spreadsheet formula injection (cells starting with = + - @). */
function cell(v: CsvCell): string {
  if (v == null) return '';
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const line = (cells: CsvCell[]) => `${cells.map(cell).join(',')}\r\n`;

/**
 * Stream rows as CSV. The first row is pulled BEFORE returning, so validation errors thrown by the row source surface as
 * a normal error response instead of a half-written file.
 */
export async function csvStream(header: string[], rows: AsyncGenerator<CsvCell[]>): Promise<Readable> {
  const first = await rows.next();
  async function* gen() {
    yield `﻿${line(header)}`;
    if (first.done) return;
    yield line(first.value);
    for await (const r of rows) yield line(r);
  }
  return Readable.from(gen(), { objectMode: false });
}
