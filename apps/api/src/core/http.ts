import { sql, type AnyColumn, type SQL } from 'drizzle-orm';

/** limit/offset from validated `pageQuery` values. */
export const pageArgs = (q: { page: number; pageSize: number }) => ({ limit: q.pageSize, offset: (q.page - 1) * q.pageSize });

/** Standard list envelope: `{ data, meta: { page, pageSize, total, totalPages } }` (matches `paged()` in shared/common). */
export function paged<T>(data: T[], total: number, q: { page: number; pageSize: number }) {
  return { data, meta: { page: q.page, pageSize: q.pageSize, total, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) } };
}

/** Case-insensitive contains, with LIKE wildcards in user input escaped. */
export const ilikeAny = (q: string, ...cols: AnyColumn[]): SQL => {
  const pattern = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
  return sql.join(
    cols.map((c) => sql`${c} ilike ${pattern}`),
    sql` or `,
  );
};

/** Opaque keyset cursor helpers: `encodeCursor({ at, id })` ⇄ `decodeCursor(str)`. */
export const encodeCursor = (v: Record<string, string | number>): string => Buffer.from(JSON.stringify(v)).toString('base64url');
export function decodeCursor<T extends Record<string, string | number>>(c: string | undefined): T | null {
  if (!c) return null;
  try {
    return JSON.parse(Buffer.from(c, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}

/** Today's date (YYYY-MM-DD) in the school's timezone — never use UTC "today" for attendance, due dates, etc. */
export function todayIn(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** ISO weekday (1=Mon … 7=Sun) of a YYYY-MM-DD date. */
export function isoWeekday(date: string): number {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

export function addDaysIso(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
