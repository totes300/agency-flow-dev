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

/** Anchor `startedAt` onto `selectedDate` at the current wall-clock HH:MM,
 *  then subtract duration. Clamped to midnight of the selected date so a
 *  near-midnight log doesn't strand `startedAt` on the previous day while
 *  `date` stays today. */
export function anchorStartedAt(selectedDate: string, durationMinutes: number): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(selectedDate)
  if (!m) return Date.now() - durationMinutes * 60_000
  const y = Number(m[1])
  const mo = Number(m[2]) - 1
  const d = Number(m[3])
  const now = new Date()
  const anchor = new Date(y, mo, d, now.getHours(), now.getMinutes(), now.getSeconds(), 0).getTime()
  const midnight = new Date(y, mo, d, 0, 0, 0, 0).getTime()
  return Math.max(anchor - durationMinutes * 60_000, midnight)
}

/** Move `startedAt` to a different YYYY-MM-DD, preserving time-of-day. Used
 *  by the edit form when the user moves an entry to a new date. */
export function reanchorStartedAt(originalStartedAt: number, newDate: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(newDate)
  if (!m) return originalStartedAt
  const old = new Date(originalStartedAt)
  return new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    old.getHours(),
    old.getMinutes(),
    old.getSeconds(),
    old.getMilliseconds(),
  ).getTime()
}
