/**
 * Round raw minutes UP to the nearest rounding increment.
 * rounding <= 1 → just ceil to the nearest minute.
 * 0 input always returns 0 (no phantom time).
 */
export function roundMinutes(raw: number, roundingMinutes: number): number {
  if (raw <= 0) return 0;
  if (roundingMinutes <= 1) return Math.ceil(raw);
  return Math.ceil(raw / roundingMinutes) * roundingMinutes;
}
