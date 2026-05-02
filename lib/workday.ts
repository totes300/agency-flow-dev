export const PX_PER_MIN = 40 / 60
export const CAPACITY_MINUTES = 480
export const WORKDAY_HEIGHT_PX = 320 // 8h × 40px/h

/** YYYY-MM-DD in the given IANA timezone. Mirrors the server's
 *  `getDateInTimezone` so client and server agree on "today" for the same org. */
export function getYMDInTimezone(d: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d)
}

/** Local-time Date at midnight whose calendar date equals "today in org tz."
 *  Lets `startOfWeek` and friends produce a Monday consistent with the page's
 *  org-tz "today" highlight. Falls back to `new Date()` when no tz is known. */
export function startOfTodayInTimezone(timezone: string | undefined): Date {
  if (!timezone) return new Date()
  const ymd = getYMDInTimezone(new Date(), timezone)
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!m) return new Date()
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

/** Tz offset (epoch_ms_local − epoch_ms_utc) at a given UTC instant. */
function tzOffsetAt(utcMs: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs))
  const o: Record<string, number> = {}
  for (const p of parts) if (p.type !== "literal") o[p.type] = Number(p.value)
  return Date.UTC(o.year, o.month - 1, o.day, o.hour, o.minute, o.second) - utcMs
}

/** Convert wall-clock parts in a tz to an epoch ms. Single-pass; at DST
 *  boundaries the returned instant may display ±1h off the input HMS, but
 *  its date in `timezone` matches the input date — which is what callers
 *  (and the server's date↔startedAt invariant) actually require. */
export function tzWallToEpoch(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timezone: string,
): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second)
  return guess - tzOffsetAt(guess, timezone)
}

/** Hour/minute/second of a timestamp as observed in a specific timezone. */
export function getHMSInTimezone(
  timestampMs: number,
  timezone: string,
): { hour: number; minute: number; second: number } {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
  const parts = dtf.formatToParts(new Date(timestampMs))
  const o: Record<string, number> = {}
  for (const p of parts) if (p.type !== "literal") o[p.type] = Number(p.value)
  return { hour: o.hour, minute: o.minute, second: o.second }
}

/** Anchor `startedAt` onto `selectedDate` in the org timezone.
 *  Today → real `Date.now()`; past date → noon in org tz. Clamp to
 *  midnight-of-selectedDate so a large duration can't push `startedAt`
 *  onto the previous day and break the server's date↔startedAt invariant. */
export function anchorStartedAt(
  selectedDate: string,
  durationMinutes: number,
  timezone: string,
): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(selectedDate)
  if (!m) return Date.now() - durationMinutes * 60_000
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  const midnight = tzWallToEpoch(y, mo, d, 0, 0, 0, timezone)
  const todayInTz = getYMDInTimezone(new Date(), timezone)
  const anchor =
    selectedDate === todayInTz
      ? Date.now()
      : tzWallToEpoch(y, mo, d, 12, 0, 0, timezone)
  return Math.max(anchor - durationMinutes * 60_000, midnight)
}

/** Move `startedAt` to a different YYYY-MM-DD, preserving the time-of-day
 *  as seen in the org timezone. */
export function reanchorStartedAt(
  originalStartedAt: number,
  newDate: string,
  timezone: string,
): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(newDate)
  if (!m) return originalStartedAt
  const { hour, minute, second } = getHMSInTimezone(originalStartedAt, timezone)
  return tzWallToEpoch(
    Number(m[1]),
    Number(m[2]),
    Number(m[3]),
    hour,
    minute,
    second,
    timezone,
  )
}
