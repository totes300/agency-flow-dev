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

/** A session this long may be a forgotten timer (the app's stale-timer dialog). */
export const TIMER_STALE_MS = 8 * 60 * 60 * 1000; // 8 hours

/** Shorter sessions are not worth an entry: stop clears the timer without saving. */
export const TIMER_MIN_SAVE_MS = 30_000;

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
 * The measured length of a user's timer session at `now`: running segments
 * plus paused accumulation, capped at `MAX_TIMER_MS`. What `timer.stop`
 * saves (and the MCP timer status shows).
 */
export function timerElapsedMs(
  timer: { timerStatus?: "running" | "paused"; timerStartedAt?: number; timerAccumulatedMs?: number },
  now: number,
): number {
  const accumulated = timer.timerAccumulatedMs ?? 0;
  const raw =
    timer.timerStatus === "running"
      ? totalElapsedMs(timer.timerStartedAt ?? now, now, accumulated)
      : accumulated;
  return Math.min(raw, MAX_TIMER_MS);
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
