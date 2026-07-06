/**
 * Pure helpers for bucketing and labelling YYYY-MM-DD date strings.
 *
 * All math is string-based on YYYY-MM-DD to avoid DST edge cases.
 * "Today" for org-tz-aware labels is computed via
 * `Intl.DateTimeFormat("en-CA", { timeZone })` — the caller passes in the
 * org timezone so grouping boundaries match the dates the server stores.
 */

export type DateGrouping = "day" | "week" | "month"
export type Grouping = DateGrouping | "member" | "task" | "none"

export type DateRangePreset =
  | "this_week"
  | "last_week"
  | "this_month"
  | "last_month"
  | "this_year"
  | "all"
  | "custom"

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const

const MONTHS_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const

const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const

function parseDateParts(date: string): { y: number; m: number; d: number } {
  const [y, m, d] = date.split("-").map(Number)
  return { y, m, d }
}

function pad2(n: number): string {
  return String(n).padStart(2, "0")
}

/** Format a UTC Date as YYYY-MM-DD. */
function utcYmd(date: Date): string {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`
}

/** Create a UTC-anchored Date from a YYYY-MM-DD string. Used purely for
 * day-level arithmetic — never for wall-clock display. */
function toUtcDate(date: string): Date {
  const { y, m, d } = parseDateParts(date)
  return new Date(Date.UTC(y, m - 1, d))
}

/** Get today's date in `timezone` as a YYYY-MM-DD string. */
export function todayInTimezone(timezone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(now)
}

/**
 * Monday of the week containing `date`, as YYYY-MM-DD.
 * Week starts Monday (ISO 8601). Pure string math via UTC arithmetic.
 */
export function mondayOfWeek(date: string): string {
  const d = toUtcDate(date)
  const dow = d.getUTCDay() // 0 = Sun, 1 = Mon, ... 6 = Sat
  const offset = dow === 0 ? -6 : 1 - dow
  d.setUTCDate(d.getUTCDate() + offset)
  return utcYmd(d)
}

/** Sunday of the week containing `date`, as YYYY-MM-DD. */
export function sundayOfWeek(date: string): string {
  const monday = mondayOfWeek(date)
  const d = toUtcDate(monday)
  d.setUTCDate(d.getUTCDate() + 6)
  return utcYmd(d)
}

/** Previous day. */
export function prevDay(date: string): string {
  const d = toUtcDate(date)
  d.setUTCDate(d.getUTCDate() - 1)
  return utcYmd(d)
}

/** First and last day of a calendar month as YYYY-MM-DD strings. */
export function monthBounds(
  year: number,
  monthOneIndexed: number,
): { start: string; end: string } {
  const lastDay = new Date(Date.UTC(year, monthOneIndexed, 0)).getUTCDate()
  const mm = pad2(monthOneIndexed)
  return {
    start: `${year}-${mm}-01`,
    end: `${year}-${mm}-${pad2(lastDay)}`,
  }
}

/**
 * Stable, unambiguous bucket key.
 *   day   → "2026-04-06"
 *   week  → Monday-of-week "2026-04-13" (NOT ISO "YYYY-Www" — avoids
 *           ISO-week vs calendar-year boundary ambiguity)
 *   month → "2026-04"
 */
export function bucketKey(date: string, grouping: DateGrouping): string {
  switch (grouping) {
    case "day":
      return date
    case "week":
      return mondayOfWeek(date)
    case "month":
      return date.slice(0, 7)
  }
}

/**
 * Human-readable group header.
 *   day   → "Today" / "Yesterday" / "Mon, Apr 6, 2026"
 *   week  → "Apr 13–19, 2026" (same month) or "Apr 28 – May 4, 2026"
 *   month → "April 2026"
 */
export function bucketLabel(
  date: string,
  grouping: DateGrouping,
  orgTimezone: string,
  now: Date = new Date(),
): string {
  if (grouping === "month") {
    const { y, m } = parseDateParts(`${date.slice(0, 7)}-01`)
    return `${MONTHS_FULL[m - 1]} ${y}`
  }

  if (grouping === "week") {
    const monday = mondayOfWeek(date)
    const sunday = sundayOfWeek(date)
    const ms = parseDateParts(monday)
    const ss = parseDateParts(sunday)
    if (ms.y === ss.y && ms.m === ss.m) {
      // Same month: "Apr 13–19, 2026"
      return `${MONTHS_SHORT[ms.m - 1]} ${ms.d}–${ss.d}, ${ms.y}`
    }
    if (ms.y === ss.y) {
      // Cross-month, same year: "Apr 28 – May 4, 2026"
      return `${MONTHS_SHORT[ms.m - 1]} ${ms.d} – ${MONTHS_SHORT[ss.m - 1]} ${ss.d}, ${ms.y}`
    }
    // Cross-year: "Dec 29, 2025 – Jan 4, 2026"
    return `${MONTHS_SHORT[ms.m - 1]} ${ms.d}, ${ms.y} – ${MONTHS_SHORT[ss.m - 1]} ${ss.d}, ${ss.y}`
  }

  // day
  const today = todayInTimezone(orgTimezone, now)
  if (date === today) return "Today"
  if (date === prevDay(today)) return "Yesterday"
  const { y, m, d } = parseDateParts(date)
  const weekday = WEEKDAYS_SHORT[toUtcDate(date).getUTCDay()]
  return `${weekday}, ${MONTHS_SHORT[m - 1]} ${d}, ${y}`
}

/**
 * Resolve a preset date range to concrete YYYY-MM-DD bounds in the given
 * timezone. Returns `null` for the "all" preset (caller omits bounds).
 * Returns `null` for "custom" too — caller supplies explicit from/to.
 */
export function resolveDateRangePreset(
  preset: DateRangePreset,
  orgTimezone: string,
  now: Date = new Date(),
): { from: string; to: string } | null {
  const today = todayInTimezone(orgTimezone, now)
  const { y, m } = parseDateParts(today)

  switch (preset) {
    case "all":
    case "custom":
      return null

    case "this_week": {
      return { from: mondayOfWeek(today), to: sundayOfWeek(today) }
    }

    case "last_week": {
      const monday = mondayOfWeek(today)
      const d = toUtcDate(monday)
      d.setUTCDate(d.getUTCDate() - 7)
      const lastMonday = utcYmd(d)
      d.setUTCDate(d.getUTCDate() + 6)
      const lastSunday = utcYmd(d)
      return { from: lastMonday, to: lastSunday }
    }

    case "this_month": {
      const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
      return {
        from: `${y}-${pad2(m)}-01`,
        to: `${y}-${pad2(m)}-${pad2(lastDay)}`,
      }
    }

    case "last_month": {
      const prevMonth = m === 1 ? 12 : m - 1
      const prevYear = m === 1 ? y - 1 : y
      const lastDay = new Date(Date.UTC(prevYear, prevMonth, 0)).getUTCDate()
      return {
        from: `${prevYear}-${pad2(prevMonth)}-01`,
        to: `${prevYear}-${pad2(prevMonth)}-${pad2(lastDay)}`,
      }
    }

    case "this_year": {
      return { from: `${y}-01-01`, to: `${y}-12-31` }
    }
  }
}

export const DATE_RANGE_PRESET_LABELS: Record<DateRangePreset, string> = {
  this_week: "This week",
  last_week: "Last week",
  this_month: "This month",
  last_month: "Last month",
  this_year: "This year",
  all: "All time",
  custom: "Custom…",
}
