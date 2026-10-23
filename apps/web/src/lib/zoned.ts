/** Date/time helpers for a school's timezone (`SiteInfo.timezone`), so "publish at 9:00" means 9:00 school time wherever the browser is. */

function parts(instant: Date, tz: string): Record<string, string> {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return Object.fromEntries(f.formatToParts(instant).map((p) => [p.type, p.value]));
}

/** Offset of `tz` from UTC, in minutes, at the given instant. */
function offsetMinutes(instant: Date, tz: string): number {
  const p = parts(instant, tz);
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000);
}

/** `2026-11-02` + `09:30` in `tz` → ISO instant (UTC, with `Z`). */
export function zonedToIso(date: string, time: string, tz: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y!, m! - 1, d!, hh!, mm!);
  let off = offsetMinutes(new Date(guess), tz);
  let t = guess - off * 60000;
  // the offset can differ at the corrected instant (DST edge): re-check once
  const off2 = offsetMinutes(new Date(t), tz);
  if (off2 !== off) {
    off = off2;
    t = guess - off * 60000;
  }
  return new Date(t).toISOString();
}

/** ISO instant → `{ date: 'YYYY-MM-DD', time: 'HH:MM' }` as seen in `tz`. */
export function isoToZoned(iso: string, tz: string): { date: string; time: string } {
  const p = parts(new Date(iso), tz);
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

/** "Mon 2 Nov, 9:30 am" in the school's timezone. */
export function fmtZoned(iso: string | null | undefined, tz: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }): string {
  return iso ? new Intl.DateTimeFormat(undefined, { timeZone: tz, ...opts }).format(new Date(iso)) : '—';
}

/** Today's date (YYYY-MM-DD) in `tz`. */
export function todayIn(tz: string): string {
  return isoToZoned(new Date().toISOString(), tz).date;
}

/** True when `iso` is later than now (kept out of components: the lint rules treat `Date.now()` during render as impure). */
export const isFuture = (iso: string): boolean => new Date(iso).getTime() > Date.now();
/** The same time of day on tomorrow's date (school timezone) as `iso`: a sensible default when re-proposing a slot that has passed. */
export function sameTimeTomorrow(iso: string, tz: string): string {
  return zonedToIso(isoToZoned(new Date(Date.now() + 86_400_000).toISOString(), tz).date, isoToZoned(iso, tz).time, tz);
}
