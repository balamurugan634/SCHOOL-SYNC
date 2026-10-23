/** Tiny date helpers on `YYYY-MM-DD` strings (local calendar days; no time zones involved). */

const pad = (n: number) => String(n).padStart(2, '0');
export const isoOf = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseIso = (s: string): Date => new Date(`${s}T00:00:00`);
export const addDaysIso = (s: string, n: number): string => {
  const d = parseIso(s);
  d.setDate(d.getDate() + n);
  return isoOf(d);
};
/** Monday of the week containing `s` (ISO weeks start on Monday). */
export const mondayOf = (s: string): string => {
  const d = parseIso(s);
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow);
  return isoOf(d);
};
export const weekDates = (monday: string): string[] => Array.from({ length: 7 }, (_, i) => addDaysIso(monday, i));
export const startOfMonthIso = (s: string): string => `${s.slice(0, 7)}-01`;
export const daysBetweenIso = (a: string, b: string): number => Math.round((parseIso(b).getTime() - parseIso(a).getTime()) / 86_400_000);
