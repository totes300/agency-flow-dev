import { useMemo } from "react"
import {
  addDays as addDaysFn,
  format,
  getISOWeek,
  getISOWeekYear,
  startOfISOWeek,
  startOfMonth,
  isSameDay,
} from "date-fns"

// ─── Pure date helpers (testable, no React) ────────────────────────────────────

/** Strip a date to local Y-M-D at 00:00 (kills time-of-day drift). */
export function stripTime(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/** Monday of the ISO week containing `d`, local time. */
export function startOfWeek(d: Date): Date {
  return startOfISOWeek(stripTime(d))
}

/** Add `n` calendar days (handles DST by using local Date arithmetic). */
export function addDays(d: Date, n: number): Date {
  return stripTime(addDaysFn(d, n))
}

/** True when both dates fall in the same ISO week (year + week). */
export function sameWeek(a: Date, b: Date): boolean {
  return (
    getISOWeekYear(a) === getISOWeekYear(b) &&
    getISOWeek(a) === getISOWeek(b)
  )
}

/**
 * Format a Date as `YYYY-Www` (ISO 8601 week, e.g. `2026-W17`).
 * Pad week to two digits.
 */
export function formatIsoWeek(d: Date): string {
  const year = getISOWeekYear(d)
  const week = getISOWeek(d)
  return `${year}-W${String(week).padStart(2, "0")}`
}

const ISO_WEEK_RE = /^(\d{4})-W(\d{2})$/

/**
 * Parse a `YYYY-Www` token. Returns the Monday of that ISO week, or null if
 * the token is malformed or names a week that doesn't exist (e.g. `2025-W53`).
 */
export function parseIsoWeek(token: string): Date | null {
  const match = ISO_WEEK_RE.exec(token)
  if (!match) return null
  const year = Number(match[1])
  const week = Number(match[2])
  if (week < 1 || week > 53) return null

  // Jan 4 is always in ISO week 1 of its ISO year — anchor and walk forward.
  const jan4 = new Date(year, 0, 4)
  const week1Monday = startOfISOWeek(jan4)
  const target = addDaysFn(week1Monday, (week - 1) * 7)

  // Reject overflow (e.g. W53 in a year that only has 52 weeks).
  if (getISOWeekYear(target) !== year || getISOWeek(target) !== week) {
    return null
  }
  return stripTime(target)
}

/** Format a Mon–Fri / Mon–Sun range. Examples:
 *   Apr 21 – 25, 2026
 *   Dec 30, 2025 – Jan 5, 2026     (cross-year)
 *   Mar 30 – Apr 5, 2026           (cross-month)
 */
export function formatRange(start: Date, end: Date): string {
  const sameMonth =
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth()
  const sameYear = start.getFullYear() === end.getFullYear()

  if (sameMonth) {
    return `${format(start, "MMM d")} – ${format(end, "d, yyyy")}`
  }
  if (sameYear) {
    return `${format(start, "MMM d")} – ${format(end, "MMM d, yyyy")}`
  }
  return `${format(start, "MMM d, yyyy")} – ${format(end, "MMM d, yyyy")}`
}

// ─── 6×7 calendar grid generator ───────────────────────────────────────────────

export type CalendarCell = {
  date: Date
  inMonth: boolean
  isToday: boolean
  inSelectedWeek: boolean
}

export type CalendarRow = {
  weekStart: Date
  isSelectedWeek: boolean
  cells: CalendarCell[]
}

/**
 * Build a 6 × 7 month grid (42 cells) starting on the Monday of the week that
 * contains the 1st of the displayed month. Marks today and the selected week.
 */
export function buildMonthGrid(
  displayMonth: Date,
  selectedWeekStart: Date,
  today: Date = new Date(),
): {
  monthLabel: string
  rows: CalendarRow[]
} {
  const todayStripped = stripTime(today)
  const firstOfMonth = startOfMonth(displayMonth)
  const gridStart = startOfWeek(firstOfMonth)

  const rows: CalendarRow[] = []
  for (let r = 0; r < 6; r++) {
    const weekStart = addDays(gridStart, r * 7)
    const cells: CalendarCell[] = []
    for (let c = 0; c < 7; c++) {
      const date = addDays(weekStart, c)
      cells.push({
        date,
        inMonth: date.getMonth() === displayMonth.getMonth(),
        isToday: isSameDay(date, todayStripped),
        inSelectedWeek: sameWeek(date, selectedWeekStart),
      })
    }
    rows.push({
      weekStart,
      isSelectedWeek: sameWeek(weekStart, selectedWeekStart),
      cells,
    })
  }

  return {
    monthLabel: format(displayMonth, "MMMM yyyy"),
    rows,
  }
}

// ─── React hook ────────────────────────────────────────────────────────────────

/** Memoized 6×7 grid for a given displayed month + selected week. */
export function useMonthGrid(displayMonth: Date, selectedWeekStart: Date) {
  // Reduce inputs to primitive keys so referentially-different Dates with the
  // same year/month/Monday don't churn the grid each render.
  const monthKey = `${displayMonth.getFullYear()}-${displayMonth.getMonth()}`
  const selectedKey = selectedWeekStart.getTime()
  return useMemo(
    () => buildMonthGrid(displayMonth, selectedWeekStart),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [monthKey, selectedKey],
  )
}

// ─── YMD helpers (used by the query args) ─────────────────────────────────────

/** Format a Date as `YYYY-MM-DD` (local). */
export function formatYMD(d: Date): string {
  return format(d, "yyyy-MM-dd")
}

/**
 * Compute the inclusive Mon–Fri (or Mon–Sun) range from a week-start Monday.
 * Returns the start/end date strings + each day in the range.
 */
export function weekRange(weekStart: Date, includeWeekend: boolean): {
  startDate: string
  endDate: string
  days: string[]
} {
  const len = includeWeekend ? 7 : 5
  const days: string[] = []
  for (let i = 0; i < len; i++) days.push(formatYMD(addDays(weekStart, i)))
  return { startDate: days[0], endDate: days[days.length - 1], days }
}
