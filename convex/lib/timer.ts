/**
 * Fallback IANA timezone when an org's `orgSettings.timezone` is missing.
 * Single source of truth for the server. The client mirror lives in
 * `lib/hooks/use-org-timezone.ts` and MUST stay in sync.
 */
export const ORG_TIMEZONE_FALLBACK = "America/New_York";

/**
 * Hard ceiling on a single timer session. EVERY path that converts timer
 * state into ledger minutes must apply it — `timer.stop`, the archive
 * auto-save, and impact reporting — otherwise a forgotten weekend timer
 * mints fabricated billable hours.
 */
export const MAX_TIMER_MS = 16 * 60 * 60 * 1000; // 16 hours

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
