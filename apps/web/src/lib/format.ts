/** Number / money / date formatting shared by the screens. Money is always integer minor units from the API. */

const LOCALE_BY_CURRENCY: Record<string, string> = { INR: 'en-IN', USD: 'en-US', GBP: 'en-GB', EUR: 'en-IE', AED: 'en-AE', SGD: 'en-SG' };
const localeFor = (currency: string) => LOCALE_BY_CURRENCY[currency] ?? 'en-US';

export function money(minor: number, currency = 'INR'): string {
  try {
    return new Intl.NumberFormat(localeFor(currency), { style: 'currency', currency, maximumFractionDigits: minor % 100 === 0 ? 0 : 2 }).format(minor / 100);
  } catch {
    return `${currency} ${(minor / 100).toFixed(2)}`;
  }
}

/** ₹6.68Cr style — for figures in stat tiles. */
export function moneyCompact(minor: number, currency = 'INR'): string {
  try {
    return new Intl.NumberFormat(localeFor(currency), { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 2 }).format(minor / 100);
  } catch {
    return money(minor, currency);
  }
}

export const percent = (v: number | null | undefined, digits = 1): string => (v === null || v === undefined ? '—' : `${v.toFixed(digits).replace(/\.0$/, '')}%`);

/** `YYYY-MM-DD` → Date at local midnight (avoids the UTC shift of `new Date('2026-10-21')`). */
export const dateOnly = (s: string): Date => new Date(`${s}T00:00:00`);

export function fmtDate(s: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }): string {
  return s ? new Intl.DateTimeFormat(undefined, opts).format(dateOnly(s.slice(0, 10))) : '—';
}
export const fmtMonth = (ym: string): string => new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' }).format(new Date(`${ym}-01T00:00:00`));
export const fmtMonthShort = (ym: string): string => new Intl.DateTimeFormat(undefined, { month: 'short' }).format(new Date(`${ym}-01T00:00:00`));
export const fmtDay = (s: string): string => new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric' }).format(dateOnly(s));
export const fmtTime = (iso: string): string => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
export const fmtDateTime = (iso: string): string => new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
export const todayIso = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const plural = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** "Today, 5:00 PM" · "Tomorrow, 9:00 AM" · "Mon 27 Oct" — and "Overdue" when already past. */
export function dueLabel(iso: string, now: Date = new Date()): { text: string; overdue: boolean } {
  const d = new Date(iso);
  const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(d);
  if (d.getTime() < now.getTime() && !sameDay(d, now)) return { text: `Due ${new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' }).format(d)}`, overdue: true };
  if (sameDay(d, now)) return { text: `Today, ${time}`, overdue: d.getTime() < now.getTime() };
  if (sameDay(d, tomorrow)) return { text: `Tomorrow, ${time}`, overdue: false };
  return { text: new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' }).format(d), overdue: false };
}

/** "09:30" → "9:30 AM" */
export function fmtClock(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(2000, 0, 1, h, m));
}
