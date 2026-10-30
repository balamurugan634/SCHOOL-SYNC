/**
 * School-local date/time handling. Events store a local date and clock time; meetings store an instant. Providers want the local
 * wall-clock time plus the IANA zone, and a duration that is real elapsed minutes (a meeting that crosses the DST change is
 * an hour shorter or longer than its clock times suggest).
 */

function partsOf(instant: Date, tz: string): Record<string, string> {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return Object.fromEntries(f.formatToParts(instant).map((p) => [p.type, p.value]));
}

/** Offset of `tz` from UTC at that instant, in minutes. */
function offsetMinutes(instant: Date, tz: string): number {
  const p = partsOf(instant, tz);
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60_000);
}

/** `2026-11-02` + `09:30[:00]` in `tz` → the instant. Times that do not exist (spring-forward gap) resolve to just after the gap. */
export function zonedToInstant(date: string, time: string, tz: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm, ss] = time.split(':').map(Number);
  const guess = Date.UTC(y!, m! - 1, d!, hh!, mm!, ss ?? 0);
  const off = offsetMinutes(new Date(guess), tz);
  let t = guess - off * 60_000;
  const off2 = offsetMinutes(new Date(t), tz);
  if (off2 !== off) t = guess - off2 * 60_000;
  return new Date(t);
}

/** The instant as the school's wall clock: `{ date: 'YYYY-MM-DD', time: 'HH:mm:ss' }`. */
export function instantToZoned(instant: Date, tz: string): { date: string; time: string } {
  const p = partsOf(instant, tz);
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}:${p.second}` };
}

export interface Window {
  startLocal: string;
  endLocal: string;
  durationMin: number;
}

const hms = (t: string) => (t.length === 5 ? `${t}:00` : t.slice(0, 8));

/** An event on ONE day from `startTime` to `endTime`. Returns null when the event is not a timed single-day event. */
export function eventWindow(ev: { startDate: string; endDate: string; startTime: string | null; endTime: string | null; allDay: boolean }, tz: string): Window | null {
  if (ev.allDay || !ev.startTime || !ev.endTime || ev.endDate !== ev.startDate) return null;
  const start = zonedToInstant(ev.startDate, ev.startTime, tz);
  const end = zonedToInstant(ev.startDate, ev.endTime, tz);
  const durationMin = Math.round((end.getTime() - start.getTime()) / 60_000);
  if (durationMin < 1) return null;
  return { startLocal: `${ev.startDate}T${hms(ev.startTime)}`, endLocal: `${ev.startDate}T${hms(ev.endTime)}`, durationMin };
}

/** A meeting at an instant for `durationMin` minutes, expressed in the school's local time. */
export function meetingWindow(at: Date, durationMin: number, tz: string): Window {
  const s = instantToZoned(at, tz);
  const e = instantToZoned(new Date(at.getTime() + durationMin * 60_000), tz);
  return { startLocal: `${s.date}T${s.time}`, endLocal: `${e.date}T${e.time}`, durationMin };
}
