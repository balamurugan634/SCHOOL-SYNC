import { addDays, format, parseISO, startOfWeek } from 'date-fns';

/** ISO weekday (1 = Monday … 7 = Sunday) of a `YYYY-MM-DD` date. */
export const isoWeekday = (date: string): number => parseISO(date).getDay() || 7;

export const toIso = (d: Date): string => format(d, 'yyyy-MM-dd');

/** The Monday of the week containing `date`. */
export const mondayOf = (date: string): string => toIso(startOfWeek(parseISO(date), { weekStartsOn: 1 }));

export const shiftDays = (date: string, days: number): string => toIso(addDays(parseISO(date), days));

/** The first date on or after `from` that falls on ISO weekday `day`. */
export function nextDateOnWeekday(from: string, day: number): string {
  const diff = (day - isoWeekday(from) + 7) % 7;
  return shiftDays(from, diff);
}

export const slotKey = (day: number, periodId: string) => `${day}|${periodId}`;

/** What a grid cell holds, whether it comes from the server or from the draft being edited. */
export interface CellLesson {
  /** server slot id (absent for lessons that only exist in a draft) */
  id?: string;
  dayOfWeek: number;
  periodId: string;
  subjectId: string | null;
  subjectName: string | null;
  subjectCode: string | null;
  /** explicit teacher; null = whoever is assigned to the subject in this section */
  staffId: string | null;
  teacherName: string | null;
  room: string | null;
}
