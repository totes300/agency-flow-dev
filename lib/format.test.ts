import { describe, it, expect } from "vitest"
import {
  formatCurrency,
  formatCurrencyPrecise,
  formatMinutes,
  formatDateToYMD,
  formatRelativeTime,
  formatShortDate,
  getInitials,
  firstName,
  isOverdue,
  getWeekBounds,
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
