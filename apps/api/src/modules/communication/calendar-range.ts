import { unprocessable } from '../../core/errors';

const MAX_DAYS = 100;

/** The calendar feed is bounded: a valid range of at most ~3 months. */
export function badRequestRange(from: string, to: string): void {
  if (to < from) throw unprocessable('`to` cannot be before `from`', 'RANGE_INVALID');
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  if (days > MAX_DAYS) throw unprocessable(`Ask for at most ${MAX_DAYS} days at a time`, 'RANGE_TOO_LARGE');
}
