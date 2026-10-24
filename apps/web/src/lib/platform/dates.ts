/** Add days to an ISO date (`2026-10-23` + 14 → `2026-11-06`), in UTC so DST never shifts the calendar day. */
export function addDaysIso(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
