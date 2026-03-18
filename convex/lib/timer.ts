/**
 * Compute elapsed milliseconds for a single running segment.
 * Returns 0 if result would be negative.
 */
export function computeElapsedMs(startedAt: number, now: number): number {
  return Math.max(0, now - startedAt);
}

/**
 * Total elapsed time including accumulated time from paused segments.
 * When running: accumulated + (now - startedAt)
 * When paused: just accumulated (startedAt is undefined, pass 0 for both)
 */
export function totalElapsedMs(
  startedAt: number,
  now: number,
  accumulatedMs: number,
): number {
  return accumulatedMs + computeElapsedMs(startedAt, now);
}

/**
 * Convert milliseconds to fractional minutes (for rounding).
 */
export function msToMinutes(ms: number): number {
  return ms / 60_000;
}

/**
 * Get the date string (YYYY-MM-DD) for a timestamp in a given timezone.
 * Used to determine which "day" a time entry belongs to.
 */
export function getDateInTimezone(timestampMs: number, timezone: string): string {
  const date = new Date(timestampMs);
  // Intl.DateTimeFormat gives us the date parts in the target timezone
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = parts.find((p) => p.type === "year")!.value;
  const month = parts.find((p) => p.type === "month")!.value;
  const day = parts.find((p) => p.type === "day")!.value;
  return `${year}-${month}-${day}`;
}
