import { describe, it, expect } from "vitest"
import {
  formatCurrency,
  formatCurrencyPrecise,
  formatMinutes,
  formatDateToYMD,
  formatRelativeTime,
  formatShortDate,
  formatLastInvoiced,
  daysSinceLastInvoice,
  getInitials,
  firstName,
  isOverdue,
  getWeekBounds,
  buildCycleMonths,
  formatCycleLabel,
} from "./format"

// ─── formatCurrency ─────────────────────────────────────────────────────────────

describe("formatCurrency", () => {
  it("formats USD with no decimals", () => {
    expect(formatCurrency(1234, "USD")).toBe("$1,234")
  })
  it("formats zero", () => {
    expect(formatCurrency(0, "USD")).toBe("$0")
  })
  it("formats negative amounts", () => {
    expect(formatCurrency(-500, "USD")).toBe("-$500")
  })
  it("formats EUR", () => {
    const result = formatCurrency(1000, "EUR")
    expect(result).toContain("1,000")
  })
  it("formats large numbers", () => {
    expect(formatCurrency(1000000, "USD")).toBe("$1,000,000")
  })
})

// ─── formatCurrencyPrecise ──────────────────────────────────────────────────────

describe("formatCurrencyPrecise", () => {
  it("formats with 2 decimal places", () => {
    expect(formatCurrencyPrecise(1234.56, "USD")).toBe("$1,234.56")
  })
  it("pads cents", () => {
    expect(formatCurrencyPrecise(100, "USD")).toBe("$100.00")
  })
})

// ─── formatMinutes ──────────────────────────────────────────────────────────────

describe("formatMinutes", () => {
  it("formats zero", () => {
    expect(formatMinutes(0)).toBe("00:00")
  })
  it("formats 90 minutes as 01:30", () => {
    expect(formatMinutes(90)).toBe("01:30")
  })
  it("formats 630 minutes as 10:30", () => {
    expect(formatMinutes(630)).toBe("10:30")
  })
  it("formats negative minutes", () => {
    expect(formatMinutes(-90)).toBe("-01:30")
  })
  it("formats single-digit minutes", () => {
    expect(formatMinutes(5)).toBe("00:05")
  })
})

// ─── formatDateToYMD ────────────────────────────────────────────────────────────

describe("formatDateToYMD", () => {
  it("formats a date correctly", () => {
    expect(formatDateToYMD(new Date(2026, 2, 19))).toBe("2026-03-19")
  })
  it("pads single-digit month and day", () => {
    expect(formatDateToYMD(new Date(2026, 0, 5))).toBe("2026-01-05")
  })
})

// ─── formatRelativeTime ─────────────────────────────────────────────────────────

describe("formatRelativeTime", () => {
  const NOW = 1710864000000 // fixed reference point

  it("returns 'just now' for < 1 minute", () => {
    expect(formatRelativeTime(NOW - 30000, NOW)).toBe("just now")
  })
  it("returns minutes for < 1 hour", () => {
    expect(formatRelativeTime(NOW - 5 * 60000, NOW)).toBe("5m ago")
  })
  it("returns hours for < 24 hours", () => {
    expect(formatRelativeTime(NOW - 3 * 3600000, NOW)).toBe("3h ago")
  })
  it("returns days for >= 24 hours", () => {
    expect(formatRelativeTime(NOW - 2 * 86400000, NOW)).toBe("2d ago")
  })
})

// ─── formatShortDate ────────────────────────────────────────────────────────────

describe("formatShortDate", () => {
  it("formats YYYY-MM-DD to short date", () => {
    const result = formatShortDate("2026-03-20")
    expect(result).toBe("Mar 20")
  })
  it("formats another date", () => {
    const result = formatShortDate("2026-12-25")
    expect(result).toBe("Dec 25")
  })
})

// ─── formatLastInvoiced ─────────────────────────────────────────────────────────

describe("formatLastInvoiced", () => {
  // Anchor at Mar 19 2026 12:00 UTC. Boundaries are computed in `tz`.
  const tz = "UTC"
  const now = new Date(Date.UTC(2026, 2, 19, 12, 0, 0))
  const daysAgo = (n: number) => new Date(Date.UTC(2026, 2, 19 - n, 12, 0, 0))

  it("returns empty string for null", () => {
    expect(formatLastInvoiced(null, { now, timezone: tz })).toBe("")
  })
  it("returns 'today' for same day (0d)", () => {
    expect(formatLastInvoiced(daysAgo(0), { now, timezone: tz })).toBe("today")
  })
  it("returns 'yesterday' for 1 day ago", () => {
    expect(formatLastInvoiced(daysAgo(1), { now, timezone: tz })).toBe("yesterday")
  })
  it("returns 'N days ago' for 13 days ago", () => {
    expect(formatLastInvoiced(daysAgo(13), { now, timezone: tz })).toBe("13 days ago")
  })
  it("switches to absolute date at 14-day boundary", () => {
    expect(formatLastInvoiced(daysAgo(14), { now, timezone: tz })).toBe("Mar 5, 2026")
  })
  it("returns absolute date for 60 days ago", () => {
    expect(formatLastInvoiced(daysAgo(60), { now, timezone: tz })).toBe("Jan 18, 2026")
  })
  it("returns absolute date for ~1 year ago", () => {
    expect(
      formatLastInvoiced(new Date(Date.UTC(2025, 2, 19, 12, 0, 0)), { now, timezone: tz }),
    ).toBe("Mar 19, 2025")
  })
  it("accepts a numeric (millisecond) timestamp", () => {
    expect(formatLastInvoiced(daysAgo(1).getTime(), { now, timezone: tz })).toBe("yesterday")
  })
  it("respects the requested timezone — same UTC instant, different calendar day", () => {
    // Mar 19 02:00 UTC = Mar 18 22:00 NYC = Mar 19 11:00 Tokyo.
    const stamp = new Date(Date.UTC(2026, 2, 19, 2, 0, 0))
    const probe = new Date(Date.UTC(2026, 2, 19, 14, 0, 0)) // Mar 19 10:00 NYC, Mar 19 23:00 Tokyo
    expect(formatLastInvoiced(stamp, { now: probe, timezone: "America/New_York" })).toBe("yesterday")
    expect(formatLastInvoiced(stamp, { now: probe, timezone: "Asia/Tokyo" })).toBe("today")
  })
  it("DST-safe — 'yesterday' holds across US spring-forward", () => {
    // 2026-03-08 = US DST start (02:00 EST → 03:00 EDT). Calendar diff stays 1.
    const dayBefore = new Date(Date.UTC(2026, 2, 7, 22, 0, 0))
    const today = new Date(Date.UTC(2026, 2, 8, 22, 0, 0))
    expect(formatLastInvoiced(dayBefore, { now: today, timezone: "America/New_York" })).toBe("yesterday")
  })
})

// ─── daysSinceLastInvoice ───────────────────────────────────────────────────────

describe("daysSinceLastInvoice", () => {
  const tz = "UTC"
  const now = new Date(Date.UTC(2026, 2, 19, 12, 0, 0))

  it("returns null when there is no last invoice", () => {
    expect(daysSinceLastInvoice(null, { now, timezone: tz })).toBe(null)
  })
  it("returns 0 for today", () => {
    expect(daysSinceLastInvoice(now.getTime(), { now, timezone: tz })).toBe(0)
  })
  it("returns N for N days ago", () => {
    const ts = Date.UTC(2026, 2, 19 - 30, 12, 0, 0) // 30 days
    expect(daysSinceLastInvoice(ts, { now, timezone: tz })).toBe(30)
  })
  it("agrees with formatLastInvoiced on the boundary", () => {
    const ts = Date.UTC(2026, 2, 19 - 14, 12, 0, 0)
    expect(daysSinceLastInvoice(ts, { now, timezone: tz })).toBe(14)
    expect(formatLastInvoiced(ts, { now, timezone: tz })).toBe("Mar 5, 2026")
  })
})

// ─── getInitials ────────────────────────────────────────────────────────────────

describe("getInitials", () => {
  it("extracts two initials from full name", () => {
    expect(getInitials("John Doe")).toBe("JD")
  })
  it("extracts first char from single word", () => {
    expect(getInitials("Alice")).toBe("A")
  })
  it("returns ? for empty string", () => {
    expect(getInitials("")).toBe("?")
  })
  it("returns ? for null", () => {
    expect(getInitials(null)).toBe("?")
  })
  it("returns ? for undefined", () => {
    expect(getInitials(undefined)).toBe("?")
  })
  it("handles three-word names", () => {
    expect(getInitials("John Michael Doe")).toBe("JM")
  })
})

// ─── firstName ──────────────────────────────────────────────────────────────────

describe("firstName", () => {
  it("extracts first name", () => {
    expect(firstName("John Doe")).toBe("John")
  })
  it("returns single name as-is", () => {
    expect(firstName("Alice")).toBe("Alice")
  })
})

// ─── isOverdue ──────────────────────────────────────────────────────────────────

describe("isOverdue", () => {
  const today = new Date(2026, 2, 19) // March 19, 2026

  it("returns false for null", () => {
    expect(isOverdue(null, today)).toBe(false)
  })
  it("returns false for undefined", () => {
    expect(isOverdue(undefined, today)).toBe(false)
  })
  it("returns false for today's date", () => {
    expect(isOverdue("2026-03-19", today)).toBe(false)
  })
  it("returns true for yesterday", () => {
    expect(isOverdue("2026-03-18", today)).toBe(true)
  })
  it("returns false for tomorrow", () => {
    expect(isOverdue("2026-03-20", today)).toBe(false)
  })
  it("returns true for a date far in the past", () => {
    expect(isOverdue("2020-01-01", today)).toBe(true)
  })
  it("returns false for empty string", () => {
    expect(isOverdue("", today)).toBe(false)
  })
})

// ─── getWeekBounds ──────────────────────────────────────────────────────────────

describe("getWeekBounds", () => {
  // Wednesday, March 19, 2026
  const wednesday = new Date(2026, 2, 19, 12, 0, 0)

  it("returns this week's Monday-Sunday for offset 0", () => {
    const { start, end } = getWeekBounds(0, wednesday)
    expect(start).toBe("2026-03-16") // Monday
    expect(end).toBe("2026-03-22") // Sunday
  })
  it("returns last week for offset -1", () => {
    const { start, end } = getWeekBounds(-1, wednesday)
    expect(start).toBe("2026-03-09")
    expect(end).toBe("2026-03-15")
  })
  it("returns next week for offset 1", () => {
    const { start, end } = getWeekBounds(1, wednesday)
    expect(start).toBe("2026-03-23")
    expect(end).toBe("2026-03-29")
  })
  it("handles Sunday correctly (offset 0)", () => {
    const sunday = new Date(2026, 2, 22, 12, 0, 0) // Sunday March 22
    const { start, end } = getWeekBounds(0, sunday)
    expect(start).toBe("2026-03-16") // Monday of same week
    expect(end).toBe("2026-03-22") // Sunday
  })
  it("handles Monday correctly (offset 0)", () => {
    const monday = new Date(2026, 2, 16, 12, 0, 0)
    const { start, end } = getWeekBounds(0, monday)
    expect(start).toBe("2026-03-16")
    expect(end).toBe("2026-03-22")
  })
})

// ─── Cycle range helpers ────────────────────────────────────────────────────────
//
// Pins the codebase-wide convention: month is 1-indexed (1=Jan…12=Dec) on
// every API. Both `buildCycleMonths` and `formatCycleLabel` consume that.
// Round-tripping the pair guards against silent off-by-one regressions in
// either direction (the bug that originally sent us here).

describe("buildCycleMonths", () => {
  it("walks back from the closing month, 1-indexed", () => {
    expect(buildCycleMonths(2026, 4, 3)).toEqual([
      { year: 2026, month: 2 },
      { year: 2026, month: 3 },
      { year: 2026, month: 4 },
    ])
  })
  it("crosses the year boundary cleanly", () => {
    expect(buildCycleMonths(2027, 2, 4)).toEqual([
      { year: 2026, month: 11 },
      { year: 2026, month: 12 },
      { year: 2027, month: 1 },
      { year: 2027, month: 2 },
    ])
  })
  it("degenerate cycleLength <1 returns just the closing month", () => {
    expect(buildCycleMonths(2026, 7, 0)).toEqual([{ year: 2026, month: 7 }])
  })
})

describe("formatCycleLabel", () => {
  it("formats a same-year range with bare short months", () => {
    expect(
      formatCycleLabel([
        { year: 2026, month: 2 },
        { year: 2026, month: 3 },
        { year: 2026, month: 4 },
      ]),
    ).toBe("Feb–Apr")
  })
  it("falls back to month + year on cross-year ranges", () => {
    expect(
      formatCycleLabel([
        { year: 2026, month: 12 },
        { year: 2027, month: 1 },
        { year: 2027, month: 2 },
      ]),
    ).toBe("Dec 2026 – Feb 2027")
  })
  it("is the inverse of buildCycleMonths for any closing month", () => {
    // Round-trip pin: closing April 2026, 3-month cycle → "Feb–Apr".
    expect(formatCycleLabel(buildCycleMonths(2026, 4, 3))).toBe("Feb–Apr")
    // Closing January 2027, 3-month cycle → "Nov 2026 – Jan 2027".
    expect(formatCycleLabel(buildCycleMonths(2027, 1, 3))).toBe(
      "Nov 2026 – Jan 2027",
    )
  })
  it("handles empty input safely", () => {
    expect(formatCycleLabel([])).toBe("")
  })
})
